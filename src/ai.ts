// One entry point for every AI call (Prepare, Polish, CV import). The provider is chosen in .env:
//   AI_PROVIDER=anthropic   ANTHROPIC_API_KEY=...            (default model claude-opus-5)
//   AI_PROVIDER=openai      AI_API_KEY=...  AI_BASE_URL=...  (OpenAI, OpenRouter, Gemini, Groq, Mistral, Ollama...)
//   AI_PROVIDER=claude-cli  CLAUDE_CODE_OAUTH_TOKEN=...      (a Claude subscription via Claude Code)
// Every call returns a parsed JSON object; the caller validates the shape.
import Anthropic from "@anthropic-ai/sdk";

const PROVIDER = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
const MODEL = process.env.AI_MODEL;
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 300_000);

export type AiStatus = { provider: string; model: string; configured: boolean; problem?: string };

export function aiStatus(): AiStatus {
  if (PROVIDER === "anthropic") {
    const ok = !!process.env.ANTHROPIC_API_KEY;
    return { provider: "anthropic", model: MODEL ?? "claude-opus-5", configured: ok, problem: ok ? undefined : "ANTHROPIC_API_KEY is not set in .env" };
  }
  if (PROVIDER === "openai") {
    const base = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
    const local = /localhost|127\.0\.0\.1|host\.docker\.internal|ollama/.test(base);
    const ok = (!!process.env.AI_API_KEY || local) && !!MODEL;
    return { provider: `openai-compatible (${base})`, model: MODEL ?? "(set AI_MODEL)", configured: ok, problem: ok ? undefined : "Set AI_MODEL, and AI_API_KEY unless it's a local model" };
  }
  if (PROVIDER === "claude-cli") {
    const ok = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
    return { provider: "claude-cli", model: MODEL ?? "opus", configured: ok, problem: ok ? undefined : "Run `claude setup-token` and put the token in CLAUDE_CODE_OAUTH_TOKEN" };
  }
  return { provider: PROVIDER, model: "", configured: false, problem: `Unknown AI_PROVIDER "${PROVIDER}" (use anthropic, openai or claude-cli)` };
}

/** Pull the JSON object out of a model reply (tolerates code fences and stray prose). */
function parseJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the model did not return JSON");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

let anthropic: Anthropic | null = null;

async function viaAnthropic(system: string, prompt: string): Promise<string> {
  anthropic ??= new Anthropic({ timeout: TIMEOUT_MS });
  const res = await anthropic.beta.messages.create({
    model: MODEL ?? "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    // if a safety classifier declines, the API re-runs the request on a fallback model instead of failing
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error("the model declined this request");
  if (res.stop_reason === "max_tokens") throw new Error("the reply was cut off (max_tokens)");
  return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

async function viaOpenAI(system: string, prompt: string): Promise<string> {
  const base = (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const body = (jsonMode: boolean) => JSON.stringify({
    model: MODEL,
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });
  const call = (jsonMode: boolean) => fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.AI_API_KEY ? { authorization: `Bearer ${process.env.AI_API_KEY}` } : {}) },
    body: body(jsonMode),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let r = await call(true);
  // some OpenAI-compatible servers don't support JSON mode: retry without it (the prompt still asks for JSON)
  if (r.status === 400) r = await call(false);
  if (!r.ok) throw new Error(`${base} returned ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return d.choices?.[0]?.message?.content ?? "";
}

async function viaClaudeCli(system: string, prompt: string): Promise<string> {
  const tools = "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,NotebookEdit";
  const proc = Bun.spawn([process.env.CLAUDE_BIN ?? "claude", "-p", "--model", MODEL ?? "opus", "--output-format", "json",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disallowedTools", tools, "--append-system-prompt", system, prompt],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const timer = setTimeout(() => proc.kill("SIGTERM"), TIMEOUT_MS);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if ((await proc.exited) !== 0) throw new Error(`claude exited: ${(err || out).slice(0, 300)}`);
  return (JSON.parse(out) as { result?: string }).result ?? "";
}

const JSON_RULE = "\n\nReply with ONLY a single JSON object, no code fences and no text before or after it.";

/** Ask the configured model for a JSON object; retries once if the reply isn't valid JSON. */
export async function generateJson<T>(system: string, prompt: string): Promise<T> {
  const status = aiStatus();
  if (!status.configured) throw new Error(`AI is not configured: ${status.problem}`);
  const run = PROVIDER === "anthropic" ? viaAnthropic : PROVIDER === "openai" ? viaOpenAI : viaClaudeCli;
  const first = await run(system + JSON_RULE, prompt);
  try {
    return noEmDash(parseJson<T>(first));
  } catch {
    const second = await run(system + JSON_RULE, `${prompt}\n\nYour previous reply was not valid JSON. Return only the JSON object this time.`);
    return noEmDash(parseJson<T>(second));
  }
}

/** Deep-replace em-dashes in every string of a JSON value (house style for all generated text). */
export function noEmDash<T>(v: T): T {
  if (typeof v === "string") return v.replace(/\s*—\s*/g, ", ") as T;
  if (Array.isArray(v)) return v.map(noEmDash) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noEmDash(x)])) as T;
  return v;
}
