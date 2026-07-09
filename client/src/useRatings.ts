import { useEffect, useReducer } from 'react';
import { fetchRatings, getRating } from './api';

// Fetches any not-yet-cached ratings for `names` and re-renders when they land.
export function useRatings(names: string[]) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const key = [...new Set(names)].sort().join('|');
  useEffect(() => {
    if (key) fetchRatings(key.split('|')).then(bump, bump);
  }, [key]);
  return getRating;
}
