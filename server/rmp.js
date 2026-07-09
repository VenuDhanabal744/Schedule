// RateMyProfessors lookup via its public GraphQL endpoint (unofficial).
// Results are cached on disk; lookups that fail resolve to null rather than erroring.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, 'data', 'rmp-cache.json');

const GRAPHQL_URL = 'https://www.ratemyprofessors.com/graphql';
// The RMP web client authenticates with this fixed basic token ("test:test").
const AUTH = 'Basic dGVzdDp0ZXN0';

let cache = { schoolId: null, teachers: {} };
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
} catch {
  /* fresh cache */
}

function saveCache() {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function gql(query, variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: AUTH,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`RMP GraphQL ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

async function resolveSchoolId() {
  if (cache.schoolId) return cache.schoolId;
  const data = await gql(
    `query SearchSchools($query: SchoolSearchQuery!) {
       newSearch { schools(query: $query) {
         edges { node { id name city state } }
       } }
     }`,
    { query: { text: 'Johns Hopkins University' } }
  );
  const edges = data?.newSearch?.schools?.edges ?? [];
  const jhu =
    edges.find((e) => /johns hopkins university/i.test(e.node.name))?.node ??
    edges[0]?.node;
  if (!jhu) throw new Error('Could not resolve JHU on RateMyProfessors');
  cache.schoolId = jhu.id;
  saveCache();
  return jhu.id;
}

// SIS gives "Last, First M" — RMP search works best with "First Last".
function searchName(instructor) {
  const m = instructor.match(/^([^,]+),\s*(.+)$/);
  if (!m) return instructor;
  const first = m[2].trim().split(/\s+/)[0];
  return `${first} ${m[1].trim()}`;
}

export async function lookupInstructor(instructor) {
  const key = instructor.toLowerCase();
  if (key in cache.teachers) return cache.teachers[key];

  let result = null;
  try {
    const schoolId = await resolveSchoolId();
    const data = await gql(
      `query SearchTeachers($query: TeacherSearchQuery!) {
         newSearch { teachers(query: $query, first: 3) {
           edges { node {
             id legacyId firstName lastName department
             avgRating avgDifficulty numRatings wouldTakeAgainPercent
           } }
         } }
       }`,
      { query: { text: searchName(instructor), schoolID: schoolId } }
    );
    const node = data?.newSearch?.teachers?.edges?.[0]?.node;
    if (node && node.numRatings > 0) {
      result = {
        name: `${node.firstName} ${node.lastName}`,
        department: node.department,
        avgRating: node.avgRating,
        avgDifficulty: node.avgDifficulty,
        numRatings: node.numRatings,
        wouldTakeAgain: node.wouldTakeAgainPercent,
        url: `https://www.ratemyprofessors.com/professor/${node.legacyId}`,
      };
    }
  } catch (err) {
    // Unofficial API — treat failures as "no rating" but don't cache them,
    // so a later request can retry.
    console.error(`RMP lookup failed for "${instructor}": ${err.message}`);
    return null;
  }

  cache.teachers[key] = result;
  saveCache();
  return result;
}
