// jobs.apple.com: no public API, but search and detail pages embed their data as React Router hydration JSON.
import type { Job } from "../db";
import { titleWanted } from "../match";
import { COUNTRIES, type CountryCode, getSettings, searchCountries } from "../settings";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const BASE = "https://jobs.apple.com/en-gb"; // UI language only; the location parameter picks the country
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Apple rarely puts "Senior" in titles, so keep titles matching the target roles and drop hardware/chip tracks
const HARDWARE = /(gpu|rtl|asic|silicon|physical design|verification|synthesis|cad|emulation|ams|analog|rf|firmware|hardware|camera|display|mechanical|electrical|technician|genius|specialist)/i;

async function hydration(url: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-GB" }, redirect: "follow" });
  if (!r.ok) return null;
  const m = (await r.text()).match(/window\.__staticRouterHydrationData\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\);/);
  return m ? JSON.parse(JSON.parse(m[1])) : null;
}

function find(o: unknown, key: string): Record<string, unknown> | null {
  if (!o || typeof o !== "object") return null;
  if (!Array.isArray(o) && key in (o as object)) return o as Record<string, unknown>;
  for (const v of Object.values(o as object)) { const f = find(v, key); if (f) return f; }
  return null;
}

type Hit = { id: string; positionId: string; postingTitle: string; postDateInGMT?: string; locations?: { name: string }[] };

export async function scanApple(say: (m: string) => void): Promise<Job[]> {
  const out: Job[] = [];
  for (const c of searchCountries()) out.push(...(await scanAppleCountry(c, say)));
  return out;
}

async function scanAppleCountry(country: CountryCode, say: (m: string) => void): Promise<Job[]> {
  const s = getSettings();
  const loc = COUNTRIES[country].apple;
  if (!loc) return [];
  const QUERIES = s.searchQueries.slice(0, 5);
  const hits = new Map<string, Hit>();
  for (const q of QUERIES) {
    for (let page = 1; page <= 6; page++) {
      const d = await hydration(`${BASE}/search?location=${loc}&key=${encodeURIComponent(q)}&page=${page}`);
      const res = (find(d, "searchResults")?.searchResults ?? []) as Hit[];
      for (const h of res) if (titleWanted(h.postingTitle) && !HARDWARE.test(h.postingTitle)) hits.set(h.id, h);
      if (res.length < 20) break;
      await sleep(1200);
    }
  }
  const out: Job[] = [];
  for (const h of hits.values()) {
    const j = await appleJob(h.id, country, h);
    await sleep(800);
    if (j) out.push(j);
  }
  say(`apple (${COUNTRIES[country].name}): ${hits.size} matching roles`);
  return out;
}

/** One Apple job from its details page (also used for a pasted jobs.apple.com link). */
export async function appleJob(id: string, country: CountryCode | null, h?: Hit): Promise<Job | null> {
  const d = await hydration(`${BASE}/details/${id}`);
  const jd = find(d, "minimumQualifications") as Record<string, string | boolean | { name: string }[]> | null;
  if (!jd) return null;
  const section = (t: string, k: string) => (jd[k] ? `${t}\n${jd[k]}` : "");
  return {
    source: "apple",
    source_id: id,
    url: `${BASE}/details/${id}`,
    title: String(jd.postingTitle ?? h?.postingTitle ?? "").trim(),
    company: "Apple",
    country,
    location: ((jd.locations as { name: string }[]) ?? h?.locations ?? []).map((l) => l.name).join(" / "),
    work_mode: jd.homeOffice === true ? "remote" : "unknown",
    posted_at: h?.postDateInGMT?.slice(0, 10) ?? (typeof jd.postDateInGMT === "string" ? jd.postDateInGMT.slice(0, 10) : null),
    description: [jd.jobSummary, section("Description", "description"), section("Responsibilities", "responsibilities"), section("Minimum qualifications", "minimumQualifications"), section("Preferred qualifications", "preferredQualifications")].filter(Boolean).join("\n\n"),
  };
}
