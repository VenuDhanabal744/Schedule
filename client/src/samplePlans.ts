// Sample programs of study, transcribed from a program's catalog page. The
// auto-planner uses them for course ORDER only; the requirement templates say
// what is required.

export type Slot = 'core-elective' | 'design' | 'focus' | 'fa3' | 'fa4' | 'fa3-fa4' | 'free';

// A row of the catalog's grid: a course (first code is the one the catalog
// lists, the rest are the alternatives it names) or a slot the student fills.
export type SampleEntry = { credits: number; codes?: string[]; slot?: Slot; label?: string };

export type SamplePlan = {
  name: string;
  source: string;
  templateId: string; // requirement template the slots belong to
  premedTemplateId: string;
  slotGroups: Partial<Record<Slot, string>>; // slot -> group id in that template
  focusAreas: { tag: string; name: string }[]; // SIS program-of-study tags
  // one list per semester, the first one a Fall
  standard: SampleEntry[][];
  premed: SampleEntry[][];
};

const c = (credits: number, ...codes: string[]): SampleEntry => ({ codes, credits });
const s = (slot: Slot, label: string, credits: number): SampleEntry => ({ slot, label, credits });

// "Sample Program" and "Sample Program for Pre-Meds" (129 and 130 credits),
// read Nov 2026 for students entering Fall 2026.
const jhuBme: SamplePlan = {
  name: 'JHU Biomedical Engineering B.S.',
  source:
    'https://e-catalogue.jhu.edu/engineering/full-time-residential-programs/degree-programs/biomedical-engineering/biomedical-engineering-bachelor-science/#sampleprogramtext',
  templateId: 'jhu-bme-bs',
  premedTemplateId: 'jhu-premed',
  slotGroups: {
    'core-elective': 'core-electives',
    design: 'design',
    focus: 'focus-area',
    fa3: 'fa3-fa4',
    fa4: 'fa3-fa4',
    'fa3-fa4': 'fa3-fa4',
  },
  focusAreas: [
    { tag: 'BME-BDS', name: 'Biomedical Data Science' },
    { tag: 'BME-CM', name: 'Computational Medicine' },
    { tag: 'BME-GSB', name: 'Genomics and Systems Biology' },
    { tag: 'BME-IMD', name: 'Imaging and Medical Devices' },
    { tag: 'BME-IMMU', name: 'Immunoengineering' },
    { tag: 'BME-NE', name: 'Neuroengineering' },
    { tag: 'BME-TCTE', name: 'Translational Cell and Tissue Engineering' },
  ],
  standard: [
    [c(3, 'AS.030.101'), c(1, 'AS.030.105'), c(4, 'AS.110.108'), c(4, 'AS.171.101'), c(1, 'AS.173.111'), c(2, 'EN.501.124'), c(2, 'EN.580.111')],
    [c(3, 'AS.030.102'), c(1, 'AS.030.106'), c(4, 'AS.110.109'), c(4, 'AS.171.102'), c(1, 'AS.173.112'), c(3, 'EN.500.113', 'EN.500.112'), c(2, 'EN.580.151')],
    [c(4, 'EN.553.291'), c(3, 'EN.580.231'), c(1, 'EN.580.233'), c(2, 'EN.580.240'), c(2, 'EN.580.243'), c(3, 'EN.661.250')],
    [c(4, 'AS.110.202'), c(2, 'EN.580.241'), c(2, 'EN.580.242'), c(2, 'EN.580.246'), c(2, 'EN.580.248'), c(3, 'EN.661.110', 'AS.004.101')],
    [c(4, 'EN.553.311'), s('core-elective', 'EN.580.3xx Core Elective 1', 3), s('core-elective', 'EN.580.3xx Core Elective 2', 3), s('design', 'Design Sequence 1', 4), s('focus', 'Focus Area Course 1', 3)],
    [s('core-elective', 'EN.580.3xx Core Elective 3', 3), s('core-elective', 'EN.580.3xx Core Elective 4', 3), s('design', 'Design Sequence 2', 4), s('focus', 'Focus Area Course 2', 3), s('fa3', 'Course tagged FA3', 3)],
    [s('focus', 'Focus Area Course 3', 3), s('focus', 'Focus Area Course 4', 3), s('fa4', 'Course tagged FA4', 3), s('fa3-fa4', 'Course tagged FA3 or FA4', 3), s('free', 'Free Elective', 4)],
    [s('focus', 'Focus Area Course 5', 3), s('focus', 'Focus Area Course 6', 3), s('fa3-fa4', 'Course tagged FA3 or FA4', 3), s('free', 'Free Elective', 3), s('free', 'Free Elective', 3)],
  ],
  premed: [
    [c(3, 'AS.030.101'), c(1, 'AS.030.105'), c(4, 'AS.110.108'), c(4, 'AS.171.101'), c(1, 'AS.173.111'), c(2, 'EN.501.124'), c(2, 'EN.580.111')],
    [c(3, 'AS.030.102'), c(1, 'AS.030.106'), c(4, 'AS.110.109'), c(4, 'AS.171.102'), c(1, 'AS.173.112'), c(3, 'EN.500.113', 'EN.500.112'), c(2, 'EN.580.151')],
    [c(4, 'AS.030.205'), c(4, 'EN.553.291'), c(3, 'EN.580.231'), c(1, 'EN.580.233'), c(3, 'EN.661.250')],
    [c(4, 'AS.030.206'), c(4, 'AS.110.202'), c(2, 'EN.580.241'), c(2, 'EN.580.242'), c(3, 'EN.661.110', 'AS.004.101')],
    [c(3, 'AS.030.225'), c(4, 'EN.553.311'), c(2, 'EN.580.240'), c(2, 'EN.580.243'), s('core-elective', 'EN.580.3xx Core Elective 1', 3), s('core-elective', 'EN.580.3xx Core Elective 2', 3)],
    [c(2, 'EN.580.246'), c(2, 'EN.580.248'), s('core-elective', 'EN.580.3xx Core Elective 3', 3), s('core-elective', 'EN.580.3xx Core Elective 4', 3), s('fa3', 'Course tagged FA3', 3), s('focus', 'Focus Area Course 1', 3)],
    [s('design', 'Design Sequence 1', 4), s('focus', 'Focus Area Course 2', 3), s('focus', 'Focus Area Course 3', 3), s('fa4', 'Course tagged FA4', 3), s('fa3-fa4', 'Course tagged FA3 or FA4', 3)],
    [s('design', 'Design Sequence 2', 4), s('focus', 'Focus Area Course 4', 3), s('focus', 'Focus Area Course 5', 3), s('focus', 'Focus Area Course 6', 3), s('fa3-fa4', 'Course tagged FA3 or FA4', 3)],
  ],
};

// by school; one program each for now
export const samplePlans: Record<string, SamplePlan> = { jhu: jhuBme };
