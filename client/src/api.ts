import type { Course, Rating } from './types';

export type TermOption = { name: string; code: string };

export type TermsInfo = {
  school: string;
  hasKey: boolean;
  available: TermOption[];
  imported: string[];
  sampleTerm: string | null;
  error: string | null;
};

export async function fetchTermsInfo(school: string): Promise<TermsInfo> {
  const res = await fetch(`/api/terms?school=${encodeURIComponent(school)}`);
  return res.json();
}

export async function fetchCourses(school: string, term: string): Promise<Course[]> {
  const res = await fetch(
    `/api/courses?school=${encodeURIComponent(school)}&term=${encodeURIComponent(term)}`
  );
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load courses');
  const data = await res.json();
  return data.courses;
}

export async function importTerm(
  school: string,
  term: string,
  code: string,
  onProgress: (line: string) => void
): Promise<void> {
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ school, term, code }),
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop()!;
    for (const line of lines) if (line.trim()) onProgress(line);
  }
}

// Ratings are cached per school; the active school is set by App.
let ratingsSchool = 'jhu';
export function setRatingsSchool(school: string) {
  ratingsSchool = school;
}

const ratingCache = new Map<string, Rating>();
const pending = new Set<string>();
const cacheKey = (name: string) => `${ratingsSchool}|${name}`;

// undefined = not fetched yet; null = fetched, no rating found
export function getRating(name: string): Rating | undefined {
  return ratingCache.get(cacheKey(name));
}

export async function fetchRatings(names: string[]): Promise<void> {
  const school = ratingsSchool;
  const missing = names.filter(
    (n) => !ratingCache.has(`${school}|${n}`) && !pending.has(`${school}|${n}`)
  );
  if (!missing.length) return;
  missing.forEach((n) => pending.add(`${school}|${n}`));
  try {
    // the server handles at most 30 lookups per request
    for (let i = 0; i < missing.length; i += 25) {
      const chunk = missing.slice(i, i + 25);
      const res = await fetch(
        `/api/ratings?school=${encodeURIComponent(school)}&instructors=${encodeURIComponent(
          chunk.join('|')
        )}`
      );
      const data: Record<string, Rating> = await res.json();
      for (const [name, rating] of Object.entries(data)) {
        ratingCache.set(`${school}|${name}`, rating);
      }
    }
  } finally {
    missing.forEach((n) => pending.delete(`${school}|${n}`));
  }
}
