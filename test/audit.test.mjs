import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { audit } from "../skills/recruiter-ready/scripts/audit.mjs";

/** Creates a throwaway repository with the given files, committed. */
function repo(files, { git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rr-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  if (git) {
    run(dir, ["init", "-q", "-b", "main"]);
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-q", "-m", "initial"]);
  }
  return dir;
}
const run = (dir, args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: dir, stdio: "ignore" });
const failed = (result) => result.checks.filter((c) => !c.pass).map((c) => c.id);
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

const GOOD_README = `# Shoplist

Shoplist helps market traders in Lagos track daily sales from their phone, even offline.

**Live demo:** https://shoplist.vercel.app

![Screenshot](docs/screenshot.png)

## How it works

Sales are stored locally and synced when the connection returns.

## Run it

\`\`\`bash
npm install
npm run dev
\`\`\`
`;

const GOOD_REPO = {
  "README.md": GOOD_README,
  "LICENSE": "MIT License",
  "package.json": JSON.stringify({ name: "shoplist", scripts: { test: "vitest run" }, devDependencies: { typescript: "^5" } }),
  "tsconfig.json": "{}",
  ".env.example": "DATABASE_URL=your-database-url",
  "src/db.ts": "export const url = process.env.DATABASE_URL;",
  "src/sales.test.ts": "test('adds sales', () => {});",
  ".github/workflows/ci.yml": "name: CI",
};

test("a well-prepared repository scores 100", () => {
  const result = audit(repo(GOOD_REPO));
  assert.deepEqual(failed(result), []);
  assert.equal(result.score, 100);
  assert.equal(result.facts.commits, 1);
  assert.equal(result.facts.testFiles, 1);
});

test("an empty folder scores low without crashing", () => {
  const result = audit(repo({ "index.js": "console.log(1)" }, { git: false }));
  assert.ok(result.score < 40, `score ${result.score}`);
  assert.ok(failed(result).includes("readme"));
  assert.equal(result.facts.commits, null);
});

test("each missing piece is reported with a fix", () => {
  const files = { ...GOOD_REPO, "README.md": "# Shoplist\n\nshort" };
  delete files["src/sales.test.ts"];
  delete files[".env.example"];
  const result = audit(repo(files));
  const ids = failed(result);
  for (const id of ["readme", "pitch", "live-link", "visual", "run-steps", "decisions", "tests", "env-example"]) assert.ok(ids.includes(id), `expected ${id} to fail`);
  for (const c of result.checks.filter((c) => !c.pass)) assert.ok(c.fix.length > 20, `${c.id} needs a fix`);
});

test("finds secrets in committed files and masks them", () => {
  const fakes = {
    aws: "AKIA" + "IOSFODNN7EXAMPLE",
    github: "ghp_" + "a".repeat(36),
    openai: "sk-proj-" + "b".repeat(40),
    payment: "sk_" + "live_" + "c".repeat(24),
    serviceRole: `${b64({ alg: "HS256" })}.${b64({ role: "service_role", iss: "supabase" })}.${"d".repeat(20)}`,
    anon: `${b64({ alg: "HS256" })}.${b64({ role: "anon", iss: "supabase" })}.${"e".repeat(20)}`,
  };
  const dir = repo({
    ...GOOD_REPO,
    "src/config.ts": Object.entries(fakes).map(([k, v]) => `export const ${k} = "${v}";`).join("\n"),
  });
  const result = audit(dir);
  const kinds = result.secrets.map((s) => s.kind).sort();
  assert.deepEqual(kinds, [
    "AWS access key",
    "GitHub token",
    "Live payment secret key (Stripe/Paystack)",
    "OpenAI API key",
    "Supabase service-role key",
  ]); // the public anon key is not a secret
  for (const s of result.secrets) {
    assert.equal(s.file, "src/config.ts");
    assert.ok(!Object.values(fakes).some((v) => s.value.includes(v)), "values must be masked");
  }
  assert.ok(failed(result).includes("no-secrets"));
});

test("flags committed .env files, including ones deleted later but still in history", () => {
  const dir = repo({ ...GOOD_REPO, ".env": "DATABASE_URL=postgres://real", ".env.local": "TOKEN=abc" });
  run(dir, ["rm", "-q", ".env"]);
  run(dir, ["commit", "-q", "-m", "remove env"]);
  const result = audit(dir);
  assert.deepEqual(result.trackedEnv, [".env.local"]);
  assert.deepEqual(result.envInHistory, [".env"]);
  assert.ok(failed(result).includes("no-secrets"));
});

test("does not flag .env.example or similar templates", () => {
  const result = audit(repo({ ...GOOD_REPO, ".env.sample": "KEY=placeholder" }));
  assert.deepEqual(result.trackedEnv, []);
  assert.ok(!failed(result).includes("no-secrets"));
});

test("reads README files with Windows line endings", () => {
  const result = audit(repo({ ...GOOD_REPO, "README.md": GOOD_README.replace(/\n/g, "\r\n") }));
  assert.ok(!failed(result).includes("run-steps"));
  assert.ok(!failed(result).includes("pitch"));
});

test("flags committed dependencies and build junk", () => {
  const result = audit(repo({ ...GOOD_REPO, "node_modules/left-pad/index.js": "module.exports = 1", ".DS_Store": "x" }));
  assert.ok(failed(result).includes("no-junk"));
});
