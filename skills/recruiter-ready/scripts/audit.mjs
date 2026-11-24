#!/usr/bin/env node
// Recruiter-ready audit: checks a repository for what recruiters and hiring managers look for, with evidence.
// No dependencies. Usage: node audit.mjs [repo-path] [--json]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".dart_tool", "vendor", "__pycache__", ".venv", "target"]);
const DEPLOY_HOSTS = /https?:\/\/[^\s)"'>]*(?:vercel\.app|netlify\.app|github\.io|onrender\.com|fly\.dev|railway\.app|pages\.dev|herokuapp\.com|expo\.dev|play\.google\.com|apps\.apple\.com|streamlit\.app|huggingface\.co\/spaces|npmjs\.com\/package|pypi\.org\/project|pub\.dev\/packages|marketplace\.visualstudio\.com|chromewebstore\.google\.com)/i;
const RUN_COMMAND = /```[a-z]*\r?\n[^`]*\b(?:npm|pnpm|yarn|bun|npx|pip|python|flutter|dart|go|cargo|docker|make|gradle|mvn|dotnet)\b/i;
const TEST_FILE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|dart|py)$|(?:^|\/)test_[^/]+\.py$|Tests?\.(?:java|kt|cs|swift)$)/;
const ENV_USE = /\b(?:process\.env|import\.meta\.env|os\.environ|os\.getenv|Deno\.env|dotenv)\b/;
const SOURCE_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go", ".dart", ".rb", ".php", ".java", ".kt", ".cs", ".swift", ".rs"]);
const MAX_SCAN_BYTES = 1_000_000;
const BIG_FILE_BYTES = 5_000_000;

/** Credential formats. Each line reports at most one finding. */
const SECRET_PATTERNS = [
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["Live payment secret key (Stripe/Paystack)", /\bsk_live_[A-Za-z0-9]{20,}\b/],
  ["Test payment secret key (Stripe/Paystack)", /\bsk_test_[A-Za-z0-9]{20,}\b/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
];
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/;

const ENV_FILE = /(?:^|\/)\.env(?:\.[a-z]+)?$/i;
const ENV_TEMPLATE = /\.(?:example|sample|template|dist)$/i;

function git(dir, args) {
  try {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}

/** Files to inspect: what git tracks, or a walk of the folder when it isn't a git repository. */
function listFiles(dir) {
  const tracked = git(dir, ["ls-files"]);
  if (tracked !== null) return tracked.split("\n").filter(Boolean);
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(path);
      } else out.push(path);
    }
  };
  walk("");
  return out;
}

const mask = (value) => `${value.slice(0, 6)}…(${value.length} chars)`;

function scanSecrets(dir, files) {
  const findings = [];
  for (const file of files) {
    if (/(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.lock)$/.test(file)) continue;
    const full = join(dir, file);
    let text;
    try {
      if (statSync(full).size > MAX_SCAN_BYTES) continue;
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue; // binary
    text.split(/\r?\n/).forEach((line, i) => {
      for (const [kind, pattern] of SECRET_PATTERNS) {
        const m = pattern.exec(line);
        if (m) {
          findings.push({ file, line: i + 1, kind, value: mask(m[0]) });
          return;
        }
      }
      const jwt = JWT.exec(line);
      if (jwt) {
        try {
          const payload = JSON.parse(Buffer.from(jwt[1], "base64url").toString("utf8"));
          if (payload?.role === "service_role") findings.push({ file, line: i + 1, kind: "Supabase service-role key", value: mask(jwt[0]) });
        } catch {
          /* not a JWT we can read */
        }
      }
    });
  }
  return findings;
}

export function audit(target = ".") {
  const dir = resolve(target);
  if (!existsSync(dir)) throw new Error(`No such folder: ${dir}`);
  const files = listFiles(dir);
  const isGit = git(dir, ["rev-parse", "--is-inside-work-tree"]) === "true";
  const has = (re) => files.some((f) => re.test(f));
  const read = (file) => {
    try {
      return readFileSync(join(dir, file), "utf8");
    } catch {
      return "";
    }
  };

  const readmeFile = files.find((f) => /^readme(?:\.md|\.markdown|\.rst|\.txt)?$/i.test(f));
  const readme = readmeFile ? read(readmeFile) : "";
  const pkg = files.includes("package.json") ? safeJson(read("package.json")) : null;
  const testFiles = files.filter((f) => TEST_FILE.test(f) || /(?:^|\/)(?:__tests__|tests?)\/.+\.[a-z]+$/.test(f));
  const sourceFiles = files.filter((f) => SOURCE_EXT.has(extname(f)));
  const usesEnv = sourceFiles.slice(0, 2000).some((f) => ENV_USE.test(read(f)));
  const secrets = scanSecrets(dir, files);
  const trackedEnv = files.filter((f) => ENV_FILE.test(f) && !ENV_TEMPLATE.test(f));
  const everAdded = isGit ? (git(dir, ["log", "--all", "--diff-filter=A", "--name-only", "--pretty=format:"]) ?? "") : "";
  const envInHistory = [...new Set(everAdded.split("\n").filter((f) => ENV_FILE.test(f) && !ENV_TEMPLATE.test(f)))].filter((f) => !files.includes(f));
  const junk = files.filter((f) => /(?:^|\/)(?:node_modules|\.next|__pycache__)\/|\.DS_Store$|Thumbs\.db$/.test(f));
  const bigFiles = files.filter((f) => {
    try {
      return statSync(join(dir, f)).size > BIG_FILE_BYTES;
    } catch {
      return false;
    }
  });
  const testScript = pkg?.scripts?.test;
  const defaultTestScript = typeof testScript === "string" && /no test specified/.test(testScript);

  const firstParagraph = readme
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#") && !p.startsWith("![") && !p.startsWith("<") && !p.startsWith("[!["));

  const check = (id, category, weight, label, pass, detail, fix) => ({ id, category, weight, label, pass, detail, fix });
  const checks = [
    check("readme", "First impression", 10, "README explains the project", readme.length >= 300,
      readmeFile ? `${readmeFile}, ${readme.length} characters` : "no README",
      "Add a README: what it does, who it's for, a screenshot, how to run it."),
    check("pitch", "First impression", 5, "Opens with a one-line pitch", Boolean(firstParagraph && firstParagraph.length >= 40),
      firstParagraph ? `"${firstParagraph.slice(0, 90)}${firstParagraph.length > 90 ? "…" : ""}"` : "no opening paragraph",
      "Start the README with one sentence: what it does and for whom."),
    check("live-link", "First impression", 10, "Links to a live demo", DEPLOY_HOSTS.test(readme),
      DEPLOY_HOSTS.exec(readme)?.[0] ?? "no live demo or published package link in the README",
      "Deploy it (Vercel, Netlify, GitHub Pages…) or publish it (npm, PyPI, pub.dev), and put the link at the top of the README."),
    check("visual", "First impression", 5, "Shows a screenshot or GIF", /!\[[^\]]*\]\(|<img\s/i.test(readme),
      /!\[[^\]]*\]\(|<img\s/i.test(readme) ? "image found in README" : "no image in README",
      "Add a screenshot or a 10-second GIF near the top. Recruiters skim; pictures stop the scroll."),
    check("run-steps", "First impression", 5, "Says how to run it", RUN_COMMAND.test(readme),
      RUN_COMMAND.test(readme) ? "run commands found" : "no install/run commands in the README",
      "Add copy-paste steps to install and run it locally."),
    check("tests", "Proof it works", 15, "Has automated tests", testFiles.length > 0,
      `${testFiles.length} test file${testFiles.length === 1 ? "" : "s"}`,
      "Add tests for the core logic. Even 5 good tests show you can prove your code works."),
    check("ci", "Proof it works", 10, "Runs checks automatically (CI)", has(/^\.github\/workflows\/.+\.ya?ml$|^\.gitlab-ci\.yml$|^\.circleci\//),
      has(/^\.github\/workflows\//) ? "GitHub Actions workflow found" : "no CI configuration",
      "Add a GitHub Actions workflow that runs your tests on every push, and a status badge in the README."),
    check("test-script", "Proof it works", 5, "Tests run with one command", !pkg || (Boolean(testScript) && !defaultTestScript),
      !pkg ? "not a Node.js project" : testScript ? `npm test → ${testScript}` : "no \"test\" script in package.json",
      "Add a \"test\" script to package.json so anyone can run `npm test`."),
    check("decisions", "Engineering signals", 10, "Explains design decisions", /^#{1,3}\s*.*(?:decision|trade-?off|architecture|how it works|design|why )/im.test(readme),
      /^#{1,3}\s*.*(?:decision|trade-?off|architecture|how it works|design|why )/im.test(readme) ? "design section found" : "no design or decisions section",
      "Add a \"How it works\" or \"Decisions and trade-offs\" section. It's what interviewers ask about."),
    check("env-example", "Engineering signals", 5, "Documents required settings", !usesEnv || has(/(?:^|\/)\.env\.(?:example|sample|template)$/),
      !usesEnv ? "no environment variables used" : has(/(?:^|\/)\.env\.(?:example|sample|template)$/) ? ".env.example found" : "code reads environment variables but there's no .env.example",
      "Add a .env.example listing every variable with a placeholder value (never real keys)."),
    check("types", "Engineering signals", 5, "Uses a type-checked language", !pkg || files.includes("tsconfig.json") || Boolean(pkg?.devDependencies?.typescript || pkg?.dependencies?.typescript),
      !pkg ? "not a Node.js project" : files.includes("tsconfig.json") ? "TypeScript" : "plain JavaScript",
      "Consider TypeScript; most teams hiring JavaScript developers expect it."),
    check("license", "Hygiene", 5, "Has a licence", has(/^licen[cs]e(?:\.md|\.txt)?$/i), has(/^licen[cs]e/i) ? "licence found" : "no LICENSE file",
      "Add a LICENSE (MIT is common for portfolio projects)."),
    check("no-secrets", "Hygiene", 5, "No secrets committed", secrets.length === 0 && trackedEnv.length === 0 && envInHistory.length === 0,
      secrets.length + trackedEnv.length + envInHistory.length === 0 ? "none found" : `${secrets.length} secret(s), ${trackedEnv.length} tracked .env file(s), ${envInHistory.length} .env file(s) in git history`,
      "Revoke and replace every exposed key now. Deleting the file isn't enough: old commits keep it."),
    check("no-junk", "Hygiene", 5, "No build output or junk committed", junk.length === 0 && bigFiles.length === 0,
      junk.length + bigFiles.length === 0 ? "clean" : [...junk.slice(0, 3), ...bigFiles.slice(0, 3).map((f) => `${f} (over 5 MB)`)].join(", "),
      "Remove generated files (node_modules, build output, .DS_Store) and add them to .gitignore."),
  ];

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const score = Math.round((checks.filter((c) => c.pass).reduce((s, c) => s + c.weight, 0) / total) * 100);

  const extensions = {};
  for (const f of sourceFiles) extensions[extname(f)] = (extensions[extname(f)] ?? 0) + 1;
  const facts = {
    name: pkg?.name ?? basename(dir),
    files: files.length,
    sourceFiles: sourceFiles.length,
    testFiles: testFiles.length,
    topExtensions: Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ext, n]) => `${ext} (${n})`),
    commits: isGit ? Number(git(dir, ["rev-list", "--count", "HEAD"]) ?? 0) : null,
    firstCommit: isGit ? git(dir, ["log", "--reverse", "--format=%as", "--max-parents=0"])?.split("\n")[0] ?? null : null,
    lastCommit: isGit ? git(dir, ["log", "-1", "--format=%as"]) : null,
    contributors: isGit ? (git(dir, ["shortlog", "-sne", "HEAD"]) ?? "").split("\n").filter(Boolean).length : null,
  };

  return { score, checks, facts, secrets, trackedEnv, envInHistory };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function printReport(result) {
  const lines = [`\nRecruiter-ready score: ${result.score}/100\n`];
  const critical = result.secrets.length + result.trackedEnv.length + result.envInHistory.length;
  if (critical > 0) {
    lines.push("⚠ CRITICAL: possible secrets in this repository");
    for (const s of result.secrets) lines.push(`  ${s.file}:${s.line}  ${s.kind}  ${s.value}`);
    for (const f of result.trackedEnv) lines.push(`  ${f}  environment file is committed`);
    for (const f of result.envInHistory) lines.push(`  ${f}  was committed in the past and is still in git history`);
    lines.push("  Revoke and replace these keys now; deleting the file doesn't remove it from history.\n");
  }
  let category = "";
  for (const c of result.checks) {
    if (c.category !== category) lines.push(`${(category = c.category)}`);
    lines.push(`  ${c.pass ? "✓" : "✗"} ${c.label} — ${c.detail}`);
    if (!c.pass) lines.push(`      → ${c.fix}`);
  }
  const f = result.facts;
  lines.push(`\nFacts: ${f.commits ?? "?"} commits (${f.firstCommit ?? "?"} → ${f.lastCommit ?? "?"}), ${f.sourceFiles} source files, ${f.testFiles} test files, mostly ${f.topExtensions.join(", ") || "n/a"}`);
  return lines.join("\n");
}

// realpath: when installed with npm, the command is a symlink to this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--")) ?? ".";
  try {
    const result = audit(target);
    console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : printReport(result));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
