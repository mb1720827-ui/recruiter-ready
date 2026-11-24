---
name: recruiter-ready
description: Use when someone wants a GitHub project or portfolio to impress recruiters or hiring managers - "review my repo", "make my project job-ready", "is my portfolio good enough", writing resume bullets or a project summary, or preparing to explain a project in an interview. Audits the repo with evidence, ranks fixes by hiring impact, writes honest resume bullets and prepares interview answers.
---

# Recruiter-ready

Recruiters spend about 30 seconds on a repository. Hiring managers who look longer want proof the code works and that its author understands it. This skill checks a project against both, then helps the person present it honestly.

## Step 1: Audit with evidence

Run the audit script that ships with this skill, from this skill's base directory, against the project:

```bash
node "<this skill's base directory>/scripts/audit.mjs" <path-to-project> --json
```

It returns a 0-100 score, each check with evidence and a suggested fix, possible committed secrets, and facts (commits, dates, test files, languages). It runs no AI and changes nothing.

Then read what a reviewer would: the README top to bottom, the main entry points, a few tests, the CI workflow and `git log --oneline -20`.

## Step 2: Report, most important first

Use this structure, in plain words:

1. **Score and one-line verdict**, e.g. "62/100: solid code, but a recruiter can't see that from the README."
2. **Critical: secrets.** If the audit found any, this comes before everything else. The key must be **revoked and replaced** at the provider: deleting the file isn't enough, because git history keeps it. Say which provider dashboard to visit.
3. **Top 5 fixes, ranked by hiring impact**, each with the exact change. Usual order of impact:
   1. Live demo link at the top of the README
   2. One-sentence pitch: what it does and for whom
   3. Screenshot or short GIF
   4. Tests plus CI with a status badge
   5. A "How it works" or "Decisions and trade-offs" section
   6. Run instructions, `.env.example`, licence
4. **What's already strong**: two or three specific points, honestly. Don't pad.

Offer to make the fixes. When you write README text, keep it short and concrete, and never claim things the code doesn't do.

## Step 3: Resume bullets, honest by construction

Write 2-3 bullets plus a one-line project summary. Each bullet should be **action + what + how + evidence**.

**Honesty rules (never break these):**
- Every number must come from the audit facts (commits, test files, files), from the code itself (for example "17 syllabus topics"), or from the person. **Never invent** users, percentages, speed-ups or revenue.
- If a usage number would make a bullet stronger, **ask the person** for the real figure ("How many people have used it?") rather than guessing.
- Name technologies only if they're actually in the code.
- Prefer specifics recruiters can verify (a live link, a test count) over adjectives ("robust", "scalable", "cutting-edge").

| ✗ Weak | ✓ Strong |
|---|---|
| Built a robust, scalable e-commerce platform using cutting-edge AI. | Built a Next.js and Supabase store with Paystack checkout, verifying every payment on the server before fulfilment; 24 tests run in CI. |
| Improved performance by 40%. | (Only with a measurement the person can show. Otherwise leave it out.) |

## Step 4: "Can you defend it?" (interview prep)

Many projects are now built with AI help. That's fine, but the person must be able to explain the code. Produce:

1. **Five concepts this codebase relies on**, each with the file where it appears and one sentence on why it matters (for example "row-level security, `supabase/migrations/0001.sql`: each user can only read their own rows").
2. **Three questions an interviewer is likely to ask** about this project, each with the points a strong answer covers. Include one "What would you do differently?" and one about a trade-off visible in the code.
3. **Weak spots to study first**: parts of the code that are complex or unusual, which the person should be able to walk through line by line before an interview.

Be kind but direct. If the person can't explain a part, that part is a risk in an interview, not something to hide.

## Without Claude Code

The audit also runs on its own: `npx recruiter-ready <path>` prints the checklist in the terminal.
