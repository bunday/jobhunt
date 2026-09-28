// Adzuna job search API (official, free key): aggregator covering many boards and employer sites in gb/nl/us/ca.
// Results carry only a ~500-char snippet and Adzuna's web pages block automated access (403 even in headless Chrome),
// so Adzuna jobs are snippet-only: the card asks the user to paste the full ad before Prepare.
import type { Job } from "../db";
import { titleWanted } from "../match";
import { COUNTRIES, getSettings } from "../settings";

const ID = process.env.ADZUNA_APP_ID;
const KEY = process.env.ADZUNA_APP_KEY;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Hit = {
  id: string; title: string; description: string; redirect_url: string; created: string;
  company?: { display_name?: string }; location?: { display_name?: string; area?: string[] };
  salary_min?: number; salary_max?: number; salary_is_predicted?: string; contract_time?: string; contract_type?: string;
};

const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").trim();


export async function scanAdzuna(say: (m: string) => void, maxDaysOld = 7): Promise<Job[]> {
  if (!ID || !KEY) { say("adzuna: skipped (no ADZUNA_APP_ID / ADZUNA_APP_KEY)"); return []; }
  const s = getSettings();
  const COUNTRY = COUNTRIES[s.country].adzuna;
  if (!COUNTRY) { say(`adzuna: not available for ${COUNTRIES[s.country].name}`); return []; }
  // "what" requires every word, so search each query as written
  const QUERIES = s.searchQueries.slice(0, 6).map((what) => ({ what }));
  const hits = new Map<string, Hit>();
  let calls = 0;
  for (const q of QUERIES) {
    for (let page = 1; page <= 2; page++) {
      const u = new URL(`https://api.adzuna.com/v1/api/jobs/${COUNTRY}/search/${page}`);
      u.search = new URLSearchParams({ app_id: ID, app_key: KEY, ...q, results_per_page: "50", max_days_old: String(maxDaysOld), full_time: "1", permanent: "1", sort_by: "date", "content-type": "application/json" }).toString();
      const r = await fetch(u); calls++;
      if (!r.ok) { say(`adzuna "${q.what}" p${page}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`); break; }
      const d = (await r.json()) as { results?: Hit[]; count?: number };
      for (const h of d.results ?? []) if (titleWanted(h.title)) hits.set(h.id, h);
      if ((d.results?.length ?? 0) < 50) break;
      await sleep(400);
    }
  }
  const out: Job[] = [];
  for (const h of hits.values()) {
    const loc = h.location?.display_name ?? "";
    const salary = h.salary_min && h.salary_is_predicted !== "1" ? `£${Math.round(h.salary_min)}${h.salary_max && h.salary_max !== h.salary_min ? ` - £${Math.round(h.salary_max)}` : ""}` : null;
    const desc = strip(h.description ?? "");
    out.push({
      source: "adzuna", source_id: h.id, url: h.redirect_url, title: strip(h.title), company: h.company?.display_name?.trim() || "Unknown",
      location: loc, work_mode: /remote/i.test(`${h.title} ${loc} ${desc.slice(0, 600)}`) ? "remote" : /hybrid/i.test(desc) ? "hybrid" : "unknown",
      salary_text: salary ? salary.replace(/£/g, COUNTRIES[s.country].symbol) : null, posted_at: h.created?.slice(0, 10) ?? null, description: desc,
    });
  }
  say(`adzuna: ${calls} API calls, ${hits.size} matching roles (snippet only)`);
  return out;
}
