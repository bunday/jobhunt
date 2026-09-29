# Job Hunt

A self-hosted job search assistant. Tell it what you're looking for and give it your CV; it searches job boards every day, ranks every job against your profile, and helps you apply: a tailored CV, a cover letter and polished answers to application questions for each job, written by the AI of your choice.

Everything runs on your own machine. Your CV, applications and notes never leave it, apart from the AI calls you configure.

## What it does

- **Finds jobs daily** from LinkedIn's public search, company careers boards (Greenhouse, Lever, Ashby), Apple, and optionally Adzuna.
- **Searches up to three countries**: where you live, plus up to two you'd move to. Each country has its own minimum salary (in its own currency) and its own sponsorship setting, and every job is judged by the rules of the country it's in.
- **Fits how you work**: on-site, hybrid, remote or any. On-site and hybrid searches centre on your home city and the places you'd commute to; jobs further away are flagged.
- **Ranks every job against you**: your target roles and level, your skills, location and working pattern, and your minimum salary. Every point of the score comes with a plain-English reason, and nothing is ever hidden: jobs outside your preferences are flagged, not filtered.
- **Checks visa sponsorship** (optional, per country): in the **UK** and the **Netherlands**, every employer is checked against the government's public register of licensed sponsors. Everywhere, ads that rule out sponsorship are flagged.
- **Prepares applications**: one click tailors your CV (picked and reordered from your own master CV, so nothing is invented), writes a cover letter, and gives you an honest fit review with the gaps and questions that would make the application stronger. Download both as PDFs, named the way recruiters expect.
- **Learns about you as you go**: answer the review's "to make this stronger" questions once, and every future application uses the answers.
- **Polishes application-form answers** from your rough drafts.
- **Tracks everything**: shortlisted, applied, interview, offer, with dates and notes, and an overview of where every application stands.

It works for any profession, not just tech: tell it the roles you want and it searches and ranks for those.

### Supported countries

| Country | Job sources | Sponsor register check |
|---|---|---|
| United Kingdom | LinkedIn, careers boards, Apple, Adzuna | Yes (Home Office register) |
| Netherlands | LinkedIn, careers boards, Apple (few roles), Adzuna | Yes (IND register) |
| United States | LinkedIn, careers boards, Apple, Adzuna | No public register |
| Canada | LinkedIn, careers boards, Adzuna | No public register |
| Ireland | LinkedIn, careers boards, Apple | No public register |
| Türkiye | LinkedIn, careers boards (remote roles) | No public register |

Where there's no register, ads that rule out sponsorship are still flagged.

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

### 1. Find jobs you want (Discover)

**Discover** lists new jobs, best match first. Click a job to open it: you'll see why it scored the way it did (every point has a reason), and a link to the original ad. Searching several countries? Filter by country.

- Want it? Click **Shortlist**. The job moves to **Applications**, where you prepare it.
- Not for you? Click **Skip** and it moves to **Closed**.

Found a job somewhere else? Use **Add a job** in Discover and paste the description; it's scored like everything else.

### 2. Prepare the application (Applications)

Open the job in **Applications** and click **Prepare application**. In a minute or two you get:

- **A tailored CV**: picked and reordered from your master CV to fit this job. Nothing is invented. Open it or download it as a PDF.
- **A cover letter**: edit it right there (it saves as you type), copy it, or download it as a PDF on the same letterhead as your CV.
- **A fit review**: how well you match, the gaps against the ad, and watch-outs such as office days, salary or sponsorship.

The review also asks **"To make this stronger"** questions, for example *"Do you have a number for that result?"* or *"Have you used this tool?"*:

- Answer the ones you can; **skip any you'd rather not**. A plain "No" is useful too: it stops the AI hinting at something you haven't done.
- Your answers are **saved to your profile and reused for every future application**, so you're rarely asked the same thing twice. See and edit them any time in **Settings → My answers**.
- Click **Prepare again** to rebuild the CV and letter with your answers included.

### 3. Answer the application form (Applications)

Most job portals ask their own questions (*"Why do you want to work here?"*, *"Tell us about a project you're proud of"*). For each one:

1. Paste the **question from the portal** and your **rough answer** (a few honest notes are enough) into *Application questions*, and click **Add question**.
2. Click **Polish**. The AI turns your notes into a clear, specific answer, using only your CV and your saved answers, in your own voice.
3. Copy the **Ready to paste** answer into the portal. If it suggests something that would make the answer stronger, answer it and click **Polish again**.

### 4. Apply and track

Apply on the employer's site yourself, then set the job's status to **Applied**. As things move, update it to **Interview**, **Offer** or **Rejected**, and keep notes (recruiter names, dates) on the job.

**Overview** shows the whole picture: your job pool, every application and its stage, and what needs your attention (jobs waiting to be prepared, questions not yet polished, applications worth following up).

### Settings

Everything from setup can be changed later: roles, countries, pay and sponsorship, your master CV, your saved answers and writing rules. **Settings → Start over** wipes everything and takes you back to setup.

## Your data

- Everything is stored in `./data` (a SQLite database plus generated PDFs). Back it up by copying the folder; delete it (or use *Start over*) to reset.
- Your API keys live only in `.env`.
- Company careers boards to scan are listed in `config/companies.json`. Add your own in `config/companies.local.json` (same format; not tracked by git).

## Notes and limits

- LinkedIn is searched through its public, logged-out job pages, politely and at personal scale. Use it responsibly. Each extra country adds its own searches, so the daily search takes longer.
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

MIT licensed. If it helps you, a star on GitHub is appreciated.
