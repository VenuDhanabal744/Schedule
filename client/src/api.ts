import type { Course, Rating } from './types';

export type TermsInfo = {
  hasKey: boolean;
  available: string[];
  imported: string[];
  sampleTerm: string;
  error: string | null;
};

export async function fetchTermsInfo(): Promise<TermsInfo> {
  const res = await fetch('/api/terms');
  return res.json();
}

export async function fetchCourses(term: string): Promise<Course[]> {
  const res = await fetch(`/api/courses?term=${encodeURIComponent(term)}`);
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load courses');
  const data = await res.json();
  return data.courses;
}

export async function importTerm(term: string, onProgress: (line: string) => void): Promise<void> {
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ term }),
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

const ratingCache = new Map<string, Rating>();

// undefined = not fetched yet; null = fetched, no rating found
export function getRating(name: string): Rating | undefined {
  return ratingCache.get(name);
}
const pending = new Set<string>();

export async function fetchRatings(names: string[]): Promise<Map<string, Rating>> {
  const missing = names.filter((n) => !ratingCache.has(n) && !pending.has(n));
  if (missing.length) {
    missing.forEach((n) => pending.add(n));
    try {
      const res = await fetch(`/api/ratings?instructors=${encodeURIComponent(missing.join('|'))}`);
      const data: Record<string, Rating> = await res.json();
      for (const [name, rating] of Object.entries(data)) ratingCache.set(name, rating);
    } finally {
      missing.forEach((n) => pending.delete(n));
    }
  }
  return ratingCache;
}
