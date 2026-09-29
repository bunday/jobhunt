// Render the master CV, or a tailored variant, to PDF. Tailoring = a spec (documents/specs/<jobId>.json) that
// selects/reorders/rewords master content. The master stays the single source of truth; nothing is invented.
import { $ } from "bun";
import { existsSync } from "node:fs";
import { db, logEvent, OUT_DIR } from "./db";
import { COUNTRIES, getMasterCV, getSettings, type Bullet, type MasterCV } from "./settings";

export type Spec = {
  headline?: string;
  profile?: string;
  /** skill row labels in the order to show; unlisted rows are dropped */
  skills?: string[];
  /** replace a skill row's text, e.g. to lead with the stack the job asks for */
  skillText?: Record<string, string>;
  /** per experience id: bullet ids in order (unlisted bullets are dropped). Omitted experience = keep all. */
  bullets?: Record<string, string[]>;
  /** reworded bullets by id (same facts, the job's vocabulary) */
  rewrite?: Record<string, string>;
  dropExperience?: string[];
  projects?: string[];
  community?: string[];
};

const FONTS = `${import.meta.dir}/../assets/fonts`;
// never crash a PDF on a stray list or number from an AI model or a hand-edited CV
const esc = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const font = (w: number, st: string) => `@font-face{font-family:Carlito;font-weight:${w};font-style:${st};src:url(file://${FONTS}/Carlito-${w}-${st}.ttf)}`;

/** The name + contact line printed on every document, from the user's settings (falls back to the CV). */
export function letterhead(m: MasterCV = getMasterCV()) {
  const s = getSettings();
  const place = [s.homeCity, COUNTRIES[s.country]?.name].filter(Boolean).join(", ");
  const contact = [place, s.email, s.phone, ...s.links].filter((x) => x?.trim());
  return { name: s.name || m.name, contact: contact.length ? contact : m.contact };
}

/** "Jane Doe - CV - Monzo.pdf": recruiters see the file name. */
export function fileName(kind: string, company: string) {
  return `${letterhead().name || "CV"} - ${kind} - ${company.replace(/[^\w &.-]+/g, "").trim()}.pdf`;
}

export function renderHtml(spec: Spec = {}): string {
  const m = getMasterCV();
  const head = letterhead(m);
  const text = (b: Bullet) => esc(spec.rewrite?.[b.id] ?? b.text);
  const pick = <T extends { id: string }>(all: T[], ids?: string[]) => (ids ? ids.map((id) => all.find((x) => x.id === id)).filter((x): x is T => !!x) : all);
  const skills = spec.skills ? spec.skills.map((l) => m.skills.find(([k]) => k === l)).filter((x): x is [string, string] => !!x) : m.skills;
  const exp = m.experience.filter((e) => !spec.dropExperience?.includes(e.id));
  const projects = pick(m.projects, spec.projects);
  const community = pick(m.community, spec.community);

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(head.name)} CV</title><style>
${font(400, "normal")}${font(700, "normal")}${font(400, "italic")}${font(700, "italic")}
@page { size: A4; margin: 11mm 13mm; }
* { box-sizing: border-box; }
body { font-family: Carlito, Calibri, sans-serif; font-size: 10.3pt; line-height: 1.27; color: #1f2328; margin: 0; }
h1 { font-size: 22pt; color: #1f3a68; margin: 0; line-height: 1.1; }
.headline { font-size: 12pt; color: #5a6270; margin: 1pt 0 2pt; }
.contact { color: #2c5da8; font-size: 10pt; }
.contact span + span::before { content: "  |  "; color: #8a93a3; white-space: pre; }
h2 { font-size: 11pt; letter-spacing: .06em; color: #1f3a68; border-bottom: 1.2pt solid #1f3a68; margin: 9pt 0 4pt; padding-bottom: 1.5pt; }
p { margin: 0; }
.skills div { margin: 0 0 2.5pt; }
.job { margin-bottom: 6pt; break-inside: auto; }
.job-top { display: flex; justify-content: space-between; gap: 8pt; }
.job-top .when { color: #5a6270; white-space: nowrap; }
.sub { color: #2c5da8; font-style: italic; font-size: 9.5pt; }
ul { margin: 2pt 0 0; padding-left: 13pt; }
li { margin: 0 0 1.5pt; }
.edu div { display: flex; justify-content: space-between; }
</style></head><body>
<h1>${esc(head.name)}</h1>
<div class="headline">${esc(spec.headline ?? m.headline)}</div>
<div class="contact">${head.contact.map((c) => `<span>${esc(c)}</span>`).join("")}</div>
${(spec.profile ?? m.profile) ? `<h2>PROFILE</h2><p>${esc(spec.profile ?? m.profile)}</p>` : ""}
${skills.length ? `<h2>SKILLS</h2><div class="skills">${skills.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(spec.skillText?.[k] ?? v)}</div>`).join("")}</div>` : ""}
<h2>EXPERIENCE</h2>
${exp.map((e) => `<div class="job"><div class="job-top"><div><b>${esc(e.title)}</b>${e.company ? `, ${esc(e.company)}` : ""}</div><div class="when">${esc(e.dates)}</div></div>
${e.sub ? `<div class="sub">${esc(e.sub)}</div>` : ""}<ul>${pick(e.bullets, spec.bullets?.[e.id]).map((b) => `<li>${text(b)}</li>`).join("")}</ul></div>`).join("\n")}
${projects.length ? `<h2>PROJECTS</h2><ul>${projects.map((b) => `<li>${text(b)}</li>`).join("")}</ul>` : ""}
${community.length ? `<h2>COMMUNITY</h2><ul>${community.map((b) => `<li>${text(b)}</li>`).join("")}</ul>` : ""}
${m.education.length ? `<h2>EDUCATION</h2><div class="edu">${m.education.map(([d, y]) => `<div><span>${esc(d)}</span><span>${esc(y)}</span></div>`).join("")}</div>` : ""}
</body></html>`;
}

/** HTML → PDF with headless Chromium; returns the page count. */
export async function htmlToPdf(html: string, out: string): Promise<number> {
  const tmp = `${out}.html`;
  await Bun.write(tmp, html);
  await $`${process.env.CHROME_BIN ?? "chromium"} --headless=new --disable-gpu --no-sandbox --no-pdf-header-footer --print-to-pdf=${out} file://${tmp}`.quiet();
  await $`rm -f ${tmp}`;
  const pages = (await $`pdfinfo ${out}`.text()).match(/Pages:\s+(\d+)/)?.[1];
  return Number(pages);
}

export const renderPdf = (spec: Spec, out: string) => htmlToPdf(renderHtml(spec), out);

/** Cover letter on the same letterhead as the CV, with the date and a "Re:" line. */
export function renderLetterHtml(o: { text: string; title: string; company: string; headline?: string }): string {
  const m = getMasterCV();
  const head = letterhead(m);
  const locale = getSettings().country === "us" ? "en-US" : "en-GB";
  const date = new Date().toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  const paras = o.text.trim().split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(head.name)} Cover Letter</title><style>
${font(400, "normal")}${font(700, "normal")}${font(400, "italic")}
@page { size: A4; margin: 16mm 18mm; }
body { font-family: Carlito, Calibri, sans-serif; font-size: 11pt; line-height: 1.45; color: #1f2328; margin: 0; }
h1 { font-size: 22pt; color: #1f3a68; margin: 0; line-height: 1.1; }
.headline { font-size: 12pt; color: #5a6270; margin: 1pt 0 2pt; }
.contact { color: #2c5da8; font-size: 10pt; padding-bottom: 6pt; border-bottom: 1.2pt solid #1f3a68; }
.contact span + span::before { content: "  |  "; color: #8a93a3; white-space: pre; }
.meta { margin: 16pt 0 12pt; }
.re { font-weight: 700; color: #1f3a68; margin-top: 4pt; }
p { margin: 0 0 9pt; }
</style></head><body>
<h1>${esc(head.name)}</h1>
<div class="headline">${esc(o.headline ?? m.headline)}</div>
<div class="contact">${head.contact.map((c) => `<span>${esc(c)}</span>`).join("")}</div>
<div class="meta"><div>${esc(date)}</div><div class="re">Re: ${esc(o.title)}, ${esc(o.company)}</div></div>
${paras}
</body></html>`;
}

/** Render documents/specs/<id>.json (or the given spec) to documents/<id>-<slug>.pdf and attach it to the job. */
export async function renderJobCv(id: number, spec?: Spec): Promise<{ file: string; pages: number }> {
  const job = db.query("SELECT id, company, title FROM jobs WHERE id = ?").get(id) as { id: number; company: string; title: string } | null;
  const specPath = `${OUT_DIR}/specs/${id}.json`;
  if (!job) throw new Error(`no job ${id}`);
  if (spec) await Bun.write(specPath, JSON.stringify(spec, null, 2));
  if (!existsSync(specPath)) throw new Error(`no spec at ${specPath}`);
  const slug = `${job.company}-${job.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  const file = `${id}-${slug}.pdf`;
  const pages = await renderPdf(await Bun.file(specPath).json(), `${OUT_DIR}/${file}`);
  db.query("UPDATE jobs SET cv_path = ?, status = CASE WHEN status IN ('new','shortlisted') THEN 'tailoring' ELSE status END, updated_at = datetime('now') WHERE id = ?").run(file, id);
  logEvent(id, "note", `tailored CV rendered: ${file}`);
  return { file, pages };
}
