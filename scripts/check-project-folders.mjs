#!/usr/bin/env node
// Real form writes use scratch projects and an isolated registry. Folder organization
// uses disposable browser profiles; the desktop file round-trip is tested in Rust.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { chromium } from "playwright";
import { repoRoot, startServer, stopServer, waitForServer } from "./dev-server.mjs";
import { t, useLocale } from "./i18n.mjs";

const scratch = mkdtempSync(join(tmpdir(), "agentmon-project-folders-"));
const binary = resolve(process.env.AGENTMON_BIN || join(repoRoot, "target", "release", process.platform === "win32" ? "agentmon.exe" : "agentmon"));
const env = { ...process.env, AGENTMON_REGISTRY_DIR: join(scratch, "registry"), AGENTMON_DIR: "" };
const origin = `http://localhost:${process.env.FOLDERS_PORT || 5220}`;
const shots = join(repoRoot, ".critic-tmp", "project-folders");
let server, browser;
let checks = 0;
const checked = (name) => { checks++; console.log(`  ok ${name}`); };

try {
  const projects = ["Alpha", "Beta"].map((name) => {
    const location = join(scratch, name);
    const result = spawnSync(binary, ["--json", "init", "--dir", location, "--name", name], { env, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return location;
  });
  const missing = join(scratch, "offline", "AgentMonitoring");
  server = startServer(Number(new URL(origin).port), { env: { ...env, AGENTMON_BIN: binary, AGENTMON_DIRS: [...projects, missing].join(";") } });
  await waitForServer(server, origin);
  browser = await chromium.launch();
  mkdirSync(shots, { recursive: true });

  for (const locale of ["ko"]) {
    const T = (key, ...args) => t(locale, key, ...args);
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    let page = await context.newPage();
    await useLocale(page, locale);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/projects`);
    await page.getByRole("button", { name: T("proj.new"), exact: true }).click();
    const form = page.locator(".create-panel");
    assert.equal(await form.locator('[aria-labelledby="scaffold-label"] [aria-checked="true"]').textContent(), T("proj.form.scaffoldOn"));
    assert.equal(await form.locator('[role="radiogroup"]').count(), 1, "one choice covers every agent file");
    const location = join(scratch, `Default ${locale}`);
    mkdirSync(location);
    await form.getByLabel(T("proj.form.name"), { exact: true }).fill(`Default ${locale}`);
    await form.getByPlaceholder(T("proj.form.locationPlaceholder"), { exact: true }).fill(location);
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/project-api/projects") && response.request().method() === "POST");
    await form.getByRole("button", { name: T("proj.create"), exact: true }).click();
    const response = await responsePromise;
    assert(response.ok(), await response.text());
    assert.match(readFileSync(join(location, "AGENTS.md"), "utf8"), /lang=ko/);
    assert.match(readFileSync(join(location, ".claude", "CLAUDE.md"), "utf8"), /lang=ko/);
    assert(!existsSync(join(location, "CLAUDE.md")), "Claude's file lives in .claude/, not the root");
    assert.match(readFileSync(join(location, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.agentmon\]/);
    assert.equal(JSON.parse(readFileSync(join(location, ".mcp.json"), "utf8")).mcpServers.agentmon.args.at(-1), "claude");
    checked(`${locale}: unchanged form defaults create both Korean instruction files and both MCP registrations`);
    await page.goto(`${origin}/projects`);

    const heading = () => page.locator(".nav-projects-heading");
    const dialog = () => page.getByRole("dialog");
    const menuAction = async (target, id) => {
      await target.click({ button: "right" });
      await page.locator(`.ctx-item[data-item="${id}"]`).click();
    };
    await heading().waitFor();
    assert.equal(await heading().locator("span").first().textContent(), T("nav.projects"));
    assert.equal(await heading().locator("svg").count(), 0);
    assert.equal(await page.locator('.nav > .nav-item[href="/projects"]').count(), 0);
    assert.equal(await page.locator(".page-head-actions").getByRole("button", { name: T("folder.new"), exact: true }).count(), 0);
    await heading().focus();
    await page.keyboard.press("Shift+F10");
    await page.keyboard.press("Enter");
    await dialog().waitFor();
    assert(await dialog().getByLabel(T("folder.name"), { exact: true }).evaluate((el) => el === document.activeElement));
    await page.keyboard.press("Control+k");
    assert.equal(await page.getByRole("dialog").count(), 1);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      assert(await dialog().evaluate((el) => el.contains(document.activeElement)));
    }
    await page.keyboard.press("Escape");
    assert.equal(await dialog().count(), 0);
    assert(await heading().evaluate((el) => el === document.activeElement));
    checked(`${locale}: one icon-free Projects heading, no toolbar folder button, keyboard menu and dialog focus`);

    const createFolder = async (name) => {
      await menuAction(heading(), "create-folder");
      await dialog().getByLabel(T("folder.name"), { exact: true }).fill(name);
      await dialog().getByRole("button", { name: T("folder.create"), exact: true }).click();
    };
    const section = (name) => page.locator(".project-section").filter({ has: page.locator(".folder-heading", { hasText: name }) });
    const sidebarFolder = (name) => page.locator(".sidebar-folder > summary").filter({ hasText: name });
    const root = () => page.locator('.project-section[data-folder-id=""]');
    const move = async (row, name) => {
      await row.locator(".project-folder-move button[aria-haspopup]").click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    await createFolder("개인");
    await section("개인").waitFor();
    // The sidebar can create and rename folders while a project is open.
    await page.locator('.nav > .nav-sub').filter({ hasText: /^Alpha$/ }).click();
    await createFolder("업무");
    await sidebarFolder("업무").waitFor();
    await menuAction(sidebarFolder("개인"), "rename-folder");
    await dialog().getByLabel(T("folder.name"), { exact: true }).fill("개인 작업");
    await dialog().getByRole("button", { name: T("folder.save"), exact: true }).click();
    await sidebarFolder("개인 작업").waitFor();
    await heading().click();
    await section("업무").waitFor();
    const alpha = () => page.locator(".project-row").filter({ has: page.locator(".project-name", { hasText: /^Alpha$/ }) });
    await move(alpha(), "개인 작업");
    assert.equal(await section("개인 작업").locator(".project-row").count(), 1);
    assert.equal(await page.locator(".sidebar-folder").filter({ hasText: "개인" }).getByRole("link", { name: "Alpha", exact: true }).count(), 1);
    await move(page.locator(".project-row.is-unavailable"), "업무");
    assert.equal(await section("업무").locator(".is-unavailable").count(), 1);
    assert.equal(await root().locator(".folder-heading").count(), 0);
    assert.equal(await page.locator('.nav > .nav-sub').filter({ hasText: /^Beta$/ }).count(), 1);
    assert(!/미분류|Unfiled/.test(await page.locator(".app").innerText()));
    checked(`${locale}: sidebar create/rename from a project page; assigned and loose projects render correctly`);

    const navProject = (name) => page.locator('.nav [data-project-drag-path]').filter({ hasText: new RegExp(`^${name}$`) });
    const beginDrag = async (source, destination, targetY = 0.5) => {
      await source.scrollIntoViewIfNeeded();
      const from = await source.boundingBox();
      assert(from);
      const x = from.x + Math.min(60, from.width / 2), y = from.y + from.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 12, y, { steps: 3 });
      await page.locator(".project-drag-preview").waitFor();
      await destination.scrollIntoViewIfNeeded();
      const to = await destination.boundingBox();
      assert(to);
      await page.mouse.move(to.x + to.width / 2, to.y + to.height * targetY, { steps: 12 });
    };
    const drop = async (source, destination) => {
      const url = page.url();
      await beginDrag(source, destination);
      assert.equal(await page.locator("[data-project-drag-over]").count(), 1);
      await page.mouse.up();
      await page.locator(".project-drag-preview").waitFor({ state: "detached" });
      assert.equal(page.url(), url, "a drag must not navigate to the source project");
    };
    await drop(alpha().locator(".project-name"), sidebarFolder("업무"));
    assert.equal(await section("업무").locator(".project-name", { hasText: /^Alpha$/ }).count(), 1);
    await drop(navProject("Alpha"), heading());
    assert.equal(await root().locator(".project-name", { hasText: /^Alpha$/ }).count(), 1);
    await sidebarFolder("개인 작업").click();
    await drop(navProject("Alpha"), sidebarFolder("개인 작업"));
    assert(await navProject("Alpha").isVisible(), "dropping in a collapsed sidebar folder opens it");
    assert.equal(await section("개인 작업").locator(".project-row").count(), 1);
    await drop(page.locator(".project-row.is-unavailable .project-name"), section("개인 작업").locator(".folder-heading"));
    assert.equal(await section("개인 작업").locator(".is-unavailable").count(), 1);
    await drop(page.locator(".project-row.is-unavailable .project-name"), section("업무").locator(".folder-heading"));
    checked(`${locale}: mouse dragging moves across sidebar/list, out to the root, into collapsed folders and unavailable projects`);

    const folderOrder = () => page.locator(".sidebar-folder > summary .nav-sub-name").allTextContents();
    const reorder = async (source, destination, edge) => {
      const url = page.url();
      await beginDrag(source, destination, edge === "before" ? 0.2 : 0.8);
      assert.equal(await page.locator("[data-folder-order-edge]").getAttribute("data-folder-order-edge"), edge);
      assert.equal(await page.locator("[data-project-drag-over]").count(), 0, "folder ordering must not show a project membership target");
      await page.mouse.up();
      assert.equal(page.url(), url);
      assert.equal(await page.locator(".project-drag-preview, [data-folder-order-edge]").count(), 0);
    };
    const assignments = await page.evaluate(() => JSON.parse(localStorage.getItem("agentmon.projectFolders")).assignments);
    await sidebarFolder("개인 작업").click();
    await reorder(sidebarFolder("개인 작업"), sidebarFolder("업무"), "after");
    assert.deepEqual(await folderOrder(), ["업무", "개인 작업"]);
    assert.equal(await sidebarFolder("개인 작업").evaluate((el) => el.parentElement.open), false, "a reordered folder must not also toggle open");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("agentmon.projectFolders")).assignments), assignments);
    await page.reload();
    await sidebarFolder("개인 작업").waitFor();
    await section("업무").waitFor();
    assert.deepEqual(await folderOrder(), ["업무", "개인 작업"]);
    assert.deepEqual(await page.locator(".project-section .folder-heading > span:nth-last-child(2)").allTextContents(), ["업무", "개인 작업"]);
    await reorder(section("개인 작업").locator(".folder-heading"), section("업무").locator(".folder-heading"), "before");
    assert.deepEqual(await folderOrder(), ["개인 작업", "업무"]);
    checked(`${locale}: folder drag reorders up/down across both views, survives reload and preserves folder contents`);

    const beforeFolderCancel = await page.evaluate(() => localStorage.getItem("agentmon.projectFolders"));
    await beginDrag(sidebarFolder("개인 작업"), sidebarFolder("업무"), 0.8);
    await page.screenshot({ path: join(shots, `${locale}-folder-order.png`) });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await page.evaluate(() => localStorage.getItem("agentmon.projectFolders")), beforeFolderCancel);
    assert.equal(await page.locator("[data-folder-order-edge]").count(), 0);
    await beginDrag(sidebarFolder("개인 작업"), sidebarFolder("업무"), 0.2);
    assert.equal(await page.locator("[data-folder-order-edge]").count(), 0, "an unchanged position is not an insertion target");
    await page.mouse.up();
    assert.equal(await page.evaluate(() => localStorage.getItem("agentmon.projectFolders")), beforeFolderCancel);
    checked(`${locale}: Escape and dropping at the current folder position leave order unchanged`);

    // Legacy settings had no projectOrder field. Keep both folders and memberships.
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("agentmon.projectFolders"));
      delete data.projectOrder;
      localStorage.setItem("agentmon.projectFolders", JSON.stringify(data));
    });
    await page.reload();
    await section("개인 작업").locator(".project-row").waitFor();
    assert.deepEqual(await folderOrder(), ["개인 작업", "업무"]);
    checked(`${locale}: legacy folder settings load without a project order field`);

    await drop(navProject("Beta"), sidebarFolder("개인 작업"));
    await drop(navProject(`Default ${locale}`), sidebarFolder("개인 작업"));
    await section("개인 작업").locator(".project-row").nth(2).waitFor();
    const memberNames = () => sidebarFolder("개인 작업").locator("..").locator(':scope > [data-project-drag-path] .nav-sub-name').allTextContents();
    const mainMemberNames = () => section("개인 작업").locator(".project-name").allTextContents();
    const memberRow = (name) => section("개인 작업").locator(".project-row").filter({ has: page.locator(".project-name", { hasText: new RegExp(`^${name}$`) }) });
    const reorderProject = async (source, destination, edge) => {
      const url = page.url();
      await beginDrag(source, destination, edge === "before" ? 0.2 : 0.8);
      assert.equal(await page.locator("[data-project-order-edge]").getAttribute("data-project-order-edge"), edge);
      assert.equal(await page.locator("[data-folder-order-edge], [data-project-drag-over]").count(), 0);
      await page.mouse.up();
      await page.locator(".project-drag-preview").waitFor({ state: "detached" });
      assert.equal(page.url(), url);
    };
    const initialMembers = await memberNames();
    assert.equal(initialMembers.length, 3);
    const firstMember = initialMembers[0], lastMember = initialMembers.at(-1);
    await reorderProject(navProject(firstMember), navProject(lastMember), "after");
    assert.deepEqual(await memberNames(), [...initialMembers.slice(1), firstMember]);
    assert.deepEqual(await mainMemberNames(), [...initialMembers.slice(1), firstMember]);
    await reorderProject(memberRow(firstMember).locator(".project-name"), memberRow(initialMembers[1]), "before");
    assert.deepEqual(await memberNames(), initialMembers);
    assert.deepEqual(await mainMemberNames(), initialMembers);
    checked(`${locale}: three projects reorder down/up inside one folder in the sidebar and project list`);

    // Reverse the API's activity ordering to prove manual ordering wins after reopening.
    const projectsRoute = "**/project-api/projects";
    await page.route(projectsRoute, async (route) => {
      const response = await route.fetch();
      const rows = await response.json();
      await route.fulfill({ response, body: JSON.stringify(rows.reverse()) });
    });
    await page.reload();
    await section("개인 작업").locator(".project-row").nth(2).waitFor();
    assert.deepEqual(await memberNames(), initialMembers);
    assert.deepEqual(await mainMemberNames(), initialMembers);
    await page.unroute(projectsRoute);
    checked(`${locale}: saved project order survives reopening and a changed activity order from the API`);

    const savedProjectOrder = await page.evaluate(() => localStorage.getItem("agentmon.projectFolders"));
    await beginDrag(navProject(firstMember), navProject(lastMember), 0.8);
    await page.screenshot({ path: join(shots, `${locale}-project-order.png`) });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await page.evaluate(() => localStorage.getItem("agentmon.projectFolders")), savedProjectOrder);
    assert.equal(await page.locator("[data-project-order-edge]").count(), 0);
    await beginDrag(navProject(firstMember), navProject(initialMembers[1]), 0.2);
    assert.equal(await page.locator("[data-project-order-edge]").count(), 0);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => localStorage.getItem("agentmon.projectFolders")), savedProjectOrder);
    await page.evaluate(() => {
      window.originalProjectOrderSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "agentmon.projectFolders") throw new Error("simulated project order failure");
        return window.originalProjectOrderSetItem.call(this, key, value);
      };
    });
    await reorderProject(navProject(firstMember), navProject(lastMember), "after");
    await page.getByRole("alert").filter({ hasText: "simulated project order failure" }).waitFor();
    assert.deepEqual(await memberNames(), initialMembers);
    assert.equal(await page.evaluate(() => localStorage.getItem("agentmon.projectFolders")), savedProjectOrder);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalProjectOrderSetItem; });
    await page.getByRole("button", { name: T("app.retry"), exact: true }).click();
    checked(`${locale}: project order is unchanged after Escape, a no-op drop or a failed save`);

    await drop(navProject("Beta"), heading());
    await drop(navProject(`Default ${locale}`), heading());
    assert.deepEqual(await memberNames(), ["Alpha"]);
    assert.deepEqual(await mainMemberNames(), ["Alpha"]);
    checked(`${locale}: projects can still leave an ordered folder without leaving duplicate rows`);

    const beforeCancel = await page.evaluate(() => localStorage.getItem("agentmon.projectFolders"));
    const beforeUrl = page.url();
    await beginDrag(navProject("Alpha"), sidebarFolder("업무"));
    await page.screenshot({ path: join(shots, `${locale}-drag.png`) });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await page.locator(".project-drag-preview, [data-project-drag-over]").count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("agentmon.projectFolders")), beforeCancel);
    assert.equal(page.url(), beforeUrl);
    await beginDrag(navProject("Alpha"), page.locator(".brand"));
    assert.equal(await page.locator("[data-project-drag-over]").count(), 0);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => localStorage.getItem("agentmon.projectFolders")), beforeCancel);
    assert.equal(page.url(), beforeUrl);
    await navProject("Alpha").click();
    assert.notEqual(page.url(), beforeUrl, "a normal click still opens a project after a cancelled drag");
    await heading().click();
    checked(`${locale}: Escape and dropping outside a folder cancel; the next normal click still opens a project`);

    await page.evaluate(() => {
      window.originalDragSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "agentmon.projectFolders") throw new Error("simulated drag save failure");
        return window.originalDragSetItem.call(this, key, value);
      };
    });
    await drop(navProject("Alpha"), sidebarFolder("업무"));
    await page.getByRole("alert").filter({ hasText: "simulated drag save failure" }).waitFor();
    assert.equal(await section("개인 작업").locator(".project-row").count(), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem("agentmon.projectFolders")), beforeCancel);
    await reorder(sidebarFolder("개인 작업"), sidebarFolder("업무"), "after");
    assert.deepEqual(await folderOrder(), ["개인 작업", "업무"]);
    assert.equal(await page.evaluate(() => localStorage.getItem("agentmon.projectFolders")), beforeCancel);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalDragSetItem; });
    await page.getByRole("button", { name: T("app.retry"), exact: true }).click();
    checked(`${locale}: failed saves preserve both project membership and folder order`);

    await createFolder("개인 작업");
    await dialog().getByRole("alert").filter({ hasText: T("folder.duplicateName") }).waitFor();
    assert.equal(await section("개인 작업").count(), 1);
    await dialog().getByRole("button", { name: T("app.cancel"), exact: true }).click();
    await page.getByRole("button", { name: T("app.retry"), exact: true }).click();
    await heading().waitFor();
    checked(`${locale}: duplicate names keep the existing folder`);

    // A fresh page simulates reopening the app, with no React state carried over.
    await page.close();
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/projects`);
    await section("개인 작업").waitFor();
    assert.equal(await section("개인 작업").locator(".project-row").count(), 1);
    assert.equal(await section("업무").locator(".is-unavailable").count(), 1);
    checked(`${locale}: reopening restores folders, assignments and unavailable rows`);

    for (const width of [960, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      const alignment = await page.evaluate(() => {
        const folder = document.querySelector(".sidebar-folder > summary");
        const project = document.querySelector(".nav > .nav-sub[data-project-drag-path]");
        const nested = document.querySelector(".sidebar-folder .nav-sub .nav-sub-name");
        const folderIcon = folder.querySelector(".nav-icon").getBoundingClientRect();
        const projectIcon = project.querySelector(".nav-bullet").getBoundingClientRect();
        const folderX = folder.querySelector(".nav-sub-name").getBoundingClientRect().x;
        const projectX = project.querySelector(".nav-sub-name").getBoundingClientRect().x;
        return {
          textGap: Math.abs(folderX - projectX),
          iconGap: Math.abs(folderIcon.x + folderIcon.width / 2 - projectIcon.x - projectIcon.width / 2),
          rowGap: Math.abs(folder.getBoundingClientRect().height - project.getBoundingClientRect().height),
          sameFontSize: getComputedStyle(folder).fontSize === getComputedStyle(project).fontSize,
          nestedIndent: nested.getBoundingClientRect().x - projectX,
        };
      });
      assert(alignment.textGap < 0.5 && alignment.iconGap < 0.5 && alignment.rowGap < 0.5 && alignment.sameFontSize && alignment.nestedIndent > 10,
        `${locale}/${width}: sidebar rows should align: ${JSON.stringify(alignment)}`);
      await page.screenshot({ path: join(shots, `${locale}-${width}.png`), fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    }
    checked(`${locale}: folder/project names, icon centers, font sizes and row heights align at 960/1600px; children stay indented`);
    await section("개인 작업").locator(".folder-heading").click();
    assert.equal(await section("개인 작업").locator(".project-row").count(), 0);
    await section("개인 작업").locator(".folder-heading").click();
    await move(alpha(), "업무");
    await menuAction(sidebarFolder("업무"), "delete-folder");
    await root().waitFor();
    assert.equal(await root().locator(".is-unavailable").count(), 1);
    assert.equal(await section("업무").count(), 0);
    assert.equal(await root().locator(".project-name", { hasText: /^Alpha$/ }).count(), 1);
    assert.equal(await page.locator('.nav > .nav-sub').filter({ hasText: /^Alpha$/ }).count(), 1);
    assert(existsSync(join(projects[0], "AgentMonitoring", "project.json")));
    checked(`${locale}: collapse and sidebar folder deletion preserve projects and return them directly to the root`);

    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "agentmon.projectFolders") throw new Error("simulated write failure");
        return window.originalSetItem.call(this, key, value);
      };
    });
    await createFolder("저장 실패");
    await dialog().getByRole("alert").filter({ hasText: "simulated write failure" }).waitFor();
    assert.equal(await section("저장 실패").count(), 0);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await page.locator(".folder-name-form").getByRole("button", { name: T("folder.create"), exact: true }).click();
    await section("저장 실패").waitFor();
    checked(`${locale}: a failed save reports an error, keeps previous state and can be retried`);
    await menuAction(section("저장 실패").locator(".folder-heading"), "rename-folder");
    await dialog().getByLabel(T("folder.name"), { exact: true }).fill("정상 저장");
    await dialog().getByRole("button", { name: T("folder.save"), exact: true }).click();
    await section("정상 저장").waitFor();
    await menuAction(section("정상 저장").locator(".folder-heading"), "delete-folder");
    assert.equal(await section("정상 저장").count(), 0);
    checked(`${locale}: the project list folder headers share the same rename/delete menu`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`PASS ${checks} project organization checks`);
} finally {
  await browser?.close();
  await stopServer(server);
  const withinTemp = relative(tmpdir(), scratch);
  if (!withinTemp || withinTemp.startsWith("..") || isAbsolute(withinTemp)) throw new Error("Unsafe scratch cleanup path");
  rmSync(scratch, { recursive: true, force: true });
}
