import type { RawReq } from './types';

// A prerequisite tree: a course code, or all-of / any-of a list of subtrees.
export type Req = { code: string } | { op: 'and' | 'or'; items: Req[] };

// One checkable requirement. `concurrent`: may be taken in the same term.
export type ParsedReq = { tree: Req; concurrent: boolean };

// Flatten nested same-op groups, drop duplicates, unwrap single-item groups.
function group(op: 'and' | 'or', items: (Req | null)[]): Req | null {
  const flat: Req[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it) continue;
    for (const child of 'op' in it && it.op === op ? it.items : [it]) {
      const key = JSON.stringify(child);
      if (!seen.has(key)) {
        seen.add(key);
        flat.push(child);
      }
    }
  }
  if (!flat.length) return null;
  return flat.length === 1 ? flat[0] : { op, items: flat };
}

// JHU SIS expression: "A[C]^OR^(^B[C]^AND^C[C]^)". AND binds tighter than OR.
export function parseSisExpr(expr: string): Req | null {
  const tokens = expr.split('^').map((t) => t.trim()).filter(Boolean);
  let i = 0;
  const atom = (): Req | null => {
    const t = tokens[i++];
    if (t === '(') {
      const inner = or();
      if (tokens[i] === ')') i++;
      return inner;
    }
    const code = t?.match(/^[A-Z]{2}\.\d{3}\.\d{3}/)?.[0];
    return code ? { code } : null;
  };
  const and = (): Req | null => {
    const items = [atom()];
    while (tokens[i] === 'AND') {
      i++;
      items.push(atom());
    }
    return group('and', items);
  };
  function or(): Req | null {
    const items = [and()];
    while (tokens[i] === 'OR') {
      i++;
      items.push(and());
    }
    return group('or', items);
  }
  const tree = or();
  return i >= tokens.length ? tree : null; // leftover tokens: don't trust the parse
}

type Tok = { t: 'code'; code: string } | { t: 'and' | 'or' | ',' | ';' | '(' | ')' };

const TOKEN =
  /([A-Z]{2}\.\d{3}\.\d{3})|([A-Z]{2,5}) (\d{2,4}[A-Z]?)\b|\b(\d{2,4}[A-Z]?)\b|\b(and|or)\b|([,;()&])/g;

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  let subject = '';
  let lastEnd = 0;
  for (const m of text.matchAll(TOKEN)) {
    const gap = text.slice(lastEnd, m.index);
    if (m[1]) toks.push({ t: 'code', code: m[1] });
    else if (m[2]) {
      subject = m[2];
      toks.push({ t: 'code', code: `${m[2]} ${m[3]}` });
    } else if (m[4]) {
      // a bare number is a course only as "MATH 110 and 130": right after a
      // connective that itself follows a course code
      const prev = toks.at(-1);
      const before = toks.at(-2);
      const isCourse =
        subject && !gap.trim() && prev && prev.t !== 'code' && prev.t !== '(' && before?.t === 'code';
      if (!isCourse) continue;
      toks.push({ t: 'code', code: `${subject} ${m[4]}` });
    } else if (m[5]) toks.push({ t: m[5].toLowerCase() as 'and' | 'or' });
    else toks.push({ t: m[6] === '&' ? 'and' : (m[6] as ',' | ';' | '(' | ')') });
    lastEnd = m.index + m[0].length;
  }
  // ", and" / ", or" is one connective
  return toks.filter((tok, i) => !(tok.t === ',' && ['and', 'or'].includes(toks[i + 1]?.t)));
}

// Split a token list on top-level (outside parentheses) separators.
function split(toks: Tok[], seps: string[]): Tok[][] {
  const parts: Tok[][] = [[]];
  let depth = 0;
  for (const tok of toks) {
    if (tok.t === '(') depth++;
    if (tok.t === ')') depth--;
    if (depth === 0 && seps.includes(tok.t)) parts.push([]);
    else parts.at(-1)!.push(tok);
  }
  return parts;
}

// A list element: codes and parenthesized groups with no connective between.
// undefined = nothing recognizable (e.g. "placement by the department").
function element(toks: Tok[]): Req | null | undefined {
  const items: (Req | null)[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.t === 'code') items.push({ code: tok.code });
    else if (tok.t === '(') {
      let depth = 1;
      let j = i + 1;
      for (; j < toks.length && depth; j++) {
        if (toks[j].t === '(') depth++;
        if (toks[j].t === ')') depth--;
      }
      items.push(list(toks.slice(i + 1, j - 1)));
      i = j - 1;
    }
  }
  return items.length ? group('and', items) : undefined;
}

// "A, B, or C" is any-of; "A, B and C" is all-of. An any-of list with an
// unrecognizable alternative can't be checked, so it is dropped entirely.
function piece(toks: Tok[]): Req | null {
  const isOr = split(toks, ['or']).length > 1;
  const elems = split(toks, ['or', ',']).map(element);
  if (isOr && elems.some((e) => e == null)) return null;
  return group(isOr ? 'or' : 'and', elems.map((e) => e ?? null));
}

function list(toks: Tok[]): Req | null {
  const parts = split(toks, [';']).filter((p) => p.length);
  // "A; or B; or C and D" — semicolons joined by a leading "or" are any-of
  const semiOr = parts.slice(1).some((p) => p[0].t === 'or');
  const trees = parts.map((p) => {
    while (p[0]?.t === ',' || (semiOr && p[0]?.t === 'or')) p = p.slice(1);
    return group('and', split(p, ['and']).map(piece));
  });
  return group(semiOr ? 'or' : 'and', trees);
}

const CONCURRENT = /concurrent|same time|simultaneous|during enrollment|pre-?\s*or\s*co-?requisite/i;

// Bulletin text -> requirement trees. Only what can be read reliably is kept:
// the caller shows the raw text either way.
export function parsePrereqText(text: string): ParsedReq[] {
  const cleaned = text
    // "C- or better", "5 or higher": the "or" is not an alternative
    .replace(/\b(?:[A-DFPS][+-]?|\d)\s+or\s+(?:better|higher|above)\b/gi, '')
    // an escape hatch everyone has; it shouldn't cancel the requirement
    .replace(/[;,]?\s*(?:or\s+)?(?:with\s+)?permission of the \w+[^;.]*/gi, '')
    .replace(/\bor equivalent\b/gi, '');
  const out: ParsedReq[] = [];
  // UNC writes "Prerequisites, A and B; Corequisite, C." in one string
  for (const seg of cleaned.split(/(?=\b(?:pre-?\s*or\s*co-?requisites?|co-?requisites?|pre-?requisites?)\b)/i)) {
    if (/^co-?requisite/i.test(seg)) continue; // corequisites are shown, not checked
    const tree = list(tokenize(seg.replace(/^pre-?\s*or\s*co-?requisites?|^pre-?requisites?/i, '')));
    if (tree) out.push({ tree, concurrent: CONCURRENT.test(seg) });
  }
  return out;
}

export function parseRawReqs(raw: RawReq[] | undefined): ParsedReq[] {
  const out: ParsedReq[] = [];
  for (const r of raw ?? []) {
    if (r.negative) continue; // antirequisite: "can't take both", not a prerequisite
    if (r.expr) {
      const tree = parseSisExpr(r.expr);
      if (tree) out.push({ tree, concurrent: CONCURRENT.test(r.text) });
    } else {
      out.push(...parsePrereqText(r.text));
    }
  }
  return out;
}

function prune(req: Req, keep: (code: string) => boolean): Req | null {
  if ('code' in req) return keep(req.code) ? req : null;
  return group(req.op, req.items.map((it) => prune(it, keep)));
}

function missing(req: Req, have: Set<string>): Req | null {
  if ('code' in req) return have.has(req.code) ? null : req;
  const rest = req.items.map((it) => missing(it, have));
  if (req.op === 'or' && rest.some((r) => r === null)) return null;
  return group(req.op, rest);
}

// The part of `req` still missing given the courses in `have`, or null if met.
// Codes that fail `known` (lab-safety trainings, retired course numbers) can't
// be placed in a plan, so they are ignored rather than reported forever.
export function unmet(
  req: Req,
  have: Set<string>,
  known: (code: string) => boolean = () => true
): Req | null {
  const checkable = prune(req, (c) => have.has(c) || known(c));
  return checkable && missing(checkable, have);
}

export function fmtReq(req: Req, nested = false): string {
  if ('code' in req) return req.code;
  const s = req.items.map((it) => fmtReq(it, true)).join(req.op === 'and' ? ' and ' : ' or ');
  return nested ? `(${s})` : s;
}
