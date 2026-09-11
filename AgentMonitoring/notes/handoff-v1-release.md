---
name: handoff-v1-release
title: v1.6.1 배포 완료 — MCP 대시 시작 값 전달 수정
type: handoff
description: v1.6.1 소스·태그·설치 파일을 공개했고 다운로드 크기·SHA-256과 업데이트 경로를 검증했습니다. 이 기기의 설치본 업데이트는 실행하지 않았습니다.
agent: fable-release-builder
updated_by: fable-fb-dash
created: 2026-08-21T08:29:26Z
updated: 2026-09-11T02:47:10Z
tags: []
refs: [WORK-0121, WORK-0120, WORK-0119, korean-only-ui, project-organization-and-create-defaults]
---

현재 공개 버전은 **v1.6.1**입니다(2026-09-11). WORK-0121 배포를 완료했습니다.

## 현재 배포

- 릴리스: https://github.com/UnrealFactory/AgentMonitoring/releases/tag/v1.6.1
- 최신 릴리스 API는 v1.6.1, draft=false, prerelease=false이며 공개 시각은 2026-09-11T02:46:12Z(한국 시각 11:46:12)입니다. 앱 업데이트 확인에 쓰는 /releases/latest의 HEAD 리다이렉트도 v1.6.1을 가리킵니다.
- 기능 커밋: f986a70ead22a0f32f98850f6c865db3a045416a입니다. main과 주석 태그 v1.6.1을 원자적으로 푸시했고 원격 태그가 같은 커밋을 가리킴을 확인했습니다. 배포 완료 기록은 후속 문서 커밋으로 남깁니다.
- 설치 파일: AgentMonitoring_1.6.1_x64-setup.exe, 8,262,740바이트입니다.
- SHA-256: f2d182569d1a6b0173e863f65eeed6b1a7f367dccfe11f7fed01af5ebd9a6175입니다.
- 로컬 빌드와 공개 주소에서 다시 내려받은 파일의 크기·해시가 일치했습니다. 번들 CLI --version은 1.6.1입니다.

## 포함된 변경과 적용 범위

v1.6.1은 FB-0001 수정만 담은 패치입니다. MCP 서버(mcp/lib/tools.mjs)가 값이 있는 모든 옵션을 `--name=value` 한 인자로 넘기므로 노트 설명·제목·사람용 문장·앱 피드백이 `--`나 `-`로 시작해도 저장됩니다(WORK-0120). 이 수정은 설치본에 번들되는 MCP 서버에 있으므로 설치 후 Claude Code·Codex의 MCP 연결을 다시 맺어야 적용됩니다. 앱 화면과 Rust 코드는 v1.6.0과 같습니다.

v1.6.0의 한국어 전용 UI는 [[korean-only-ui]], 프로젝트·폴더 정리는 [[project-organization-and-create-defaults]]를 확인하세요. 이전 배포 v1.6.0(2026-09-08)의 기능 커밋은 be43b732e774a26f0cfeb1731176c9847b056c89, 설치 파일 8,261,051바이트, SHA-256 2e4f559ddf83306dfcf6afbb616cef89dce3cc47b5a51879722ad9f91e91263b입니다.

이 기기의 설치 프로그램 실행, .codex/config.toml 변경, 다른 프로젝트 지침 일괄 갱신은 하지 않았습니다. 공개 배포와 로컬 설치본 적용을 구분하세요.

## 검증

- v1.6.1: HUMAN_STYLE 드리프트 검사 clean(전체 16,377자·compact 5,491자), npm run tauri:build 종료 0, MCP 검사 271건 통과(1.6.1 CLI 기준). Rust 코드가 v1.6.0과 같아 cargo test는 다시 돌리지 않았습니다. 설치 프로그램 실행과 실제 MCP 클라이언트 재연결은 시험하지 않았습니다.
- v1.6.0: Rust 212개, 키보드·메뉴 276개, 실시간 갱신 19개, 전체 한국어 검사 327화면·11개 너비 363회 판독이 통과했습니다. 상세는 WORK-0119에 있습니다.

## 다음 버전을 배포할 때

- package.json, src-tauri/tauri.conf.json, 루트 Cargo.toml의 버전과 package-lock.json(2곳)·Cargo.lock(agentmon-cli·agentmon-core·agentmonitoring 3곳)의 로컬 패키지 버전을 맞춥니다. MCP 패키지 버전은 앱과 독립적입니다.
- 빌드와 공개를 나누면 node scripts/check-humanstyle-drift.mjs → npm run tauri:build → 소스 커밋·주석 태그 → git push --atomic origin main v<version> → gh release create v<version> <installer> --verify-tag --title --notes-file 순서로 진행합니다. npm run release는 검사·빌드·GitHub 공개를 한 번에 수행하므로 소스와 태그를 먼저 정확히 푸시합니다.
- 공개 뒤 gh api repos/…/releases/latest로 tag·draft·prerelease·assets를 확인하고, 공개 주소에서 다시 내려받아 sha256sum으로 로컬 빌드와 비교합니다.
- 설치 파일 이름 AgentMonitoring_<version>_x64-setup.exe를 유지합니다. 업데이트 코드가 이 이름으로 다운로드 주소를 만듭니다.
- HUMAN_STYLE 검사가 실패하면 배포 CLI를 다시 빌드합니다. 전체 문서와 compact 규칙 모두 바이너리 내장 내용과 같아야 합니다.
- Windows 설치 파일은 mcp/server.mjs·mcp/lib·mcp/node_modules와 CLI를 포함합니다. Tauri 리소스는 디렉터리 매핑을 유지하며 glob으로 평탄화하지 않습니다.
- PowerShell 5.1의 Invoke-WebRequest에는 -UseBasicParsing을 사용합니다. NSIS는 HKCU/Software/agentmonitoring/AgentMonitoring에 마지막 설치 위치를 기억하므로 시험 설치가 기본 설치 위치를 바꿀 수 있습니다.
- v1.1.0 이후 자동 업데이트는 기존 바탕화면 아이콘 상태를 보존합니다. .mcp.json은 Claude Code용이고 .codex/config.toml은 Codex용입니다.

배포 경위는 WORK-0121(v1.6.1)과 WORK-0119(v1.6.0)에 남아 있습니다.

## For humans

AgentMonitoring 1.6.1을 공개했습니다. 에이전트가 남기는 문장이 '--'로 시작해도 저장되도록 고친 패치 버전입니다. 공개 설치 파일을 다시 내려받아 로컬 빌드와 크기·해시가 같음을 확인했고 앱의 최신 버전 확인 경로도 1.6.1을 가리킵니다. 이 기기에 설치 프로그램을 실행하지는 않았습니다. 설치 뒤에는 Claude Code·Codex의 MCP 연결을 다시 맺어야 새 서버가 쓰입니다.
