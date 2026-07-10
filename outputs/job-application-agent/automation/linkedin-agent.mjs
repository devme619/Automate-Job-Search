import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const artifactsDir = resolve("automation/artifacts");
const profileDir = resolve(
  args.profileDir || "automation/.linkedin-browser-profile",
);
const configPath = resolve(args.config || "automation/linkedin-agent.json");
const config = readConfig(configPath);
const maxJobs = Number(args.max || config.maxJobs || 25);
const shouldSubmit = args.submit === true || config.submit === true;
const scanIntervalMinutes = Number(
  args.interval || config.intervalMinutes || 0,
);
const browserPath =
  args.browserPath || config.browserPath || detectInstalledBrowser();

mkdirSync(artifactsDir, { recursive: true });
mkdirSync(profileDir, { recursive: true });

if (browserPath) {
  console.log(`Using system browser: ${browserPath}`);
} else {
  console.log(
    "No system Chrome/Edge found at the known paths - using Playwright's bundled Chromium (run 'npm run playwright:install' if this fails).",
  );
}

process.on("unhandledRejection", (error) => {
  console.error("FATAL (unhandled rejection):", error?.message || error);
  process.exitCode = 1;
});

try {
  if (args.login === true) {
    await withLinkedIn(async ({ page, context }) => {
      logCloseReasons(context, page);
      await page.goto("https://www.linkedin.com/login", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      console.log(
        "LinkedIn login window opened. Sign in manually, then close the browser window or press Ctrl+C here.",
      );
      console.log(
        `Waiting up to ${Math.round(Number(args.loginWaitMs || 180000) / 1000)}s for you to finish logging in...`,
      );
      await page.waitForTimeout(Number(args.loginWaitMs || 180000));
      console.log("Login wait finished.");
    });
  } else if (scanIntervalMinutes > 0) {
    while (true) {
      await runOnce();
      await waitMinutes(scanIntervalMinutes);
    }
  } else {
    await runOnce();
  }
} catch (error) {
  console.error("FATAL:", error?.message || error);
  console.error(
    "If the browser window closed unexpectedly, this is almost always one of:\n" +
      "  1) The system Chrome/Edge path above doesn't exist or refused automation - try deleting 'browserPath' from automation/linkedin-agent.json and running `npm run playwright:install` so Playwright uses its own bundled Chromium instead.\n" +
      "  2) LinkedIn showed a checkpoint/CAPTCHA/2FA page that the automated profile couldn't get past.\n" +
      "  3) The persistent profile folder (automation/.linkedin-browser-profile) got corrupted - try deleting that folder and running `npm run linkedin:login` again.",
  );
  process.exitCode = 1;
}

async function runOnce() {
  await withLinkedIn(async ({ page, context }) => {
    logCloseReasons(context, page);
    const jobs = await scrapeLinkedInJobs(page);
    saveJobs(jobs);
    console.log(`Found ${jobs.length} LinkedIn job(s).`);

    if (args.apply === true || config.autoApply === true) {
      for (const job of jobs) {
        await applyToJob(page, job).catch((error) => {
          console.log(`WARN: ${job.title} at ${job.company}: ${error.message}`);
        });
      }
    }
  });
}

function logCloseReasons(context, page) {
  page.on("close", () => console.log("NOTE: the page was closed."));
  page.on("crash", () => console.error("NOTE: the page crashed."));
  context.on("close", () => console.log("NOTE: the browser context closed."));
}

async function withLinkedIn(work) {
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: browserPath,
      headless: args.headless === true,
      slowMo: Number(args.slowMo || 80),
      acceptDownloads: true,
    });
  } catch (error) {
    throw new Error(
      `Could not launch the browser (executablePath: ${browserPath || "bundled Chromium"}). ${error.message}`,
    );
  }
  const page = context.pages()[0] || (await context.newPage());
  try {
    await work({ context, page });
  } finally {
    if (args.keepOpen !== true) await context.close();
  }
}

async function scrapeLinkedInJobs(page) {
  const searchUrl = buildSearchUrl();
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);

  if (page.url().includes("/login") || page.url().includes("/checkpoint")) {
    throw new Error(
      "LinkedIn is asking you to sign in or verify (checkpoint). Run npm run linkedin:login first, complete any verification, then re-run this command.",
    );
  }

  for (let index = 0; index < 8; index += 1) {
    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(900);
  }

  const jobs = await page.evaluate((limit) => {
    const anchors = [...document.querySelectorAll("a[href*='/jobs/view/']")];
    const seen = new Set();
    return anchors
      .flatMap((anchor) => {
        const href = new URL(anchor.href, location.href);
        const match = href.pathname.match(/\/jobs\/view\/(\d+)/);
        const id = match?.[1] || href.pathname;
        if (seen.has(id)) return [];
        seen.add(id);

        const card =
          anchor.closest(
            "li, .job-card-container, .jobs-search-results__list-item",
          ) || anchor;
        const text = card.innerText || anchor.innerText || "";
        const parts = text
          .split("\n")
          .map((part) => part.trim())
          .filter(Boolean);
        const title = anchor.innerText.trim() || parts[0] || "LinkedIn Job";
        const company =
          parts.find(
            (part) =>
              part !== title &&
              !part.match(/promoted|viewed|actively recruiting/i),
          ) || "LinkedIn";
        const location =
          parts.find((part) =>
            part.match(
              /remote|hybrid|on-site|india|bengaluru|bangalore|pune|mumbai|delhi|gurugram|hyderabad|chennai/i,
            ),
          ) || "Not listed";
        return [
          {
            id,
            url: `https://www.linkedin.com/jobs/view/${id}/`,
            title,
            company,
            location,
            platform: "LinkedIn",
            description: text.slice(0, 900),
          },
        ];
      })
      .slice(0, limit);
  }, maxJobs);

  return jobs;
}

async function applyToJob(page, job) {
  await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);

  const clicked = await clickOptional(page, [
    page.getByRole("button", { name: /easy apply/i }),
    page.getByRole("button", { name: /apply/i }),
  ]);
  if (!clicked) throw new Error("No Easy Apply button found.");

  await page.waitForTimeout(1200);
  await fillApplication(page);
  await uploadFiles(page);

  for (let step = 0; step < 8; step += 1) {
    await answerQuestions(page);
    const advanced = await clickOptional(page, [
      page.getByRole("button", { name: /next/i }),
      page.getByRole("button", { name: /review/i }),
      page.getByRole("button", { name: /continue/i }),
    ]);
    if (!advanced) break;
    await page.waitForTimeout(900);
  }

  await answerQuestions(page);
  if (shouldSubmit) {
    const submitted = await clickOptional(page, [
      page.getByRole("button", { name: /submit application/i }),
      page.getByRole("button", { name: /submit/i }),
    ]);
    console.log(
      `${submitted ? "APPLIED" : "READY"}: ${job.title} at ${job.company}`,
    );
  } else {
    console.log(`READY: ${job.title} at ${job.company}`);
  }
}

async function fillApplication(page) {
  await fillLikely(page, ["name", "full name"], config.candidate?.name);
  await fillLikely(page, ["email"], config.candidate?.email);
  await fillLikely(page, ["phone", "mobile"], config.candidate?.phone);
  await fillLikely(page, ["city", "location"], config.candidate?.location);
}

async function uploadFiles(page) {
  const inputs = await page.locator("input[type='file']").all();
  for (const input of inputs) {
    const descriptor =
      `${await input.getAttribute("name")} ${await input.getAttribute("id")} ${await input.getAttribute("accept")}`.toLowerCase();
    const target =
      descriptor.includes("cover") || descriptor.includes("letter")
        ? config.files?.coverLetterPath
        : config.files?.resumePath;
    if (target && existsSync(resolve(target))) {
      await input.setInputFiles(resolve(target));
      await page.waitForTimeout(600);
    }
  }
}

async function answerQuestions(page) {
  for (const [label, value] of Object.entries(config.answers || {})) {
    await fillLikely(page, [label], value);
  }

  const fields = await page
    .locator("textarea, input[type='text'], input[type='number']")
    .all();
  for (const field of fields) {
    try {
      if ((await field.inputValue()) !== "") continue;
      const prompt = await field
        .locator(
          "xpath=ancestor::*[self::label or self::div or self::fieldset][1]",
        )
        .innerText()
        .catch(() => "");
      const answer = answerForPrompt(prompt);
      if (answer) await field.fill(answer);
    } catch {
      continue;
    }
  }
}

function answerForPrompt(prompt) {
  const text = prompt.toLowerCase();
  const resume = config.answerStrategy?.resumeSource || "";
  const persona =
    config.answerStrategy?.persona || config.candidate?.name || "Devendra";
  const limit = config.answerStrategy?.limitWords || 150;
  if (text.match(/why.*hire|why.*you|why.*fit/)) {
    return limitWords(
      `As ${persona}, I bring relevant hands-on experience from my resume: ${resume}. I focus on practical delivery, clear communication, and measurable product impact.`,
      limit,
    );
  }
  if (text.match(/react|frontend|front-end|javascript|typescript/)) {
    return limitWords(
      `As ${persona}, my React experience includes building component-based interfaces, forms, API integration, accessibility improvements, testing, performance tuning, and production UI workflows.`,
      limit,
    );
  }
  if (text.match(/notice/))
    return config.answers?.["Notice period"] || "Immediate / negotiable";
  if (text.match(/current.*salary|current.*ctc/))
    return config.answers?.["Current salary"] || "Prefer not to disclose";
  if (text.match(/expected.*salary|expected.*ctc|salary expectation/))
    return (
      config.answers?.["Expected salary"] ||
      "Competitive / open to market range"
    );
  if (text.match(/authorized|sponsorship|eligible/))
    return config.answers?.["Work authorization"] || "Yes";
  return "";
}

async function fillLikely(page, labels, value) {
  if (value == null || value === "") return false;
  for (const label of labels) {
    const regex = new RegExp(escapeRegex(label), "i");
    const locators = [
      page.getByLabel(regex),
      page.getByPlaceholder(regex),
      page.locator(`input[name*="${cssContains(label)}" i]`),
      page.locator(`textarea[name*="${cssContains(label)}" i]`),
    ];
    for (const locator of locators) {
      try {
        const first = locator.first();
        if (
          (await first.count()) === 0 ||
          !(await first.isVisible({ timeout: 600 }))
        )
          continue;
        await first.fill(String(value));
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

async function clickOptional(page, locators) {
  for (const locator of locators) {
    try {
      const first = locator.first();
      if (
        (await first.count()) > 0 &&
        (await first.isVisible({ timeout: 1200 }))
      ) {
        await first.click({ timeout: 4000 });
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

function saveJobs(jobs) {
  const jsonPath = resolve(artifactsDir, "linkedin-jobs.json");
  const textPath = resolve(artifactsDir, "linkedin-jobs.txt");
  writeFileSync(jsonPath, JSON.stringify(jobs, null, 2), "utf8");
  writeFileSync(
    textPath,
    jobs
      .map(
        (job) => `${job.url} | ${job.company} | ${job.title} | ${job.location}`,
      )
      .join("\n"),
    "utf8",
  );
}

function buildSearchUrl() {
  if (config.searchUrl) return config.searchUrl;
  const params = new URLSearchParams({
    keywords: config.keywords || "Frontend Engineer",
    location: config.location || "India",
    f_AL: "true",
    f_TPR: config.postedWithin || "r86400",
    sortBy: "DD",
  });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

function readConfig(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function detectInstalledBrowser() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function waitMinutes(minutes) {
  return new Promise((resolveWait) =>
    setTimeout(resolveWait, minutes * 60 * 1000),
  );
}

function limitWords(value, limit) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, Number(limit) || 150)
    .join(" ");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssContains(value) {
  return (
    String(value)
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .split(" ")[0] || value
  );
}
