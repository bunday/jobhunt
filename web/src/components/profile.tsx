// Forms for the user's profile, shared by the setup wizard and the Settings page.
import { Plus, Trash2, X } from "lucide-react";
import { type Country, type CountryPrefs, MAX_EXTRA_COUNTRIES, type MasterCV, type SetupData, type Settings } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, TagInput, Textarea } from "@/components/ui/form";

type SettingsProps = { value: Settings; onChange: (patch: Partial<Settings>) => void };

export function AboutForm({ value, onChange }: SettingsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name"><Input value={value.name} onChange={(e) => onChange({ name: e.target.value })} /></Field>
      <Field label="Email"><Input type="email" value={value.email} onChange={(e) => onChange({ email: e.target.value })} /></Field>
      <Field label="Phone" hint="Optional, but most recruiters call first."><Input value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} /></Field>
      <Field label="Links" hint="LinkedIn, GitHub, portfolio. Press Enter after each."><TagInput value={value.links} onChange={(links) => onChange({ links })} placeholder="linkedin.com/in/you" /></Field>
    </div>
  );
}

export function SearchForm({ value, onChange }: SettingsProps) {
  return (
    <div className="grid gap-4">
      <Field label="Roles you're looking for" hint="Job titles, e.g. Senior Backend Engineer. Press Enter after each.">
        <TagInput value={value.targetRoles} onChange={(targetRoles) => onChange({ targetRoles })} placeholder="Senior Product Designer" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your level">
          <Select value={value.seniority} onChange={(e) => onChange({ seniority: e.target.value as Settings["seniority"] })}>
            <option value="junior">Junior / graduate</option>
            <option value="mid">Mid-level</option>
            <option value="senior">Senior</option>
            <option value="staff">Staff / principal</option>
            <option value="lead">Lead / manager</option>
            <option value="any">Any</option>
          </Select>
        </Field>
        <Field label="Search terms" hint="What the scanner searches for. Defaults to your roles.">
          <TagInput value={value.searchQueries} onChange={(searchQueries) => onChange({ searchQueries })} placeholder="senior product designer" />
        </Field>
      </div>
      <Field label="Your strongest skills" hint="Tools, languages and domains you've used recently. Jobs mentioning them rank higher.">
        <TagInput value={value.strongSkills} onChange={(strongSkills) => onChange({ strongSkills })} placeholder="figma" />
      </Field>
      <Field label="Skills you've used, but not recently" hint="Jobs that centre on these get a small flag.">
        <TagInput value={value.weakSkills} onChange={(weakSkills) => onChange({ weakSkills })} placeholder="sketch" />
      </Field>
    </div>
  );
}

export function WhereForm({ value, onChange, countries }: SettingsProps & { countries: SetupData["countries"] }) {
  const home = value.country;
  const extras = value.extraCountries.filter((c) => c !== home);
  const all = [home, ...extras];
  const available = (Object.keys(countries) as Country[]).filter((c) => !all.includes(c));
  const prefs = (c: Country): CountryPrefs => ({ salaryMin: null, needsSponsorship: false, sponsorSalaryFloor: null, ...value.perCountry[c] });
  const setPrefs = (c: Country, p: Partial<CountryPrefs>) => onChange({ perCountry: { ...value.perCountry, [c]: { ...prefs(c), ...p } } });
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country you live in">
          <Select value={home} onChange={(e) => { const c = e.target.value as Country; onChange({ country: c, extraCountries: extras.filter((x) => x !== c) }); }}>
            {Object.entries(countries).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Home city"><Input value={value.homeCity} onChange={(e) => onChange({ homeCity: e.target.value })} placeholder="Manchester" /></Field>
      </div>

      <Field label="Countries to search in" hint={`Your home country, plus up to ${MAX_EXTRA_COUNTRIES} more you'd move to. Each extra country makes the daily search take longer.`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border bg-secondary px-2.5 py-1 text-sm">{countries[home].name} <span className="text-xs text-muted-foreground">(home)</span></span>
          {extras.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm">
              {countries[c].name}
              <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label={`Stop searching ${countries[c].name}`} onClick={() => onChange({ extraCountries: extras.filter((x) => x !== c) })}><X className="size-3.5" /></button>
            </span>
          ))}
          {extras.length < MAX_EXTRA_COUNTRIES && available.length > 0 && (
            <Select className="h-8 w-44" value="" onChange={(e) => e.target.value && onChange({ extraCountries: [...extras, e.target.value as Country], perCountry: { ...value.perCountry, [e.target.value]: { ...prefs(e.target.value as Country), needsSponsorship: true } } })}>
              <option value="">+ Add a country</option>
              {available.map((c) => <option key={c} value={c}>{countries[c].name}</option>)}
            </Select>
          )}
        </div>
      </Field>

      <Field label="Places you'd commute to" hint={`Towns and cities near ${value.homeCity || "home"} where you'd travel for work.`}>
        <TagInput value={value.commutable} onChange={(commutable) => onChange({ commutable })} placeholder="Leeds" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How you work" hint={value.remotePreference ? undefined : "Required: this decides where we search."}>
          <Select value={value.remotePreference} onChange={(e) => onChange({ remotePreference: e.target.value as Settings["remotePreference"] })} className={value.remotePreference ? "" : "border-primary"}>
            <option value="" disabled>Choose…</option>
            <option value="onsite">On-site (e.g. hospital, shop, site work)</option>
            <option value="hybrid">Hybrid: some days in an office</option>
            <option value="remote">Remote preferred</option>
            <option value="any">Any of these</option>
          </Select>
        </Field>
        <Field label="Most office days a week, if far away" hint="Jobs asking for more are flagged, not hidden.">
          <Input type="number" min={0} max={5} value={value.maxOfficeDays} onChange={(e) => onChange({ maxOfficeDays: Number(e.target.value) })} />
        </Field>
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Pay and sponsorship, per country</span>
        <span className="text-xs text-muted-foreground">Jobs below your minimum are flagged, never hidden. Sponsorship is checked against the public sponsor register where the country has one ({Object.entries(countries).filter(([, v]) => v.sponsorRegister).map(([, v]) => v.name).join(", ")}).</span>
        <div className="grid gap-3">
          {all.map((c) => {
            const p = prefs(c);
            return (
              <div key={c} className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[9rem_1fr_auto_1fr]">
                <span className="self-center text-sm font-medium">{countries[c].name}</span>
                <Field label={`Minimum salary (${countries[c].symbol}/year)`}>
                  <Input type="number" min={0} step={1000} value={p.salaryMin ?? ""} onChange={(e) => setPrefs(c, { salaryMin: e.target.value ? Number(e.target.value) : null })} />
                </Field>
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={p.needsSponsorship} onChange={(e) => setPrefs(c, { needsSponsorship: e.target.checked })} />
                  I need sponsorship here
                </label>
                {p.needsSponsorship ? (
                  <Field label={`Visa salary floor (${countries[c].symbol}, optional)`}>
                    <Input type="number" min={0} step={100} value={p.sponsorSalaryFloor ?? ""} onChange={(e) => setPrefs(c, { sponsorSalaryFloor: e.target.value ? Number(e.target.value) : null })} />
                  </Field>
                ) : <span />}
              </div>
            );
          })}
        </div>
        {all.some((c) => prefs(c).needsSponsorship && !countries[c].sponsorRegister) && (
          <span className="text-xs text-muted-foreground">No public sponsor register exists for {all.filter((c) => prefs(c).needsSponsorship && !countries[c].sponsorRegister).map((c) => countries[c].name).join(", ")}, so employers there can't be checked. Ads that rule out sponsorship are still flagged.</span>
        )}
      </div>

      <Field label="Companies to leave out" hint="For example your current employer.">
        <TagInput value={value.excludeCompanies} onChange={(excludeCompanies) => onChange({ excludeCompanies })} placeholder="Company name" />
      </Field>
    </div>
  );
}

export function FactsForm({ facts, onFacts, value, onChange }: SettingsProps & { facts: string; onFacts: (t: string) => void }) {
  return (
    <div className="grid gap-4">
      <Field label="Things about you that aren't on your CV" hint="Achievements, numbers, tools, context. The AI may use these in CVs, letters and answers, and never invents anything else.">
        <Textarea rows={7} value={facts} onChange={(e) => onFacts(e.target.value)} placeholder={"- Cut page load time by 40% on the checkout redesign\n- Presented at Config 2024 on design tokens"} />
      </Field>
      <Field label="Writing rules for the AI" hint="One per line. For example: never mention my notice period; call it a 'hybrid' role, not 'flexible'.">
        <Textarea rows={4} value={value.writingRules} onChange={(e) => onChange({ writingRules: e.target.value })} />
      </Field>
    </div>
  );
}

// ---------- master CV editor ----------
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || `item-${Date.now()}`;

export function CvEditor({ cv, onChange }: { cv: MasterCV; onChange: (cv: MasterCV) => void }) {
  const set = (patch: Partial<MasterCV>) => onChange({ ...cv, ...patch });
  const setExp = (i: number, patch: Partial<MasterCV["experience"][number]>) => set({ experience: cv.experience.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Headline"><Input value={cv.headline} onChange={(e) => set({ headline: e.target.value })} /></Field>
      </div>
      <Field label="Profile / summary"><Textarea rows={4} value={cv.profile} onChange={(e) => set({ profile: e.target.value })} /></Field>

      <section className="grid gap-2">
        <h4 className="text-sm font-semibold">Skills</h4>
        {cv.skills.map(([k, v], i) => (
          <div key={i} className="grid grid-cols-[10rem_1fr_auto] gap-2">
            <Input value={k} onChange={(e) => set({ skills: cv.skills.map((s, j) => (j === i ? [e.target.value, s[1]] : s)) })} />
            <Input value={v} onChange={(e) => set({ skills: cv.skills.map((s, j) => (j === i ? [s[0], e.target.value] : s)) })} />
            <Button variant="ghost" size="icon" onClick={() => set({ skills: cv.skills.filter((_, j) => j !== i) })} aria-label="Remove skill row"><Trash2 /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-fit" onClick={() => set({ skills: [...cv.skills, ["", ""]] })}><Plus /> Add skill row</Button>
      </section>

      <section className="grid gap-4">
        <h4 className="text-sm font-semibold">Experience</h4>
        {cv.experience.map((e, i) => (
          <div key={e.id} className="grid gap-3 rounded-md border p-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <Input value={e.title} onChange={(ev) => setExp(i, { title: ev.target.value })} placeholder="Title" />
              <Input value={e.company} onChange={(ev) => setExp(i, { company: ev.target.value })} placeholder="Company" />
              <Input value={e.dates} onChange={(ev) => setExp(i, { dates: ev.target.value })} placeholder="Jan 2022 – Present" />
            </div>
            <Input value={e.sub} onChange={(ev) => setExp(i, { sub: ev.target.value })} placeholder="Location / one-line context (optional)" />
            {e.bullets.map((b, k) => (
              <div key={b.id} className="grid grid-cols-[1fr_auto] gap-2">
                <Textarea rows={2} className="min-h-0" value={b.text} onChange={(ev) => setExp(i, { bullets: e.bullets.map((x, m) => (m === k ? { ...x, text: ev.target.value } : x)) })} />
                <Button variant="ghost" size="icon" onClick={() => setExp(i, { bullets: e.bullets.filter((_, m) => m !== k) })} aria-label="Remove bullet"><Trash2 /></Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setExp(i, { bullets: [...e.bullets, { id: `${e.id}-${e.bullets.length + 1}-${Date.now() % 1000}`, text: "" }] })}><Plus /> Add bullet</Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => set({ experience: cv.experience.filter((_, j) => j !== i) })}><Trash2 /> Remove role</Button>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-fit" onClick={() => set({ experience: [...cv.experience, { id: slug(`role-${cv.experience.length + 1}`), title: "", company: "", dates: "", sub: "", bullets: [] }] })}><Plus /> Add role</Button>
      </section>

      {(["projects", "community"] as const).map((key) => (
        <section key={key} className="grid gap-2">
          <h4 className="text-sm font-semibold">{key === "projects" ? "Projects" : "Community, volunteering, awards"}</h4>
          {cv[key].map((b, k) => (
            <div key={b.id} className="grid grid-cols-[1fr_auto] gap-2">
              <Textarea rows={2} className="min-h-0" value={b.text} onChange={(ev) => set({ [key]: cv[key].map((x, m) => (m === k ? { ...x, text: ev.target.value } : x)) })} />
              <Button variant="ghost" size="icon" onClick={() => set({ [key]: cv[key].filter((_, m) => m !== k) })} aria-label="Remove"><Trash2 /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-fit" onClick={() => set({ [key]: [...cv[key], { id: `${key}-${Date.now() % 100000}`, text: "" }] })}><Plus /> Add</Button>
        </section>
      ))}

      <section className="grid gap-2">
        <h4 className="text-sm font-semibold">Education</h4>
        {cv.education.map(([q, y], i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_auto] gap-2">
            <Input value={q} onChange={(e) => set({ education: cv.education.map((x, j) => (j === i ? [e.target.value, x[1]] : x)) })} />
            <Input value={y} onChange={(e) => set({ education: cv.education.map((x, j) => (j === i ? [x[0], e.target.value] : x)) })} />
            <Button variant="ghost" size="icon" onClick={() => set({ education: cv.education.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-fit" onClick={() => set({ education: [...cv.education, ["", ""]] })}><Plus /> Add</Button>
      </section>
    </div>
  );
}
