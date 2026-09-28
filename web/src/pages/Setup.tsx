import { Check, FileText, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type Country, type MasterCV, type ScanStatus, type SetupData, type Settings } from "@/api";
import { AboutForm, CvEditor, FactsForm, SearchForm, WhereForm } from "@/components/profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";

const STEPS = ["Welcome", "Your CV", "About you", "What you want", "Where and pay", "Extra facts", "Find jobs"];

export function Setup({ initial, onDone }: { initial: SetupData; onDone: () => void }) {
  const [step, setStep] = useState(initial.cv.experience.length ? 2 : 0);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [cv, setCv] = useState<MasterCV>(initial.cv);
  const [facts, setFacts] = useState(initial.factsText);
  const [error, setError] = useState("");
  const patch = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));

  const save = async () => {
    await Promise.all([api.saveSettings(settings), api.saveCv(cv), api.saveFactsText(facts)]);
  };
  const next = async () => {
    setError("");
    try { await save(); setStep((s) => s + 1); } catch (e) { setError((e as Error).message); }
  };

  const canNext = [
    initial.ai.configured,
    cv.experience.length > 0,
    !!settings.name.trim(),
    settings.targetRoles.length > 0,
    !!settings.remotePreference && (settings.remotePreference === "remote" || !!settings.homeCity.trim()),
    true,
  ][step] ?? true;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Set up Job Hunt</h1>
        <p className="mt-1 text-sm text-muted-foreground">A few minutes now, then it finds and ranks jobs for you every day.</p>
      </div>
      <ol className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-1.5", i === step ? "font-medium text-foreground" : "text-muted-foreground")}>
            <span className={cn("grid size-5 place-items-center rounded-full border text-xs", i < step && "border-primary bg-primary text-primary-foreground", i === step && "border-primary text-primary")}>
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <Card>
        {step === 0 && <Welcome data={initial} />}
        {step === 1 && <CvStep cv={cv} onCv={setCv} onSuggested={(s) => {
          setSettings((cur) => ({
            ...cur,
            name: cur.name || s.name, email: cur.email || s.email, phone: cur.phone || s.phone,
            links: cur.links.length ? cur.links : s.links, homeCity: cur.homeCity || s.homeCity,
            country: (["gb", "nl", "us", "ie", "ca", "tr"].includes(s.country) ? s.country : cur.country) as Country,
            targetRoles: cur.targetRoles.length ? cur.targetRoles : s.targetRoles,
            searchQueries: cur.searchQueries.length ? cur.searchQueries : s.targetRoles.map((r) => r.toLowerCase()),
            seniority: s.seniority ?? cur.seniority,
            strongSkills: cur.strongSkills.length ? cur.strongSkills : s.strongSkills,
            weakSkills: cur.weakSkills.length ? cur.weakSkills : s.weakSkills,
            excludeCompanies: s.currentEmployer && !cur.excludeCompanies.includes(s.currentEmployer) ? [...cur.excludeCompanies, s.currentEmployer] : cur.excludeCompanies,
          }));
        }} />}
        {step === 2 && <Section title="About you" desc="This goes on every CV and cover letter we generate."><AboutForm value={settings} onChange={patch} /></Section>}
        {step === 3 && <Section title="What you're looking for" desc="Suggested from your CV. Adjust anything that's off."><SearchForm value={settings} onChange={patch} /></Section>}
        {step === 4 && <Section title="Where and pay" desc="Used to rank jobs. Nothing is hidden: jobs outside your preferences are flagged so you decide."><WhereForm value={settings} onChange={patch} countries={initial.countries} /></Section>}
        {step === 5 && <Section title="Extra facts and rules" desc="Optional, but it's what makes tailored CVs and answers specific to you."><FactsForm value={settings} onChange={patch} facts={facts} onFacts={setFacts} /></Section>}
        {step === 6 && <Finish settings={settings} countries={initial.countries} onDone={onDone} />}

        {step < 6 && (
          <div className="flex items-center justify-between gap-3 border-t p-5">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
            <div className="flex items-center gap-3">
              {error && <span className="text-sm text-destructive">{error}</span>}
              <Button disabled={!canNext} onClick={next}>Continue</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{desc}</CardDescription></CardHeader>
      <CardContent>{children}</CardContent>
    </>
  );
}

function Welcome({ data }: { data: SetupData }) {
  return (
    <Section title="Welcome" desc="Here's what happens next.">
      <ol className="grid gap-3 text-sm">
        <li><strong>1. Your CV.</strong> Upload it and it's turned into a structured master CV you can edit. Every tailored CV is cut from it, so nothing gets invented.</li>
        <li><strong>2. What you want.</strong> Roles, location, salary and whether you need sponsorship.</li>
        <li><strong>3. Find jobs.</strong> It searches LinkedIn, company careers pages and more, then ranks every job against your profile. After that it runs every day.</li>
      </ol>
      <div className={cn("mt-5 rounded-md border p-4 text-sm", data.ai.configured ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5")}>
        {data.ai.configured
          ? <>AI is connected: <strong>{data.ai.provider}</strong>, model <strong>{data.ai.model}</strong>.</>
          : <>AI isn't set up yet: {data.ai.problem}. Add it to your <code>.env</code> file and restart (see the README), then reload this page.</>}
      </div>
      {!data.adzuna && <p className="mt-3 text-xs text-muted-foreground">Optional: add a free Adzuna API key to <code>.env</code> to search more job boards.</p>}
    </Section>
  );
}

function CvStep({ cv, onCv, onSuggested }: { cv: MasterCV; onCv: (cv: MasterCV) => void; onSuggested: (s: import("@/api").CvImport["suggested"]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const run = async (input: { file?: File; text?: string }) => {
    setBusy(true); setError("");
    try {
      const r = await api.importCv(input);
      onCv({ ...r.cv, name: r.cv.name });
      onSuggested(r.suggested);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Your CV" desc="Upload your CV as a PDF (or paste the text). Then check it: this becomes the master CV every application is built from.">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && run({ file: e.target.files[0] })} />
          <Button disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 className="animate-spin" /> : <Upload />}{cv.experience.length ? "Upload a different CV" : "Upload CV (PDF)"}</Button>
          <Button variant="outline" disabled={busy} onClick={() => setPaste(!paste)}><FileText /> Paste text instead</Button>
          {busy && <span className="text-sm text-muted-foreground">Reading your CV, this takes about 20 to 60 seconds…</span>}
        </div>
        {paste && (
          <div className="grid gap-2">
            <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste your whole CV here" />
            <Button className="w-fit" disabled={busy || text.trim().length < 300} onClick={() => run({ text })}>Import pasted CV</Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {cv.experience.length > 0 && (
          <div className="grid gap-3">
            <div className="rounded-md bg-muted p-3 text-sm">Imported <strong>{cv.experience.length} roles</strong>, <strong>{cv.experience.reduce((n, e) => n + e.bullets.length, 0)} bullet points</strong>, {cv.skills.length} skill groups. Check the wording below: it's copied from your CV, and you can edit anything.</div>
            <CvEditor cv={cv} onChange={onCv} />
          </div>
        )}
      </div>
    </Section>
  );
}

function Finish({ settings, countries, onDone }: { settings: Settings; countries: SetupData["countries"]; onDone: () => void }) {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!started) return;
    const t = setInterval(async () => {
      const s = await api.scanStatus();
      setStatus(s);
      if (!s.scanning && s.lastScan) { clearInterval(t); }
    }, 2000);
    return () => clearInterval(t);
  }, [started]);
  const go = async () => {
    setError("");
    const r = await api.completeSetup().catch((e) => ({ ok: false, error: (e as Error).message }));
    if (!r.ok) { setError(r.error ?? "Something's missing"); return; }
    setStarted(true);
  };
  const done = started && status && !status.scanning && status.lastScan;
  return (
    <Section title="Ready to find jobs" desc="The first search looks back two weeks and takes a while (LinkedIn is searched politely, one request at a time). You can start using the app as soon as it begins.">
      <ul className="mb-5 grid gap-1 text-sm">
        <li><span className="text-muted-foreground">Looking for:</span> {settings.targetRoles.join(", ")}</li>
        <li><span className="text-muted-foreground">In:</span> {countries[settings.country].name}{settings.homeCity ? `, near ${settings.homeCity}` : ""} · {({ onsite: "on-site", hybrid: "hybrid", remote: "remote preferred", any: "any working pattern" } as Record<string, string>)[settings.remotePreference] ?? ""}</li>
        {settings.salaryMin && <li><span className="text-muted-foreground">Minimum salary:</span> {countries[settings.country].symbol}{settings.salaryMin.toLocaleString()}</li>}
        <li><span className="text-muted-foreground">Sponsorship:</span> {settings.needsSponsorship ? "needed" : "not needed"}</li>
      </ul>
      {!started && <Button size="lg" onClick={go}>Save and find jobs</Button>}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {started && (
        <div className="grid gap-3">
          <div className="flex items-center gap-2 text-sm">
            {done ? <Check className="size-4 text-success" /> : <Loader2 className="size-4 animate-spin text-primary" />}
            <span>{done ? `Done: ${status!.lastScan!.added} jobs found.` : status?.progress?.stage ?? "Starting…"}</span>
          </div>
          {!done && status?.progress && <p className="text-xs text-muted-foreground">{status.progress.found} seen so far, {status.progress.added} new</p>}
          <Button className="w-fit" variant={done ? "default" : "outline"} onClick={onDone}>{done ? "See your jobs" : "Open the app while it searches"}</Button>
        </div>
      )}
    </Section>
  );
}
