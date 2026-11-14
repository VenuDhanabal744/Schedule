// Builds server/data/requirements/generated/<school>.json: one requirement
// template per bachelor's program, read from the course-list tables on each
// school's catalog pages (all three run CourseLeaf). Run locally and commit:
//
//   npm run requirements -- jhu|temple|unc
//
// The result is a best-effort reading of the major's own course lists — not
// university or school-wide requirements, and not prose-only rules, which come
// out as TODO groups to assign by hand. Hand-written templates in
// server/data/requirements/*.json take precedence (see the README).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRetry, pool } from './details.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'data', 'requirements', 'generated');

const CATALOGS = {
  jhu: 'https://e-catalogue.jhu.edu',
  temple: 'https://bulletin.temple.edu',
  unc: 'https://catalog.unc.edu',
};

export const text = (html) =>
  String(html ?? '')
    .replace(/<sup>.*?<\/sup>/gs, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;| /g, ' ')
    .replace(/&amp;|&#38;/g, '&')
    .replace(/&#8203;|​/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&ndash;|&#8211;/g, '–')
    .replace(/\s+/g, ' ')
    .trim();

// ---- program lists ----

async function listPrograms(school) {
  const base = CATALOGS[school];
  if (school === 'temple') {
    // a table of programs; column1 links are the undergraduate degrees
    const html = await fetchRetry(`${base}/academic-programs/`, (r) => r.text());
    const out = [];
    for (const [, cell] of html.matchAll(/<td class="column1">(.*?)<\/td>/gs)) {
      for (const [, href, label] of cell.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)) {
        if (/^B/.test(label) && !/not (?:currently )?accepting|japan/i.test(label)) out.push(base + href);
      }
    }
    return [...new Set(out)];
  }
  // JHU and UNC: a filterable grid; bachelor's degrees carry these filter classes
  const filters = school === 'jhu' ? ['filter_1'] : ['filter_52', 'filter_53', 'filter_54'];
  const html = await fetchRetry(`${base}/programs/`, (r) => r.text());
  const out = [];
  for (const [, cls, href] of html.matchAll(/<li[^>]*class="item ([^"]*)"[^>]*>.*?<a href="([^"]+)"/gs)) {
    if (cls.split(' ').some((c) => filters.includes(c))) out.push(base + href);
  }
  return [...new Set(out)];
}

// ---- one program page -> template ----

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const num = (s) => WORDS[s.toLowerCase()] ?? +s;
const N = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\\s*[-–]\\s*\\d+)?';

// "Select two of the following" -> {count: 2}; "9 credits from" -> {credits: 9}
export function quantity(comment) {
  const t = comment.replace(/\([^)]*\)/g, ' ');
  let m = t.match(new RegExp(`\\b${N}\\s+(?:additional\\s+|more\\s+)?(?:credits?|credit hours?|semester hours?|hours)\\b`, 'i'));
  if (m) return { credits: num(m[1]) };
  m = t.match(new RegExp(`\\b${N}\\s+(?:additional\\s+|more\\s+|other\\s+)?(?:[\\w-]+\\s+){0,3}?(?:courses?|classes|electives?)\\b`, 'i'));
  if (m) return { count: num(m[1]) };
  m = t.match(new RegExp(`\\b${N}\\s+(?:of|from)(?:\\s+among)?\\s+(?:the\\s+)?(?:following|these|this list)`, 'i'));
  if (m) return { count: num(m[1]) };
  return null;
}

// Rules a template can check without a course list: JHU POS tags and
// Foundational Ability tags.
function tagMatch(comment) {
  const posTags = [...comment.matchAll(/POS[- ]Tag,?\s*([A-Z]+-[A-Z0-9]+)/gi)].map((m) => m[1].toUpperCase());
  const areas = [...comment.matchAll(/\btag\s+(FA\d(?:\.\d)?(?:eP)?)\b/gi)].map((m) => m[1]);
  const match = {};
  if (posTags.length) match.posTags = posTags;
  if (areas.length) match.areas = areas;
  return Object.keys(match).length ? match : null;
}

const hoursNum = (h) => {
  const m = String(h ?? '').match(/^(\d+(?:\.\d+)?)/);
  return m ? +m[1] : null;
};

export function parseRows(tableHtml) {
  const rows = [];
  for (const [, cls, body] of tableHtml.matchAll(/<tr class="([^"]*)"[^>]*>(.*?)<\/tr>/gs)) {
    if (/hidden|listsum/.test(cls)) continue;
    const hours = text(body.match(/<td class="hourscol">(.*?)<\/td>/s)?.[1]);
    const rest = body.replace(/<td class="hourscol">.*?<\/td>/s, '');
    if (/areaheader|areasubheader/.test(cls)) {
      rows.push({ kind: 'header', text: text(rest), sub: /areasubheader/.test(cls) });
      continue;
    }
    const codecol = body.match(/<td class="codecol[^"]*">(.*?)<\/td>/s)?.[1];
    const codes = codecol
      ? [...codecol.matchAll(/title="([^"]+)"[^>]*class="[^"]*\bcode\b/g)].map((m) => text(m[1]))
      : [];
    if (codes.length) {
      rows.push({
        kind: 'course',
        codes: [...new Set(codes)],
        or: /orclass/.test(cls),
        indent: /blockindent/.test(codecol.split('<a')[0]),
        hours,
      });
    } else {
      const t = text(rest);
      if (t) rows.push({ kind: 'comment', text: t, hours });
    }
  }
  return rows;
}

// a sentence that introduces options rather than requirements
const OPTIONISH = /\boptions?\b|\bchoose\b|\bchosen\b|\bselect(?:ed)?\b|from the following|\bone of\b|\bany of\b|\blist\b|\belectives?\b/i;
// "a maximum of one course from…" limits, it doesn't require
const LIMIT = /maximum|\bmax\.|no more than|up to|at most/i;
// prose introducing courses that do NOT count
const EXCLUDED = /(?:do|does|will|may|can)\s*not count|cannot count|not be counted|excluded|do not satisfy/i;
// "Elective courses to reach 129 credits": the degree total, not a group
const DEGREE_TOTAL = /to reach \d{3}|\b\d{3} (?:total )?credits/i;
const BARE_CODE = /^[A-Z]{2,5}[ .]\d{2,4}(?:\.\d{3})?[A-Z]?$/;
// lists this long are menus to pick from, not courses to take
const MAX_CHECKLIST = 12;
const lastSentence = (s) => (s.match(/[^.:;]*[.:;]?\s*$/)?.[0] ?? s).trim();

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'group';

const todoNote = (what) => `TODO: not readable automatically — "${what}". Assign courses by hand.`;

// Course-list tables (each with its heading and the prose just before it) -> groups.
export function buildGroups(tables) {
  const groups = [];
  const ids = new Set();
  const add = (g) => {
    let id = slug(g.name);
    for (let i = 2; ids.has(id); i++) id = `${slug(g.name)}-${i}`;
    ids.add(id);
    groups.push({ id, ...g, name: g.name.slice(0, 140) });
  };
  // a menu of courses: "pick N of these" (or an unknown N, flagged TODO)
  const menu = (name, need, codes) =>
    add({
      name,
      ...(need ?? { count: 1, todo: true, note: 'TODO: a list of options — set how many are required (count or credits).' }),
      match: { codes: [...new Set(codes)] },
    });
  const option = (codes) => (codes.length > 1 ? codes : codes[0]);

  for (const { heading = '', prose: rawProse = '', rows } of tables) {
    // a table that opens with its own header labels itself; the prose before it
    // is usually the previous table's footnotes
    const prose = rows[0]?.kind === 'header' ? '' : rawProse;
    const tail = prose.slice(-400);
    if (EXCLUDED.test(tail)) continue;

    // a bare table of courses introduced by prose like "choose two of the following"
    const intro = lastSentence(prose);
    const required = rows.filter((r) => r.kind === 'course' && !r.or).length;
    if (rows.length && rows.every((r) => r.kind === 'course') && (OPTIONISH.test(intro) || quantity(intro) || required > MAX_CHECKLIST)) {
      const need = quantity(intro) ?? (OPTIONISH.test(intro) ? quantity(tail) : null);
      menu(intro ? `${heading || 'Requirements'}: ${intro}` : heading || 'Requirements', need, rows.flatMap((r) => r.codes));
      continue;
    }

    let section = heading || 'Requirements';
    let parent = section;
    let slots = [];
    let pending = []; // groups from this section, held until we know it isn't a menu
    let choice = null; // an open "pick N from the following" (or a limit to skip)
    let note = null; // a comment with no quantity; a requirement only if courses don't follow

    const closeChoice = () => {
      if (!choice) return;
      const { label, need, match, options, skip } = choice;
      choice = null;
      if (skip) return;
      const name = `${section}: ${label}`;
      const codes = options.flat();
      if (need.count === 1 && options.length && !match) {
        // "one of": keep "A & B" pairs together as a single option
        pending.push({ name, courses: [{ label, oneOf: options }] });
      } else if (codes.length || match) {
        pending.push({ name, ...need, match: { ...match, ...(codes.length ? { codes: [...new Set(codes)] } : {}) } });
      } else {
        pending.push({ name, ...need, todo: true, note: todoNote(label) });
      }
    };
    const closeNote = () => {
      // a prose rule with credit hours, e.g. "Electives at the 300 level | 9"
      const credits = note && hoursNum(note.hours);
      if (credits) {
        const match = tagMatch(note.text);
        pending.push({
          name: `${section}: ${note.text}`,
          credits,
          ...(match ? { match } : { todo: true, note: todoNote(note.text) }),
        });
      }
      note = null;
    };
    const closeSection = () => {
      closeChoice();
      closeNote();
      const isMenu =
        slots.length > MAX_CHECKLIST || (slots.length > 1 && /\blist\b|electives|\boptions?\b/i.test(section));
      if (isMenu) {
        // prose rows inside a menu describe its entries; they aren't separate rules
        menu(section, null, slots.flatMap((s) => (typeof s === 'string' ? [s] : s.oneOf.flat())));
      } else {
        pending.forEach(add);
        if (slots.length) add({ name: section, courses: slots });
      }
      slots = [];
      pending = [];
    };

    for (const row of rows) {
      if (row.kind === 'header') {
        closeSection();
        section = row.sub ? `${parent} – ${row.text}` : row.text;
        if (!row.sub) parent = row.text;
      } else if (row.kind === 'comment') {
        closeChoice();
        closeNote();
        if (DEGREE_TOTAL.test(row.text) || BARE_CODE.test(row.text)) continue;
        const q = quantity(row.text);
        const match = tagMatch(row.text);
        if (LIMIT.test(row.text)) {
          choice = { skip: true }; // swallow the courses it caps
        } else if (q || match) {
          const credits = hoursNum(row.hours);
          choice = { label: row.text, need: q ?? (credits ? { credits } : { count: 1 }), match, options: [] };
        } else {
          note = row;
        }
      } else {
        note = null; // the comment was a label for these courses
        // an unindented course after an indented list ends it; "or" rows never do
        if (choice?.indent && !row.indent && !row.or) closeChoice();
        if (choice) {
          choice.indent ??= row.indent;
          choice.options?.push(option(row.codes));
        } else {
          const last = slots.at(-1);
          if (row.or && last !== undefined) {
            const prev = typeof last === 'string' || Array.isArray(last) ? { oneOf: [last] } : last;
            prev.oneOf.push(option(row.codes));
            slots[slots.length - 1] = prev;
          } else {
            slots.push(row.codes.length > 1 ? { oneOf: [row.codes] } : row.codes[0]);
          }
        }
      }
    }
    closeSection();
  }
  return groups;
}

// The current requirements: the Requirements tab if the page has tabs, else
// the main text. Other tabs (sample plans, older catalog years) are skipped.
function requirementsHtml(page) {
  // find the tab labelled "Requirements" — JHU gives it legacy ids like
  // "twozerotwofourtext" — else a requirements container, else the main text
  const tab = page.match(/showSection\('(\w+)'\);"\s*>\s*(?:Degree\s+|Major\s+)?Requirements\b/i)?.[1];
  const byTab = tab ? page.indexOf(`<div id="${tab}container"`) : -1;
  const reqs = page.search(/<div id="\w*requirementstextcontainer"/);
  const start = byTab >= 0 ? byTab : reqs >= 0 ? reqs : page.search(/<div id="textcontainer"/);
  if (start < 0) return '';
  const next = page.slice(start + 10).search(/<div id="\w+textcontainer"/);
  return page.slice(start, next < 0 ? undefined : start + 10 + next);
}

export function parseProgramPage(page, url, school) {
  const html = requirementsHtml(page);
  const tables = [];
  let heading = '';
  let since = 0; // prose between the last heading/table and this one
  // walk headings and course-list tables in document order
  for (const m of html.matchAll(/<h[2-5][^>]*>(.*?)<\/h[2-5]>|<table class="sc_courselist[^"]*">(.*?)<\/table>/gs)) {
    if (m[1] !== undefined) heading = text(m[1]);
    else tables.push({ heading, prose: text(html.slice(since, m.index)), rows: parseRows(m[2]) });
    since = m.index + m[0].length;
  }
  const groups = buildGroups(tables);
  if (!groups.length) {
    // no machine-readable course lists (prose-only page): still list the program,
    // with one bucket to assign courses to by hand
    groups.push({
      id: 'major-courses',
      name: 'Major courses',
      count: 1,
      todo: true,
      note:
        'TODO: this catalog page has no machine-readable course lists. Open the source, then assign your major ' +
        `courses to this group (⋯ on a course card). The page begins: "${text(html).slice(0, 220)}…"`,
    });
  }
  const titles = [...page.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)].map((m) => text(m[1])).filter(Boolean);
  const name = titles.at(-1) ?? url;
  return {
    id: `${school}-${url.replace(/\/$/, '').split('/').pop()}`,
    school,
    name,
    source: url,
    note:
      'Unofficial and auto-generated from the catalog page — verify with your advisor. Covers only the course lists ' +
      'on that page (not university or school-wide requirements). Rules the generator could not read are marked ' +
      'TODO; programs with tracks or concentrations list every option — hide the groups that do not apply.',
    generated: true,
    groups,
  };
}

export async function buildRequirements(school, log = console.log) {
  if (!CATALOGS[school]) throw new Error(`Unknown school "${school}"`);
  const urls = await listPrograms(school);
  log(`${urls.length} bachelor's programs`);
  const templates = [];
  const empty = [];
  let failed = 0;
  await pool(urls, 4, async (url) => {
    try {
      const page = await fetchRetry(url, (r) => r.text());
      const t = page && parseProgramPage(page, url, school);
      if (t) templates.push(t);
      if (t?.groups[0]?.id === 'major-courses') empty.push(url);
    } catch {
      failed++;
    }
  });
  if (failed > urls.length * 0.1) throw new Error(`${failed} of ${urls.length} pages failed`);
  if (!templates.length) throw new Error('no templates built — keeping existing data');
  if (failed) log(`warning: ${failed} pages failed and were skipped`);
  if (empty.length) log(`${empty.length} pages had no course lists (placeholder templates):\n  ${empty.join('\n  ')}`);
  templates.sort((a, b) => a.name.localeCompare(b.name));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${school}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ school, builtAt: new Date().toISOString(), templates }, null, 1));
  fs.renameSync(`${file}.tmp`, file);
  log(`done: ${templates.length} templates -> ${path.relative(process.cwd(), file)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const school = process.argv[2];
  if (!school) {
    console.error('usage: npm run requirements -- <jhu|temple|unc>');
    process.exit(1);
  }
  buildRequirements(school).catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}
