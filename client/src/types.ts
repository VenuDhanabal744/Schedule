export type Meeting = { days: string[]; start: number; end: number };

export type Section = {
  section: string;
  instructors: string[];
  meetings: Meeting[];
  status: string;
  seatsAvailable: string;
  openSeats: string;
  waitlisted: string;
  location: string;
  instructionMethod: string;
};

export type Course = {
  code: string;
  title: string;
  department: string;
  school: string;
  credits: string;
  level: string;
  areas: string;
  writingIntensive: boolean;
  sections: Section[];
};

export type Rating = {
  name: string;
  department: string;
  avgRating: number;
  avgDifficulty: number;
  numRatings: number;
  wouldTakeAgain: number | null;
  url: string;
} | null;

// A course the user has added: chosen section index, or null if not yet placed.
// `locked` pins the chosen section: the generator must keep it exactly there.
export type Selected = { code: string; sectionIdx: number | null; locked?: boolean };

export type Constraints = {
  earliest: number | null; // no classes before (minutes)
  latest: number | null; // no classes after (minutes)
  avoidDays: string[];
  onlyOpen: boolean;
  minGap: number | null; // break between consecutive classes at least this (minutes)
  maxGap: number | null; // break between consecutive classes at most this (minutes)
};

// ---- planner ----

// A prerequisite as the registrar publishes it: display text, plus (JHU only)
// a structured expression. `negative` marks an antirequisite.
export type RawReq = { text: string; expr?: string; negative?: boolean };

export type CourseDetail = {
  description: string;
  prereqs?: RawReq[];
  coreqs?: RawReq[];
  restrictions?: string[];
  posTags?: string[];
  repeatable?: boolean;
};

// One course merged across every imported term of a school (no sections).
export type IndexCourse = {
  code: string;
  title: string;
  department: string;
  credits: string;
  level: string;
  areas: string;
  writingIntensive: boolean;
  terms: string[]; // imported terms it appears in
  prereqs?: RawReq[];
  posTags?: string[];
  repeatable?: boolean;
};

export type PlannerData = {
  school: string;
  terms: string[]; // imported terms, oldest first
  courses: IndexCourse[];
  templates: ReqSummary[]; // full templates load on demand
};

export type ReqSummary = { id: string; name: string; generated?: boolean };

export type CourseInfo = {
  code: string;
  detail: CourseDetail | null;
  offerings: { term: string; course: Course }[];
  importedTerms: string[];
};

// ---- degree requirement templates (server/data/requirements/*.json) ----

// A required course, or a choice: each option is one code or a set of codes
// that must all be taken.
export type ReqSlot = string | { label?: string; oneOf: (string | string[])[] };

export type ReqMatch = {
  codes?: string[];
  patterns?: string[]; // globs: "EN.580.4*", "AS.110.???"
  areas?: string[]; // area tags: "H", "FA3"
  posTags?: string[];
  writingIntensive?: boolean;
};

export type ReqGroup = {
  id: string;
  name: string;
  note?: string;
  todo?: boolean; // placeholder the user still has to verify or fill in
  // checklist group: every slot must be filled…
  courses?: ReqSlot[];
  // …or pool group: anything matching counts toward `credits` or `count`
  match?: ReqMatch;
  credits?: number;
  count?: number;
  // courses here may also count toward other groups
  shared?: boolean;
};

export type ReqTemplate = {
  id: string;
  school: string;
  name: string;
  source: string;
  note: string;
  totalCredits?: number;
  generated?: boolean; // built by server/requirements.js from the catalog page
  groups: ReqGroup[];
};
