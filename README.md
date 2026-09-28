# Job Hunt

A self-hosted job search assistant. Tell it what you're looking for and give it your CV; it searches job boards every day, ranks every job against your profile, and helps you apply: a tailored CV, a cover letter and polished answers to application questions for each job, written by the AI of your choice.

Everything runs on your own machine. Your CV, applications and notes never leave it, apart from the AI calls you configure.

## What it does

- **Finds jobs daily** from LinkedIn's public search, company careers boards (Greenhouse, Lever, Ashby), Apple, and optionally Adzuna.
- **Ranks them against you**: your target roles and level, your skills, your location and working pattern, your minimum salary. Every point of the score comes with a plain-English reason, and nothing is ever hidden: jobs outside your preferences are flagged, not filtered.
- **Checks visa sponsorship** (optional): in the **UK** and the **Netherlands**, every employer is checked against the government's public register of licensed sponsors. Everywhere, ads that rule out sponsorship are flagged.
- **Prepares applications**: one click tailors your CV (picked and reordered from your own master CV, so nothing is invented), writes a cover letter, and gives you an honest fit review with the gaps and questions that would make the application stronger.
- **Polishes application-form answers** from your rough drafts.
- **Tracks everything**: shortlisted, applied, interview, offer, with dates and notes.

Supported countries: **United Kingdom, Netherlands, United States, Ireland, Canada.**

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) and an AI provider (see below).

```bash
git clone https://github.com/bunday/jobhunt.git
cd jobhunt
cp .env.example .env        # then add your AI key
docker compose up -d --build
```

Open **http://localhost:3800** and follow the setup: upload your CV, check it, say what you're looking for, and it runs its first search.

## Choosing an AI provider

AI is only used to import your CV, prepare applications and polish answers. Set it in `.env`:

| Provider | Settings | Notes |
|---|---|---|
| Anthropic API | `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` | Best results. Default model `claude-opus-5`. |
| OpenAI-compatible | `AI_PROVIDER=openai`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` | OpenAI, OpenRouter, Gemini, Groq, Mistral, or local models via Ollama. |
| Claude subscription | `AI_PROVIDER=claude-cli`, `CLAUDE_CODE_OAUTH_TOKEN`, `INSTALL_CLAUDE_CLI=true` | Uses Claude Code with your Claude plan. Get a token with `claude setup-token`. |

Smaller or local models work, but write weaker cover letters and are more likely to stretch the truth. **Always read a cover letter before sending it.** Tailored CVs are safer: the server rejects anything that isn't in your master CV.

## Everyday use

1. **Discover**: new jobs, best first. Open one to see why it scored the way it did. Shortlist or skip.
2. **Prepare**: on a shortlisted job, click *Prepare application*. You get a tailored CV (PDF), a cover letter (editable, downloadable as PDF) and a fit review. Answer the review's questions to strengthen future applications too: your answers are saved to your profile and reused.
3. **Apply** on the employer's site yourself, then set the job's status to *Applied*.
4. **Overview** shows where everything stands and what needs your attention.

Found a job somewhere else? Use *Add a job* in Discover and paste the description.

## Your data

- Everything is stored in `./data` (a SQLite database plus generated PDFs). Back it up by copying the folder.
- Your API keys live only in `.env`.
- Company careers boards to scan are listed in `config/companies.json`. Add your own in `config/companies.local.json` (same format; not tracked by git).

## Notes and limits

- LinkedIn is searched through its public, logged-out job pages, politely and at personal scale. Use it responsibly.
- Indeed blocks automated access, so it isn't searched. Add jobs from Indeed by hand.
- Adzuna only shares a short snippet of each ad; paste the full description into the job before preparing it.
- Sponsor registers are checked by company name, so matches are marked *licensed* (exact) or *probably licensed* (close). Check the name shown on the job.
- This tool helps you apply; it doesn't apply for you, and it's not immigration or legal advice.

## Development

```bash
bun install
bun run dev        # API on :3800 (needs chromium and poppler-utils installed locally)
bun run dev:web    # web app on :5480, proxied to the API
bun run check      # type-check server and web
```

MIT licensed.
