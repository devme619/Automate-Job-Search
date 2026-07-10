import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// root is the project folder for this agent (one level above `automation`)
const root = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "fetch-config.json");

async function loadConfig() {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return {
      remoteok: true,
      greenhouse: [],
      lever: [],
      workable: [],
      output: "artifacts/jobs.json",
    };
  }
}

function normalize(job) {
  return {
    id: job.id || job.key || job.uuid || String(Math.random()).slice(2, 10),
    company:
      job.company || job.employer || job.organization || job.source || "",
    title: job.title || job.position || job.role || "",
    url: job.url || job.absolute_url || job.apply_url || job.remote_url || "",
    location:
      job.location || job.city || job["location"]?.name || job.cities || "",
    platform: job.platform || job.source || "Imported",
    description: job.description || job.content || job.description_text || "",
    raw: job,
  };
}

function looksOpenToIndia(job) {
  const s = (
    (job.location || "") +
    " " +
    (job.title || "") +
    " " +
    (job.description || "")
  ).toLowerCase();
  const tags = (job.tags || []).map((t) => String(t).toLowerCase());
  if (s.includes("india") || (s.includes("in") && s.match(/\b(in)\b/)))
    return true;
  if (
    s.includes("remote") ||
    s.includes("anywhere") ||
    s.includes("worldwide") ||
    s.includes("global")
  )
    return true;
  if (
    tags.includes("india") ||
    tags.includes("remote") ||
    tags.includes("worldwide") ||
    tags.includes("global")
  )
    return true;
  return false;
}

async function fetchJson(url, opts = {}) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`Failed fetch ${url}: ${err.message}`);
    return null;
  }
}

async function fetchRemoteOK() {
  const url = "https://remoteok.com/api";
  const raw = await fetchJson(url, {
    headers: { "User-Agent": "job-agent-fetcher" },
  });
  if (!raw || !Array.isArray(raw)) return [];
  // RemoteOK returns a header object as first element
  const items = raw
    .filter((r) => r && r.id && r.company)
    .map((r) =>
      normalize({
        id: r.id,
        company: r.company,
        title: r.position || r.title,
        url:
          r.url || (r.slug ? `https://remoteok.com/remote-jobs/${r.slug}` : ""),
        location: r.location || r.countries || r.country || "Remote",
        platform: "RemoteOK",
        description: r.description || r.tags?.join(", ") || "",
        tags: r.tags || [],
      }),
    );
  return items;
}

async function fetchGreenhouse(company) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs`;
  const raw = await fetchJson(url);
  if (!raw) return [];
  const list = Array.isArray(raw.jobs) ? raw.jobs : raw;
  return list.map((j) =>
    normalize({
      id: j.id,
      company: j.metadata?.hiring_team || company,
      title: j.title,
      url:
        j.absolute_url ||
        j.absolute_url ||
        `https://boards.greenhouse.io/${company}/jobs/${j.id}`,
      location: (j.location && j.location.name) || j.location || "",
      platform: "Greenhouse",
      description: j.content || j.metadata?.description || "",
      tags: j.departments ? j.departments.map((d) => d.name) : [],
    }),
  );
}

async function fetchLever(company) {
  const url = `https://api.lever.co/v0/postings/${company}?mode=json`;
  const raw = await fetchJson(url);
  if (!raw) return [];
  return raw.map((j) =>
    normalize({
      id: j.id || j.postingId,
      company: j.hostedOrganization || company,
      title: j.text || j.title,
      url:
        j.hostedUrl ||
        j.applyUrl ||
        j.url ||
        `https://jobs.lever.co/${company}/${j.id || j.postingId}`,
      location:
        (j.categories && (j.categories.location || j.categories.cities)) ||
        j.location ||
        "",
      platform: "Lever",
      description: j.description || j.text || "",
      tags: (j.tags || []).map((t) => t.name || t),
    }),
  );
}

async function fetchWorkable(company) {
  const url = `https://www.workable.com/spi/v3/accounts/${company}/jobs`;
  const raw = await fetchJson(url);
  if (!raw || !raw.length) return [];
  return raw.map((j) =>
    normalize({
      id: j.id,
      company: j.company || company,
      title: j.title,
      url: j.shortlink || j.apply_url || `https://www.workable.com/j/${j.id}`,
      location: j.location || (j.locations && j.locations.join(", ")) || "",
      platform: "Workable",
      description: j.description || j.summary || "",
      tags: j.tags || [],
    }),
  );
}

(async function main() {
  const cfg = await loadConfig();
  const results = [];

  if (cfg.remoteok) {
    console.log("Fetching RemoteOK...");
    const r = await fetchRemoteOK();
    results.push(...r);
  }

  for (const company of cfg.greenhouse || []) {
    console.log(`Fetching Greenhouse for ${company}...`);
    const r = await fetchGreenhouse(company).catch((e) => {
      console.warn(e);
      return [];
    });
    results.push(...r);
  }

  for (const company of cfg.lever || []) {
    console.log(`Fetching Lever for ${company}...`);
    const r = await fetchLever(company).catch((e) => {
      console.warn(e);
      return [];
    });
    results.push(...r);
  }

  for (const company of cfg.workable || []) {
    console.log(`Fetching Workable for ${company}...`);
    const r = await fetchWorkable(company).catch((e) => {
      console.warn(e);
      return [];
    });
    results.push(...r);
  }

  // Normalize and de-duplicate by url
  const normalized = results.map((r) =>
    typeof r === "object" ? r : normalize(r),
  );
  const dedup = [];
  const seen = new Set();
  for (const job of normalized) {
    const url = (job.url || "").trim();
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    if (looksOpenToIndia(job)) dedup.push(job);
  }

  const outPath = path.join(
    root,
    "automation",
    cfg.output || "artifacts/jobs.json",
  );
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(dedup, null, 2), "utf8");
  console.log(`Wrote ${dedup.length} job(s) to ${outPath}`);
})();
