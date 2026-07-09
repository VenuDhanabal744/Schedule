// A small demo catalog in the normalized shape, used until a real term is
// imported from the SIS API. Course codes/titles mimic real JHU offerings.

const M = (days, start, end) => [{ days, start, end }];
const two = (d1, s1, e1, d2, s2, e2) => [
  { days: d1, start: s1, end: e1 },
  { days: d2, start: s2, end: e2 },
];
const h = (hh, mm = 0) => hh * 60 + mm;

const sec = (section, instructors, meetings, status = 'Open', open = '10', seats = '10/30') => ({
  section,
  instructors,
  meetings,
  status,
  seatsAvailable: seats,
  openSeats: open,
  waitlisted: '0',
  location: 'Homewood Campus',
  instructionMethod: 'In-person',
});

export const SAMPLE_TERM = 'Demo Term';

export const SAMPLE_COURSES = [
  {
    code: 'EN.601.226',
    title: 'Data Structures',
    department: 'EN Computer Science',
    school: 'Whiting School of Engineering',
    credits: '4.00',
    level: 'Lower Level Undergraduate',
    areas: 'E',
    writingIntensive: false,
    sections: [
      sec('01', ['Selinski, Sara'], M(['M', 'W', 'F'], h(9), h(9, 50))),
      sec('02', ['Selinski, Sara'], M(['M', 'W', 'F'], h(13, 30), h(14, 20))),
      sec('03', ['Darvish, Ali'], M(['T', 'Th'], h(15), h(16, 15))),
    ],
  },
  {
    code: 'EN.601.220',
    title: 'Intermediate Programming',
    department: 'EN Computer Science',
    school: 'Whiting School of Engineering',
    credits: '4.00',
    level: 'Lower Level Undergraduate',
    areas: 'E',
    writingIntensive: false,
    sections: [
      sec('01', ['Kazhdan, Misha'], M(['M', 'W', 'F'], h(10), h(10, 50))),
      sec('02', ['Kazhdan, Misha'], M(['M', 'W', 'F'], h(14), h(14, 50))),
    ],
  },
  {
    code: 'AS.110.201',
    title: 'Linear Algebra',
    department: 'AS Mathematics',
    school: 'Krieger School of Arts and Sciences',
    credits: '4.00',
    level: 'Lower Level Undergraduate',
    areas: 'Q',
    writingIntensive: false,
    sections: [
      sec('01', ['Brown, Richard'], M(['M', 'W', 'F'], h(9), h(9, 50))),
      sec('02', ['Brown, Richard'], M(['M', 'W', 'F'], h(11), h(11, 50))),
      sec('03', ['Marshburn, Nicholas'], M(['T', 'Th'], h(9), h(10, 15))),
      sec('04', ['Marshburn, Nicholas'], M(['T', 'Th'], h(18), h(19, 15))),
    ],
  },
  {
    code: 'AS.171.101',
    title: 'General Physics: Physical Science Major I',
    department: 'AS Physics & Astronomy',
    school: 'Krieger School of Arts and Sciences',
    credits: '4.00',
    level: 'Lower Level Undergraduate',
    areas: 'N',
    writingIntensive: false,
    sections: [
      sec('01', ['Maksimovic, Petar'], two(['M', 'W'], h(13, 30), h(14, 45), ['F'], h(13, 30), h(14, 20))),
      sec('02', ['Maksimovic, Petar'], two(['T', 'Th'], h(10, 30), h(11, 45), ['F'], h(10), h(10, 50))),
    ],
  },
  {
    code: 'AS.030.101',
    title: 'Introductory Chemistry I',
    department: 'AS Chemistry',
    school: 'Krieger School of Arts and Sciences',
    credits: '3.00',
    level: 'Lower Level Undergraduate',
    areas: 'N',
    writingIntensive: false,
    sections: [
      sec('01', ['Greco, Jane'], M(['M', 'W', 'F'], h(8), h(8, 50))),
      sec('02', ['Greco, Jane'], M(['M', 'W', 'F'], h(12), h(12, 50))),
    ],
  },
  {
    code: 'AS.220.105',
    title: 'Introduction to Fiction & Poetry I',
    department: 'AS Writing Seminars',
    school: 'Krieger School of Arts and Sciences',
    credits: '3.00',
    level: 'Lower Level Undergraduate',
    areas: 'H',
    writingIntensive: true,
    sections: [
      sec('01', ['Rivera, Diana'], M(['T', 'Th'], h(12), h(13, 15))),
      sec('02', ['Chen, Marcus'], M(['M', 'W'], h(16, 30), h(17, 45))),
      sec('03', ['Chen, Marcus'], M(['T', 'Th'], h(19), h(20, 15))),
    ],
  },
  {
    code: 'EN.553.171',
    title: 'Discrete Mathematics',
    department: 'EN Applied Mathematics & Statistics',
    school: 'Whiting School of Engineering',
    credits: '4.00',
    level: 'Lower Level Undergraduate',
    areas: 'Q',
    writingIntensive: false,
    sections: [
      sec('01', ['Braverman, Vova'], M(['M', 'W', 'F'], h(11), h(11, 50))),
      sec('02', ['Braverman, Vova'], M(['T', 'Th'], h(13, 30), h(14, 45))),
    ],
  },
  {
    code: 'AS.050.102',
    title: 'Language and Mind',
    department: 'AS Cognitive Science',
    school: 'Krieger School of Arts and Sciences',
    credits: '3.00',
    level: 'Lower Level Undergraduate',
    areas: 'N,S',
    writingIntensive: false,
    sections: [
      sec('01', ['Rawlins, Kyle'], M(['M', 'W'], h(10, 30), h(11, 45))),
    ],
  },
  {
    code: 'AS.180.101',
    title: 'Elements of Macroeconomics',
    department: 'AS Economics',
    school: 'Krieger School of Arts and Sciences',
    credits: '3.00',
    level: 'Lower Level Undergraduate',
    areas: 'S',
    writingIntensive: false,
    sections: [
      sec('01', ['Barbera, Robert'], M(['M', 'W'], h(9), h(10, 15))),
      sec('02', ['Barbera, Robert'], M(['M', 'W'], h(15), h(16, 15))),
      sec('03', ['Husain, Aasim'], M(['T', 'Th'], h(16, 30), h(17, 45))),
    ],
  },
  {
    code: 'AS.280.101',
    title: 'Introduction to Public Health',
    department: 'AS Public Health Studies',
    school: 'Krieger School of Arts and Sciences',
    credits: '3.00',
    level: 'Lower Level Undergraduate',
    areas: 'S',
    writingIntensive: false,
    sections: [
      sec('01', ['Sherman, Susan'], M(['T', 'Th'], h(10, 30), h(11, 45))),
      sec('02', ['Sherman, Susan'], M(['T', 'Th'], h(18, 30), h(19, 45))),
    ],
  },
];
