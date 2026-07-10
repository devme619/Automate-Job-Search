import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const storageKey = "job-application-agent-state-v2";
const today = () => new Date().toISOString().slice(0, 10);

const roleTemplates = [
  {
    id: crypto.randomUUID(),
    title: "Frontend Engineer",
    cvFile: "",
    cvText:
      "Frontend engineer with React, TypeScript, accessibility, testing, API integration, and performance optimization experience.",
    summary:
      "I build accessible, fast product experiences with React, TypeScript, and design-system thinking.",
    coverLetter:
      "I am excited to apply because my frontend background maps closely to product engineering, UX quality, and reliable delivery.",
    salaryExpectation: "Competitive / open to market range",
    yearsExperience: "4",
    skills:
      "React, TypeScript, JavaScript, HTML, CSS, Accessibility, Testing, API integration, Performance",
    achievements:
      "Improved checkout conversion by 12% by rebuilding forms and validation.\nReduced dashboard load time by 38% through bundle splitting and API caching.\nLed component library adoption across 4 product teams.",
    jobPostings: "",
    platforms: [
      {
        id: crypto.randomUUID(),
        name: "LinkedIn",
        url: "https://www.linkedin.com/jobs/search/?keywords=Frontend%20Engineer",
        enabled: true,
      },
    ],
  },
];

const starterState = {
  candidate: {
    name: "Your Name",
    email: "you@example.com",
    phone: "",
    location: "Remote / Hybrid",
    links:
      "LinkedIn: https://linkedin.com/in/your-profile\nPortfolio: https://your-site.com",
  },
  roles: roleTemplates,
  selectedRoleId: roleTemplates[0].id,
  discoveredJobs: [],
  tracker: [],
};

const stopWords = new Set([
  "and",
  "the",
  "for",
  "with",
  "you",
  "our",
  "are",
  "will",
  "that",
  "this",
  "from",
  "your",
  "have",
  "has",
  "into",
  "about",
  "work",
  "team",
  "role",
  "job",
  "looking",
  "experience",
  "candidate",
  "company",
]);

function loadState() {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : starterState;
  } catch {
    return starterState;
  }
}

function tokenize(text) {
  return [
    ...new Set(
      String(text)
        .toLowerCase()
        .match(/[a-z][a-z+#.-]{2,}/g) || [],
    ),
  ]
    .filter((word) => !stopWords.has(word))
    .slice(0, 120);
}

function scoreMatch(role, job) {
  const jobTerms = tokenize(`${job.title} ${job.description}`);
  const roleTerms = new Set(
    tokenize(
      `${role.title} ${role.cvText} ${role.summary} ${role.skills} ${role.achievements}`,
    ),
  );
  const matched = jobTerms.filter((term) => roleTerms.has(term));
  const missing = jobTerms.filter((term) => !roleTerms.has(term)).slice(0, 10);
  const score = jobTerms.length
    ? Math.round((matched.length / jobTerms.length) * 100)
    : 0;
  return { score, matched: matched.slice(0, 14), missing };
}

function lines(text) {
  return String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function platformKind(name, url) {
  const source = `${name} ${url}`.toLowerCase();
  if (source.includes("linkedin")) return "linkedin";
  if (source.includes("wellfound") || source.includes("angel"))
    return "wellfound";
  if (source.includes("indeed")) return "indeed";
  if (source.includes("naukri")) return "naukri";
  return "generic";
}

function parseImportedJobs(role) {
  return lines(role.jobPostings || "")
    .filter((line) => line.includes("linkedin.com/jobs"))
    .map((line, index) => {
      const [
        url,
        company = "Imported Company",
        title = role.title,
        location = "Not listed",
      ] = line.split("|").map((part) => part.trim());
      return {
        id: crypto.randomUUID(),
        roleId: role.id,
        platform:
          platformKind("", url) === "linkedin" ? "LinkedIn" : "Imported",
        company,
        title,
        url,
        location,
        salary: role.salaryExpectation || "Not listed",
        description: `${company} is hiring for ${title}. Imported from an exact job posting URL, so the apply flow opens the specific role instead of the platform home page.`,
        discoveredAt: today(),
        sourceIndex: index,
      };
    });
}

function buildTailoredResume(role, job, match) {
  const focus = match.matched.slice(0, 5).join(", ") || role.title;
  const achievements = lines(role.achievements);
  const bullets = achievements.map((achievement) => {
    const clean = achievement.replace(/\.$/, "");
    return `- ${clean}. Relevant to ${job.company}'s focus on ${focus}.`;
  });

  return `${role.title} resume focus for ${job.company}

Profile summary:
${role.summary}

Selected skills:
${role.skills}

Tailored bullets:
${bullets.join("\n")}

Realism check:
Only use bullets that reflect your actual experience. Add exact tools, dates, or metrics only when you can defend them in an interview.`;
}

function buildTailoredCoverLetter(candidate, role, job, match) {
  const strength =
    match.matched.slice(0, 6).join(", ") ||
    role.skills.split(",").slice(0, 4).join(", ");
  const proof = lines(role.achievements)[0] || role.summary;
  return `Hi ${job.company} team,

I am interested in the ${job.title} opening I found on ${job.platform}. My background as a ${role.title} maps well to your needs around ${strength}.

One example of the way I work: ${proof.replace(/\.$/, "")}. I try to keep my applications grounded in real work, so I would rather show a few strong examples than overstate fit.

Salary expectation: ${role.salaryExpectation}
Years of experience: ${role.yearsExperience}

Best,
${candidate.name}
${candidate.email}`;
}

function buildApplicationPacket(candidate, role, job) {
  const match = scoreMatch(role, job);
  return {
    match,
    resume: buildTailoredResume(role, job, match),
    coverLetter: buildTailoredCoverLetter(candidate, role, job, match),
    checklist: [
      "Open job posting",
      "Review tailored resume for truthfulness",
      "Attach CV or paste resume text",
      "Paste cover letter if requested",
      "Confirm salary and experience fields",
      "Submit on the employer site",
    ],
  };
}

function buildAutomationConfig(candidate, role, job, automation) {
  let answers = {};
  try {
    answers = JSON.parse(automation.extraAnswers || "{}");
  } catch {
    answers = {
      "Fix extra answers JSON": "The extra answers field must be valid JSON.",
    };
  }

  return {
    url: job.url,
    submit: false,
    candidate: {
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      location: candidate.location,
    },
    files: {
      resumePath: automation.resumePath,
      coverLetterPath: automation.coverLetterPath,
    },
    answerStrategy: {
      persona: candidate.name || "Devendra",
      limitWords: 150,
      useResume: true,
      resumeSource: role.cvText,
      coverLetterSource: role.coverLetter,
      defaultNoticePeriod: automation.noticePeriod,
      currentSalary: automation.currentSalary,
      expectedSalary: role.salaryExpectation,
    },
    answers: {
      "Years of experience": role.yearsExperience,
      "Salary expectation": role.salaryExpectation,
      "Expected salary": role.salaryExpectation,
      "Current salary": automation.currentSalary,
      "Notice period": automation.noticePeriod,
      "Why should we hire you": `As ${candidate.name || "Devendra"}, I bring ${role.yearsExperience} years of ${role.title} experience across ${role.skills}. ${lines(role.achievements)[0] || role.summary}`,
      "Describe React experience": `${role.summary} My React experience includes ${role.skills}.`,
      ...answers,
    },
  };
}

function Field({
  label,
  value,
  onChange,
  textarea = false,
  rows = 4,
  type = "text",
  placeholder = "",
}) {
  const Input = textarea ? "textarea" : "input";
  return (
    <label className="field">
      <span>{label}</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        type={type}
        placeholder={placeholder}
      />
    </label>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return (
    <button className="ghost" onClick={copy} type="button">
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function App() {
  const [state, setState] = useState(loadState);
  const [isRoleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState(state.selectedRoleId);
  const [activeJobId, setActiveJobId] = useState(null);
  const [automation, setAutomation] = useState({
    resumePath: "C:/Users/devme/Documents/resume.pdf",
    coverLetterPath: "C:/Users/devme/Documents/cover-letter.pdf",
    noticePeriod: "Immediate / negotiable",
    currentSalary: "Prefer not to disclose",
    extraAnswers:
      '{\n  "Work authorization": "Yes",\n  "Why are you interested": "The role maps closely to my experience and product engineering interests."\n}',
  });
  const [agentMessage, setAgentMessage] = useState("");
  const { candidate, roles, selectedRoleId, discoveredJobs, tracker } = state;
  const selectedRole =
    roles.find((role) => role.id === selectedRoleId) || roles[0];
  const activeJob =
    discoveredJobs.find((job) => job.id === activeJobId) || discoveredJobs[0];
  const packet =
    activeJob && selectedRole
      ? buildApplicationPacket(candidate, selectedRole, activeJob)
      : null;
  const relevantJobs = useMemo(
    () => discoveredJobs.filter((job) => job.roleId === selectedRole?.id),
    [discoveredJobs, selectedRole],
  );

  function saveWorkspace() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function updateCandidate(key, value) {
    setState((current) => ({
      ...current,
      candidate: { ...current.candidate, [key]: value },
    }));
  }

  function updateRole(roleId, key, value) {
    setState((current) => ({
      ...current,
      roles: current.roles.map((role) =>
        role.id === roleId ? { ...role, [key]: value } : role,
      ),
    }));
  }

  function addRole() {
    const newRole = {
      ...roleTemplates[0],
      id: crypto.randomUUID(),
      title: "New Role",
      cvFile: "",
      platforms: [],
    };
    setState((current) => ({
      ...current,
      roles: [newRole, ...current.roles],
      selectedRoleId: newRole.id,
    }));
    setEditingRoleId(newRole.id);
    setRoleModalOpen(true);
  }

  function addPlatform(roleId) {
    setState((current) => ({
      ...current,
      roles: current.roles.map((role) =>
        role.id === roleId
          ? {
              ...role,
              platforms: [
                ...role.platforms,
                {
                  id: crypto.randomUUID(),
                  name: "LinkedIn",
                  url: "https://www.linkedin.com/jobs/search/",
                  enabled: true,
                },
              ],
            }
          : role,
      ),
    }));
  }

  function updatePlatform(roleId, platformId, key, value) {
    setState((current) => ({
      ...current,
      roles: current.roles.map((role) =>
        role.id === roleId
          ? {
              ...role,
              platforms: role.platforms.map((platform) =>
                platform.id === platformId
                  ? { ...platform, [key]: value }
                  : platform,
              ),
            }
          : role,
      ),
    }));
  }

  function scanJobs() {
    const jobs = parseImportedJobs(selectedRole);
    if (jobs.length === 0) {
      setAgentMessage(
        "No LinkedIn jobs imported yet. Run the local LinkedIn agent, or paste LinkedIn job results in role setup.",
      );
      window.setTimeout(() => setAgentMessage(""), 5200);
      return;
    }
    setState((current) => ({
      ...current,
      discoveredJobs: [
        ...jobs,
        ...current.discoveredJobs.filter(
          (job) => job.roleId !== selectedRole.id,
        ),
      ],
    }));
    setActiveJobId(jobs[0]?.id || null);
  }

  function trackJob(job) {
    const item = {
      id: crypto.randomUUID(),
      jobId: job.id,
      roleId: selectedRole.id,
      company: job.company,
      title: job.title,
      platform: job.platform,
      status: "Tailored",
      nextStep: "Review packet and apply",
      updated: today(),
    };
    setState((current) => ({
      ...current,
      tracker: [item, ...current.tracker],
    }));
  }

  function markApplied(job) {
    const item = {
      id: crypto.randomUUID(),
      jobId: job.id,
      roleId: selectedRole.id,
      company: job.company,
      title: job.title,
      platform: job.platform,
      status: "Applied",
      nextStep: "Wait for recruiter response",
      updated: today(),
    };
    setState((current) => ({
      ...current,
      tracker: [item, ...current.tracker],
    }));
  }

  function finalApply(job) {
    markApplied(job);
    setAgentMessage(
      "Queued for the local LinkedIn agent. The agent uses your signed-in browser profile and does not store your LinkedIn password.",
    );
    window.open(job.url, "_blank", "noreferrer");
    window.setTimeout(() => setAgentMessage(""), 5200);
  }

  function updateTracker(id, key, value) {
    setState((current) => ({
      ...current,
      tracker: current.tracker.map((item) =>
        item.id === id ? { ...item, [key]: value, updated: today() } : item,
      ),
    }));
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">Local React agent</p>
          <h1>Job Application Agent</h1>
        </div>
        <div className="actions">
          <button className="ghost" onClick={saveWorkspace} type="button">
            Save
          </button>
          <button
            className="ghost"
            onClick={() => setRoleModalOpen(true)}
            type="button"
          >
            Manage roles
          </button>
          <button onClick={addRole} type="button">
            Add role
          </button>
        </div>
      </header>

      <section className="role-strip">
        {roles.map((role) => (
          <button
            className={
              role.id === selectedRoleId ? "role-chip active" : "role-chip"
            }
            key={role.id}
            onClick={() =>
              setState((current) => ({ ...current, selectedRoleId: role.id }))
            }
            type="button"
          >
            {role.title}
          </button>
        ))}
      </section>

      <section className="dashboard">
        <article className="panel">
          <div className="panel-heading">
            <h2>Candidate Details</h2>
            <p>Used across every role and application packet.</p>
          </div>
          <div className="grid two">
            <Field
              label="Name"
              value={candidate.name}
              onChange={(value) => updateCandidate("name", value)}
            />
            <Field
              label="Email"
              value={candidate.email}
              onChange={(value) => updateCandidate("email", value)}
            />
            <Field
              label="Phone"
              value={candidate.phone}
              onChange={(value) => updateCandidate("phone", value)}
            />
            <Field
              label="Location"
              value={candidate.location}
              onChange={(value) => updateCandidate("location", value)}
            />
          </div>
          <Field
            label="Links"
            textarea
            rows={4}
            value={candidate.links}
            onChange={(value) => updateCandidate("links", value)}
          />
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>{selectedRole.title}</h2>
            <p>
              {selectedRole.yearsExperience} years experience -{" "}
              {selectedRole.salaryExpectation}
            </p>
          </div>
          <div className="role-summary">
            <p>{selectedRole.summary}</p>
            <div className="meta-list">
              <span>{selectedRole.cvFile || "No CV file selected"}</span>
              <span>LinkedIn only</span>
            </div>
          </div>
          <div className="actions align-left">
            <button
              className="ghost"
              onClick={() => {
                setEditingRoleId(selectedRole.id);
                setRoleModalOpen(true);
              }}
              type="button"
            >
              Edit role
            </button>
            <button onClick={scanJobs} type="button">
              Load LinkedIn jobs
            </button>
          </div>
        </article>
      </section>

      <section className="job-workspace">
        <article className="panel jobs-panel">
          <div className="panel-heading">
            <h2>Relevant Openings</h2>
            <p>LinkedIn postings from your local scraping agent.</p>
          </div>
          {agentMessage ? (
            <div className="notice success">{agentMessage}</div>
          ) : null}
          {relevantJobs.length === 0 ? (
            <div className="empty-state">
              <h3>No jobs scraped yet</h3>
              <p>
                Run the local LinkedIn agent, then paste or import its LinkedIn
                job results.
              </p>
            </div>
          ) : (
            <div className="job-list">
              {relevantJobs.map((job) => {
                const match = scoreMatch(selectedRole, job);
                return (
                  <button
                    className={
                      job.id === activeJob?.id ? "job-card active" : "job-card"
                    }
                    key={job.id}
                    onClick={() => setActiveJobId(job.id)}
                    type="button"
                  >
                    <span className="job-title">{job.title}</span>
                    <span>
                      {job.company} - {job.platform}
                    </span>
                    <span>
                      {job.location} - {match.score}% match
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel packet-panel">
          <div className="panel-heading">
            <h2>Tailor And Apply</h2>
            <p>Review the packet before submitting anywhere.</p>
          </div>
          {!packet ? (
            <div className="empty-state">
              <h3>Select a job</h3>
              <p>
                Your tailored resume, cover letter, and apply checklist will
                appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="match-box compact">
                <div
                  className="score"
                  style={{ "--score": `${packet.match.score}%` }}
                >
                  <span>{packet.match.score}</span>
                  <small>% match</small>
                </div>
                <div>
                  <h3>{activeJob.company}</h3>
                  <p>{activeJob.description}</p>
                  <p>
                    Gaps to address:{" "}
                    {packet.match.missing.join(", ") || "No obvious gaps."}
                  </p>
                </div>
              </div>
              <div className="outputs-grid two-output">
                <Draft title="Tailored Resume" text={packet.resume} />
                <Draft title="Cover Letter" text={packet.coverLetter} />
              </div>
              <div className="apply-bar">
                <button
                  className="ghost"
                  onClick={() => trackJob(activeJob)}
                  type="button"
                >
                  Add to tracker
                </button>
                <a
                  className="button-link"
                  href={activeJob.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open exact posting
                </a>
                <button onClick={() => finalApply(activeJob)} type="button">
                  Final Apply
                </button>
              </div>
              {agentMessage ? (
                <div className="notice success">{agentMessage}</div>
              ) : null}
              <AutomationPanel
                automation={automation}
                setAutomation={setAutomation}
              />
            </>
          )}
        </article>
      </section>

      <section className="panel tracker-panel">
        <div className="panel-heading">
          <h2>Application Tracker</h2>
          <p>Pipeline status for all roles.</p>
        </div>
        <div className="tracker-table">
          <div className="tracker-row tracker-head">
            <span>Company</span>
            <span>Role</span>
            <span>Platform</span>
            <span>Status</span>
            <span>Next step</span>
            <span>Updated</span>
          </div>
          {tracker.map((item) => (
            <div className="tracker-row" key={item.id}>
              <input
                value={item.company}
                onChange={(event) =>
                  updateTracker(item.id, "company", event.target.value)
                }
              />
              <input
                value={item.title}
                onChange={(event) =>
                  updateTracker(item.id, "title", event.target.value)
                }
              />
              <input
                value={item.platform}
                onChange={(event) =>
                  updateTracker(item.id, "platform", event.target.value)
                }
              />
              <select
                value={item.status}
                onChange={(event) =>
                  updateTracker(item.id, "status", event.target.value)
                }
              >
                <option>Saved</option>
                <option>Tailored</option>
                <option>Applied</option>
                <option>Screening</option>
                <option>Interviewing</option>
                <option>Offer</option>
                <option>Closed</option>
              </select>
              <input
                value={item.nextStep}
                onChange={(event) =>
                  updateTracker(item.id, "nextStep", event.target.value)
                }
              />
              <span>{item.updated}</span>
            </div>
          ))}
        </div>
      </section>

      {isRoleModalOpen ? (
        <RoleModal
          roles={roles}
          editingRoleId={editingRoleId}
          setEditingRoleId={setEditingRoleId}
          onClose={() => setRoleModalOpen(false)}
          onAddRole={addRole}
          onUpdateRole={updateRole}
          onAddPlatform={addPlatform}
          onUpdatePlatform={updatePlatform}
        />
      ) : null}
    </main>
  );
}

function AutomationPanel({ automation, setAutomation }) {
  function update(key, value) {
    setAutomation((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="automation-panel">
      <div className="automation-heading">
        <div>
          <h2>Application Answers</h2>
          <p>
            The local LinkedIn agent uses these values when it fills Easy Apply
            forms.
          </p>
        </div>
      </div>
      <div className="grid two">
        <Field
          label="Resume file path"
          value={automation.resumePath}
          onChange={(value) => update("resumePath", value)}
          placeholder="C:/Users/devme/Documents/resume.pdf"
        />
        <Field
          label="Cover letter file path"
          value={automation.coverLetterPath}
          onChange={(value) => update("coverLetterPath", value)}
          placeholder="C:/Users/devme/Documents/cover-letter.pdf"
        />
      </div>
      <div className="grid two">
        <Field
          label="Notice period"
          value={automation.noticePeriod}
          onChange={(value) => update("noticePeriod", value)}
          placeholder="Immediate / negotiable"
        />
        <Field
          label="Current salary"
          value={automation.currentSalary}
          onChange={(value) => update("currentSalary", value)}
          placeholder="Prefer not to disclose"
        />
      </div>
      <Field
        label="Extra question answers JSON"
        textarea
        rows={5}
        value={automation.extraAnswers}
        onChange={(value) => update("extraAnswers", value)}
      />
    </section>
  );
}

function RoleModal({
  roles,
  editingRoleId,
  setEditingRoleId,
  onClose,
  onAddRole,
  onUpdateRole,
  onAddPlatform,
  onUpdatePlatform,
}) {
  const role = roles.find((item) => item.id === editingRoleId) || roles[0];

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    onUpdateRole(role.id, "cvFile", file.name);
    if (file.type.startsWith("text/")) {
      const reader = new FileReader();
      reader.onload = () =>
        onUpdateRole(role.id, "cvText", String(reader.result || ""));
      reader.readAsText(file);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Role setup</p>
            <h2>Manage application roles</h2>
          </div>
          <button className="ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="modal-body">
          <aside className="role-nav">
            {roles.map((item) => (
              <button
                className={
                  item.id === role.id ? "role-nav-item active" : "role-nav-item"
                }
                key={item.id}
                onClick={() => setEditingRoleId(item.id)}
                type="button"
              >
                {item.title}
              </button>
            ))}
            <button onClick={onAddRole} type="button">
              Add different role
            </button>
          </aside>

          <section className="role-editor">
            <div className="grid two">
              <Field
                label="Role title"
                value={role.title}
                onChange={(value) => onUpdateRole(role.id, "title", value)}
              />
              <Field
                label="Years of experience"
                value={role.yearsExperience}
                onChange={(value) =>
                  onUpdateRole(role.id, "yearsExperience", value)
                }
              />
            </div>
            <Field
              label="Salary expectation"
              value={role.salaryExpectation}
              onChange={(value) =>
                onUpdateRole(role.id, "salaryExpectation", value)
              }
            />
            <label className="field">
              <span>Upload CV</span>
              <input
                type="file"
                accept=".txt,.pdf,.doc,.docx"
                onChange={handleFile}
              />
            </label>
            <Field
              label="CV text / resume source"
              textarea
              rows={5}
              value={role.cvText}
              onChange={(value) => onUpdateRole(role.id, "cvText", value)}
            />
            <Field
              label="Summary"
              textarea
              rows={3}
              value={role.summary}
              onChange={(value) => onUpdateRole(role.id, "summary", value)}
            />
            <Field
              label="Cover letter base"
              textarea
              rows={4}
              value={role.coverLetter}
              onChange={(value) => onUpdateRole(role.id, "coverLetter", value)}
            />
            <Field
              label="Exact job posting URLs"
              textarea
              rows={4}
              value={role.jobPostings || ""}
              onChange={(value) => onUpdateRole(role.id, "jobPostings", value)}
              placeholder="https://www.linkedin.com/jobs/view/123 | Company | Role title | Remote"
            />
            <Field
              label="Skills"
              textarea
              rows={3}
              value={role.skills}
              onChange={(value) => onUpdateRole(role.id, "skills", value)}
            />
            <Field
              label="Achievements"
              textarea
              rows={5}
              value={role.achievements}
              onChange={(value) => onUpdateRole(role.id, "achievements", value)}
            />

            <div className="platform-heading">
              <h3>LinkedIn searches</h3>
              <button
                className="ghost"
                onClick={() => onAddPlatform(role.id)}
                type="button"
              >
                Add search
              </button>
            </div>
            <div className="platform-list">
              {role.platforms.map((platform) => (
                <div className="platform-row" key={platform.id}>
                  <input
                    value={platform.name}
                    onChange={(event) =>
                      onUpdatePlatform(
                        role.id,
                        platform.id,
                        "name",
                        event.target.value,
                      )
                    }
                    aria-label="LinkedIn search name"
                  />
                  <input
                    value={platform.url}
                    onChange={(event) =>
                      onUpdatePlatform(
                        role.id,
                        platform.id,
                        "url",
                        event.target.value,
                      )
                    }
                    aria-label="LinkedIn search URL"
                  />
                  <label className="toggle">
                    <input
                      checked={platform.enabled}
                      onChange={(event) =>
                        onUpdatePlatform(
                          role.id,
                          platform.id,
                          "enabled",
                          event.target.checked,
                        )
                      }
                      type="checkbox"
                    />
                    Active
                  </label>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Draft({ title, text }) {
  return (
    <article className="draft-block">
      <div className="draft-heading">
        <h2>{title}</h2>
        <CopyButton text={text} />
      </div>
      <pre>{text}</pre>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);
