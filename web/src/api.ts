export type Country = "gb" | "nl" | "us" | "ie" | "ca";

export type Settings = {
  setupComplete: boolean;
  name: string; email: string; phone: string; links: string[];
  targetRoles: string[]; seniority: "junior" | "mid" | "senior" | "staff" | "lead" | "any";
  strongSkills: string[]; weakSkills: string[]; searchQueries: string[];
  country: Country; homeCity: string; commutable: string[];
  remotePreference: "remote" | "hybrid" | "any"; maxOfficeDays: number;
  salaryMin: number | null; needsSponsorship: boolean; sponsorSalaryFloor: number | null;
  excludeCompanies: string[]; writingRules: string; scanHour: number;
};

export type Bullet = { id: string; text: string };
export type Experience = { id: string; title: string; company: string; dates: string; sub: string; bullets: Bullet[] };
export type MasterCV = {
  name: string; headline: string; contact: string[]; profile: string;
  skills: [string, string][]; experience: Experience[]; projects: Bullet[]; community: Bullet[]; education: [string, string][];
};

export type SetupData = {
  settings: Settings; cv: MasterCV; factsText: string;
  ai: { provider: string; model: string; configured: boolean; problem?: string };
  adzuna: boolean;
  countries: Record<Country, { name: string; symbol: string; sponsorRegister: boolean }>;
};

export type CvImport = {
  cv: MasterCV;
  suggested: Pick<Settings, "name" | "email" | "phone" | "links" | "homeCity" | "targetRoles" | "seniority" | "strongSkills" | "weakSkills"> & { country: string; currentEmployer: string };
};

export type JobRow = {
  id: number; source: string; url: string; title: string; company: string; location: string | null; work_mode: string | null;
  salary_text: string | null; salary_min: number | null; salary_max: number | null; posted_at: string | null; is_agency: number;
  sponsor_status: string | null; sponsor_name: string | null; sponsor_text: string | null; score: number; reasons: string | null;
  status: string; cv_path: string | null; notes: string | null; applied_at: string | null; first_seen: string; updated_at: string; prep_state: string | null;
};
export type Answer = { id: number; job_id: number; question: string; draft: string | null; answer: string | null; suggestions: string | null; polish_state: string | null };
export type Review = { fit: string; fit_reason: string; gaps: string[]; suggestions: string[]; watch_outs: string[] };
export type JobFull = JobRow & { description: string | null; cover_letter: string | null; prep_review: string | null; answers: Answer[]; events: { id: number; kind: string; detail: string; at: string }[] };
export type Fact = { id: number; question: string; answer: string; job_id: number | null; company: string | null; created_at: string };
export type Overview = {
  counts: Record<string, number>;
  applications: { id: number; title: string; company: string; status: string; applied_at: string | null; cv_path: string | null; score: number; last_event: string; updated_at: string }[];
  attention: { kind: string; text: string; job_id?: number }[];
  strongNew: number; lastScan: { started: string; found: number; added: number } | null; scanning: boolean;
};
export type ScanStatus = { scanning: boolean; progress: { stage: string; found: number; added: number } | null; lastScan: { started: string; finished: string; found: number; added: number } | null };

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
  if (!r.ok || (body && typeof body === "object" && "error" in body && body.error)) throw new Error(typeof body === "string" ? body : body.error);
  return body as T;
}
const json = (method: string, data: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

export const api = {
  setup: () => req<SetupData>("/api/setup"),
  importCv: (input: { file?: File; text?: string }) => {
    const fd = new FormData();
    if (input.file) fd.append("file", input.file);
    if (input.text) fd.append("text", input.text);
    return req<CvImport>("/api/setup/cv", { method: "POST", body: fd });
  },
  saveSettings: (s: Partial<Settings>) => req<Settings>("/api/settings", json("PUT", s)),
  saveCv: (cv: MasterCV) => req<{ ok: boolean }>("/api/cv", json("PUT", cv)),
  saveFactsText: (text: string) => req<{ ok: boolean }>("/api/facts-text", json("PUT", { text })),
  completeSetup: () => req<{ ok: boolean; error?: string }>("/api/setup/complete", { method: "POST" }),

  overview: () => req<Overview>("/api/overview"),
  scan: (days?: number) => req<{ started: boolean }>(`/api/scan${days ? `?days=${days}` : ""}`, { method: "POST" }),
  scanStatus: () => req<ScanStatus>("/api/scan/status"),

  jobs: (p: Record<string, string>) => req<JobRow[]>(`/api/jobs?${new URLSearchParams(p)}`),
  job: (id: number) => req<JobFull>(`/api/jobs/${id}`),
  patchJob: (id: number, body: { status?: string; notes?: string; cover_letter?: string; description?: string; event?: string }) => req<{ ok: boolean }>(`/api/jobs/${id}`, json("PATCH", body)),
  addJob: (body: Record<string, string>) => req<{ id: number }>("/api/jobs", json("POST", body)),
  prepare: (id: number) => req<{ started: boolean }>(`/api/jobs/${id}/prepare`, { method: "POST" }),

  addAnswer: (jobId: number, body: { question: string; draft?: string }) => req<{ id: number }>(`/api/jobs/${jobId}/answers`, json("POST", body)),
  patchAnswer: (id: number, body: { question?: string; draft?: string; answer?: string }) => req<{ ok: boolean }>(`/api/answers/${id}`, json("PATCH", body)),
  polish: (id: number) => req<{ started: boolean }>(`/api/answers/${id}/polish`, { method: "POST" }),
  deleteAnswer: (id: number) => req<{ ok: boolean }>(`/api/answers/${id}`, { method: "DELETE" }),

  facts: () => req<Fact[]>("/api/facts"),
  saveFact: (body: { question: string; answer: string; job_id?: number }) => req<{ id: number }>("/api/facts", json("POST", body)),
  patchFact: (id: number, answer: string) => req<{ ok: boolean }>(`/api/facts/${id}`, json("PATCH", { answer })),
  deleteFact: (id: number) => req<{ ok: boolean }>(`/api/facts/${id}`, { method: "DELETE" }),
};
