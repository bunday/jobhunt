// LinkedIn public (logged-out) job search. No account, no API key; be polite with delays.
import type { Job } from "../db";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const BASE = "https://www.linkedin.com/jobs-guest/jobs/api";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ");
const text = (s: string) => decode(s.replace(/<br\s*\/?>/g, "\n").replace(/<\/(p|li|ul|h\d)>/g, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim();

async function get(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" } });
    if (r.ok) return r.text();
    if (r.status === 429 || r.status >= 500) { await sleep(8000 * (attempt + 1)); continue; }
    return null;
  }
  return null;
}

export type SearchOpts = {
  keywords: string;
  location: string;
  /** 1 onsite, 2 remote, 3 hybrid */
  workType?: 1 | 2 | 3;
  /** seconds, e.g. 604800 = past week */
  postedWithin?: number;
  distanceMiles?: number;
  pages?: number;
};

type Card = { id: string; title: string; company: string; location: string; url: string; posted: string | null };

export async function search(o: SearchOpts): Promise<Card[]> {
  const out: Card[] = [];
  for (let page = 0; page < (o.pages ?? 2); page++) {
    const q = new URLSearchParams({ keywords: o.keywords, location: o.location, f_JT: "F", start: String(page * 10) });
    if (o.workType) q.set("f_WT", String(o.workType));
    if (o.postedWithin) q.set("f_TPR", `r${o.postedWithin}`);
    if (o.distanceMiles) q.set("distance", String(o.distanceMiles));
    const html = await get(`${BASE}/seeMoreJobPostings/search?${q}`);
    if (!html) break;
    const cards = html.split(/<li>/).slice(1);
    for (const c of cards) {
      const id = c.match(/jobPosting:(\d+)/)?.[1] ?? c.match(/\/jobs\/view\/[^"?]*?-(\d+)[?"]/)?.[1];
      const title = c.match(/base-search-card__title">\s*([\s\S]*?)\s*</)?.[1];
      const company = c.match(/base-search-card__subtitle">[\s\S]*?>\s*([\s\S]*?)\s*</)?.[1];
      const location = c.match(/job-search-card__location">\s*([\s\S]*?)\s*</)?.[1];
      const posted = c.match(/datetime="([\d-]+)"/)?.[1] ?? null;
      if (id && title && company) out.push({ id, title: decode(title), company: decode(company), location: decode(location ?? ""), url: `https://www.linkedin.com/jobs/view/${id}`, posted });
    }
    if (cards.length < 10) break;
    await sleep(2500);
  }
  return out;
}

export async function detail(card: Card, workType?: number, nearHome = false, country?: string, page?: string): Promise<Job> {
  const html = page ?? (await get(`${BASE}/jobPosting/${card.id}`)) ?? "";
  const desc = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1];
  const salary = html.match(/salary[^>]*>\s*([^<]*[£$€₺][^<]*)</)?.[1]?.trim() ?? null;
  const industry = html.match(/Industries<\/h3>\s*<span[^>]*>\s*([\s\S]*?)\s*</)?.[1] ?? "";
  return {
    source: "linkedin",
    source_id: card.id,
    url: card.url,
    title: card.title,
    company: card.company,
    location: card.location,
    work_mode: workType === 2 ? "remote" : workType === 3 ? "hybrid" : workType === 1 ? "onsite" : "unknown",
    salary_text: salary,
    posted_at: card.posted,
    description: desc ? text(desc) : null,
    is_agency: /staffing|recruit/i.test(industry) ? 1 : 0,
    near_home: nearHome ? 1 : 0,
    country: country ?? null,
  };
}

/** One job from its id alone (a pasted linkedin.com/jobs/view/... link): the card fields come from the posting page. */
export async function postingById(id: string): Promise<Job | null> {
  const html = await get(`${BASE}/jobPosting/${id}`);
  const title = html?.match(/top-card-layout__title[^>]*>([^<]+)</)?.[1]?.trim();
  if (!html || !title) return null;
  const company = html.match(/topcard__org-name-link[^>]*>\s*([^<]+?)\s*</)?.[1] ?? html.match(/topcard__flavor">\s*([^<]+?)\s*</)?.[1] ?? "";
  const location = html.match(/topcard__flavor--bullet">\s*([^<]+?)\s*</)?.[1] ?? "";
  const card: Card = { id, url: `https://www.linkedin.com/jobs/view/${id}`, title: decode(title), company: decode(company), location: decode(location), posted: null };
  const j = await detail(card, undefined, false, undefined, html);
  const d = j.description ?? "";
  return { ...j, work_mode: /\bfully remote\b|\bremote[- ]first\b|\(remote\)/i.test(`${title} ${location}`) ? "remote" : /\bhybrid\b/i.test(`${title} ${location} ${d.slice(0, 1500)}`) ? "hybrid" : "unknown" };
}
