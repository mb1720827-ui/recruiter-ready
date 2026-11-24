# Recruiter-Ready

**Find out what a recruiter sees in your GitHub project in 30 seconds, then fix it, describe it honestly on your resume and be ready to explain it in an interview.**

Built for developers job-hunting with portfolio projects, especially projects built with AI help.

## What it does

| Part | What you get |
|---|---|
| **Audit** (no AI, no dependencies) | A 0–100 score across 14 checks with evidence and a fix for each: live demo, README pitch, screenshot, run steps, tests, CI, design notes, `.env.example`, licence, committed secrets and junk files. |
| **Claude Code skill** | Builds on the audit: ranks fixes by hiring impact, writes resume bullets backed only by evidence, and prepares you to defend the code in an interview. |

Example output:

```
Recruiter-ready score: 35/100

First impression
  ✓ README explains the project — README.md, 7194 characters
  ✗ Links to a live demo — no live demo or published package link in the README
      → Deploy it (Vercel, Netlify, GitHub Pages…) or publish it (npm, PyPI, pub.dev), and put the link at the top of the README.
Proof it works
  ✗ Has automated tests — 0 test files
      → Add tests for the core logic. Even 5 good tests show you can prove your code works.
  ✓ Runs checks automatically (CI) — GitHub Actions workflow found
...
Facts: 8 commits (2026-09-16 → 2026-10-05), 46 source files, 0 test files, mostly .jsx (36), .js (9)
```

## Install

### Claude Code

```
/plugin marketplace add mb1720827-ui/recruiter-ready
/plugin install recruiter-ready@recruiter-ready
```

Then ask: *"Make this repo recruiter-ready"*, *"Write resume bullets for this project"* or *"Prepare me to explain this project in an interview."*

### Command line (audit only)

From a clone, with Node.js 20 or later:

```bash
node skills/recruiter-ready/scripts/audit.mjs path/to/your-project
node skills/recruiter-ready/scripts/audit.mjs path/to/your-project --json
```

## How it works

1. **A deterministic audit** (`skills/recruiter-ready/scripts/audit.mjs`) reads what git tracks and scores 14 weighted checks in four groups: first impression (35), proof it works (30), engineering signals (20) and hygiene (15). Checks that don't apply, such as `.env.example` for code that reads no environment variables, count as passed.
2. **A secrets scan** looks for common credential formats (private keys; AWS, GitHub, OpenAI, Anthropic, Google and Slack keys; live and test payment secret keys; Supabase service-role keys and secret keys) and masks every match. Supabase's public anon key is deliberately not flagged. It also lists `.env` files that are committed now, or were committed once and are still in git history.
3. **The skill** has Claude read the audit plus the README, entry points, tests and commit history, then follow fixed rules: secrets first, fixes ranked by impact, and bullets in which every number comes from the repository or from you.

## Decisions and trade-offs

- **The audit uses no AI.** It's free, instant, repeatable and testable. Judgement (what to fix first, how to phrase a bullet) is left to the skill.
- **No dependencies.** Nothing to install, and nothing to trust beyond Node.js itself.
- **Honesty is a rule, not a style.** The skill must never invent users, percentages or speed-ups, and asks for real numbers instead. Recruiters check, and invented numbers end interviews.
- **"Can you defend it?"** Projects built with AI help are fine, but a candidate who can't explain their own code fails the interview. The skill lists the concepts and files to study first.
- **Not a full secret scanner.** The scan catches the common mistakes. For security-critical repositories, also run a dedicated tool such as gitleaks or trufflehog.

## Tests

```bash
npm test
```

Eight tests build throwaway git repositories and check scoring, every failure's fix text, secret detection and masking (including a deleted `.env` still in history), Windows line endings and junk detection. Fake credentials are assembled at runtime so they never appear in the source.

## License

MIT
