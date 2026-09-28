// One full scan: refresh the sponsor register (if the user needs sponsorship), pull every source, score, store.
import { db, jobExists, upsertJob, type Job } from "./db";
import { score } from "./score";
import { COUNTRIES, type CountryCode, getSettings, prefsFor, searchCountries } from "./settings";
import { jobCountry } from "./match";
import { hasRegister, matchSponsor, refreshRegister } from "./sponsors";
import { scanAdzuna } from "./sources/adzuna";
import { scanApple } from "./sources/apple";
import { scanAts } from "./sources/ats";
import * as linkedin from "./sources/linkedin";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function excluded(company: string): boolean {
  const ex = getSettings().excludeCompanies.map((c) => c.toLowerCase().trim()).filter(Boolean);
  const c = company.toLowerCase();
  return ex.some((e) => c.includes(e));
}

export function finalise(j: Job): Job {
  const st = getSettings();
  // the country the job is in decides currency, salary minimum, sponsorship and which register to check
  const country = (j.country ?? jobCountry(j.location ?? "") ?? st.country) as CountryCode;
  j = { ...j, country };
  const needs = prefsFor(country, st).needsSponsorship;
  const sp = needs ? matchSponsor(country, j.company) : { status: "n/a" as const };
  const r = score(j, sp, st);
  return {
    ...j,
    salary_min: r.salary.min,
    salary_max: r.salary.max,
    // a recruiter's own name matching the register says nothing about their client
    sponsor_status: r.agency && needs ? "agency" : sp.status,
    sponsor_name: "name" in sp ? sp.name ?? null : null,
    sponsor_text: r.sponsorText,
    score: r.score,
    reasons: JSON.stringify(r.reasons),
  };
}

export type ScanProgress = { stage: string; found: number; added: number };

export async function runScan(opts: { postedWithin?: number; log?: (m: string) => void; progress?: (p: ScanProgress) => void } = {}) {
  const st = getSettings();
  const cc = COUNTRIES[st.country];
  const log = opts.log ?? console.log;
  const scanId = Number(db.query("INSERT INTO scans DEFAULT VALUES").run().lastInsertRowid);
  const lines: string[] = [];
  const say = (m: string) => { lines.push(m); log(m); };
  let found = 0;
  let added = 0;
  const stage = (s: string) => opts.progress?.({ stage: s, found, added });
  const add = (j: Job) => {
    if (excluded(j.company)) return;
    found++;
    if (upsertJob(finalise(j)).added) added++;
  };

  for (const c of searchCountries(st)) {
    if (!prefsFor(c, st).needsSponsorship || !hasRegister(c)) continue;
    stage(`Updating the ${COUNTRIES[c].name} sponsor register`);
    try { say(`sponsor register (${c}): ${await refreshRegister(c)}`); }
    catch (e) { say(`sponsor register (${c}) refresh failed, using the cached copy: ${(e as Error).message}`); }
  }

  const postedWithin = opts.postedWithin ?? 7 * 86400;
  type Run = linkedin.SearchOpts & { country: CountryCode };
  const runs: Run[] = [];
  const extras = searchCountries(st).slice(1);
  for (const kw of st.searchQueries.slice(0, 10)) {
    // extra countries: the user would relocate, so any working pattern, nationwide
    for (const c of extras) runs.push({ country: c, keywords: kw, location: COUNTRIES[c].linkedin, postedWithin, pages: 3 });
    const pref = st.remotePreference;
    // nationwide remote search, unless the work is on-site
    if (pref !== "onsite") runs.push({ country: st.country, keywords: kw, location: cc.linkedin, workType: 2, postedWithin, pages: pref === "remote" ? 5 : 3 });
    // search around home: any working pattern for on-site/hybrid/any people; a light hybrid search for remote-first people
    if (st.homeCity) {
      const near = `${st.homeCity}, ${cc.linkedin}`;
      if (pref === "remote") runs.push({ country: st.country, keywords: kw, location: near, workType: 3, distanceMiles: 30, postedWithin, pages: 1 });
      else runs.push({ country: st.country, keywords: kw, location: near, distanceMiles: pref === "onsite" ? 25 : 50, postedWithin, pages: pref === "onsite" ? 5 : 3 });
    }
  }

  for (const [i, run] of runs.entries()) {
    stage(`LinkedIn search ${i + 1} of ${runs.length}: "${run.keywords}" (${COUNTRIES[run.country].name})`);
    let cards: Awaited<ReturnType<typeof linkedin.search>> = [];
    try { cards = await linkedin.search(run); } catch (e) { say(`linkedin "${run.keywords}" failed: ${(e as Error).message}`); }
    const fresh = cards.filter((c) => !excluded(c.company) && !jobExists("linkedin", c.id));
    say(`linkedin "${run.keywords}" [${run.distanceMiles ? `within ${run.distanceMiles} miles of ${st.homeCity}` : run.country === st.country ? `remote, ${cc.name}` : COUNTRIES[run.country].name}]: ${cards.length} results, ${fresh.length} new`);
    for (const c of fresh) {
      try { add(await linkedin.detail(c, run.workType, !!run.distanceMiles, run.country)); } catch (e) { say(`  detail ${c.id} failed: ${(e as Error).message}`); }
      await sleep(1500);
    }
    await sleep(3000);
  }

  stage("Company careers boards");
  try { for (const j of await scanAts(say)) add(j); } catch (e) { say(`careers boards failed: ${(e as Error).message}`); }

  stage("Apple");
  try { for (const j of await scanApple(say)) add(j); } catch (e) { say(`apple failed: ${(e as Error).message}`); }

  stage("Adzuna");
  try {
    for (const j of await scanAdzuna(say, Math.max(1, Math.round(postedWithin / 86400)))) if (!jobExists("adzuna", j.source_id)) add(j);
  } catch (e) { say(`adzuna failed: ${(e as Error).message}`); }

  const dupes = markDuplicates();
  if (dupes) say(`hid ${dupes} duplicate postings`);
  db.query("UPDATE scans SET finished = datetime('now'), found = ?, added = ?, log = ? WHERE id = ?").run(found, added, lines.join("\n"), scanId);
  say(`done: ${found} seen, ${added} new`);
  stage("Done");
  return { found, added };
}

const dedupeKey = (company: string, title: string) => `${company}|${title}`.toLowerCase().replace(/[^a-z0-9|]+/g, " ").trim();

/**
 * The same company + title posted in several cities/sources: keep the best-scored row, mark untouched copies
 * as 'duplicate' (hidden). Marking rather than deleting stops the next scan re-adding them as new.
 */
export function markDuplicates(): number {
  const rows = db.query("SELECT id, company, title, status, (SELECT COUNT(*) FROM events e WHERE e.job_id = jobs.id) ev FROM jobs WHERE status != 'duplicate' ORDER BY (status != 'new') DESC, score DESC, id").all() as { id: number; company: string; title: string; status: string; ev: number }[];
  const seen = new Set<string>();
  let hidden = 0;
  for (const r of rows) {
    const k = dedupeKey(r.company, r.title);
    if (!seen.has(k)) { seen.add(k); continue; }
    if (r.status === "new" && r.ev === 0) { db.query("UPDATE jobs SET status = 'duplicate' WHERE id = ?").run(r.id); hidden++; }
  }
  return hidden;
}

/** Re-score everything already stored (after settings change). */
export function rescoreAll() {
  const rows = db.query("SELECT * FROM jobs").all() as Job[];
  for (const r of rows) upsertJob(finalise(r));
  markDuplicates();
  return rows.length;
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (arg === "rescore") console.log(`rescored ${rescoreAll()}`);
  else await runScan({ postedWithin: arg ? Number(arg) * 86400 : undefined });
}
