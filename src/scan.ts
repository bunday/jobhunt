// One full scan: refresh the sponsor register (if the user needs sponsorship), pull every source, score, store.
import { db, jobExists, upsertJob, type Job } from "./db";
import { score } from "./score";
import { COUNTRIES, getSettings } from "./settings";
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
  const sp = st.needsSponsorship ? matchSponsor(st.country, j.company) : { status: "n/a" as const };
  const r = score(j, sp, st);
  return {
    ...j,
    salary_min: r.salary.min,
    salary_max: r.salary.max,
    // a recruiter's own name matching the register says nothing about their client
    sponsor_status: r.agency && st.needsSponsorship ? "agency" : sp.status,
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

  if (st.needsSponsorship && hasRegister(st.country)) {
    stage("Updating the sponsor register");
    try { say(`sponsor register (${st.country}): ${await refreshRegister(st.country)}`); }
    catch (e) { say(`sponsor register refresh failed, using the cached copy: ${(e as Error).message}`); }
  }

  const postedWithin = opts.postedWithin ?? 7 * 86400;
  const runs: linkedin.SearchOpts[] = [];
  for (const kw of st.searchQueries.slice(0, 10)) {
    // remote jobs suit everyone; hybrid near home gets a deeper search unless the user wants remote only
    runs.push({ keywords: kw, location: cc.linkedin, workType: 2, postedWithin, pages: st.remotePreference === "hybrid" ? 3 : 5 });
    if (st.homeCity) runs.push({ keywords: kw, location: `${st.homeCity}, ${cc.linkedin}`, workType: 3, distanceMiles: st.remotePreference === "remote" ? 30 : 50, postedWithin, pages: st.remotePreference === "remote" ? 1 : 3 });
  }

  for (const [i, run] of runs.entries()) {
    stage(`LinkedIn search ${i + 1} of ${runs.length}: "${run.keywords}"`);
    let cards: Awaited<ReturnType<typeof linkedin.search>> = [];
    try { cards = await linkedin.search(run); } catch (e) { say(`linkedin "${run.keywords}" failed: ${(e as Error).message}`); }
    const fresh = cards.filter((c) => !excluded(c.company) && !jobExists("linkedin", c.id));
    say(`linkedin "${run.keywords}" [${run.workType === 2 ? `remote ${cc.name}` : `hybrid near ${st.homeCity}`}]: ${cards.length} results, ${fresh.length} new`);
    for (const c of fresh) {
      try { add(await linkedin.detail(c, run.workType)); } catch (e) { say(`  detail ${c.id} failed: ${(e as Error).message}`); }
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
