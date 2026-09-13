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
const legacyTemplate = (lang) => readFileSync(join(repoRoot, "crates", "agentmon-core", "templates", `claude-md.v1.${lang}.md`), "utf8");
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
    assert(!existsSync(join(none, ".claude")));
    assert(!existsSync(join(none, "AGENTS.md")));
    assert(!existsSync(join(none, ".mcp.json")));
    assert(!existsSync(join(none, ".codex/config.toml")));
  });
  const codexOnly = init("Codex MCP 한글", "--codex-mcp", "--codex-agent", "codex-team");
  check("Codex MCP alone creates the project TOML with the chosen author", () => {
    assert(!existsSync(join(codexOnly, ".mcp.json")));
    const config = read(codexOnly, ".codex/config.toml");
    assert.match(config, /\[mcp_servers\.agentmon\]/);
    assert(config.includes('"codex-team"'));
    assert(config.includes(codexOnly.replaceAll("\\", "/")));
  });
  const bothMcp = init("Both MCP", "--claude-mcp", "--codex-mcp");
  check("both MCP flags register separate clients and default authors", () => {
    assert.equal(JSON.parse(read(bothMcp, ".mcp.json")).mcpServers.agentmon.args.at(-1), "claude");
    assert(read(bothMcp, ".codex/config.toml").includes('"codex"'));
    assert.equal(cli(["--dir", bothMcp, "project", "claude-mcp"]).outcome, "already_present");
    assert.equal(cli(["--dir", bothMcp, "project", "mcp-json"]).outcome, "already_present");
    assert.equal(cli(["--dir", bothMcp, "project", "codex-mcp"]).outcome, "already_present");
  });
  const legacy = init("Legacy MCP", "--mcp-json");
  check("legacy MCP flag still creates only Claude configuration", () => {
    assert(existsSync(join(legacy, ".mcp.json")));
    assert(!existsSync(join(legacy, ".codex/config.toml")));
  });
  const broken = init("Invalid Codex TOML");
  mkdirSync(join(broken, ".codex"));
  writeFileSync(join(broken, ".codex/config.toml"), "[invalid");
  check("CLI rejects broken TOML without overwriting it", () => {
    const result = cli(["--dir", broken, "project", "codex-mcp"], 6);
    assert.match(result, /TOML/);
    assert.equal(read(broken, ".codex/config.toml"), "[invalid");
  });
  const onlyAgents = init("Codex only", "--agents-md", "en");
  check("AGENTS.md alone uses the requested language", () => {
    assert.equal(read(onlyAgents, "AGENTS.md"), template("en"));
    assert(!existsSync(join(onlyAgents, "CLAUDE.md")));
    assert(!existsSync(join(onlyAgents, ".claude")));
  });
  const onlyClaude = init("Claude only", "--claude-md", "ko");
  check("CLAUDE.md-only option writes into .claude/ like Codex's .codex/ and stays independent", () => {
    assert.equal(read(onlyClaude, ".claude/CLAUDE.md"), template("ko"));
    assert(!existsSync(join(onlyClaude, "CLAUDE.md")));
    assert(!existsSync(join(onlyClaude, "AGENTS.md")));
  });
  const both = init("Both agents", "--claude-md", "ko", "--agents-md", "en");
  check("both flags create independent files with independent languages", () => {
    assert.equal(read(both, ".claude/CLAUDE.md"), template("ko"));
    assert.equal(read(both, "AGENTS.md"), template("en"));
  });
  const invalid = join(scratch, "invalid language");
  const error = cli(["init", "--dir", invalid, "--name", "Invalid", "--claude-md", "ko", "--agents-md", "kr"], 2);
  check("invalid AGENTS language is rejected before creating the project", () => {
    assert.match(error, /--agents-md/);
    assert(!existsSync(join(invalid, "AgentMonitoring")));
    assert(!existsSync(join(invalid, "CLAUDE.md")));
    assert(!existsSync(join(invalid, ".claude")));
  });
  for (const filename of [".claude/CLAUDE.md", "AGENTS.md"]) {
    const command = filename.endsWith("CLAUDE.md") ? "claude-md" : "agents-md";
    const original = "# User rules\r\n\r\nKeep these instructions exactly.\r\n";
    mkdirSync(join(none, filename, ".."), { recursive: true });
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
    const suffix = "\n\n# Additional user rules\r\nPreserve these too.\r\n";
    writeFileSync(join(none, filename), original + legacyTemplate("en").trimEnd() + suffix);
    const migrated = cli(["--dir", none, "project", command, "--lang", "ko"]);
    check(`${filename} migrates exact legacy, keeping both surrounding rules and the existing language`, () => {
      assert.equal(migrated.outcome, "updated");
      assert.equal(read(none, filename), original + template("en").trimEnd() + suffix);
    });
    const old = "<!-- agentmon:instructions version=1 lang=ko -->\r\nEarlier managed instructions.\r\n<!-- /agentmon:instructions -->";
    writeFileSync(join(none, filename), original + old + suffix);
    const updated = cli(["--dir", none, "project", command, "--lang", "en"]);
    const refreshed = read(none, filename);
    check(`${filename} refreshes managed text with CRLF and remains idempotent`, () => {
      assert.equal(updated.outcome, "updated");
      assert.equal(refreshed, original + template("ko").replaceAll("\r\n", "\n").trimEnd().replaceAll("\n", "\r\n") + suffix);
      assert.equal(cli(["--dir", none, "project", command, "--lang", "en"]).outcome, "already_present");
      assert.equal(read(none, filename), refreshed);
    });
    for (const unsafe of [legacyTemplate("en").replace("Write every record", "Our special rule: write every record"), template("en").replace("<!-- /agentmon:instructions -->", "")]) {
      writeFileSync(join(none, filename), unsafe);
      const result = cli(["--dir", none, "project", command, "--lang", "ko"], 5);
      check(`${filename} refuses custom legacy or broken markers without altering user text`, () => {
        assert.match(result, /manually merge/);
        assert.equal(read(none, filename), unsafe);
      });
    }
    writeFileSync(join(none, filename), refreshed);
  }

  // A root CLAUDE.md from before .claude/ existed: refreshed where it is, never shadowed by
  // a second copy — Claude Code loads both locations and would read the instructions twice.
  rmSync(join(none, ".claude"), { recursive: true });
  writeFileSync(join(none, "CLAUDE.md"), legacyTemplate("ko"));
  const rootRefreshed = cli(["--dir", none, "project", "claude-md", "--lang", "en"]);
  check("a root CLAUDE.md carrying the section is refreshed in place, keeping its language", () => {
    assert.equal(rootRefreshed.outcome, "updated");
    assert.equal(resolve(rootRefreshed.path), join(none, "CLAUDE.md"));
    assert.equal(read(none, "CLAUDE.md"), template("ko"));
    assert(!existsSync(join(none, ".claude")));
  });
  // A root CLAUDE.md the user owns, without the section: left alone; ours goes to .claude/.
  const userRules = "# Their rules\n\nNo agentmon here.\n";
  writeFileSync(join(none, "CLAUDE.md"), userRules);
  const beside = cli(["--dir", none, "project", "claude-md", "--lang", "ko"]);
  check("a user's root CLAUDE.md stays untouched and the instructions go to .claude/CLAUDE.md", () => {
    assert.equal(beside.outcome, "created");
    assert.equal(resolve(beside.path), join(none, ".claude", "CLAUDE.md"));
    assert.equal(read(none, "CLAUDE.md"), userRules);
    assert.equal(read(none, ".claude/CLAUDE.md"), template("ko"));
  });
  rmSync(join(none, "CLAUDE.md"));

  server = startServer(port, { env: { ...env, AGENTMON_DIRS: none, AGENTMON_BIN: binary } });
  await waitForServer(server, origin);
  browser = await chromium.launch();
  mkdirSync(shots, { recursive: true });
  for (const locale of ["ko"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    await useLocale(page, locale);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const T = (key, ...args) => t(locale, key, ...args);
    await page.goto(`${origin}/projects`);
    await page.getByRole("button", { name: T("proj.new"), exact: true }).click();
    const form = page.locator(".create-panel");
    // One choice for all four agent files, on by default; nothing else to pick.
    const group = form.locator('[role="radiogroup"][aria-labelledby="scaffold-label"]');
    assert.equal(await form.locator('[role="radiogroup"]').count(), 1, "a single choice covers every agent file");
    assert.equal(await group.locator('[aria-checked="true"]').textContent(), T("proj.form.scaffoldOn"));
    assert.equal(await form.locator("input.mcp-agent-input").count(), 0, "no per-client author inputs remain");
    await group.getByRole("radio", { name: T("proj.form.scaffoldOff"), exact: true }).click();
    assert.equal(await group.locator('[aria-checked="true"]').textContent(), T("proj.form.scaffoldOff"));
    await group.getByRole("radio", { name: T("proj.form.scaffoldOn"), exact: true }).click();
    assert.equal(await group.locator('[aria-checked="true"]').textContent(), T("proj.form.scaffoldOn"));
    const location = join(scratch, `UI ${locale}`);
    mkdirSync(location);
    const existing = "# Team conventions\n\nPreserve our review rules.\n";
    writeFileSync(join(location, "AGENTS.md"), existing);
    mkdirSync(join(location, ".codex"));
    const originalConfig = "# Keep my settings\nmodel = 'my-model'\n\n[mcp_servers.other]\ncommand = 'keep'\n";
    writeFileSync(join(location, ".codex/config.toml"), originalConfig);
    await form.getByLabel(T("proj.form.name"), { exact: true }).fill(`Claude + Codex (${locale})`);
    await form.getByPlaceholder(T("proj.form.locationPlaceholder"), { exact: true }).fill(location);
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
    check(`${locale} form on 추가 creates all four files, preserving existing AGENTS.md and Codex settings`, () => {
      assert.equal(read(location, ".claude/CLAUDE.md"), template("ko"));
      assert(!existsSync(join(location, "CLAUDE.md")), "Claude's file lives in .claude/, not the root");
      assert(read(location, "AGENTS.md").startsWith(existing));
      assert(read(location, "AGENTS.md").endsWith(template("ko")));
      assert.equal(JSON.parse(read(location, ".mcp.json")).mcpServers.agentmon.args.at(-1), "claude");
      const config = read(location, ".codex/config.toml");
      assert(config.startsWith(originalConfig));
      assert(config.includes('"codex"'));
    });

    // The other half of the switch: 추가 안 함 writes none of the four.
    const plain = join(scratch, `Plain ${locale}`);
    mkdirSync(plain);
    await page.goto(`${origin}/projects`);
    await page.getByRole("button", { name: T("proj.new"), exact: true }).click();
    await form.getByLabel(T("proj.form.name"), { exact: true }).fill(`Plain (${locale})`);
    await form.getByPlaceholder(T("proj.form.locationPlaceholder"), { exact: true }).fill(plain);
    await group.getByRole("radio", { name: T("proj.form.scaffoldOff"), exact: true }).click();
    const plainResponse = page.waitForResponse((r) => r.url().endsWith("/project-api/projects") && r.request().method() === "POST");
    await form.getByRole("button", { name: T("proj.create"), exact: true }).click();
    assert((await plainResponse).ok());
    check(`${locale} form on 추가 안 함 creates the project and no agent files`, () => {
      assert(existsSync(join(plain, "AgentMonitoring")));
      for (const file of ["CLAUDE.md", ".claude", "AGENTS.md", ".mcp.json", ".codex"]) {
        assert(!existsSync(join(plain, file)), `${file} must not exist`);
      }
    });

    // Remove only the scratch files, then use the existing-project menu to create them.
    rmSync(join(location, "AGENTS.md"));
    rmSync(join(location, ".claude"), { recursive: true });
    await page.goto(`${origin}/projects`);
    const row = page.locator(".project-row").filter({ hasText: project.name });
    const focusedItem = () => page.evaluate(() => document.activeElement?.getAttribute("data-item"));
    await row.click({ button: "right" });
    const rootMenu = page.locator('.ctx-menu:not(.ctx-submenu)');
    assert.deepEqual(await rootMenu.locator('.ctx-item').evaluateAll(items => items.map(el => el.dataset.item)),
      ['open', 'work', 'bugs', 'notes', 'copy-path', 'instructions', 'mcp', 'delete']);
    // Flat: the two items act on their own and name both files in their hint. → on a
    // leaf is a no-op, so nothing opens and the focus stays put.
    assert.equal(await page.locator('.ctx-item[data-item="instructions"] .ctx-hint').textContent(), '.claude/CLAUDE.md · AGENTS.md');
    assert.equal(await page.locator('.ctx-item[data-item="mcp"] .ctx-hint').textContent(), '.mcp.json · .codex/config.toml');
    await page.locator('.ctx-item[data-item="instructions"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await focusedItem(), 'instructions');
    assert.equal(await page.locator('.ctx-submenu').count(), 0);
    await page.keyboard.press('ArrowDown');
    assert.equal(await focusedItem(), 'mcp');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.ctx-submenu').count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await rootMenu.count(), 0);
    assert(await row.evaluate(el => el === document.activeElement || el.contains(document.activeElement)));
    checks++;
    console.log(`  ok ${locale} flat menu: no submenu, hints name both files, Escape restores focus`);

    // The menu near the bottom-right corner must stay inside the viewport with its hints readable.
    await page.setViewportSize({ width: 960, height: 620 });
    // Resizing dismisses menus by design; let that event finish before opening one.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await row.evaluate((el) => el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, clientX: 948, clientY: 608,
    })));
    const box = await rootMenu.evaluate(el => {
      const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    assert(box.left >= 0 && box.top >= 0 && box.right <= 960 && box.bottom <= 620, JSON.stringify(box));
    assert(box.top > 200, 'the mouse event must actually anchor near the bottom');
    const clipped = await rootMenu.locator('.ctx-item[data-item="instructions"] .ctx-label, .ctx-item[data-item="mcp"] .ctx-label')
      .evaluateAll(els => els.some(el => el.scrollWidth > el.clientWidth));
    assert(!clipped, `${locale}: a menu label is clipped`);
    await page.screenshot({ path: join(shots, `${locale}-menu.png`) });
    await page.keyboard.press('Escape');
    checks++;
    console.log(`  ok ${locale} the flat menu stays inside the bottom-right corner without clipped labels`);
    await page.setViewportSize({ width: 1600, height: 1000 });

    // One press, two requests — and one toast that says what happened to each file.
    const pressBoth = async (item, routes, expectedToast) => {
      await row.click({ button: "right" });
      const pending = routes.map((route) => page.waitForResponse((r) => r.url().endsWith(`/projects/${project.id}/${route}`) && r.request().method() === "POST"));
      await page.locator(`.ctx-item[data-item="${item}"]`).click();
      const responses = await Promise.all(pending);
      for (const r of responses) assert(r.ok(), await r.text());
      await page.locator(".toast-text").filter({ hasText: expectedToast }).waitFor({ timeout: 5000 });
      assert.equal(await page.locator(".toast-text").textContent(), expectedToast);
      return Promise.all(responses.map((r) => r.json()));
    };
    const writeFromMenu = (toast) => pressBoth("instructions", ["claude-md", "agents-md"], toast);
    const [createdClaude, createdAgents] = await writeFromMenu(T("menu.scaffoldCreated", "CLAUDE.md·AGENTS.md"));
    const [repeatedClaude, repeatedAgents] = await writeFromMenu(T("menu.scaffoldPresent", "CLAUDE.md·AGENTS.md"));
    check(`${locale} project menu writes both instruction files at once and skips repeats`, () => {
      assert.equal(createdClaude.outcome, "created");
      assert.equal(createdAgents.outcome, "created");
      assert.equal(repeatedClaude.outcome, "already_present");
      assert.equal(repeatedAgents.outcome, "already_present");
      assert.equal(read(location, "AGENTS.md"), template(locale));
      assert.equal(read(location, ".claude/CLAUDE.md"), template("ko"));
      assert(!existsSync(join(location, "CLAUDE.md")));
      assert.deepEqual(pageErrors, []);
    });
    const legacyRules = "# Custom review rules\r\n\r\n";
    writeFileSync(join(location, "AGENTS.md"), legacyRules + legacyTemplate(locale));
    const [heldClaude, refreshedAgents] = await writeFromMenu(`${T("menu.scaffoldPresent", "CLAUDE.md")} · ${T("menu.scaffoldUpdated", "AGENTS.md")}`);
    check(`${locale} project menu upgrades legacy AGENTS.md and reports each file's own outcome`, () => {
      assert.equal(heldClaude.outcome, "already_present");
      assert.equal(refreshedAgents.outcome, "updated");
      assert.equal(read(location, "AGENTS.md"), legacyRules + template(locale));
      assert.deepEqual(pageErrors, []);
    });
    // Both registrations from one item: create, then the repeat path, through real UI requests.
    rmSync(join(location, ".mcp.json"));
    rmSync(join(location, ".codex/config.toml"));
    const addMcp = (toast) => pressBoth("mcp", ["mcp-json", "codex-mcp"], toast);
    const [firstClaude, firstCodex] = await addMcp(T("menu.scaffoldCreated", ".mcp.json·.codex/config.toml"));
    const mcpBefore = read(location, ".mcp.json");
    const codexBefore = read(location, ".codex/config.toml");
    const [againClaude, againCodex] = await addMcp(T("menu.scaffoldPresent", ".mcp.json·.codex/config.toml"));
    check(`${locale} menu registers Claude and Codex MCP at once and preserves both files on repeat`, () => {
      assert.equal(firstClaude.outcome, "created");
      assert.equal(firstCodex.outcome, "created");
      assert.equal(againClaude.outcome, "already_present");
      assert.equal(againCodex.outcome, "already_present");
      assert.equal(read(location, ".mcp.json"), mcpBefore);
      assert.equal(read(location, ".codex/config.toml"), codexBefore);
      assert(mcpBefore.includes('"claude"'));
      assert(codexBefore.includes('"codex"'));
    });
    assert.deepEqual(pageErrors, []);
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
