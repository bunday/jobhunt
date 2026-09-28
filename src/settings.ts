// The user's profile and preferences (filled in by the setup wizard), plus the master CV and free-text facts.
// Nothing here is hard-coded to one person: every personal detail comes from these records.
import { kvGet, kvSet } from "./db";

export type CountryCode = "gb" | "nl" | "us" | "ie" | "ca" | "tr";

export const COUNTRIES: Record<CountryCode, {
  name: string; currency: string; symbol: string;
  linkedin: string; apple: string | null; adzuna: string | null;
  /** is there a public register we can check sponsorship against (see sponsors.ts)? */
  sponsorRegister: boolean;
  /** words that mark a job location as being in this country (for company-board filtering) */
  places: RegExp;
}> = {
  gb: { name: "United Kingdom", currency: "GBP", symbol: "£", linkedin: "United Kingdom", apple: "united-kingdom-GBR", adzuna: "gb", sponsorRegister: true,
    places: /\b(uk|united kingdom|england|scotland|wales|northern ireland|london|manchester|liverpool|leeds|birmingham|bristol|edinburgh|glasgow|cambridge|oxford|belfast|cardiff|newcastle|sheffield|nottingham|brighton|reading)\b/i },
  nl: { name: "Netherlands", currency: "EUR", symbol: "€", linkedin: "Netherlands", apple: "netherlands-NLD", adzuna: "nl", sponsorRegister: true,
    places: /\b(netherlands|nederland|holland|amsterdam|rotterdam|utrecht|eindhoven|the hague|den haag|groningen|leiden|delft|haarlem|amstelveen)\b/i },
  us: { name: "United States", currency: "USD", symbol: "$", linkedin: "United States", apple: "united-states-USA", adzuna: "us", sponsorRegister: false,
    places: /\b(us|usa|u\.s\.|united states|new york|san francisco|seattle|austin|boston|chicago|los angeles|denver|atlanta|washington|remote - us|[a-z]+, (ca|ny|wa|tx|ma|il|co|ga))\b/i },
  ie: { name: "Ireland", currency: "EUR", symbol: "€", linkedin: "Ireland", apple: "ireland-IRL", adzuna: null, sponsorRegister: false,
    places: /\b(ireland|dublin|cork|galway|limerick|waterford)\b/i },
  ca: { name: "Canada", currency: "CAD", symbol: "$", linkedin: "Canada", apple: "canada-CAN", adzuna: "ca", sponsorRegister: false,
    places: /\b(canada|toronto|vancouver|montreal|ottawa|calgary|waterloo|edmonton|ontario|british columbia|quebec)\b/i },
  tr: { name: "Türkiye", currency: "TRY", symbol: "₺", linkedin: "Türkiye", apple: null, adzuna: null, sponsorRegister: false,
    places: /\b(turkey|türkiye|turkiye|istanbul|İstanbul|ankara|izmir|bursa|antalya|kocaeli|konya|gaziantep|eskişehir|eskisehir|mersin|kayseri|adana|samsun|trabzon|sakarya|tekirdağ|denizli)\b/i },
};

/** Countries outside the supported five, so "Germany (Remote)" isn't mistaken for "remote in your country". */
export const OTHER_PLACES = /\b(germany|deutschland|berlin|munich|hamburg|france|paris|spain|madrid|barcelona|portugal|lisbon|italy|milan|poland|warsaw|krakow|romania|bucharest|sweden|stockholm|denmark|copenhagen|norway|oslo|finland|helsinki|switzerland|zurich|austria|vienna|belgium|brussels|czech|prague|hungary|budapest|greece|estonia|lithuania|latvia|ukraine|israel|tel aviv|india|bangalore|bengaluru|hyderabad|pune|singapore|japan|tokyo|australia|sydney|melbourne|new zealand|brazil|sao paulo|mexico|argentina|colombia|chile|south africa|nigeria|lagos|kenya|egypt|uae|dubai|turkey|istanbul|philippines|manila|china|hong kong|korea|seoul|latam|apac)\b/i;

export type Settings = {
  setupComplete: boolean;
  // about you (also the contact line on every CV and cover letter)
  name: string;
  email: string;
  phone: string;
  links: string[];              // e.g. linkedin.com/in/..., github.com/..., portfolio
  // what you're looking for
  targetRoles: string[];        // "Senior Backend Engineer", "Senior Full Stack Engineer"
  seniority: "junior" | "mid" | "senior" | "staff" | "lead" | "any";
  strongSkills: string[];       // lower-case keywords you're strong in (boost matching jobs)
  weakSkills: string[];         // used before, not recently (small penalty when a job centres on them)
  searchQueries: string[];      // what the scanner searches for; derived from targetRoles, editable
  // where and how
  country: CountryCode;
  homeCity: string;
  commutable: string[];         // towns/cities you'd travel to for hybrid work
  remotePreference: "" | "remote" | "hybrid" | "onsite" | "any"; // "" = not chosen yet (setup requires a choice)
  maxOfficeDays: number;        // for offices outside your commutable area
  // money and eligibility
  salaryMin: number | null;     // flagged, never filtered
  needsSponsorship: boolean;    // checked against the country's public sponsor register where one exists (UK, Netherlands)
  sponsorSalaryFloor: number | null; // minimum salary the visa route requires for your occupation (e.g. UK going rate), if any
  excludeCompanies: string[];   // e.g. your current employer
  // how the AI should write for you
  writingRules: string;         // extra rules, e.g. "never mention X", "British English"
  scanHour: number;             // daily scan time (local server time, 0-23)
};

export const DEFAULT_SETTINGS: Settings = {
  setupComplete: false,
  name: "", email: "", phone: "", links: [],
  targetRoles: [], seniority: "senior", strongSkills: [], weakSkills: [], searchQueries: [],
  country: "gb", homeCity: "", commutable: [], remotePreference: "", maxOfficeDays: 2,
  salaryMin: null, needsSponsorship: false, sponsorSalaryFloor: null, excludeCompanies: [],
  writingRules: "", scanHour: 7,
};

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...(kvGet<Partial<Settings>>("settings") ?? {}) };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  // the scanner needs something to search for
  if (!next.searchQueries.length && next.targetRoles.length) next.searchQueries = next.targetRoles.slice(0, 8);
  next.strongSkills = next.strongSkills.map((s) => s.toLowerCase().trim()).filter(Boolean);
  next.weakSkills = next.weakSkills.map((s) => s.toLowerCase().trim()).filter(Boolean);
  kvSet("settings", next);
  return next;
}

export const country = () => COUNTRIES[getSettings().country] ?? COUNTRIES.gb;

// ---------- master CV ----------
// The structured CV every tailored CV is cut from. Bullet ids let the AI pick and reorder without rewriting facts.
export type Bullet = { id: string; text: string };
export type Experience = { id: string; title: string; company: string; dates: string; sub: string; bullets: Bullet[] };
export type MasterCV = {
  name: string;
  headline: string;
  contact: string[];
  profile: string;
  skills: [string, string][];
  experience: Experience[];
  projects: Bullet[];
  community: Bullet[];
  education: [string, string][];
};

export const EMPTY_CV: MasterCV = { name: "", headline: "", contact: [], profile: "", skills: [], experience: [], projects: [], community: [], education: [] };

export function getMasterCV(): MasterCV {
  return { ...EMPTY_CV, ...(kvGet<MasterCV>("cv") ?? {}) };
}

export function saveMasterCV(cv: MasterCV) {
  kvSet("cv", cv);
}

/** Free-text facts beyond the CV that the user wants the AI to know (and may use). */
export const getFactsText = () => kvGet<string>("factsText") ?? "";
export const saveFactsText = (t: string) => kvSet("factsText", t);

/** The rules every AI-written text follows, combining fixed quality rules with the user's own. */
export function writingRules(): string {
  const s = getSettings();
  return [
    "- Never claim anything that is not in the CV or the confirmed facts. Never invent numbers, employers, tools or achievements.",
    "- First person, plain and specific. No buzzword filler (\"passionate\", \"synergy\", \"rockstar\", \"leverage\").",
    "- No em-dashes. Use commas, colons or full stops.",
    `- Use ${s.country === "us" ? "American" : "British"} English spelling.`,
    "- Salary questions: state a minimum (e.g. \"90k+\") or the top half of a published band; never a range with a ceiling.",
    "- Never mention immigration status or visa history. The only visa answer is a plain \"Yes\" or \"No\" to \"Do you require sponsorship?\".",
    ...(s.writingRules.trim() ? s.writingRules.trim().split(/\n+/).map((l) => `- ${l.replace(/^[-*]\s*/, "")}`) : []),
  ].join("\n");
}
