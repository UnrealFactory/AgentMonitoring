---
name: handoff-v1-release
title: v1.5.0 배포 완료 — MCP 추가와 메뉴 정리는 작업트리에 반영
type: handoff
description: "공개 버전 v1.5.0. WORK-0099 MCP 생성 및 WORK-0101 지침/MCP 하위 메뉴 구현·검증 완료, 배포 전. 개발 앱 실행 중."
agent: fable-release-builder
updated_by: codex
created: 2026-08-21T08:29:26Z
updated: 2026-09-05T11:05:28Z
tags: []
refs: []
---

현재 공개 버전은 **v1.5.0**입니다(2026-09-05).

## 현재 배포

- 릴리스: https://github.com/UnrealFactory/AgentMonitoring/releases/tag/v1.5.0
- v1.5.0 태그가 가리키는 기능 커밋: b6503bee6a637f2a9bf9c31e29e8416e3be355d5.
- 설치 파일: AgentMonitoring_1.5.0_x64-setup.exe, 8,099,711바이트.
- SHA-256: 046a3c7a19187adf497514581f99c19487c45a87bab3e5bdf83e7e015d404588. GitHub 업로드 자산과 로컬 파일의 크기 및 해시가 같음을 확인했습니다.
- WORK-0096은 기능 구현, WORK-0097은 버전 변경·커밋·푸시·설치 파일 공개 기록입니다.
- 새 프로젝트에서 CLAUDE.md와 AGENTS.md를 각각 또는 함께 만들고 언어를 독립적으로 선택합니다. 기존 프로젝트 메뉴에서도 각 파일을 생성할 수 있습니다. 기존 내용은 보존하며 이미 있는 안내는 중복되지 않습니다.
- CLI: init --agents-md ko|en, project agents-md --lang ko|en. 두 파일은 같은 템플릿의 독립적인 복사본입니다. AGENTS.md 생성은 Codex의 MCP 연결을 자동으로 설정하지 않습니다.
- 사용자 확인용 개발 앱과 5173 서버는 배포 전에 종료했습니다. 로컬 설치 프로그램은 실행하지 않았습니다.

## 다음 버전을 배포할 때

- package.json, src-tauri/tauri.conf.json, 루트 Cargo.toml의 버전을 맞추고 package-lock.json 및 Cargo.lock의 로컬 패키지 버전도 갱신합니다. 배포 스크립트는 세 기본 버전이 다르면 중단합니다.
- npm run release는 지침 계약 확인, CLI·앱·NSIS 빌드, GitHub 릴리스 등록을 수행합니다. 소스와 태그를 먼저 정확히 푸시합니다. 빌드와 공개를 나눌 때는 node scripts/check-humanstyle-drift.mjs → npm run tauri:build → git 태그 푸시 → gh release create --verify-tag --notes-file 순서로 진행할 수 있습니다.
- 설치 파일 이름 AgentMonitoring_<version>_x64-setup.exe를 유지합니다. 업데이트 코드가 이 이름으로 다운로드 주소를 만들기 때문에 이름을 바꾸면 업데이트가 끊깁니다.
- scripts/check-humanstyle-drift.mjs가 실패하면 배포용 CLI를 다시 빌드합니다. docs/HUMAN_STYLE.md의 전체 계약과 압축 규칙이 바이너리에 내장된 내용과 같아야 합니다. 작성 규칙은 지침 파일에 상시 추가하지 않고 쓰기 시점의 CLI 거절 메시지, MCP 첫 응답, agentmon human-style에서 전달합니다.
- Windows 배포에는 mcp/server.mjs, mcp/lib, mcp/node_modules와 CLI가 함께 들어갑니다. Tauri 리소스 경로는 디렉터리 매핑을 유지합니다. glob 매핑은 경로를 평탄화하여 같은 파일명끼리 덮어쓸 수 있습니다.
- PowerShell 5.1의 Invoke-WebRequest에는 -UseBasicParsing이 필요합니다.
- NSIS는 HKCU/Software/agentmonitoring/AgentMonitoring의 마지막 설치 위치를 기억합니다. 시험 설치가 다음 기본 설치 위치에 영향을 줄 수 있습니다.
- .mcp.json은 Claude Code용 MCP 등록 경로입니다(init --mcp-json / project mcp-json). 다른 클라이언트의 등록은 각 도구의 설정을 사용합니다.
- v1.1.0 이후 자동 업데이트는 바탕화면 아이콘 상태를 보존합니다. v1.0.1 이하에서 올리는 경우에는 예전 콘솔 업데이트 동작이 나타날 수 있습니다.

이전 배포의 기능별 상세 경위는 해당 작업 기록과 progress/rounds.jsonl에서 확인합니다.

## 작업트리의 미배포 변경 — 2026-09-05

WORK-0099에서 새 프로젝트 화면에 Claude MCP 추가하기 / Codex MCP 추가하기를 구현했습니다. 이어서 WORK-0101에서 기존 프로젝트 우클릭 메뉴는 지침 쓰기 → Claude / Codex, MCP 추가하기 → Claude / Codex의 두 단계로 정리했습니다. CLAUDE.md·AGENTS.md와 별도로 각각 또는 함께 선택합니다. Codex는 .codex/config.toml에 [mcp_servers.agentmon]을 작성하고 다른 설정·주석을 보존합니다. Codex의 프로젝트 신뢰 설정은 변경하지 않습니다.

CLI는 init --claude-mcp / --codex-mcp, project claude-mcp / codex-mcp입니다. 이전 --mcp-json / project mcp-json은 Claude 등록 별칭입니다. 작성자 기본값은 claude와 codex이며 init의 --mcp-agent / --codex-agent로 바꿉니다. 화면 기본 선택은 기존처럼 Claude만 켜져 있으며 Codex는 선택해서 추가합니다.

코어 테스트 4개, CLI·브라우저 검사 19개, 프런트엔드 빌드, 데스크톱 빌드와 실제 WebView2 호출 검사가 통과했습니다. 검사는 임시 레지스트리·프로젝트와 별도 데스크톱 식별자로 수행했습니다. 일반 개발 앱 빌드를 복구했고 시험 프로세스를 종료했습니다. Codex 클라이언트의 실제 재연결은 시험하지 않았습니다.

이 기능은 아직 커밋·배포하지 않았습니다. 공개 버전과 실행 중인 설치 앱은 여전히 위의 v1.5.0입니다. 다음 배포 시 이번 작업의 소스·문서·검사·기록을 포함해야 합니다.

WORK-0101 후속 검증: npm run build, check:instructions 23개, check:keys 276개가 통과했습니다. 하위 메뉴의 키보드 이동·복원과 화면 양쪽 아래 위치를 확인했습니다. 사용자 확인용 개발 앱 PID 10664와 Vite 도구 세션 78270(5173 포트)은 실행 상태로 남겨 두었습니다.

## For humans

공개 버전은 1.5.0입니다. 개발 중인 코드에는 Claude와 Codex의 MCP 연결 생성 기능과 프로젝트 메뉴 정리가 추가되어 있습니다.

**프로젝트 메뉴에서 목적을 먼저 고릅니다.** 지침 쓰기 또는 MCP 추가하기를 누른 뒤 Claude나 Codex를 선택합니다. 서랍을 고른 뒤 안의 도구를 꺼내는 것과 같습니다.

**변경 검사와 기존 동작 검사가 통과했습니다.** 파일 생성·선택 검사 23개와 키보드 검사 276개가 통과했습니다. 사용자 확인용 개발 앱과 서버는 켜 두었습니다.

이번 기능은 아직 커밋하거나 배포하지 않았습니다.
