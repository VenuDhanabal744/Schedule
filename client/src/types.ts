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
