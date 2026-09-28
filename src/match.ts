// Which job titles are worth fetching, based on the user's target roles and level (shared by every source).
import { COUNTRIES, type CountryCode, getSettings, OTHER_PLACES, searchCountries } from "./settings";

const LEVEL = /\b(senior|sr|junior|jr|lead|staff|principal|head|mid|graduate|intern|associate|i{1,3}|iv|[1-5])\b/g;
const JUNIOR = /\b(junior|jr\.?|graduate|intern|internship|apprentice|entry[- ]level|trainee)\b/i;
const SENIOR = /\b(senior|sr\.?|staff|lead|principal|head of|director)\b/i;

/** Meaningful words of the target roles, e.g. "Senior Backend Engineer" → backend, engineer */
function roleWords(): Set<string> {
  return new Set(getSettings().targetRoles.flatMap((r) => r.toLowerCase().replace(LEVEL, " ").split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2)));
}

/** A title is wanted when it shares the role's core noun (engineer, designer, manager...) and isn't clearly the wrong level. */
export function titleWanted(title: string): boolean {
  const s = getSettings();
  const words = roleWords(); // used when no target role is set yet
  const t = title.toLowerCase();
  const tw = new Set(t.split(/[^a-z0-9+#.]+/));
  // every target role's last word is its core noun ("engineer", "designer"); require one of those
  const nouns = s.targetRoles.map((r) => r.toLowerCase().split(/\s+/).pop() ?? "").filter(Boolean);
  const nounHit = nouns.some((n) => tw.has(n) || tw.has(`${n}s`) || (n === "engineer" && tw.has("developer")) || (n === "developer" && tw.has("engineer")));
  // the role's core noun must match: "Senior Product Designer" wants designers, not product managers
  if (nouns.length ? !nounHit : ![...words].some((w) => tw.has(w))) return false;
  if (["senior", "staff", "lead"].includes(s.seniority) && JUNIOR.test(title)) return false;
  if (s.seniority === "junior" && SENIOR.test(title)) return false;
  return true;
}

/**
 * Which of the user's searched countries a job location is in. Remote roles that don't name another country
 * count as home (and "Remote, EMEA" counts for European homes). null = somewhere the user isn't searching.
 */
export function jobCountry(loc: string): CountryCode | null {
  const s = getSettings();
  const mine = searchCountries(s);
  const hit = mine.find((c) => COUNTRIES[c].places.test(loc));
  if (hit) return hit;
  if (!/remote|anywhere|worldwide|global/i.test(loc)) return null;
  const other = OTHER_PLACES.test(loc) || Object.entries(COUNTRIES).some(([k, o]) => !mine.includes(k as CountryCode) && o.places.test(loc));
  const region = s.country === "us" || s.country === "ca" ? /\b(north america|americas)\b/i : /\b(emea|europe|eu)\b/i;
  return !other || region.test(loc) || /anywhere|worldwide|global/i.test(loc) ? s.country : null;
}

export const locationInCountry = (loc: string) => jobCountry(loc) !== null;
