// Setup step: turn an uploaded CV (PDF or pasted text) into the structured master CV, and suggest
// search settings from it. The user reviews and edits everything before it's saved.
import { $ } from "bun";
import { generateJson } from "./ai";
import { DATA_DIR } from "./db";
import type { MasterCV, Settings } from "./settings";

export type CvImport = {
  cv: MasterCV;
  suggested: Pick<Settings, "name" | "email" | "phone" | "links" | "homeCity" | "targetRoles" | "seniority" | "strongSkills" | "weakSkills"> & {
    country: string; currentEmployer: string;
  };
};

const SYSTEM = `You convert a CV into structured JSON, faithfully. Copy the candidate's own wording for every bullet and summary; do not improve, summarise, merge or invent anything. Keep every role, bullet, project and qualification.

Return:
{
  "cv": {
    "name": string,
    "headline": string,                  // their current or most recent title, or the headline on the CV
    "contact": string[],                 // as on the CV: location, email, phone, links
    "profile": string,                   // the summary/profile paragraph, verbatim ("" if none)
    "skills": [[label, items], ...],     // skill groups as on the CV, e.g. ["Languages", "TypeScript, Go"]. If the CV lists skills without groups, make sensible groups.
    "experience": [{ "id": string, "title": string, "company": string, "dates": string, "sub": string, "bullets": [{ "id": string, "text": string }] }],
                                          // most recent first. id: short lowercase slug of the company ("acme"); bullet ids: short unique slugs describing the bullet ("payments-api"). sub: location / one-line context under the role ("" if none)
    "projects": [{ "id": string, "text": string }],   // personal/side projects ("" sections become [])
    "community": [{ "id": string, "text": string }],  // volunteering, open source, talks, awards
    "education": [[qualification, year], ...]
  },
  "suggested": {
    "name": string, "email": string, "phone": string,
    "links": string[],                   // linkedin / github / portfolio, without https://
    "homeCity": string,                  // city only
    "country": "gb" | "us" | "ca" | "au" | "ie" | "other",
    "currentEmployer": string,           // company of the current role, "" if none is current
    "targetRoles": string[],             // 2-4 job titles this person should search for, at their level (e.g. "Senior Backend Engineer")
    "seniority": "junior" | "mid" | "senior" | "staff" | "lead",
    "strongSkills": string[],            // 10-25 lower-case keywords they have used recently and in depth (languages, frameworks, cloud, databases, domains)
    "weakSkills": string[]               // lower-case keywords they list as "previously" or only in old roles
  }
}`;

/** Extract text from an uploaded PDF (poppler's pdftotext keeps the reading order). */
export async function pdfToText(file: File): Promise<string> {
  const tmp = `${DATA_DIR}/upload-${Date.now()}.pdf`;
  await Bun.write(tmp, file);
  try {
    return await $`pdftotext -layout ${tmp} -`.text();
  } finally {
    await $`rm -f ${tmp}`.quiet();
  }
}

export async function importCv(text: string): Promise<CvImport> {
  if (text.trim().length < 300) throw new Error("That doesn't look like a full CV (too little text). If it's a scanned PDF, paste the text instead.");
  const out = await generateJson<CvImport>(SYSTEM, `# CV text\n\n${text.slice(0, 60_000)}`);
  // make ids safe and unique so tailoring can reference them reliably
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "item";
  const seen = new Set<string>();
  const uniq = (id: string) => { let k = slug(id); let n = 2; while (seen.has(k)) k = `${slug(id)}-${n++}`; seen.add(k); return k; };
  const cv = out.cv;
  cv.experience = (cv.experience ?? []).map((e) => ({ ...e, id: uniq(e.id || e.company), sub: e.sub ?? "", bullets: (e.bullets ?? []).map((b) => ({ ...b, id: uniq(b.id || b.text.slice(0, 20)) })) }));
  cv.projects = (cv.projects ?? []).map((b) => ({ ...b, id: uniq(b.id || b.text.slice(0, 20)) }));
  cv.community = (cv.community ?? []).map((b) => ({ ...b, id: uniq(b.id || b.text.slice(0, 20)) }));
  cv.skills = cv.skills ?? [];
  cv.education = cv.education ?? [];
  return { cv, suggested: out.suggested };
}
