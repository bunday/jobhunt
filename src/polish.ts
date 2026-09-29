// "Polish" button: turn the user's rough draft of an application-form answer into a paste-ready answer,
// grounded only in their CV and confirmed facts.
import { generateJson } from "./ai";
import { candidateContext, candidateName } from "./context";
import { db } from "./db";
import { sameQuestion } from "./similar";

const system = () => `You polish answers to job application form questions for one candidate, ${candidateName()}.
You receive the job ad, the candidate's CV, facts and rules, other answers already written for this job, and one question with their rough draft.
Write the final answer they will paste into the form, in their voice. Ground every claim in the CV or the facts; if the draft claims something not in either, keep it only if it's their own opinion or motivation, never a new achievement.
Then list up to 3 short, specific NEW suggestions (never re-ask anything already answered in the facts) that would make the answer stronger, phrased as questions to them (e.g. "Do you have a number for X?"). Never put a suggestion into the answer unconfirmed.
Return {"answer": string, "suggestions": string[]}.`;

type Row = { id: number; job_id: number; question: string; draft: string | null };

export async function polishAnswer(answerId: number): Promise<void> {
  const a = db.query("SELECT id, job_id, question, draft FROM answers WHERE id = ?").get(answerId) as Row | null;
  if (!a) return;
  db.query("UPDATE answers SET polish_state = 'running', updated_at = datetime('now') WHERE id = ?").run(answerId);
  try {
    const job = db.query("SELECT title, company, description FROM jobs WHERE id = ?").get(a.job_id) as { title: string; company: string; description: string | null };
    const others = (db.query("SELECT question, answer FROM answers WHERE job_id = ? AND id != ? AND answer IS NOT NULL AND answer != ''").all(a.job_id, answerId) as { question: string; answer: string }[])
      .map((o) => `Q: ${o.question}\nA: ${o.answer}`).join("\n\n") || "(none yet)";
    const prompt = [
      `# Job: ${job.title} at ${job.company}\n${(job.description ?? "").slice(0, 12000)}`,
      candidateContext(),
      `# Other answers already written for this job (stay consistent, don't repeat them)\n${others}`,
      `# The question\n${a.question}`,
      `# Their rough draft\n${a.draft?.trim() || "(no draft: write the best answer from the CV and facts, and say in suggestions what personal detail would improve it)"}`,
    ].join("\n\n");
    const json = await generateJson<{ answer: string; suggestions?: string[] }>(system(), prompt);
    const answered = (db.query("SELECT question FROM facts").all() as { question: string }[]).map((f) => f.question);
    if (typeof json.answer !== "string") json.answer = Array.isArray(json.answer) ? (json.answer as unknown[]).join("\n\n") : String(json.answer ?? "");
    const suggestions = (Array.isArray(json.suggestions) ? json.suggestions.filter((q): q is string => typeof q === "string") : []).filter((q) => !answered.some((x) => sameQuestion(x, q)));
    db.query("UPDATE answers SET answer = ?, suggestions = ?, polish_state = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(json.answer.trim(), JSON.stringify(suggestions), answerId);
  } catch (e) {
    db.query("UPDATE answers SET polish_state = ?, updated_at = datetime('now') WHERE id = ?").run(`error: ${(e as Error).message.slice(0, 300)}`, answerId);
  }
}
