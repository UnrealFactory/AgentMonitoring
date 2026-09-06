---
name: handoff-v1-release
title: v1.5.2 배포 완료 — 기록 정책·기존 지침 갱신·피드백 수정
type: handoff
description: v1.5.2를 main·태그와 함께 공개했습니다. 설치 파일 다운로드의 크기·SHA-256을 확인했습니다. 설치 후 지침 쓰기로 기존 프로젝트를 갱신합니다.
agent: fable-release-builder
updated_by: codex
created: 2026-08-21T08:29:26Z
updated: 2026-09-06T10:24:43Z
tags: []
refs: [WORK-0099, WORK-0101, WORK-0103, WORK-0108, WORK-0109, WORK-0110]
---

현재 공개 버전은 **v1.5.2**입니다(2026-09-06).

## 현재 배포

- 릴리스: https://github.com/UnrealFactory/AgentMonitoring/releases/tag/v1.5.2
- 최신 릴리스 API: v1.5.2, draft=false, prerelease=false, 공개 시각 2026-09-06T10:23:11Z입니다. 업데이트 코드가 사용하는 /releases/latest의 HEAD 리다이렉트도 v1.5.2를 가리킵니다.
- 기능 커밋: 02007200d4c34456e9748c66f500d7295d3d03be. main과 주석 태그 v1.5.2를 origin에 원자적으로 푸시했고 원격 태그가 같은 커밋을 가리킴을 확인했습니다. 배포 완료 기록은 후속 문서 커밋으로 남깁니다.
- 설치 파일: AgentMonitoring_1.5.2_x64-setup.exe, 8255128바이트.
- SHA-256: aa79028932602572635a63e8b30f411a713ec91d2e33f92d780d438da610fffa.
- 로컬 빌드, GitHub 자산 메타데이터, 공개 주소에서 다시 내려받은 파일의 크기·해시가 모두 일치했습니다. 앱 ProductVersion/FileVersion과 CLI --version도 1.5.2입니다.
- WORK-0108은 정책·지침 갱신·refs·SVG 검사, WORK-0109는 EOF 수정과 피드백 4건 처리, WORK-0110은 이번 배포 기록입니다. 이전 Claude·Codex MCP 등록과 메뉴 구현은 WORK-0099/0101/0103을 참고하세요.

## 포함된 변경과 적용 방법

목적·완료 조건으로 WORK를 묶고 미완료 작업을 이어가는 기록 정책 v4를 앱·CLI·MCP에 포함했습니다. 설명 대화마다 기록을 쪼개지 않고 미채택 제안과 채택한 결정을 구분합니다. 노트 목록 페이지 이동, work-/bug- 노트 이름의 refs 및 화면 링크, WORK·BUG 끝 빈 줄도 수정했습니다. 내용에 맞는 시각화 정책과 SVG 기하 검사 개선도 소스에 포함됩니다. 검사 스크립트 자체는 소스 저장소의 개발 도구입니다.

앱을 1.5.2로 업데이트한 뒤 프로젝트 우클릭 → 지침 쓰기 → Codex / Claude를 실행하면 기존 AGENTS.md / CLAUDE.md의 AgentMonitoring 부분을 갱신합니다. 바깥 프로젝트 규칙과 기존 언어를 보존합니다. 정확한 구형 템플릿과 정상 관리 구간은 자동 갱신하고 직접 수정된 구형 지침·손상된 표시는 파일을 보존하며 수동 병합을 안내합니다. 기존 프로젝트 지침을 일괄 수정하지 않습니다.

실행 중인 MCP 연결은 재연결해야 새 서버 코드·도구 설명을 사용합니다. 이번 작업에서는 이 기기의 설치 프로그램 실행, .codex/config.toml 변경, 다른 프로젝트 지침 갱신을 수행하지 않았습니다. 따라서 공개 배포 완료와 로컬 설치본 적용을 구분하세요.

## 검증

- npm run tauri:build: 프런트엔드·CLI·앱·NSIS 설치 파일까지 종료 0입니다.
- cargo test --workspace: 211개 통과했습니다.
- check:instructions: 기존 파일 갱신·사용자 규칙 보존·한영 화면·메뉴를 포함하여 33개 통과했습니다.
- MCP: 267개, markdown smoke: 1069개 통과했습니다.
- HUMAN_STYLE 전체 16,377자·compact 5,491자가 배포 CLI 내장 내용과 일치합니다.
- 독립 release_review가 버전·잠금 파일·구형 지침 fixture·MCP 설치 리소스 경로·필수 신규 소스를 대조하여 배포 차단 결함을 발견하지 못했습니다.
- 지침 행동 시험·SVG 회귀·Git EOF 재현의 상세 결과는 WORK-0108/0109에 있습니다. 이번 배포에서 설치 프로그램을 실행하거나 실제 Codex 클라이언트 재연결을 시험하지는 않았습니다.
- 기존 WORK-0104~0108의 구형 도구 생성 EOF 빈 줄은 이력 그대로 보존했습니다. 소스 파일의 staged Git 공백 검사는 통과했습니다.

## 다음 버전을 배포할 때

- package.json, src-tauri/tauri.conf.json, 루트 Cargo.toml의 버전을 맞추고 package-lock.json 및 Cargo.lock의 로컬 패키지 버전도 갱신합니다. 배포 스크립트는 세 기본 버전이 다르면 중단합니다. 별도 MCP 패키지 버전은 앱 버전과 독립적입니다.
- npm run release는 지침 계약 확인, CLI·앱·NSIS 빌드, GitHub 릴리스 등록을 수행합니다. 소스와 태그를 먼저 정확히 푸시합니다. 빌드와 공개를 나눌 때는 node scripts/check-humanstyle-drift.mjs → npm run tauri:build → git 태그 푸시 → gh release create --verify-tag --notes-file 순서로 진행할 수 있습니다.
- 설치 파일 이름 AgentMonitoring_<version>_x64-setup.exe를 유지합니다. 업데이트 코드가 이 이름으로 다운로드 주소를 만들기 때문에 이름을 바꾸면 업데이트가 끊깁니다.
- scripts/check-humanstyle-drift.mjs가 실패하면 배포용 CLI를 다시 빌드합니다. docs/HUMAN_STYLE.md의 전체 계약과 압축 규칙이 바이너리에 내장된 내용과 같아야 합니다. 작성 규칙은 지침 파일에 상시 추가하지 않고 쓰기 시점의 CLI 거절 메시지, MCP 첫 응답, agentmon human-style에서 전달합니다.
- Windows 배포에는 mcp/server.mjs, mcp/lib, mcp/node_modules와 CLI가 함께 들어갑니다. Tauri 리소스 경로는 디렉터리 매핑을 유지합니다. glob 매핑은 경로를 평탄화하여 같은 파일명끼리 덮어쓸 수 있습니다.
- PowerShell 5.1의 Invoke-WebRequest에는 -UseBasicParsing이 필요합니다.
- NSIS는 HKCU/Software/agentmonitoring/AgentMonitoring의 마지막 설치 위치를 기억합니다. 시험 설치가 다음 기본 설치 위치에 영향을 줄 수 있습니다.
- .mcp.json은 Claude Code용이고 .codex/config.toml은 Codex용입니다. 다른 클라이언트는 각 도구의 설정 경로를 사용합니다.
- v1.1.0 이후 자동 업데이트는 바탕화면 아이콘 상태를 보존합니다. v1.0.1 이하에서 올리는 경우에는 예전 콘솔 업데이트 동작이 나타날 수 있습니다.

이전 배포의 기능별 상세 경위는 해당 작업 기록과 progress/rounds.jsonl에서 확인합니다.

## For humans

2026년 9월 6일, AgentMonitoring 1.5.2를 공개했습니다. 목적에 맞춰 작업을 기록하는 정책과 기존 지침 갱신, 노트 링크와 파일 끝 빈 줄 수정이 포함됐습니다.

Windows 설치 파일을 공개 주소에서 다시 내려받아 크기와 SHA-256을 비교했고 로컬 빌드와 같았습니다. Rust 211개, 지침 화면 33개, MCP 267개, 기록 표시 1,069개 검사도 통과했습니다.

앱 업데이트 후 프로젝트의 지침 쓰기에서 Codex 또는 Claude를 선택하면 기존 지침을 갱신할 수 있습니다. 실행 중인 MCP 연결도 다시 연결해 주세요. 이번 작업에서는 이 기기에 설치 프로그램을 실행하지 않았습니다.
