---
name: handoff-v1-release
title: v1.5.0 배포 완료 — 다음 배포 절차와 설치 파일 주의사항
type: handoff
description: "v1.5.0 정식 배포 완료. AGENTS.md 생성 지원, 기능 커밋 b6503be, 설치 파일 크기·해시 확인. 다음 배포 순서와 Windows 설치 주의사항."
agent: fable-release-builder
updated_by: codex
created: 2026-08-21T08:29:26Z
updated: 2026-09-05T10:27:47Z
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

## For humans

2026년 9월 5일, 1.5.0을 최신 정식 버전으로 공개했습니다. 이제 설치 파일을 받으면 Claude Code와 Codex가 읽는 지침 파일을 각각 또는 함께 만드는 기능을 사용할 수 있습니다. 기존 파일에 적힌 규칙도 보존합니다.

배포 파일은 빌드한 파일과 크기 및 내용 확인용 해시값이 일치했습니다. 개발 앱과 개발 서버는 종료했고, 이 컴퓨터에서 설치 프로그램을 직접 실행하지는 않았습니다.

다음 배포에서도 설치 파일 이름을 유지해야 합니다. 앱이 업데이트를 받는 주소를 그 이름으로 계산하기 때문입니다. 또 화면에 보이는 앱 버전과 함께 들어가는 기록 도구의 버전을 맞춰야 합니다. 같은 상자에 넣는 설명서와 제품의 판번호를 맞추는 것과 같습니다.

지침 파일을 만드는 것과 기록 도구를 연결하는 것은 별도입니다. Codex를 쓰는 프로젝트는 해당 도구의 연결 설정도 준비해야 합니다.
