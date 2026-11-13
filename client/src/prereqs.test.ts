import { describe, expect, it } from 'vitest';
import { fmtReq, parsePrereqText, parseRawReqs, parseSisExpr, unmet } from './prereqs';

const show = (text: string) => parsePrereqText(text).map((r) => fmtReq(r.tree));

describe('parseSisExpr (JHU)', () => {
  it('parses a flat any-of list', () => {
    expect(fmtReq(parseSisExpr('AS.110.107[C]^OR^AS.110.109[C]^OR^AS.110.113[C]')!)).toBe(
      'AS.110.107 or AS.110.109 or AS.110.113'
    );
  });
  it('parses nested groups', () => {
    const tree = parseSisExpr('AS.030.205[C]^AND^(^(^AS.030.102[C]^AND^AS.030.106[C]^)^OR^AS.030.103[C]^)')!;
    expect(fmtReq(tree)).toBe('AS.030.205 and ((AS.030.102 and AS.030.106) or AS.030.103)');
  });
  it('binds AND tighter than OR', () => {
    expect(fmtReq(parseSisExpr('AS.020.306[C]^OR^EN.540.202[C]^AND^EN.540.307[C]')!)).toBe(
      'AS.020.306 or (EN.540.202 and EN.540.307)'
    );
  });
  it('gives up on garbage', () => {
    expect(parseSisExpr('')).toBeNull();
    expect(parseSisExpr('permission required')).toBeNull();
  });
});

describe('parsePrereqText (Temple / UNC bulletins)', () => {
  it('reads Temple lists', () => {
    expect(show('Minimum grade of C- in ( CHEM 1032 , CHEM 1042, or CHEM 1952 )')).toEqual([
      'CHEM 1032 or CHEM 1042 or CHEM 1952',
    ]);
    expect(show('Minimum grade of C- in CHEM 3103 , CHEM 3105 , and ( CHEM 4176 or CHEM 4196 )')).toEqual([
      'CHEM 3103 and CHEM 3105 and (CHEM 4176 or CHEM 4196)',
    ]);
  });
  it('drops an any-of list that includes a placement alternative', () => {
    expect(show("Minimum grade of C- in (MATH 1021, 'Y' in MC5, or 'Y' in MC6)")).toEqual([]);
    expect(
      show("Minimum grade of C (except where noted) in (MATH 1022, 'Y' in MC6, or 'Y' in MC6T) and MATH 1033 (C- or higher)")
    ).toEqual(['MATH 1033']);
  });
  it('reads UNC shorthand numbers and semicolons', () => {
    expect(show('Prerequisites, MATH 110 and 130 ; Requires a grade of C- or better in MATH 130 or placement by the department.')).toEqual([
      'MATH 110 and MATH 130',
    ]);
    expect(show('Prerequisites, SPAN 261 or 267 , and SPAN 300 or 301 or 302 .')).toEqual([
      '(SPAN 261 or SPAN 267) and (SPAN 300 or SPAN 301 or SPAN 302)',
    ]);
    expect(show('Prerequisite, CHEM 261 or 261H ; C- or better required.')).toEqual(['CHEM 261 or CHEM 261H']);
    expect(
      show('Prerequisites, BIOL 201 ; or BIOL 202 ; or BIOL 103 and BIOL 104 ; or permission of the instructor for students lacking the prerequisites.')
    ).toEqual(['BIOL 201 or BIOL 202 or (BIOL 103 and BIOL 104)']);
  });
  it('keeps the requirement when permission is the only alternative', () => {
    expect(show('Prerequisite, COMM 140 or COMM 249 ; permission of the instructor for students lacking the prerequisite.')).toEqual([
      'COMM 140 or COMM 249',
    ]);
  });
  it('marks concurrent requirements and skips corequisites', () => {
    const [pre] = parsePrereqText('Pre- or corequisite, CHEM 101 .');
    expect(pre.concurrent).toBe(true);
    expect(show('Prerequisite, MATH 110; Corequisite, MATH 231 .')).toEqual(['MATH 110']);
  });
  it('returns nothing when there is no course to check', () => {
    expect(show('Prerequisite, advanced undergraduate mechanics.')).toEqual([]);
    expect(show('any 2000-level PSY course')).toEqual([]);
  });
});

describe('parseRawReqs', () => {
  it('prefers the structured expression and skips antirequisites', () => {
    const reqs = parseRawReqs([
      { text: 'Not both', expr: 'EN.553.620[C]', negative: true },
      { text: 'AS.110.201 OR AS.110.202, can be taken concurrently.', expr: 'AS.110.201[C]^OR^AS.110.202[C]' },
      { text: 'Prerequisite, MATH 232 .' },
    ]);
    expect(reqs.map((r) => [fmtReq(r.tree), r.concurrent])).toEqual([
      ['AS.110.201 or AS.110.202', true],
      ['MATH 232', false],
    ]);
  });
});

describe('unmet', () => {
  const tree = parseSisExpr('(^A.000.001[C]^OR^A.000.002[C]^)^AND^A.000.003[C]'.replace(/A\./g, 'AS.'))!;
  it('reports only what is still missing', () => {
    expect(unmet(tree, new Set(['AS.000.001', 'AS.000.003']))).toBeNull();
    expect(fmtReq(unmet(tree, new Set(['AS.000.001']))!)).toBe('AS.000.003');
    expect(fmtReq(unmet(tree, new Set())!)).toBe('(AS.000.001 or AS.000.002) and AS.000.003');
  });
  it('ignores courses that do not exist in the catalog', () => {
    const known = (c: string) => c !== 'AS.000.003' && c !== 'AS.000.002';
    expect(fmtReq(unmet(tree, new Set(), known)!)).toBe('AS.000.001'); // retired alternative dropped
    expect(unmet(tree, new Set(['AS.000.001']), known)).toBeNull(); // lab-safety style code ignored
    expect(unmet(parseSisExpr('EN.990.100[C]')!, new Set(), () => false)).toBeNull();
  });
});
