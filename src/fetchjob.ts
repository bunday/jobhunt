// "Add a job" from a link: read the ad from wherever it's posted. Known job sites are read through their public
// data (the same way the daily search does); any other careers page through the schema.org JobPosting data most
// pages publish for Google; failing that, the AI reads the page text. Sites that block automated reading
// (Indeed, Glassdoor…) get a clear message so the user can paste the description instead.
import { generateJson } from "./ai";
import type { Job } from "./db";
import { appleJob } from "./sources/apple";
import { postingById } from "./sources/linkedin";

export type Fetched = { ok: true; job: Job; via: string } | { ok: false; blocked: boolean; error: string; partial?: Partial<Job> };

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const BLOCKED = /(^|\.)(indeed\.[a-z.]+|glassdoor\.[a-z.]+|kariyer\.net|adzuna\.[a-z.]+|totaljobs\.com|reed\.co\.uk|cv-library\.co\.uk|ziprecruiter\.[a-z.]+|monster\.[a-z.]+|seek\.[a-z.]+)$/i;

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
/** HTML (possibly entity-encoded) → readable text with line breaks kept. */
const strip = (h: string) =>
  decode(decode(h).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|h\d|div|ul|tr)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim();
const pretty = (slug: string) => slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const mode = (s: string) => (/\bremote\b/i.test(s) ? "remote" : /\bhybrid\b/i.test(s) ? "hybrid" : /on-?site|in[- ]office/i.test(s) ? "onsite" : "unknown");

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

// ---------- known job sites ----------

async function greenhouse(slug: string, id: string, url: string): Promise<Job | null> {
  const j = await getJson<{ title: string; location?: { name: string }; content: string; absolute_url: string; updated_at?: string }>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}`);
  if (!j) return null;
  const board = await getJson<{ name: string }>(`https://boards-api.greenhouse.io/v1/boards/${slug}`);
  const loc = j.location?.name ?? "";
  return { source: "manual", source_id: url, url: j.absolute_url || url, title: j.title, company: board?.name ?? pretty(slug), location: loc, work_mode: mode(loc), posted_at: j.updated_at?.slice(0, 10), description: strip(j.content ?? "") };
}

async function lever(host: string, co: string, id: string, url: string): Promise<Job | null> {
  type L = { text: string; categories: { location?: string; commitment?: string }; workplaceType?: string; descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string; hostedUrl: string; createdAt?: number;
    salaryRange?: { min: number; max: number; currency: string; interval: string } };
  const j = await getJson<L>(`https://${host.includes(".eu.") ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${co}/${id}`);
  if (!j) return null;
  const loc = j.categories?.location ?? "";
  const sal = j.salaryRange ? `${j.salaryRange.currency} ${j.salaryRange.min.toLocaleString()} - ${j.salaryRange.max.toLocaleString()}${/hour/i.test(j.salaryRange.interval) ? " per hour" : ""}` : null;
  const desc = [j.descriptionPlain, ...(j.lists ?? []).map((l) => `${l.text}\n${strip(l.content)}`), j.additionalPlain].filter(Boolean).join("\n\n");
  return { source: "manual", source_id: url, url: j.hostedUrl || url, title: j.text, company: pretty(co), location: loc, work_mode: j.workplaceType && j.workplaceType !== "unspecified" ? (j.workplaceType === "on-site" ? "onsite" : j.workplaceType) : mode(loc), salary_text: sal, posted_at: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : null, description: desc };
}

async function ashby(org: string, id: string, url: string): Promise<Job | null> {
  type A = { id: string; title: string; location: string; isRemote?: boolean; workplaceType?: string; descriptionPlain?: string; publishedAt?: string; jobUrl: string; compensation?: { compensationTierSummary?: string } };
  const d = await getJson<{ jobs: A[] }>(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`);
  const j = d?.jobs.find((x) => x.id === id);
  if (!j) return null;
  const wt = (j.workplaceType ?? "").toLowerCase();
  return { source: "manual", source_id: url, url: j.jobUrl || url, title: j.title.trim(), company: pretty(org), location: j.location, work_mode: wt === "remote" || (j.isRemote && !wt) ? "remote" : wt === "hybrid" ? "hybrid" : wt === "onsite" ? "onsite" : mode(j.location), salary_text: j.compensation?.compensationTierSummary ?? null, posted_at: j.publishedAt?.slice(0, 10), description: j.descriptionPlain ?? "" };
}

async function workable(acct: string, code: string, url: string): Promise<Job | null> {
  type W = { title: string; remote?: boolean; workplace?: string; location?: { city?: string; region?: string | null; country?: string }; published?: string; description?: string; requirements?: string; benefits?: string };
  const j = await getJson<W>(`https://apply.workable.com/api/v2/accounts/${acct}/jobs/${code}`);
  if (!j) return null;
  const account = await getJson<{ name: string }>(`https://apply.workable.com/api/v1/accounts/${acct}`);
  const loc = [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", ");
  const wp = (j.workplace ?? "").toLowerCase();
  return { source: "manual", source_id: url, url, title: j.title, company: account?.name ?? pretty(acct), location: j.remote && !loc ? "Remote" : loc, work_mode: wp === "on_site" || wp === "onsite" ? "onsite" : wp === "hybrid" ? "hybrid" : j.remote ? "remote" : "unknown", posted_at: j.published?.slice(0, 10), description: [j.description, j.requirements, j.benefits].filter(Boolean).map((h) => strip(h!)).join("\n\n") };
}

async function smartrecruiters(co: string, id: string, url: string): Promise<Job | null> {
  type S = { name: string; company?: { name: string }; location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean }; releasedDate?: string; jobAd?: { sections?: Record<string, { title?: string; text?: string }> } };
  const j = await getJson<S>(`https://api.smartrecruiters.com/v1/companies/${co}/postings/${id}`);
  if (!j) return null;
  const loc = [j.location?.city, j.location?.region, j.location?.country?.toUpperCase()].filter(Boolean).join(", ");
  const desc = Object.values(j.jobAd?.sections ?? {}).filter((s) => s.text).map((s) => `${s.title ?? ""}\n${strip(s.text!)}`.trim()).join("\n\n");
  return { source: "manual", source_id: url, url, title: j.name, company: j.company?.name ?? pretty(co), location: loc, work_mode: j.location?.remote ? "remote" : j.location?.hybrid ? "hybrid" : "unknown", posted_at: j.releasedDate?.slice(0, 10), description: desc };
}

// ---------- any other page ----------

type Ld = Record<string, unknown>;
/** schema.org JobPosting from the page's JSON-LD (what Google for Jobs reads; most careers sites publish it). */
function jsonLd(html: string, url: string): Job | null {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const all: Ld[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") { all.push(v as Ld); if ("@graph" in (v as Ld)) walk((v as Ld)["@graph"]); }
  };
  for (const b of blocks) { try { walk(JSON.parse(b.trim())); } catch { /* malformed block: skip */ } }
  const p = all.find((o) => [o["@type"]].flat().includes("JobPosting"));
  if (!p || !p.title) return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : v && typeof v === "object" && "name" in v ? String((v as Ld).name) : "");
  const places = [p.jobLocation].flat().filter(Boolean).map((l) => {
    const a = (l as Ld).address as Ld | string | undefined;
    if (!a || typeof a === "string") return a ?? str(l);
    return [a.addressLocality, a.addressRegion, str(a.addressCountry)].filter(Boolean).join(", ");
  }).filter(Boolean);
  const remote = p.jobLocationType === "TELECOMMUTE";
  let salary: string | null = null;
  const bs = p.baseSalary as Ld | undefined;
  if (bs && typeof bs === "object") {
    const v = (bs.value ?? {}) as Ld;
    const lo = v.minValue ?? v.value, hi = v.maxValue;
    const unit = String(v.unitText ?? "").toLowerCase();
    if (lo) salary = `${bs.currency ?? ""} ${Number(lo).toLocaleString()}${hi && hi !== lo ? ` - ${Number(hi).toLocaleString()}` : ""}${unit === "hour" ? " per hour" : unit === "day" ? " per day" : ""}`.trim();
  }
  const location = places.join(" / ") || (remote ? "Remote" : "");
  return {
    source: "manual", source_id: url, url, title: decode(String(p.title)).trim(), company: decode(str(p.hiringOrganization)).trim(), location,
    work_mode: remote ? "remote" : mode(`${location} ${String(p.description ?? "").slice(0, 1500)}`),
    salary_text: salary, posted_at: typeof p.datePosted === "string" ? p.datePosted.slice(0, 10) : null, description: strip(String(p.description ?? "")),
  };
}

const pageText = (html: string) => strip(html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " "));

/** Last resort (and pasted ads): the AI pulls the job out of the page text. */
export async function aiRead(text: string, url: string, title = ""): Promise<Job | null> {
  const body = text.slice(0, 30000);
  if (body.length < 300) return null;
  const r = await generateJson<{ isJobAd: boolean; title: string; company: string; location: string; workMode: string; salary: string; description: string }>(
    "You extract a job advert from the text of a web page. Copy wording exactly; never invent anything that isn't on the page.",
    `Page title: ${title}\nURL: ${url}\n\nPage text:\n${body}\n\nReturn JSON: {"isJobAd": boolean (false if this page isn't a single job advert), "title": "", "company": "", "location": "city/country as written, or 'Remote'", "workMode": "remote|hybrid|onsite|unknown", "salary": "as written, or empty", "description": "the full advert text: responsibilities, requirements, benefits. Copy it, don't summarise"}`,
  );
  if (!r?.isJobAd || !r.title) return null;
  const wm = String(r.workMode ?? "").toLowerCase();
  return { source: "manual", source_id: url, url, title: String(r.title).trim(), company: String(r.company ?? "").trim(), location: String(r.location ?? ""), work_mode: ["remote", "hybrid", "onsite"].includes(wm) ? wm : "unknown", salary_text: r.salary ? String(r.salary) : null, description: String(r.description ?? "") };
}

const blockedMsg = (host: string) => ({ ok: false as const, blocked: true, error: `${host} doesn't allow automatic reading. Paste the job description below instead.` });

export async function fetchJob(raw: string): Promise<Fetched> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, blocked: false, error: "That doesn't look like a link. Copy the full address from your browser (starting with https://)." }; }
  const host = u.hostname.replace(/^www\./, "");
  const url = u.toString();
  const path = u.pathname.split("/").filter(Boolean);
  if (BLOCKED.test(host)) return blockedMsg(host);

  const known = async (): Promise<[Job | null, string] | null> => {
    if (host.endsWith("linkedin.com")) {
      const id = u.searchParams.get("currentJobId") ?? u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/)?.[1];
      if (!id) return [null, "LinkedIn"];
      const j = await postingById(id);
      return [j && { ...j, source: "manual", source_id: url, url: j.url }, "LinkedIn"];
    }
    if (/greenhouse\.io$/.test(host) && path[1] === "jobs") return [await greenhouse(path[0], path[2], url), "Greenhouse"];
    if (host.endsWith("greenhouse.io") && u.searchParams.get("for") && u.searchParams.get("token")) return [await greenhouse(u.searchParams.get("for")!, u.searchParams.get("token")!, url), "Greenhouse"];
    if (/lever\.co$/.test(host) && path.length >= 2) return [await lever(host, path[0], path[1], url), "Lever"];
    if (host === "jobs.ashbyhq.com" && path.length >= 2) return [await ashby(path[0], path[1], url), "Ashby"];
    if (host === "apply.workable.com" && path[1] === "j") return [await workable(path[0], path[2], url), "Workable"];
    if (host.endsWith("smartrecruiters.com") && path.length >= 2) return [await smartrecruiters(path[0], path[1].match(/^\d+/)?.[0] ?? path[1], url), "SmartRecruiters"];
    if (host === "jobs.apple.com") {
      const id = u.pathname.match(/\/details\/([\w-]+)/)?.[1];
      const j = id ? await appleJob(id, null) : null;
      return [j && { ...j, source: "manual", source_id: url }, "Apple"];
    }
    return null;
  };
  const k = await known();
  if (k?.[0]?.title) return { ok: true, job: k[0], via: k[1] };

  // a company careers page (or a known site whose data call failed): read the page itself
  let html = "";
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-GB,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (r.status === 403 || r.status === 429 || r.status === 401) return blockedMsg(host);
    if (!r.ok) return { ok: false, blocked: false, error: `The page returned an error (${r.status}). Check the link opens in your browser, or paste the description below.` };
    html = await r.text();
  } catch {
    return { ok: false, blocked: false, error: "Couldn't reach that page. Check the link, or paste the description below." };
  }
  if (/captcha|cf-challenge|Just a moment\.\.\.|Access denied/i.test(html.slice(0, 5000)) && html.length < 60000) return blockedMsg(host);

  const ld = jsonLd(html, url);
  if ((ld?.description ?? "").length > 200 && ld) return { ok: true, job: ld, via: "the page's job data" };
  try {
    const ai = await aiRead(pageText(html), url, html.match(/<title[^>]*>([^<]*)</i)?.[1] ?? "");
    if (ai && (ai.description ?? "").length > 200) return { ok: true, job: { ...ai, company: ai.company || ld?.company || "" }, via: "AI (read from the page)" };
  } catch (e) {
    return { ok: false, blocked: false, error: `Couldn't read the job from that page (${(e as Error).message}). Paste the description below instead.`, partial: ld ?? undefined };
  }
  // pages that build the ad with JavaScript leave nothing to read in the raw HTML
  return { ok: false, blocked: true, error: "Couldn't find a job advert on that page (it may load the ad with JavaScript). Paste the job description below instead.", partial: ld ?? undefined };
}
