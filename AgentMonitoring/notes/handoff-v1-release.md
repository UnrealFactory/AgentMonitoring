---
name: handoff-v1-release
title: v1.7.0 배포 완료 — 지침·MCP 통합 버튼과 로그인 시 자동 실행
type: handoff
description: v1.7.0 소스·태그·설치 파일을 공개했고 다운로드 크기·SHA-256과 업데이트 경로를 검증했습니다. 이 기기의 설치본 업데이트는 실행하지 않았습니다.
agent: fable-release-builder
updated_by: fable-unified-scaffold
created: 2026-08-21T08:29:26Z
updated: 2026-09-13T11:47:21Z
tags: []
refs: [WORK-0124, WORK-0123, WORK-0122, WORK-0121, WORK-0119, korean-only-ui, project-organization-and-create-defaults, autostart-at-login, mcp-client-registration]
---

현재 공개 버전은 **v1.7.0**입니다(2026-09-13). WORK-0124 배포를 완료했습니다.

## 현재 배포

- 릴리스: https://github.com/UnrealFactory/AgentMonitoring/releases/tag/v1.7.0
- 최신 릴리스 API는 v1.7.0, draft=false, prerelease=false이며 공개 시각은 2026-09-13T11:46:15Z(한국 시각 20:46:15)입니다. 앱 업데이트 확인에 쓰는 /releases/latest의 리다이렉트도 v1.7.0을 가리킵니다.
- 기능 커밋: b6401846dfb99d557e63fcb51d4e8de096799cc1입니다. main과 주석 태그 v1.7.0을 원자적으로 푸시했고 원격 태그가 같은 커밋을 가리킴을 확인했습니다. 배포 완료 기록은 후속 문서 커밋으로 남깁니다.
- 설치 파일: AgentMonitoring_1.7.0_x64-setup.exe, 8,272,626바이트입니다.
- SHA-256: aa1463a0a6d8b71af9a2103cdbfe8d102e0c5da6675910baa8918a75e3edafee입니다.
- 로컬 빌드와 공개 주소에서 다시 내려받은 파일의 크기·해시가 일치했습니다. 번들 CLI --version은 1.7.0입니다.

## 포함된 변경과 적용 범위

- 새 프로젝트 화면의 지침·MCP 선택을 **추가 / 추가 안 함** 하나로 합쳤고, 추가는 `.claude/CLAUDE.md`·`AGENTS.md`·`.mcp.json`·`.codex/config.toml`을 함께 만듭니다. Claude 지침 파일은 `.claude/`로 옮겼으며 루트 `CLAUDE.md`에 이미 구역이 있으면 그 자리에서 갱신합니다. 우클릭 **지침 쓰기**·**MCP 추가하기**는 Claude·Codex를 한 번에 처리합니다. 상세는 [[project-organization-and-create-defaults]]와 [[mcp-client-registration]](WORK-0122).
- 로그인 시 자동 실행(tauri-plugin-autostart). **설치본 첫 실행에서 자동으로 켜지고** `--autostart`로 뜬 창은 트레이에만 머뭅니다. 사이드바 아래 스위치로 끕니다. 상세는 [[autostart-at-login]](WORK-0123). 이 기기의 설치본을 1.7.0으로 올리지 않았으므로 첫 실행 기본 켬은 설치본에서 아직 확인하지 않았습니다.

이전 배포: v1.6.1(2026-09-11, FB-0001 MCP 대시 값 수정, 커밋 f986a70ead22a0f32f98850f6c865db3a045416a, 설치 파일 8,262,740바이트, SHA-256 f2d182569d1a6b0173e863f65eeed6b1a7f367dccfe11f7fed01af5ebd9a6175), v1.6.0(2026-09-08, 한국어 전용 UI·프로젝트 정리, 커밋 be43b732e774a26f0cfeb1731176c9847b056c89). 한국어 전용 결정은 [[korean-only-ui]]를 보세요.

이 기기의 설치 프로그램 실행, .codex/config.toml 변경, 다른 프로젝트 지침 일괄 갱신은 하지 않았습니다. 공개 배포와 로컬 설치본 적용을 구분하세요.

## 검증

- v1.7.0: Rust 전체 테스트, `npm run build`, check:instructions 28, check:project-folders 19, check:keys 276, check:locale 9, check:i18n 333화면, check:autostart 6(실제 데스크톱 앱 CDP), HUMAN_STYLE 드리프트 clean(전체 16,377자·compact 5,491자), `npm run tauri:build` 종료 0, MCP 검사 274건(1.7.0 CLI) 통과. 설치 프로그램 실행은 시험하지 않았습니다.
- v1.6.1: HUMAN_STYLE 드리프트 clean, tauri:build 종료 0, MCP 검사 271건. v1.6.0: Rust 212개, 키보드·메뉴 276개, 실시간 갱신 19개, 전체 한국어 327화면. 상세는 WORK-0121·WORK-0119에 있습니다.

## 다음 버전을 배포할 때

- package.json, src-tauri/tauri.conf.json, 루트 Cargo.toml의 버전과 package-lock.json(2곳)·Cargo.lock(agentmon-cli·agentmon-core·agentmonitoring 3곳)의 로컬 패키지 버전을 맞춥니다. Cargo.lock은 `cargo update -w --offline`으로 맞출 수 있습니다. MCP 패키지 버전은 앱과 독립적입니다.
- 빌드와 공개를 나누면 node scripts/check-humanstyle-drift.mjs → npm run tauri:build → (npm run check:mcp) → 소스 커밋·주석 태그 → git push --atomic origin main v<version> → gh release create v<version> <installer> --verify-tag --title --notes-file 순서로 진행합니다. npm run release는 검사·빌드·GitHub 공개를 한 번에 수행하므로 소스와 태그를 먼저 정확히 푸시합니다.
- 공개 뒤 gh api repos/…/releases/latest로 tag·draft·prerelease·assets를 확인하고, 공개 주소에서 다시 내려받아 sha256sum으로 로컬 빌드와 비교합니다.
- 설치 파일 이름 AgentMonitoring_<version>_x64-setup.exe를 유지합니다. 업데이트 코드가 이 이름으로 다운로드 주소를 만듭니다.
- HUMAN_STYLE 검사가 실패하면 배포 CLI를 다시 빌드합니다. 전체 문서와 compact 규칙 모두 바이너리 내장 내용과 같아야 합니다.
- Windows 설치 파일은 mcp/server.mjs·mcp/lib·mcp/node_modules와 CLI를 포함합니다. Tauri 리소스는 디렉터리 매핑을 유지하며 glob으로 평탄화하지 않습니다.
- `tauri dev`가 떠 있어도 release 빌드는 가능하지만, 5173 포트를 쓰는 검사 스크립트(check-i18n·check-keys)와는 겹치지 않게 SHOT_PORT를 바꾸거나 순서를 나눕니다.
- PowerShell 5.1의 Invoke-WebRequest에는 -UseBasicParsing을 사용합니다. NSIS는 HKCU/Software/agentmonitoring/AgentMonitoring에 마지막 설치 위치를 기억하므로 시험 설치가 기본 설치 위치를 바꿀 수 있습니다.
- v1.1.0 이후 자동 업데이트는 기존 바탕화면 아이콘 상태를 보존합니다. .mcp.json은 Claude Code용이고 .codex/config.toml은 Codex용입니다.

배포 경위는 WORK-0124(v1.7.0), WORK-0121(v1.6.1), WORK-0119(v1.6.0)에 남아 있습니다.

## For humans

AgentMonitoring 1.7.0을 공개했습니다. 새 프로젝트를 만들 때 지침 파일과 MCP 연결을 "추가" 한 번으로 넣게 했고, 로그인하면 앱이 트레이에서 스스로 시작되도록 했습니다. 공개 설치 파일을 다시 내려받아 로컬 빌드와 크기·해시가 같음을 확인했고 앱의 최신 버전 확인 경로도 1.7.0을 가리킵니다.

이 기기에 설치 프로그램을 실행하지는 않았으므로, 설치 후 처음 켤 때 자동 실행이 켜지는 동작은 설치본으로 아직 확인하지 않았습니다.
