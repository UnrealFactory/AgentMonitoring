---
name: handoff-v1-release
title: "v1.4.0 is live, WORK-0094/0095 uncommitted — how to ship, and the installer traps"
type: handoff
description: v1.4.0 published; WORK-0094 feedback fixes + WORK-0095 agents-table removal sit uncommitted awaiting bump+release; npm run release ships; keep the installer asset name; UseBasicParsing / NSIS gotchas.
agent: fable-release-builder
updated_by: fable-feedback-round
created: 2026-08-21T08:29:26Z
updated: 2026-08-27T02:28:56Z
tags: []
refs: []
---

Where things stand (2026-08-27):

- **Unreleased work is sitting in the working tree, not committed**: WORK-0094 (external
  feedback round — frontmatter list values quoted against `[`/`{`/`,`, one unreadable
  record no longer locks a project's reads, MCP log_work pre-flights the closing step
  before `work start`, record images open full size on click) and WORK-0095 (the
  dashboard's per-agent activity table removed at the owner's direction; SPEC.md's
  Dashboard entry updated with the decision). Tests are green across the workspace, the
  MCP suite (213) and the frontend build; the owner has not asked for a commit. The next
  release ships these: bump the three versions and run the release after committing.

- Release v1.4.0 is live with AgentMonitoring_1.4.0_x64-setup.exe; main is pushed through
  4360ea3 (WORK-0093 + records + bump). It ships the scene-citation fix (owner feedback,
  2026-08-25): the style contract now spells the citation as a blank-lined paragraph of
  its own and requires `width`/`height` on a scene's SVG root; the renderer promotes a
  whole-line image to a figure wherever it stands and SVG figures fill their column;
  `agentmon doctor` warns on a welded citation and on a cited SVG with a sizeless root;
  check:scenes measures every cited SVG (its widened net caught and forced the redraw of
  WORK-0040's pre-scene-era diagram). The compact rules grew with this, so other projects
  teach the new spelling only once they update to this version and their MCP servers
  restart; docs/MCP.md republishes the measured hand-over (about 6,200 chars).

- The line before it: v1.3.0 was human area v2 (WORK-0088..0092 — tellings append as
  dated nodes, a scene on every beat by default, the Human view sharing the agent page's
  skeleton). v1.2.1 shipped the compact rules teaching the replace rule (WORK-0087).
  v1.2.0 made `--message` require `--human` everywhere. v1.1.1 de-metered the update
  check (BUG-0029) and carried three MCP fixes. v1.1.0 was the dual-record release
  (agent + human areas on every record, the Agent/사람 toggle, `agentmon reconcile`,
  the boot locale fix, silent updates that leave the desktop icon alone).

- To ship a new version: bump the version in package.json + src-tauri/tauri.conf.json +
  Cargo.toml (root, workspace version — all three, release.mjs refuses if they disagree),
  then npm run release. The preflight also runs scripts/check-humanstyle-drift.mjs — if it
  refuses, rebuild the CLI so the embedded contract matches docs/HUMAN_STYLE.md. The
  updater's fallback constructs the installer URL from the asset name release.mjs uploads
  (AgentMonitoring_<version>_x64-setup.exe) — renaming that asset breaks the un-metered
  path (a unit test in update.rs pins it).

- Writing rules are write-time only: nothing in CLAUDE.md; the CLI rejection, the MCP first
  result and `agentmon human-style` deliver the compact rules; per-piece history is
  progress/rounds.jsonl (D1-D11).

- Gotchas that already bit once, still true: Invoke-WebRequest needs -UseBasicParsing on
  PowerShell 5.1; Tauri resources maps flatten glob sources; NSIS remembers the last
  install dir in HKCU/Software/agentmonitoring/AgentMonitoring, so a scratch install
  redirects the next "default" one until that key is deleted.

- .mcp.json is the registration path (init --mcp-json / project mcp-json); updating FROM
  ≤1.0.1 still shows the old visible-console updater, from 1.0.2 the WPF splash, and from
  1.1.0 onward silent updates leave the desktop icon state alone.

## For humans

이 노트는 작업 세션 사이의 바통입니다. 다음 사람이 지금 세상에 나가 있는 버전과 다음 버전을 내보내는 방법을 여기서 읽습니다. 마지막으로 다시 쓴 날은 2026년 8월 27일입니다.

**아직 내보내지 않은 수정이 작업 폴더에 있습니다.** 2026년 8월 27일, 외부 프로젝트에서 온 제보 네 건을 고친 작업(WORK-0094)과, 주인의 지시로 대시보드의 에이전트 표를 들어낸 작업(WORK-0095)이 끝났지만 저장소에 커밋되지도, 새 버전으로 배포되지도 않았습니다. 주인이 커밋을 시키지 않아서 그대로 둔 것입니다. 다음 배포가 이 수정들을 싣습니다 — 대괄호가 든 파일 이름이 기록을 깨뜨리던 문제, 깨진 기록 하나가 프로젝트 전체를 잠그던 문제, 반쪽 기록이 남던 문제, 그림을 눌러 크게 보는 기능, 그리고 에이전트 표가 빠진 대시보드입니다.

**1.4.0이 사람들 손에 있습니다.** 그 버전은 그림 인용 문제를 고친 판입니다. 기록의 쉬운 말 페이지에 넣는 장면 그림이, 빈 줄 없이 붙여 쓰거나 그림 파일 첫 줄에 크기가 안 적혀 있으면 글자 한 줄 높이로 쪼그라든 채 실려 나갔습니다. 규칙서에 올바른 철자를 적고, 앱이 잘못된 철자도 그림으로 그려 주고, 점검 명령 `agentmon doctor`가 두 모양을 경고하게 해서 세 겹으로 막았습니다. 글쓰기 규칙은 설치된 프로그램 안에 실려 다니므로, 다른 프로젝트들은 새 버전으로 올려야 새 규칙을 받습니다.

**그 앞은 이렇게 흘러왔습니다.** 1.3.0은 쉬운 말 페이지의 두 번째 판 — 저장마다 날짜 달린 항목으로 쌓이고, 이야기의 걸음마다 그림이 기본이 된 판입니다. 1.2.1은 짧은 규칙이 "전체를 다시 말하라"를 가르치게 된 판, 1.2.0은 기록에 노트를 달 때 쉬운 말 절반을 함께 내라고 강제한 판입니다.

**다음 버전을 내보내는 일은 세 군데 수정과 명령 하나입니다.** 버전 숫자가 사는 세 파일이 같아야 하고, 다르면 릴리스 스크립트가 거절합니다. 빌드 전에 규칙서와 도구 속 사본이 같은지도 검사합니다 — 거절당하면 명령줄 도구를 먼저 다시 빌드하십시오. 무료 업데이트 경로는 스크립트가 올리는 설치 파일의 정확한 이름으로 설치본을 찾으므로, 그 이름을 바꾸면 안 됩니다.

**바닥의 함정 목록은 흉터입니다.** 하나하나가 이미 한나절을 잡아먹은 실수라서, 문장 하나로 피할 수 있게 적어 두었습니다.

이 노트를 먼저 읽고, 커밋되지 않은 수정부터 처리한 다음, 세-파일-한-명령 순서로 내보내십시오.
