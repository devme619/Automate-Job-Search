# Job Application Agent

A local React prototype for organizing and drafting job applications.

## What it does

- Stores reusable candidate details in browser local storage.
- Lets you create multiple role profiles with a separate CV source, summary, cover letter base, salary expectation, years of experience, skills, and achievements.
- Lets each role define job platforms to scan.
- Generates relevant job openings from configured platform inputs in this browser-only prototype.
- Scores role-to-job alignment.
- Generates realistic tailored resume and cover letter drafts for each job.
- Generates a Playwright browser automation config and commands for each selected job.
- Tracks tailored and applied jobs in an editable pipeline table.

## Run it

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Browser automation

The automation runner lives in `automation/apply-with-playwright.mjs`.

Dry run against the included local test form:

```bash
npm run automate:apply -- --config automation/test-application.json --headless
```

Dry run against a real application config:

```bash
npm run automate:apply -- --config automation/my-application.json --keepOpen
```

Submit after review:

```bash
npm run automate:apply -- --config automation/my-application.json --submit --keepOpen
```

The runner auto-detects installed Chrome or Edge. If you want Playwright's bundled Chromium and have enough disk space, run:

```bash
npm run playwright:install
```

## Notes

Browser automation can be blocked by login pages, CAPTCHA, anti-bot checks, unsupported custom widgets, or job-board terms. Use dry-run first, review every generated application, and use `--submit` only when you are sure the details are correct.
