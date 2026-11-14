// node --test server/  (run by npm test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroups, parseProgramPage, parseRows, quantity } from './requirements.js';

const course = (code, cls = 'odd', indent = false) =>
  `<tr class="${cls}"><td class="codecol${cls.includes('orclass') ? ' orclass' : ''}">${
    cls.includes('orclass') ? 'or ' : ''
  }${indent ? '<div class="blockindent">' : ''}<a href="#" title="${code}" class="bubblelink code">${code}</a>${
    indent ? '</div>' : ''
  }</td><td>Title</td><td class="hourscol">3</td></tr>`;
const pair = (a, b) =>
  `<tr class="odd"><td class="codecol"><a title="${a}" class="bubblelink code">${a}</a><br/><span class="blockindent">&amp; <a title="${b}" class="bubblelink code">x</a></span></td><td></td><td class="hourscol">4</td></tr>`;
const header = (t, sub = false) =>
  `<tr class="even ${sub ? 'areasubheader' : 'areaheader'}"><td colspan="2"><span class="courselistcomment areaheader">${t}</span></td><td class="hourscol"></td></tr>`;
const comment = (t, hours = '') =>
  `<tr class="even"><td colspan="2"><span class="courselistcomment">${t}</span><sup>1</sup></td><td class="hourscol">${hours}</td></tr>`;
const table = (...rows) => `<table class="sc_courselist"><tbody>${rows.join('')}<tr class="listsum"><td>Total</td></tr></tbody></table>`;
const groupsOf = (heading, prose, ...rows) => buildGroups([{ heading, prose, rows: parseRows(table(...rows)) }]);

test('quantity reads counts and credits', () => {
  assert.deepEqual(quantity('Select two of the following:'), { count: 2 });
  assert.deepEqual(quantity('Complete four courses from the following:'), { count: 4 });
  assert.deepEqual(quantity('At least 6 credits from the following courses:'), { credits: 6 });
  assert.deepEqual(quantity('Two from among the following five options:'), { count: 2 });
  assert.deepEqual(quantity('Select 3-4 credits'), { credits: 3 });
  assert.equal(quantity('Required courses:'), null);
});

test('rows: courses, "or" alternatives, "&" pairs, headers, comments', () => {
  const rows = parseRows(table(header('Core'), course('MATH 1041'), course('MATH 1941', 'orclass odd'), pair('CHEM 101', 'CHEM 101L'), comment('Select one:', '4')));
  assert.deepEqual(rows.map((r) => r.kind), ['header', 'course', 'course', 'course', 'comment']);
  assert.equal(rows[2].or, true);
  assert.deepEqual(rows[3].codes, ['CHEM 101', 'CHEM 101L']);
  assert.equal(rows[4].text, 'Select one:'); // footnote marker dropped
});

test('a section of required courses becomes a checklist with alternatives', () => {
  const [g] = groupsOf('Major', '', header('Core'), course('MATH 1041'), course('MATH 1941', 'orclass odd'), pair('CHEM 101', 'CHEM 101L'));
  assert.equal(g.name, 'Core');
  assert.deepEqual(g.courses, [{ oneOf: ['MATH 1041', 'MATH 1941'] }, { oneOf: [['CHEM 101', 'CHEM 101L']] }]);
});

test('"one of the following" keeps pairs together; "N of" becomes a pool', () => {
  const [one] = groupsOf('Sci', '', comment('Complete one from the following:'), pair('A 101', 'A 105'), pair('B 101', 'B 105'));
  assert.deepEqual(one.courses, [{ label: 'Complete one from the following:', oneOf: [['A 101', 'A 105'], ['B 101', 'B 105']] }]);
  const [two] = groupsOf('Bio', '', comment('Select two of the following:'), course('X 1'), course('X 2'), course('X 3'));
  assert.deepEqual([two.count, two.match.codes], [2, ['X 1', 'X 2', 'X 3']]);
});

test('an indented choice ends at the next unindented course, but "or" rows continue it', () => {
  const gs = groupsOf('Math', '', comment('Select one of the following:'), course('M 2', 'odd', true), course('M 2H', 'orclass odd', true), course('M 3', 'orclass odd'), course('M 9'));
  assert.deepEqual(gs.map((g) => g.courses), [[{ label: 'Select one of the following:', oneOf: ['M 2', 'M 2H', 'M 3'] }], ['M 9']]);
});

test('limits are skipped, tags and prose rules are kept', () => {
  const gs = groupsOf(
    'Focus',
    '',
    comment('A maximum of one course from the following list may be applied:'),
    course('EN.601.220'),
    comment('Courses with the SIS POS Tag, BME-NE, to reach at least 18 credits.', '18'),
    comment('Electives at the 300 level', '9'),
    comment('Elective courses to reach 129 credits')
  );
  assert.deepEqual(gs.map((g) => [g.credits, g.match ?? null, !!g.todo]), [
    [18, { posTags: ['BME-NE'] }, false],
    [9, null, true],
  ]);
});

test('bare tables: option prose makes a pool, exclusions are dropped, long lists are menus', () => {
  const [wi] = groupsOf('Summary', 'Complete at least two WI courses. The options are:', course('W 1'), course('W 2'), course('W 3'));
  assert.deepEqual([wi.count, wi.match.codes.length], [2, 3]);
  assert.deepEqual(groupsOf('Research', 'These courses do not count as electives.', course('R 1')), []);
  const long = groupsOf('Allied', '', ...Array.from({ length: 13 }, (_, i) => course(`L ${i}`)));
  assert.equal(long[0].todo, true);
  assert.equal(long[0].match.codes.length, 13);
});

test('parseProgramPage reads the Requirements tab and names the template', () => {
  const page = `<h1 class="page-title">Biology, B.S.</h1>
    <a onclick="return showSection('text');">Overview</a><a onclick="return showSection('twozerotwofourtext');" >Requirements</a>
    <div id="textcontainer">${table(course('OLD 1'))}</div>
    <div id="twozerotwofourtextcontainer"><h2>Core</h2>${table(course('BIOL 101'))}</div>
    <div id="sampleplantextcontainer">${table(course('PLAN 1'))}</div>`;
  const t = parseProgramPage(page, 'https://catalog.example.edu/biology-bs/', 'unc');
  assert.equal(t.id, 'unc-biology-bs');
  assert.equal(t.name, 'Biology, B.S.');
  assert.equal(t.generated, true);
  assert.deepEqual(t.groups.map((g) => [g.name, g.courses]), [['Core', ['BIOL 101']]]);
});

test('a page without course lists still gets a placeholder group', () => {
  const t = parseProgramPage('<h1>X</h1><div id="textcontainer"><p>Not offered.</p></div>', 'https://c.edu/x/', 'jhu');
  assert.deepEqual(t.groups.map((g) => [g.id, g.todo]), [['major-courses', true]]);
});
