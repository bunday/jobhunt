// "Prepare application" button: the AI reads the ad and produces a CV tailoring spec, a cover letter and a
// review (fit, gaps, questions for the candidate). The spec can only select/reorder/reword master CV content;
// we validate every id and render the PDF ourselves, trimming until it fits on 2 pages.
import { generateJson } from "./ai";
import { candidateContext, candidateName } from "./context";
import { type Spec, renderJobCv } from "./cv";
import { db, logEvent } from "./db";
import { getMasterCV, getSettings } from "./settings";
import { sameQuestion } from "./similar";

const system = () => {
  const name = candidateName();
  const cv = getMasterCV();
  const current = cv.experience[0]?.id ?? "role";
  return `You prepare job applications for one candidate, ${name}.
You receive the job ad and the candidate's master CV (JSON, every bullet has an id), confirmed facts, preferences and writing rules.

Return:
{
  "spec": {                       // tailors the CV. It can ONLY select, reorder and reword master content.
    "headline": string,           // truthful title in the job's language
    "profile": string,            // 80-115 words, in the style of the master profile, leading with what THIS job values most. Only facts from the CV and confirmed facts: no new traits, preferences or working-style claims
    "skills": string[],           // skill row labels from the master, ordered by relevance (keep all rows unless one is irrelevant)
    "skillText": {label: string}, // optional: reorder items within a row. Only items already in the CV or facts
    "bullets": {experienceId: string[]}, // per experience id, bullet ids most relevant first; keep 8-11 for the current role ("${current}"), fewer for older roles
    "rewrite": {bulletId: string},// optional, at most 3: same facts in the job's vocabulary; may add details from the confirmed facts; never new achievements
    "projects": string[]          // project ids to keep, most relevant first
  },
  "cover_letter": string,         // 230-380 words, plain text, "Hi <Company> team," ... "Best regards,\\n${name}". Specific evidence from the CV mapped to the ad's top 3 needs. If a core requirement of the ad isn't evidenced, you may address it in one sentence by pointing to the closest thing the candidate HAS done; never state that they lack something unless the confirmed facts say so (a gap you merely infer belongs in the review, not the letter). A genuine "why this company" line drawn from the ad, never invented personal history.
  "review": {
    "fit": "strong" | "reasonable" | "stretch",
    "fit_reason": string,         // one sentence
    "gaps": string[],             // requirements the CV does not evidence, most important first
    "suggestions": string[],      // up to 5 NEW questions to the candidate that would strengthen this application ("Do you have a number for...?", "Have you done X?"); never re-ask anything already answered in the facts
    "watch_outs": string[]        // logistics and red flags against their preferences: office days, salary vs their minimum (and visa floor if any), sponsorship wording if they need it, level mismatch, anything odd
  }
}
Write the whole "review" in the second person ("You match...", "Have you...?"). Follow every writing rule.`;
};

type Out = { spec: Spec; cover_letter: string; review: { fit: string; fit_reason: string; gaps: string[]; suggestions: string[]; watch_outs: string[] } };

/** Drop anything the model referenced that isn't in the master CV, so a tailored CV can never contain invented items. */
function validate(spec: Spec): Spec {
  const m = getMasterCV();
  const labels = new Set(m.skills.map(([k]) => k));
  const bulletIds = new Map(m.experience.map((e) => [e.id, new Set(e.bullets.map((b) => b.id))]));
  const allIds = new Set([...[...bulletIds.values()].flatMap((s) => [...s]), ...m.projects.map((p) => p.id), ...m.community.map((p) => p.id)]);
  const clean: Spec = { ...spec };
  if (clean.skills) clean.skills = clean.skills.filter((l) => labels.has(l));
  if (clean.skillText) clean.skillText = Object.fromEntries(Object.entries(clean.skillText).filter(([k]) => labels.has(k)));
  if (clean.bullets) clean.bullets = Object.fromEntries(Object.entries(clean.bullets).map(([exp, ids]) => [exp, (ids ?? []).filter((id) => bulletIds.get(exp)?.has(id))]).filter(([, ids]) => (ids as string[]).length));
  if (clean.rewrite) clean.rewrite = Object.fromEntries(Object.entries(clean.rewrite).filter(([id]) => allIds.has(id)).slice(0, 3));
  if (clean.projects) clean.projects = clean.projects.filter((id) => m.projects.some((p) => p.id === id));
  return clean;
}

/** One trimming step towards 2 pages: shorten the longest bullet list (keeping the most relevant), then projects, then community. */
function trim(spec: Spec): Spec | null {
  const m = getMasterCV();
  const lists = m.experience.map((e, i) => ({ id: e.id, ids: spec.bullets?.[e.id] ?? e.bullets.map((b) => b.id), min: i === 0 ? 6 : 2 }));
  const longest = lists.filter((l) => l.ids.length > l.min).sort((a, b) => b.ids.length - a.ids.length)[0];
  if (longest) return { ...spec, bullets: { ...spec.bullets, [longest.id]: longest.ids.slice(0, -1) } };
  const projects = spec.projects ?? m.projects.map((p) => p.id);
  if (projects.length > 1) return { ...spec, projects: projects.slice(0, -1) };
  const community = spec.community ?? m.community.map((p) => p.id);
  if (community.length) return { ...spec, community: community.slice(0, -1) };
  return null;
}

export async function prepareJob(jobId: number): Promise<void> {
  const job = db.query("SELECT id, title, company, location, salary_text, description, sponsor_status, sponsor_name FROM jobs WHERE id = ?").get(jobId) as Record<string, string> | null;
  if (!job) return;
  db.query("UPDATE jobs SET prep_state = 'running', updated_at = datetime('now') WHERE id = ?").run(jobId);
  logEvent(jobId, "note", "Prepare application started");
  try {
    const sponsor = getSettings().needsSponsorship ? ` | Sponsor register: ${job.sponsor_status} ${job.sponsor_name ?? ""}` : "";
    const prompt = [
      `# Job: ${job.title} at ${job.company}\nLocation: ${job.location ?? "?"} | Salary: ${job.salary_text ?? "not published"}${sponsor}\n\n${(job.description ?? "").slice(0, 14000)}`,
      candidateContext(),
    ].join("\n\n");
    const out = await generateJson<Out>(system(), prompt);
    let spec = validate(out.spec ?? {});
    let r = await renderJobCv(jobId, spec);
    for (let i = 0; r.pages > 2 && i < 12; i++) {
      const next = trim(spec);
      if (!next) break;
      spec = next;
      r = await renderJobCv(jobId, spec);
    }
    // belt and braces: drop suggestions that re-ask something already answered (even reworded)
    const answered = (db.query("SELECT question FROM facts").all() as { question: string }[]).map((f) => f.question);
    out.review.suggestions = (out.review.suggestions ?? []).filter((q) => !answered.some((a) => sameQuestion(a, q)));
    db.query("UPDATE jobs SET cover_letter = ?, prep_review = ?, prep_state = NULL, updated_at = datetime('now') WHERE id = ?")
      .run((out.cover_letter ?? "").trim(), JSON.stringify(out.review), jobId);
    logEvent(jobId, "note", `Prepared: CV ${r.file} (${r.pages} pages), cover letter, review (fit: ${out.review.fit})`);
  } catch (e) {
    db.query("UPDATE jobs SET prep_state = ?, updated_at = datetime('now') WHERE id = ?").run(`error: ${(e as Error).message.slice(0, 300)}`, jobId);
    logEvent(jobId, "note", `Prepare failed: ${(e as Error).message.slice(0, 200)}`);
  }
}
