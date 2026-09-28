// Everything the AI needs to know about the candidate, built from their own settings, CV and facts.
import { dashboardFacts } from "./db";
import { COUNTRIES, getFactsText, getMasterCV, getSettings, prefsFor, searchCountries, writingRules } from "./settings";

export function candidateName(): string {
  return getSettings().name || getMasterCV().name || "the candidate";
}

/** Short preference summary for watch-outs (salary, office days, sponsorship). */
export function preferences(): string {
  const s = getSettings();
  const c = COUNTRIES[s.country];
  return [
    `Looking for: ${s.targetRoles.join(", ") || "(not set)"} (${s.seniority} level); lives in ${c.name}`,
    `Home: ${s.homeCity || "(not set)"}; commutable: ${s.commutable.join(", ") || "(none listed)"}; working pattern: ${s.remotePreference || "not set"}; will do at most ${s.maxOfficeDays} office days/week far away`,
    ...searchCountries(s).map((cc) => {
      const p = prefsFor(cc, s);
      const sym = COUNTRIES[cc].symbol;
      return `${COUNTRIES[cc].name}${cc === s.country ? " (home)" : " (would relocate)"}: ${p.salaryMin ? `salary minimum ${sym}${p.salaryMin.toLocaleString()}` : "no salary minimum"}; ${p.needsSponsorship ? `needs visa sponsorship${p.sponsorSalaryFloor ? ` (visa route requires at least ${sym}${p.sponsorSalaryFloor.toLocaleString()})` : ""}` : "no sponsorship needed"}`;
    }),
  ].join("\n");
}

export function candidateContext(): string {
  const facts = getFactsText().trim();
  return [
    `# Master CV (JSON; every bullet has an id)\n${JSON.stringify(getMasterCV(), null, 1)}`,
    `# Facts the candidate confirmed beyond the CV (true; may be used)\n${facts || "(none)"}`,
    `# More facts the candidate confirmed in the app (answers to earlier questions; a "no" means never imply it)\n${dashboardFacts()}`,
    `# Candidate preferences\n${preferences()}`,
    `# Writing rules (follow all of them)\n${writingRules()}`,
  ].join("\n\n");
}
