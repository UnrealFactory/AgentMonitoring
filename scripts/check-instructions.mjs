#!/usr/bin/env node
// Exercise real file writes through the CLI, project form and existing-project menu.
// Every created project and registry entry stays under one disposable directory.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { chromium } from "playwright";
import { repoRoot, startServer, stopServer, waitForServer } from "./dev-server.mjs";
import { t, useLocale } from "./i18n.mjs";

const scratch = mkdtempSync(join(tmpdir(), "agentmon-instructions-"));
const binary = resolve(process.env.AGENTMON_BIN || join(repoRoot, "target", "release",
  process.platform === "win32" ? "agentmon.exe" : "agentmon"));
const env = { ...process.env, AGENTMON_REGISTRY_DIR: join(scratch, "registry"), AGENTMON_DIR: "" };
const port = Number(process.env.INSTRUCTIONS_PORT || 5218);
const origin = `http://localhost:${port}`;
const shots = join(repoRoot, ".critic-tmp", "instructions");
const template = (lang) => readFileSync(join(repoRoot, "crates", "agentmon-core", "templates", `claude-md.${lang}.md`), "utf8");
const read = (dir, name) => readFileSync(join(dir, name), "utf8");
let server;
let browser;
let checks = 0;
function check(name, run) {
  run();
  checks++;
  console.log(`  ok ${name}`);
}
function cli(args, expected = 0) {
  const result = spawnSync(binary, ["--json", ...args], { env, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, expected, result.stderr || result.error?.message);
  return expected === 0 ? JSON.parse(result.stdout) : result.stderr + result.stdout;
}
function init(name, ...flags) {
  const dir = join(scratch, name);
  cli(["init", "--dir", dir, "--name", name, ...flags]);
  return dir;
}

try {
  const none = init("no instructions");
  check("init without options leaves both instruction files absent", () => {
    assert(!existsSync(join(none, "CLAUDE.md")));
    assert(!existsSync(join(none, "AGENTS.md")));
  });
  const onlyAgents = init("Codex only", "--agents-md", "en");
  check("AGENTS.md alone uses the requested language", () => {
    assert.equal(read(onlyAgents, "AGENTS.md"), template("en"));
    assert(!existsSync(join(onlyAgents, "CLAUDE.md")));
  });
  const onlyClaude = init("Claude only", "--claude-md", "ko");
  check("existing CLAUDE.md-only option remains independent", () => {
    assert.equal(read(onlyClaude, "CLAUDE.md"), template("ko"));
    assert(!existsSync(join(onlyClaude, "AGENTS.md")));
  });
  const both = init("Both agents", "--claude-md", "ko", "--agents-md", "en");
  check("both flags create independent files with independent languages", () => {
    assert.equal(read(both, "CLAUDE.md"), template("ko"));
    assert.equal(read(both, "AGENTS.md"), template("en"));
  });
  const invalid = join(scratch, "invalid language");
  const error = cli(["init", "--dir", invalid, "--name", "Invalid", "--claude-md", "ko", "--agents-md", "kr"], 2);
  check("invalid AGENTS language is rejected before creating the project", () => {
    assert.match(error, /--agents-md/);
    assert(!existsSync(join(invalid, "AgentMonitoring")));
    assert(!existsSync(join(invalid, "CLAUDE.md")));
  });
  for (const filename of ["CLAUDE.md", "AGENTS.md"]) {
    const command = filename === "CLAUDE.md" ? "claude-md" : "agents-md";
    const original = "# User rules\r\n\r\nKeep these instructions exactly.\r\n";
    writeFileSync(join(none, filename), original);
    const added = cli(["--dir", none, "project", command, "--lang", "en"]);
    const content = read(none, filename);
    const skipped = cli(["--dir", none, "project", command, "--lang", "ko"]);
    check(`${filename} preserves user content and skips repeats across languages`, () => {
      assert.equal(added.outcome, "appended");
      assert.equal(resolve(added.path), join(none, filename));
      assert(content.startsWith(original));
      assert(content.endsWith(template("en")));
      assert.equal(skipped.outcome, "already_present");
      assert.equal(read(none, filename), content);
    });
  }

  server = startServer(port, { env: { ...env, AGENTMON_DIRS: none, AGENTMON_BIN: binary } });
  await waitForServer(server, origin);
  browser = await chromium.launch();
  mkdirSync(shots, { recursive: true });
  for (const locale of ["ko", "en"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    await useLocale(page, locale);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const T = (key) => t(locale, key);
    await page.goto(`${origin}/projects`);
    await page.getByRole("button", { name: T("proj.new"), exact: true }).click();
    const form = page.locator(".create-panel");
    const group = (kind) => form.locator(`[role="radiogroup"][aria-labelledby="${kind}-md-label"]`);
    for (const kind of ["claude", "agents"]) {
      assert.equal(await group(kind).locator('[aria-checked="true"]').textContent(), T("proj.form.instructionMdNone"));
    }
    const location = join(scratch, `UI ${locale}`);
    mkdirSync(location);
    const existing = "# Team conventions\n\nPreserve our review rules.\n";
    writeFileSync(join(location, "AGENTS.md"), existing);
    await form.getByLabel(T("proj.form.name"), { exact: true }).fill(`Claude + Codex (${locale})`);
    await form.getByPlaceholder(T("proj.form.locationPlaceholder"), { exact: true }).fill(location);
    await group("claude").getByRole("radio", { name: "한국어", exact: true }).click();
    await group("agents").getByRole("radio", { name: "English", exact: true }).click();
    await form.locator('[aria-labelledby="mcp-json-label"]').getByRole("radio", { name: T("proj.form.mcpJsonOff"), exact: true }).click();
    for (const width of [960, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      const overflow = await form.evaluate((el) => el.scrollWidth > el.clientWidth);
      assert(!overflow, `${locale} form overflows at ${width}px`);
      await form.screenshot({ path: join(shots, `${locale}-${width}.png`) });
    }
    const createdResponse = page.waitForResponse((r) => r.url().endsWith("/project-api/projects") && r.request().method() === "POST");
    await form.getByRole("button", { name: T("proj.create"), exact: true }).click();
    const response = await createdResponse;
    assert(response.ok(), await response.text());
    const project = await response.json();
    check(`${locale} form creates both files and preserves existing AGENTS.md`, () => {
      assert.equal(read(location, "CLAUDE.md"), template("ko"));
      assert(read(location, "AGENTS.md").startsWith(existing));
      assert(read(location, "AGENTS.md").endsWith(template("en")));
      assert(!existsSync(join(location, ".mcp.json")));
    });

    // Remove only the scratch file, then use the existing-project menu to create it.
    rmSync(join(location, "AGENTS.md"));
    await page.goto(`${origin}/projects`);
    const row = page.locator(".project-row").filter({ hasText: project.name });
    const writeFromMenu = async () => {
      await row.click({ button: "right" });
      const written = page.waitForResponse((r) => r.url().endsWith(`/projects/${project.id}/agents-md`) && r.request().method() === "POST");
      await page.locator('.ctx-item[data-item="agents-md"]').click();
      const result = await written;
      assert(result.ok(), await result.text());
      return result.json();
    };
    const created = await writeFromMenu();
    const repeated = await writeFromMenu();
    check(`${locale} project menu creates AGENTS.md in the app language and skips repeats`, () => {
      assert.equal(created.outcome, "created");
      assert.equal(repeated.outcome, "already_present");
      assert.equal(read(location, "AGENTS.md"), template(locale));
      assert.equal(read(location, "CLAUDE.md"), template("ko"));
      assert.deepEqual(pageErrors, []);
    });
    await page.close();
  }
  console.log(`[check:instructions] ${checks} checks passed; screenshots: ${shots}`);
} finally {
  await browser?.close();
  await stopServer(server);
  // Verify the resolved recursive-delete target is still under the OS temp directory.
  const withinTemp = relative(resolve(tmpdir()), resolve(scratch));
  assert(withinTemp && !withinTemp.startsWith("..") && !isAbsolute(withinTemp));
  rmSync(scratch, { recursive: true, force: true });
}
