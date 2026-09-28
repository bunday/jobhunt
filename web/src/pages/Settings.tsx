import { FileText, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Fact, type MasterCV, type SetupData, type Settings as S } from "@/api";
import { AboutForm, CvEditor, FactsForm, SearchForm, WhereForm } from "@/components/profile";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/form";

export function Settings({ initial, onSaved }: { initial: SetupData; onSaved: () => void }) {
  const [settings, setSettings] = useState<S>(initial.settings);
  const [cv, setCv] = useState<MasterCV>(initial.cv);
  const [facts, setFacts] = useState(initial.factsText);
  const [saved, setSaved] = useState("");
  const patch = (p: Partial<S>) => setSettings((s) => ({ ...s, ...p }));
  const save = async () => {
    await Promise.all([api.saveSettings(settings), api.saveCv(cv), api.saveFactsText(facts)]);
    setSaved("Saved. Jobs are re-scored with your new settings."); onSaved();
    setTimeout(() => setSaved(""), 4000);
  };
  const Save = () => (
    <div className="flex items-center gap-3"><Button onClick={save}>Save changes</Button>{saved && <span className="text-sm text-success">{saved}</span>}</div>
  );
  return (
    <div className="grid gap-5">
      <Section title="What you're looking for"><SearchForm value={settings} onChange={patch} /></Section>
      <Section title="Where and pay"><WhereForm value={settings} onChange={patch} countries={initial.countries} /></Section>
      <Section title="About you" desc="Printed on every CV and cover letter."><AboutForm value={settings} onChange={patch} /></Section>
      <Section title="Master CV" desc="Every tailored CV is cut from this. Edit wording here, not in individual CVs." action={<ButtonLink variant="outline" size="sm" href="/api/master-cv.pdf" target="_blank" rel="noreferrer"><FileText /> Preview PDF</ButtonLink>}>
        <CvEditor cv={cv} onChange={setCv} />
      </Section>
      <Section title="Extra facts and writing rules"><FactsForm value={settings} onChange={patch} facts={facts} onFacts={setFacts} /></Section>
      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur"><Save /></div>
      <MyFacts />
      <Card>
        <CardHeader><CardTitle>AI</CardTitle><CardDescription>Set in your .env file.</CardDescription></CardHeader>
        <CardContent className="text-sm">{initial.ai.configured ? <>Using <strong>{initial.ai.provider}</strong>, model <strong>{initial.ai.model}</strong>.</> : <span className="text-destructive">Not configured: {initial.ai.problem}</span>}</CardContent>
      </Card>
    </div>
  );
}

function Section({ title, desc, action, children }: { title: string; desc?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>{title}</CardTitle>{desc && <CardDescription className="mt-1">{desc}</CardDescription>}</div>{action}</CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Answers given to "to make this stronger" questions: one list, editable, reused by every application. */
function MyFacts() {
  const [facts, setFacts] = useState<Fact[]>([]);
  const load = () => api.facts().then(setFacts);
  useEffect(() => { load(); }, []);
  return (
    <Section title="My answers" desc="Everything you've answered in 'to make this stronger'. These apply to every job; edit or delete anything that's wrong.">
      {facts.length === 0 ? <p className="text-sm text-muted-foreground">No answers yet.</p> : (
        <ul className="grid gap-3">
          {facts.map((f) => (
            <li key={f.id} className="grid gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
              <span className="text-sm">{f.question} {f.company && <span className="text-xs text-muted-foreground">(asked on {f.company})</span>}</span>
              <div className="flex gap-2">
                <Input defaultValue={f.answer} onBlur={(e) => e.target.value.trim() && e.target.value !== f.answer && api.patchFact(f.id, e.target.value.trim())} />
                <Button variant="ghost" size="icon" aria-label="Delete" onClick={async () => { await api.deleteFact(f.id); load(); }}><Trash2 /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
