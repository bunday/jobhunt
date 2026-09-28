// Everything the AI needs to know about the candidate, built from their own settings, CV and facts.
import { dashboardFacts } from "./db";
import { COUNTRIES, getFactsText, getMasterCV, getSettings, writingRules } from "./settings";

export function candidateName(): string {
  return getSettings().name || getMasterCV().name || "the candidate";
}

/** Short preference summary for watch-outs (salary, office days, sponsorship). */
export function preferences(): string {
  const s = getSettings();
  const c = COUNTRIES[s.country];
  return [
    `Looking for: ${s.targetRoles.join(", ") || "(not set)"} (${s.seniority} level) in ${c.name}`,
    `Home: ${s.homeCity || "(not set)"}; commutable: ${s.commutable.join(", ") || "(none listed)"}; prefers ${s.remotePreference}; will do at most ${s.maxOfficeDays} office days/week far away`,
    s.salaryMin ? `Salary minimum: ${c.symbol}${s.salaryMin.toLocaleString()}` : "No salary minimum set",
    s.needsSponsorship ? `Needs visa sponsorship${s.sponsorSalaryFloor ? `; the visa route requires at least ${c.symbol}${s.sponsorSalaryFloor.toLocaleString()}` : ""}` : "Does not need visa sponsorship",
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
