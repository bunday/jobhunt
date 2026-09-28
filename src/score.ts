// Rank a job against the user's settings. Pure function: every point has a human-readable reason.
import type { Job } from "./db";
import { COUNTRIES, OTHER_PLACES, type Settings } from "./settings";
import type { SponsorMatch } from "./sponsors";
import { titleWanted } from "./match";

// languages/platforms that usually define a role; only counted as "off-stack" when the user doesn't list them
const COMMON_STACKS = [".net", "c#", "c++", "rust", "scala", "kotlin", "swift", "ruby", "elixir", "php", "java", "python", "golang", "salesforce", "sap", "embedded", "ios", "android", "unity", "angular", "vue", "flutter"];
const DISCIPLINES = ["data scientist", "data engineer", "analytics engineer", "field engineer", "ml engineer", "machine learning", "qa", "test", "sdet", "devops", "sre", "site reliability", "security engineer", "network", "support engineer", "solutions engineer", "sales", "firmware", "hardware", "mechanical", "electrical"];

const AGENCY_NAMES = /\b(recruit\w*|talent|resourcing|staffing|search|consult\w*|people|hunters?|harnham|radley james|hackajob|ocho people|tempest vane|sellick|harvey nash|jack & jill|areti|quant capital|nearform recruit|hunter bond|stott and may|hamilton barnes|lorien|computer futures|nigel frank|x4 technology|frank recruitment|investigo|salt|g2 recruitment|montash|oho group|venturi|trust in soda|explore group|develop|intelliga|sanderson|mploy|gravitas|pearson frank|damia group|haybrook|hireful|bramwith|the curve group|ignite digital|tech people|oscar technology|oliver bernard|hays|reed|robert walters|michael page|la fosse|jobgether|understanding recruitment|trg|opus|lorien|nigel frank|jefferson frank|client server|burns sheehan|cooper lomaz|method resourcing|tenth revolution|team4rec|hirewell|crossover|turing)\b/i;

const REFUSES = [
  // "not able to offer visa sponsorship", "unable to sponsor", "does not offer sponsorship", "aren't able to sponsor"
  /\b(unable|not (currently )?able|cannot|can ?not|can't|won't|will not|do not|don't|does not|doesn't|aren't|are not|is not|isn't|no longer|not in a position)\b[^.!\n]{0,45}\bsponsor/i,
  /\bno (visa )?sponsorship/i,
  /sponsorship (is )?not (available|offered|provided|possible)/i,
  /without (the )?(need|requirement) (for|of) (visa )?sponsorship/i,
  /(right to work|work permit)[^.]{0,60}without[^.]{0,20}sponsor/i,
  /(sc|security|dv|nppv) clearance (is )?(required|essential)|eligible for (sc|dv|security) clearance|british citizen(s)? only|sole british/i,
];
// "We do sponsor visas! However, we aren't able to sponsor for every role": the qualifier makes it an offer
const PARTIAL = /(every|all|each) (role|position|candidate)|some roles/i;
const US_ONLY = /\b(u\.?s\.?|us|american|h-?1b)\b[^.]{0,20}(visa )?sponsor/i;
// "must have the right to work in the UK" is often boilerplate: a soft flag, not a no
const RTW = /must (already )?have (the )?(full |existing |unrestricted |current )?(legal )?right to work|(full|unrestricted|existing) right to work/i;
const OFFERS = [
  /(visa )?sponsorship (is )?(available|offered|provided|considered|possible)/i,
  /(we|can|will|able to|happy to|open to)\s+(offer |provide |support )?(visa )?sponsor/i,
  /sponsor (a |your )?(skilled worker )?visa/i,
  /skilled worker visa/i,
];

export function parseSalary(s: string | null | undefined): { min: number | null; max: number | null; daily: boolean } {
  if (!s) return { min: null, max: null, daily: false };
  const daily = /per day|\/day|a day|p\/d|day rate|daily|per hour|\/hr|an hour|hourly/i.test(s);
  // "k" form first, or "£80K" is read as £80; £ $ € and ISO codes
  const nums = [...s.matchAll(/(?:[£$€]|\b(?:gbp|usd|eur|cad)\s?)\s?(\d{2,3}(?:\.\d)?\s?k\b|\d{2,3}(?:,\d{3})+|\d{4,6})/gi)].map((m) => {
    const v = m[1].replace(/,/g, "").toLowerCase();
    return v.endsWith("k") ? Number.parseFloat(v) * 1000 : Number(v);
  }).filter((n) => n >= 100);
  if (!nums.length) return { min: null, max: null, daily };
  return { min: Math.min(...nums), max: Math.max(...nums), daily };
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, once: 1, twice: 2 };
/** "3 days a week in the office", "in the office twice a week", "Mon/Tue/Thu in office" → 3 */
export function officeDaysPerWeek(desc: string): number | null {
  const n = "(\\d|one|two|three|four|five)";
  const res = [
    new RegExp(`${n}(?:\\s*-\\s*${n})?\\s*(?:x\\s*)?days?\\s*(?:a|per|each|every)?\\s*(?:week|wk)?[^.\\n]{0,30}(?:office|on-?site|in person|in-person|onsite|hq)`),
    new RegExp(`(?:office|on-?site|in person|in-person|hq)[^.\\n]{0,30}?${n}(?:\\s*-\\s*${n})?\\s*(?:x\\s*)?days?\\s*(?:a|per)\\s*week`),
    /(?:office|in person|on-?site)[^.\n]{0,25}(once|twice) (?:a|per) week|(once|twice) (?:a|per) week[^.\n]{0,25}(?:office|in person|on-?site)/,
  ];
  for (const re of res) {
    const m = desc.match(re);
    if (m) {
      const vals = m.slice(1).filter(Boolean).map((v) => (/\d/.test(v) ? Number(v) : WORD_NUM[v]));
      if (vals.length) return Math.max(...vals);
    }
  }
  const dayList = desc.match(/(mon|tue|wed|thu|fri)[a-z]*\s*(?:\/|,|and|&)\s*(mon|tue|wed|thu|fri)[a-z]*(?:\s*(?:\/|,|and|&)\s*(?:and\s+)?(mon|tue|wed|thu|fri)[a-z]*)?[^.\n]{0,25}(office|in person|on-?site)/);
  if (dayList) return dayList.slice(1, 4).filter(Boolean).length;
  const dayList2 = desc.match(/(?:office|in person|on-?site)[^.\n]{0,25}?\b(mon|tue|wed|thu|fri)[a-z]*\s*(?:\/|,|and|&)\s*(?:and\s+)?(mon|tue|wed|thu|fri)[a-z]*(?:\s*(?:\/|,|and|&)\s*(?:and\s+)?(mon|tue|wed|thu|fri)[a-z]*)?/);
  if (dayList2) return dayList2.slice(1, 4).filter(Boolean).length;
  if (/(once|one day) (a|per) (month|fortnight|quarter)|monthly|quarterly (on-?site|meet|in person|offsite)/.test(desc) && /office|in person|offsite|on-?site/.test(desc)) return 0;
  return null;
}

export type Scored = { score: number; reasons: string[]; sponsorText: "offers" | "refuses" | "none"; salary: ReturnType<typeof parseSalary>; agency: boolean };

const has = (hay: string, needle: string) =>
  new RegExp(`(^|[^a-z0-9+#.])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9+#])`, "i").test(hay);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 2);

export function score(j: Job, sponsor: SponsorMatch, st: Settings): Scored {
  const reasons: string[] = [];
  let s = 20;
  const title = j.title.toLowerCase();
  const desc = (j.description ?? "").toLowerCase();
  const all = `${title}\n${desc}`;
  const cur = COUNTRIES[st.country];
  const money = (n: number) => `${cur.symbol}${Math.round(n / 1000)}k`;
  const home = st.homeCity || "home";
  const mine = new Set([...st.strongSkills, ...st.weakSkills]);
  const targets = st.targetRoles.join(" ").toLowerCase();

  // role and level fit
  const roleWords = new Set(st.targetRoles.flatMap(words).filter((w) => !["senior", "junior", "lead", "staff", "principal"].includes(w)));
  const overlap = words(title).filter((w) => roleWords.has(w)).length;
  if (st.targetRoles.length && !titleWanted(j.title)) { s -= 30; reasons.push("− not one of your target roles"); }
  else if (overlap >= 2) { s += 10; reasons.push("+ matches a role you're targeting"); }
  else if (overlap === 1) { s += 4; reasons.push("~ partly matches your target roles"); }
  const seniorTitle = /\b(senior|sr\.?|staff|lead|principal|founding)\b/.test(title);
  const juniorTitle = /\b(junior|graduate|intern|apprentice|entry|mid[- ]level|associate)\b/.test(title);
  if (["senior", "staff", "lead"].includes(st.seniority)) {
    if (seniorTitle) { s += 10; reasons.push("+ at your level"); }
    if (juniorTitle) { s -= 40; reasons.push("− below your level"); }
  } else if (st.seniority === "junior" || st.seniority === "mid") {
    if (juniorTitle || (!seniorTitle && st.seniority === "mid")) { s += 10; reasons.push("+ at your level"); }
    if (/\b(staff|principal|lead|head of|director)\b/.test(title)) { s -= 30; reasons.push("− well above your level"); }
  }
  if (/\b(head of|director|vp|vice president|cto)\b/.test(title) && !/head|director|vp|cto/.test(targets)) { s -= 15; reasons.push("− exec title, stretch"); }
  const otherDiscipline = DISCIPLINES.filter((d) => has(title, d) && !targets.includes(d));
  if (otherDiscipline.length) { s -= 25; reasons.push("− different discipline"); }

  // skills fit
  const strong = st.strongSkills.filter((k) => has(all, k));
  s += Math.min(strong.length * 2, 16);
  if (strong.length) reasons.push(`+ your skills: ${strong.slice(0, 8).join(", ")}`);
  const inTitle = st.strongSkills.filter((k) => has(title, k));
  if (inTitle.length) { s += 6; reasons.push(`+ ${inTitle.slice(0, 2).join(", ")} in the title`); }
  const off = COMMON_STACKS.filter((k) => !mine.has(k) && (has(title, k) || (desc.split(k).length > 3 && has(desc, k))));
  if (off.length) { s -= 10 * Math.min(off.length, 3); reasons.push(`− built on ${off.join(", ")} (not on your CV)`); }
  const weak = st.weakSkills.filter((k) => has(title, k));
  if (weak.length) { s -= 8; reasons.push(`− leans on ${weak.join(", ")} (not your recent strength)`); }

  // location / work mode. Job-board "remote" labels are only a hint: the ad text decides. Flag, never filter.
  const loc = `${j.location ?? ""} ${title}`.toLowerCase();
  const nearby = [st.homeCity, ...st.commutable].filter(Boolean).some((p) => loc.includes(p.toLowerCase()));
  const officeDays = officeDaysPerWeek(desc);
  const noRemote = /fully remote( working| work)? (is )?not (available|possible|an option|offered)|not (a )?(fully )?remote (role|position)|(on-?site|in[- ]office|office[- ]based) (role|position)|fully on-?site|5 days (a|per) week (in|at|from) (the |our )?office|full[- ]time in (the |our )?office/.test(desc);
  const remoteText = !noRemote && /fully remote|100% remote|remote[- ]first|remote[- ]friendly|remote \(|remote (in|across|within)|work from anywhere|or remote|work where you work best|flexibility to work from home|no mandated requirement on office attendance/.test(`${desc} ${loc}`);
  const elsewhere = OTHER_PLACES.test(loc) || Object.entries(COUNTRIES).filter(([c]) => c !== st.country).some(([, o]) => o.places.test(loc));
  const abroad = elsewhere && !cur.places.test(loc) || /must be (based|located) in (?!the same)/.test(desc) && !cur.places.test(desc.match(/must be (based|located) in [^.]{0,40}/)?.[0] ?? "");
  const maxDays = st.remotePreference === "remote" ? Math.min(st.maxOfficeDays, 1) : st.maxOfficeDays;
  if (abroad) { s -= 40; reasons.push(`− based outside ${cur.name}`); }
  else if (nearby) { s += 8; reasons.push(`+ commutable from ${home}`); }
  else if (officeDays !== null && officeDays > Math.max(maxDays, 3)) {
    s -= 30; reasons.push(`− ${officeDays} office days/week, not near ${home}`);
  } else if (noRemote && officeDays === null) {
    s -= 12; reasons.push("~ hybrid, fully remote not available, office days not stated: ask");
  } else if (officeDays !== null && officeDays >= 2) {
    const within = officeDays <= st.maxOfficeDays;
    s -= within ? 6 : 15; reasons.push(`~ ${officeDays} office days/week not near ${home} (${within ? "within" : "over"} your ${st.maxOfficeDays}-day limit)`);
  } else if (officeDays !== null && officeDays <= 1) {
    s += 6; reasons.push(`+ ${officeDays === 0 ? "remote" : "1 office day/week or less"}`);
  } else if (remoteText) { s += 10; reasons.push("+ remote (ad says so)"); }
  else if (j.work_mode === "remote") { s += 2; reasons.push("~ listed as remote but the ad doesn't confirm it, check office days"); }
  else if (j.work_mode === "onsite") { s -= 30; reasons.push(`− on-site, not near ${home}`); }
  else { reasons.push("~ office pattern not stated, check"); }

  // salary (flags only: nothing is filtered out)
  const salary = parseSalary(j.salary_text ?? desc.match(/(?:[£$€]|\b(?:gbp|usd|eur|cad)\b)[^\n]{0,60}/)?.[0]);
  if (salary.daily || /\b(contract|contractor|outside ir35|inside ir35|ftc|fixed[- ]term)\b/.test(title) || /day rate|outside ir35|inside ir35/.test(desc)) {
    s -= st.needsSponsorship ? 40 : 15; reasons.push(`− contract / day-rate${st.needsSponsorship ? " (contracts rarely sponsor)" : ""}`);
  } else if (salary.max) {
    const band = `${money(salary.min ?? salary.max)}–${money(salary.max)}`;
    const floor = st.needsSponsorship ? st.sponsorSalaryFloor : null;
    if (floor && salary.max < floor) { s -= 40; reasons.push(`− pays under the ${cur.symbol}${floor.toLocaleString()} visa salary floor`); }
    else if (st.salaryMin && salary.max < st.salaryMin) { s -= 4; reasons.push(`~ salary ${band} tops out under your ${money(st.salaryMin)} minimum`); }
    else { s += 8; reasons.push(`+ salary ${band}${st.salaryMin ? ` reaches your ${money(st.salaryMin)} minimum` : ""}`); }
    if (floor && salary.min && salary.min < floor && salary.max >= floor) reasons.push(`~ bottom of range is under the ${cur.symbol}${floor.toLocaleString()} visa floor: the offer must land at or above it`);
  }

  // agencies hide the employer, so their sponsor status can't be checked
  const agency = AGENCY_NAMES.test(j.company) || (!!j.is_agency && sponsor.status === "not_found");

  // sponsorship: only when the user needs it
  let sponsorText: Scored["sponsorText"] = "none";
  if (st.needsSponsorship) {
    const refusal = REFUSES.map((r) => desc.match(r)).find((m) => m && !PARTIAL.test(desc.slice(m.index!, m.index! + m[0].length + 60)));
    const offer = OFFERS.some((r) => r.test(desc)) && !(st.country !== "us" && US_ONLY.test(desc));
    sponsorText = refusal ? "refuses" : offer ? "offers" : "none";
    if (sponsorText === "refuses") { s -= 60; reasons.push("− ad says no sponsorship / right to work required / clearance"); }
    if (sponsorText === "offers") { s += 15; reasons.push("+ ad mentions visa sponsorship"); }
    if (sponsorText === "none" && RTW.test(desc)) { s -= 20; reasons.push("~ asks for right to work (may be boilerplate, confirm sponsorship)"); }
    if (agency) { if (sponsorText === "none") reasons.push("? recruiter post, employer hidden: ask if the client sponsors"); }
    else if (sponsor.status === "licensed") { s += 15; reasons.push("+ licensed sponsor"); }
    else if (sponsor.status === "likely") { s += 8; reasons.push("+ probably a licensed sponsor (check the name)"); }
    else if (sponsor.status === "not_found" && sponsorText !== "offers") { s -= 30; reasons.push("− not on the sponsor register"); }
  } else if (agency) reasons.push("~ recruiter post: the employer is hidden");

  if (j.source === "adzuna" && (j.description ?? "").length < 700) reasons.push("~ snippet only: open the ad for full details (sponsorship and office days may be missing)");
  return { score: Math.max(0, Math.min(100, s)), reasons, sponsorText, salary, agency };
}
