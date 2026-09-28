// Company careers boards with public JSON APIs: Greenhouse, Lever, Ashby. Default list in config/companies.json
// (add your own targets there, or in config/companies.local.json which is git-ignored).
import { existsSync, readFileSync } from "node:fs";
import { jobCountry, locationInCountry, titleWanted } from "../match";
import type { Job } from "../db";

const strip = (h: string) =>
  h.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/<br\s*\/?>/g, "\n").replace(/<\/(p|li|h\d|div)>/g, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim();

const wanted = (title: string, loc: string) => titleWanted(title) && locationInCountry(loc);
const CONFIG = `${import.meta.dir}/../../config`;
function companies(): { ats: string; slug: string; name: string }[] {
  const base = JSON.parse(readFileSync(`${CONFIG}/companies.json`, "utf8"));
  const local = existsSync(`${CONFIG}/companies.local.json`) ? JSON.parse(readFileSync(`${CONFIG}/companies.local.json`, "utf8")) : [];
  return [...base, ...local];
}
const mode = (loc: string, remote?: boolean) => (remote || /remote/i.test(loc) ? "remote" : /hybrid/i.test(loc) ? "hybrid" : "unknown");

async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

async function greenhouse(slug: string, name: string): Promise<Job[]> {
  const d = await json<{ jobs: { id: number; title: string; absolute_url: string; location: { name: string }; updated_at: string; content: string }[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
  return (d?.jobs ?? []).filter((j) => wanted(j.title, j.location?.name ?? "")).map((j) => ({
    source: "greenhouse", source_id: `${slug}:${j.id}`, url: j.absolute_url, title: j.title, company: name,
    location: j.location?.name, work_mode: mode(j.location?.name ?? ""), posted_at: j.updated_at?.slice(0, 10), description: strip(j.content ?? ""),
  }));
}

async function lever(slug: string, name: string): Promise<Job[]> {
  const d = await json<{ id: string; text: string; hostedUrl: string; categories: { location?: string; allLocations?: string[] }; workplaceType?: string; createdAt: number; descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string; salaryRange?: { min: number; max: number; currency: string } }[]>(
    `https://api.lever.co/v0/postings/${slug}?mode=json`);
  return (d ?? []).filter((j) => wanted(j.text, [j.categories?.location, ...(j.categories?.allLocations ?? []), j.workplaceType].join(" "))).map((j) => ({
    source: "lever", source_id: `${slug}:${j.id}`, url: j.hostedUrl, title: j.text, company: name,
    location: j.categories?.allLocations?.join(" / ") ?? j.categories?.location, work_mode: j.workplaceType === "remote" ? "remote" : j.workplaceType === "hybrid" ? "hybrid" : j.workplaceType === "onsite" ? "onsite" : "unknown",
    salary_text: j.salaryRange && j.salaryRange.currency === "GBP" ? `£${j.salaryRange.min} - £${j.salaryRange.max}` : null,
    posted_at: new Date(j.createdAt).toISOString().slice(0, 10),
    description: [j.descriptionPlain, ...(j.lists ?? []).map((l) => `${l.text}\n${strip(l.content)}`), j.additionalPlain].filter(Boolean).join("\n\n"),
  }));
}

async function ashby(slug: string, name: string): Promise<Job[]> {
  const d = await json<{ jobs: { id: string; title: string; jobUrl: string; location: string; secondaryLocations?: { location: string }[]; isRemote?: boolean; workplaceType?: string; publishedAt: string; descriptionPlain?: string; compensation?: { compensationTierSummary?: string } }[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
  return (d?.jobs ?? []).map((j) => ({ ...j, allLoc: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location), j.isRemote ? "remote" : ""].join(" / ") }))
    .filter((j) => wanted(j.title, j.allLoc)).map((j) => ({
      source: "ashby", source_id: `${slug}:${j.id}`, url: j.jobUrl, title: j.title, company: name, location: j.allLoc,
      work_mode: j.workplaceType === "Remote" || j.isRemote ? "remote" : j.workplaceType === "Hybrid" ? "hybrid" : j.workplaceType === "OnSite" ? "onsite" : "unknown",
      salary_text: j.compensation?.compensationTierSummary?.includes("£") ? j.compensation.compensationTierSummary : null,
      posted_at: j.publishedAt?.slice(0, 10), description: j.descriptionPlain ?? "",
    }));
}

export async function scanAts(say: (m: string) => void): Promise<Job[]> {
  const out: Job[] = [];
  const fns = { greenhouse, lever, ashby } as const;
  const list = companies() as { ats: keyof typeof fns; slug: string; name: string }[];
  for (let i = 0; i < list.length; i += 8) {
    const batch = await Promise.all(list.slice(i, i + 8).map((c) => fns[c.ats](c.slug, c.name).catch(() => [])));
    for (const b of batch) out.push(...b);
  }
  for (const j of out) j.country = jobCountry(j.location ?? "");
  say(`careers boards: ${list.length} companies, ${out.length} matching roles in your countries`);
  return out;
}
