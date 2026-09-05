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
    mkdirSync(join(location, ".codex"));
    const originalConfig = "# Keep my settings\nmodel = 'my-model'\n\n[mcp_servers.other]\ncommand = 'keep'\n";
    writeFileSync(join(location, ".codex/config.toml"), originalConfig);
    await form.getByLabel(T("proj.form.name"), { exact: true }).fill(`Claude + Codex (${locale})`);
    await form.getByPlaceholder(T("proj.form.locationPlaceholder"), { exact: true }).fill(location);
    await group("claude").getByRole("radio", { name: "한국어", exact: true }).click();
    await group("agents").getByRole("radio", { name: "English", exact: true }).click();
    const withClaude = locale === "en";
    await form.locator('[aria-labelledby="mcp-json-label"]').getByRole("radio", { name: T(withClaude ? "proj.form.mcpJsonOn" : "proj.form.mcpJsonOff"), exact: true }).click();
    await form.locator('[aria-labelledby="codex-mcp-label"]').getByRole("radio", { name: T("proj.form.mcpJsonOn"), exact: true }).click();
    await form.getByPlaceholder("codex", { exact: true }).fill("codex-ui");
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
      assert.equal(existsSync(join(location, ".mcp.json")), withClaude);
      const config = read(location, ".codex/config.toml");
      assert(config.startsWith(originalConfig));
      assert(config.includes('"codex-ui"'));
    });

    // Remove only the scratch file, then use the existing-project menu to create it.
    rmSync(join(location, "AGENTS.md"));
    await page.goto(`${origin}/projects`);
    const row = page.locator(".project-row").filter({ hasText: project.name });
    const focusedItem = () => page.evaluate(() => document.activeElement?.getAttribute("data-item"));
    await row.click({ button: "right" });
    const rootMenu = page.locator('.ctx-menu:not(.ctx-submenu)');
    assert.deepEqual(await rootMenu.locator('.ctx-item').evaluateAll(items => items.map(el => el.dataset.item)),
      ['open', 'work', 'bugs', 'notes', 'copy-path', 'instructions', 'mcp', 'delete']);
    await page.locator('.ctx-item[data-item="instructions"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await focusedItem(), 'claude-md');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focusedItem(), 'agents-md');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await focusedItem(), 'instructions');
    assert.equal(await page.locator('.ctx-submenu').count(), 0);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await focusedItem(), 'mcp-json');
    await page.keyboard.press('End');
    assert.equal(await focusedItem(), 'codex-mcp');
    await page.keyboard.press('Escape');
    assert.equal(await focusedItem(), 'mcp');
    assert.equal(await rootMenu.count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await rootMenu.count(), 0);
    assert(await row.evaluate(el => el === document.activeElement || el.contains(document.activeElement)));
    checks++;
    console.log(`  ok ${locale} grouped menu: arrows, Enter, two-step Escape and focus restoration`);

    // Place the real menu at each viewport edge; both levels must stay readable.
    await page.setViewportSize({ width: 960, height: 620 });
    // Resizing dismisses menus by design; let that event finish before opening one.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    for (const x of [12, 948]) {
      await row.evaluate((el, clientX) => el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, clientX, clientY: 608,
      })), x);
      await page.locator('.ctx-item[data-item="mcp"]').click();
      const boxes = await page.locator('.ctx-menu').evaluateAll(menus => menus.map(el => {
        const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }));
      assert.equal(boxes.length, 2);
      assert(boxes.every(r => r.left >= 0 && r.top >= 0 && r.right <= 960 && r.bottom <= 620));
      assert(boxes[0].top > 200, 'the mouse event must actually anchor near the bottom');
      if (x > 480) {
        assert(boxes[0].left > 400, 'the root menu must be near the right edge');
        assert(boxes[1].right <= boxes[0].left + 8, 'the submenu must flip to the left');
      } else {
        assert(boxes[1].left >= boxes[0].right - 8, 'the submenu must open to the right');
      }
      const clipped = await page.locator('.ctx-submenu .ctx-label, .ctx-submenu .ctx-hint').evaluateAll(els => els.some(el => el.scrollWidth > el.clientWidth));
      assert(!clipped, `${locale}: a submenu label is clipped`);
      await page.screenshot({ path: join(shots, `${locale}-menu-${x}.png`) });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
    checks++;
    console.log(`  ok ${locale} submenus stay inside both bottom corners without clipped labels`);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const writeFromMenu = async () => {
      await row.click({ button: "right" });
      await page.locator('.ctx-item[data-item="instructions"]').click();
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
    for (const [item, filename, author] of [["mcp-json", ".mcp.json", "claude"], ["codex-mcp", ".codex/config.toml", "codex"]]) {
      // Exercise the create path and then the repeat path through real UI requests.
      if (existsSync(join(location, filename))) rmSync(join(location, filename));
      const addMcp = async () => {
        await row.click({ button: "right" });
        await page.locator('.ctx-item[data-item="mcp"]').click();
        const menuItem = page.locator(`.ctx-item[data-item="${item}"]`);
        assert.equal(await menuItem.locator('.ctx-label').textContent(), author === 'claude' ? 'Claude' : 'Codex');
        const pending = page.waitForResponse(r => r.url().endsWith(`/projects/${project.id}/${item}`) && r.request().method() === "POST");
        await menuItem.click();
        const result = await pending;
        assert(result.ok(), await result.text());
        return result.json();
      };
      const first = await addMcp();
      const before = read(location, filename);
      const again = await addMcp();
      check(`${locale} menu adds ${author} MCP and preserves the file on repeat`, () => {
        assert.equal(first.outcome, "created");
        assert.equal(again.outcome, "already_present");
        assert.equal(read(location, filename), before);
        assert(before.includes(`"${author}"`));
      });
    }
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
