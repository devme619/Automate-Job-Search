import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const configPath = args.config ? resolve(args.config) : resolve("automation/example-application.json");
const config = await readJson(configPath);
const shouldSubmit = args.submit === true || config.submit === true;
const headless = args.headless === true;
const slowMo = Number(args.slowMo || 80);

if (!config.url) {
  throw new Error("Missing config.url. Provide a job application page URL.");
}

const executablePath = args.browserPath || detectInstalledBrowser();
const browser = await chromium.launch({ executablePath, headless, slowMo });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const report = [];

try {
  await step("Open page", async () => {
    await page.goto(toNavigableUrl(config.url), { waitUntil: "domcontentloaded", timeout: 60000 });
  });

  await step("Find and click Apply button", async () => {
    await clickFirst(page, [
      page.getByRole("button", { name: /easy apply|apply now|apply/i }),
      page.getByRole("link", { name: /easy apply|apply now|apply/i }),
      page.locator("button:has-text('Easy Apply')"),
      page.locator("button:has-text('Apply')"),
      page.locator("a:has-text('Apply')")
    ]);
  });

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(800);

  await step("Fill candidate fields", async () => {
    await fillLikely(page, ["full name", "name"], config.candidate?.name);
    await fillLikely(page, ["first name"], firstName(config.candidate?.name));
    await fillLikely(page, ["last name", "surname"], lastName(config.candidate?.name));
    await fillLikely(page, ["email", "email address"], config.candidate?.email);
    await fillLikely(page, ["phone", "mobile", "telephone"], config.candidate?.phone);
    await fillLikely(page, ["location", "city"], config.candidate?.location);
  });

  await step("Upload resume and cover letter", async () => {
    await uploadFiles(page, config.files || {});
  });

  await step("Answer custom questions", async () => {
    await answerApplicationQuestions(page, config);
  });

  await step("Advance through application pages", async () => {
    for (let index = 0; index < 6; index += 1) {
      const clicked = await clickOptional(page, [
        page.getByRole("button", { name: /next|continue|save and continue|review/i }),
        page.getByRole("link", { name: /next|continue|review/i })
      ]);
      if (!clicked) break;
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(900);
      await answerApplicationQuestions(page, config);
    }
  });

  if (shouldSubmit) {
    await step("Submit application", async () => {
      await clickFirst(page, [
        page.getByRole("button", { name: /submit application|send application|submit|finish|apply/i }),
        page.getByRole("link", { name: /submit application|send application|finish/i }),
        page.locator("button:has-text('Submit application')"),
        page.locator("button:has-text('Submit')")
      ]);
    });
  } else {
    report.push("Dry run: stopped before final submit. Rerun with --submit to click the final submit button.");
  }

  await saveArtifacts(page, report);
} finally {
  if (args.keepOpen !== true) {
    await browser.close();
  }
}

async function readJson(path) {
  const fs = await import("node:fs/promises");
  return JSON.parse(await fs.readFile(path, "utf8"));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function toNavigableUrl(value) {
  if (/^https?:\/\//i.test(value) || /^file:\/\//i.test(value)) return value;
  return pathToFileURL(resolve(value)).href;
}

function detectInstalledBrowser() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function step(label, action) {
  try {
    await action();
    report.push(`OK: ${label}`);
  } catch (error) {
    report.push(`WARN: ${label} - ${error.message}`);
  }
}

async function clickFirst(page, locators) {
  for (const locator of locators) {
    if (await clickOptional(page, [locator])) return true;
  }
  throw new Error("No matching clickable element found.");
}

async function clickOptional(page, locators) {
  for (const locator of locators) {
    try {
      const first = locator.first();
      if ((await first.count()) > 0 && (await first.isVisible({ timeout: 1200 }))) {
        await first.click({ timeout: 4000 });
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function fillLikely(page, labels, value) {
  if (value == null || value === "") return false;
  for (const label of labels) {
    const patterns = [label, normalizeLabel(label)];
    for (const pattern of patterns) {
      const regex = new RegExp(escapeRegex(pattern), "i");
      const locators = [
        page.getByLabel(regex),
        page.getByPlaceholder(regex),
        page.locator(`input[name*="${cssContains(pattern)}" i]`),
        page.locator(`textarea[name*="${cssContains(pattern)}" i]`)
      ];
      for (const locator of locators) {
        try {
          const first = locator.first();
          if ((await first.count()) === 0 || !(await first.isVisible({ timeout: 800 }))) continue;
          const tag = await first.evaluate((node) => node.tagName.toLowerCase());
          const type = await first.getAttribute("type");
          if (type === "checkbox" || type === "radio") {
            if (String(value).match(/yes|true|agree|authorized/i)) await first.check();
          } else if (tag === "select") {
            await first.selectOption({ label: String(value) }).catch(async () => {
              await first.selectOption(String(value));
            });
          } else {
            await first.fill(String(value));
          }
          return true;
        } catch {
          continue;
        }
      }
    }
  }
  return false;
}

async function answerApplicationQuestions(page, config) {
  const answers = config.answers || {};
  for (const [question, answer] of Object.entries(answers)) {
    await fillLikely(page, [question], answer);
  }
  await answerUnfilledTextQuestions(page, config);
  await answerRadioAndCheckboxQuestions(page, config);
  await answerSelectQuestions(page, config);
}

async function uploadFiles(page, files) {
  const inputs = await page.locator('input[type="file"]').all();
  for (const input of inputs) {
    const descriptor = `${await input.getAttribute("name")} ${await input.getAttribute("id")} ${await input.getAttribute("accept")}`.toLowerCase();
    const target =
      descriptor.includes("cover") || descriptor.includes("letter") ? files.coverLetterPath : files.resumePath;
    if (!target || !existsSync(resolve(target))) continue;
    await input.setInputFiles(resolve(target));
  }
}

async function answerUnfilledTextQuestions(page, config) {
  const answers = config.answers || {};
  const fields = [
    ...(await page.locator("textarea").all()),
    ...(await page.locator("input:not([type]), input[type='text'], input[type='email'], input[type='tel'], input[type='number']").all())
  ];
  for (const field of fields) {
    try {
      if ((await field.inputValue()) !== "") continue;
      const nearbyText = await readNearbyText(field);
      const answer = findConfiguredAnswer(nearbyText, answers) || buildAiAnswer(nearbyText, config);
      if (answer) await field.fill(String(answer));
    } catch {
      continue;
    }
  }
}

async function answerRadioAndCheckboxQuestions(page, config) {
  const controls = await page.locator("input[type='radio'], input[type='checkbox']").all();
  for (const control of controls) {
    try {
      if (await control.isChecked()) continue;
      const nearbyText = await readNearbyText(control);
      const answer = String(findConfiguredAnswer(nearbyText, config.answers || {}) || buildAiAnswer(nearbyText, config));
      if (!answer.match(/yes|true|agree|authorized|eligible|immediate|open/i)) continue;
      await control.check({ force: true });
    } catch {
      continue;
    }
  }
}

async function answerSelectQuestions(page, config) {
  const selects = await page.locator("select").all();
  for (const select of selects) {
    try {
      const current = await select.inputValue();
      if (current) continue;
      const nearbyText = await readNearbyText(select);
      const answer = String(findConfiguredAnswer(nearbyText, config.answers || {}) || buildAiAnswer(nearbyText, config));
      await select.selectOption({ label: answer }).catch(async () => {
        await select.selectOption(answer);
      });
    } catch {
      continue;
    }
  }
}

async function readNearbyText(locator) {
  return locator
    .locator("xpath=ancestor::*[self::label or self::fieldset or self::div or self::section][1]")
    .innerText()
    .catch(() => "");
}

function findConfiguredAnswer(questionText, answers) {
  const normalized = questionText.toLowerCase();
  const exact = Object.entries(answers).find(([question]) => normalized.includes(question.toLowerCase()));
  if (exact) return exact[1];
  return null;
}

function buildAiAnswer(questionText, config) {
  const text = questionText.toLowerCase();
  const strategy = config.answerStrategy || {};
  const answers = config.answers || {};
  const resume = strategy.resumeSource || readExistingFile(config.files?.resumePath);
  const persona = strategy.persona || config.candidate?.name || "Devendra";
  const skills = summarizeResume(resume);

  if (text.match(/why.*hire|why.*you|why.*fit|why.*suitable/)) {
    return limitWords(`As ${persona}, I bring practical experience that matches this role: ${skills}. I focus on reliable delivery, clear communication, and measurable product outcomes. I can contribute quickly while staying honest about scope and learning what the team needs.`, strategy.limitWords);
  }

  if (text.match(/react|frontend|front-end|javascript|typescript/)) {
    return limitWords(`As ${persona}, my frontend experience includes React, JavaScript, TypeScript, component-driven UI, forms, API integration, accessibility, testing, and performance improvements. I have built user-facing product workflows and improved quality through reusable patterns.`, strategy.limitWords);
  }

  if (text.match(/notice/)) return answers["Notice period"] || strategy.defaultNoticePeriod || "Immediate / negotiable";
  if (text.match(/current.*salary|current.*ctc/)) return answers["Current salary"] || strategy.currentSalary || "Prefer not to disclose";
  if (text.match(/expected.*salary|expected.*ctc|salary expectation/)) return answers["Expected salary"] || strategy.expectedSalary || "Competitive / open to market range";
  if (text.match(/authorized|eligible|sponsorship|work authorization/)) return answers["Work authorization"] || "Yes";

  return limitWords(`As ${persona}, I would answer based on my resume: ${skills}. I prefer accurate, role-specific answers and can provide more detail during interviews.`, strategy.limitWords);
}

function summarizeResume(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/[.!?]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(". ");
}

function readExistingFile(path) {
  try {
    const resolved = resolve(path || "");
    return existsSync(resolved) ? readFileSync(resolved, "utf8") : "";
  } catch {
    return "";
  }
}

function limitWords(value, limit = 150) {
  const words = String(value).split(/\s+/).filter(Boolean);
  return words.slice(0, Number(limit) || 150).join(" ");
}

function firstName(value) {
  return String(value || "").trim().split(/\s+/)[0] || "";
}

function lastName(value) {
  const parts = String(value || "").trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
}

async function saveArtifacts(page, lines) {
  const artifactsDir = resolve("automation/artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  await page.screenshot({ path: resolve(artifactsDir, "last-run.png"), fullPage: true }).catch(() => {});
  writeFileSync(resolve(artifactsDir, "last-run.txt"), `${lines.join("\n")}\n`, "utf8");
  console.log(lines.join("\n"));
}

function normalizeLabel(value) {
  return String(value).replace(/[^a-z0-9]+/gi, " ").trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssContains(value) {
  return normalizeLabel(value).split(" ")[0] || value;
}
