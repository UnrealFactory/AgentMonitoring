---
name: handoff-v1-release
title: v1.5.1 배포 완료 — Claude·Codex MCP 추가와 프로젝트 하위 메뉴
type: handoff
description: v1.5.1을 main·태그와 함께 공개했습니다. 설치 파일을 다시 다운로드하여 크기·SHA-256 일치를 확인했습니다. 개발 앱과 서버는 종료했습니다.
agent: fable-release-builder
updated_by: codex
created: 2026-08-21T08:29:26Z
updated: 2026-09-05T11:13:22Z
tags: []
refs: [WORK-0099, WORK-0101, WORK-0103]
---

현재 공개 버전은 **v1.5.1**입니다(2026-09-05).

## 현재 배포

- 릴리스: https://github.com/UnrealFactory/AgentMonitoring/releases/tag/v1.5.1
- GitHub 최신 릴리스 API에서 v1.5.1, draft=false, prerelease=false, 공개 시각 2026-09-05T11:09:55Z를 확인했습니다.
- v1.5.1 태그가 가리키는 기능 커밋: c289bab940799dd6249353f076ccd3233340542b. main과 주석 태그를 origin에 푸시했습니다. 배포 완료 기록은 후속 문서 커밋으로 남깁니다.
- 설치 파일: AgentMonitoring_1.5.1_x64-setup.exe, **8,245,386바이트**.
- SHA-256: **34df333304168645ee0b2a2b49cfe58ede01ed3113d26cb25ded2ced931f4c2f**.
- 로컬 빌드, GitHub 자산 메타데이터, 공개 자산을 다시 내려받은 파일의 크기·해시가 일치했습니다. 로컬 앱 실행 파일의 ProductVersion과 FileVersion도 1.5.1입니다.
- WORK-0099는 MCP 생성 기능, WORK-0101은 프로젝트 메뉴 정리, WORK-0103은 버전 변경·커밋·푸시·설치 파일 공개 기록입니다.
- 사용자 확인용 개발 앱과 5173 서버는 배포 전에 종료했습니다. 로컬 설치 프로그램은 실행하지 않았습니다.

## 배포된 기능과 검증

새 프로젝트에서 CLAUDE.md와 AGENTS.md를 각각 또는 함께 만들고 언어를 독립적으로 선택합니다. 두 파일은 같은 템플릿의 독립적인 복사본입니다. 지침 파일 생성만으로 MCP가 등록되지는 않습니다.

MCP 추가는 Claude와 Codex를 각각 또는 함께 선택합니다. Claude는 .mcp.json, Codex는 .codex/config.toml의 [mcp_servers.agentmon]에 작성합니다. Codex 설정의 다른 항목·주석을 보존하고 같은 등록을 중복하지 않습니다. 잘못된 TOML은 오류를 반환하며 덮어쓰지 않습니다. Codex의 프로젝트 신뢰 설정은 변경하지 않습니다.

기존 프로젝트 우클릭 메뉴는 지침 쓰기 → Claude / Codex, MCP 추가하기 → Claude / Codex의 두 단계입니다. 하위 메뉴는 화면 가장자리에서 방향을 바꾸며 키보드로 열기·닫기·이전 항목 복귀를 지원합니다.

CLI는 init --claude-mcp / --codex-mcp, project claude-mcp / codex-mcp입니다. 이전 --mcp-json / project mcp-json은 Claude 등록 별칭입니다. 작성자 기본값은 claude와 codex이며 init의 --mcp-agent / --codex-agent로 바꿉니다. 새 프로젝트 화면 기본 선택은 기존처럼 Claude만 켜져 있습니다. 지침은 init --agents-md ko|en, project agents-md --lang ko|en으로도 생성합니다.

- Codex 설정 코어 테스트 4개, 최종 check:instructions 23개, check:keys 276개가 통과했습니다. 파일 생성·보존·오류 처리·별칭, 한국어/영어 화면, 하위 메뉴 키보드와 화면 양쪽 아래 위치를 확인했습니다.
- 실제 WebView2에서 생성과 갱신·이미 등록된 경우·잘못된 TOML을 별도 임시 프로젝트/레지스트리/앱 식별자로 검증했습니다. Codex 클라이언트의 실제 재연결은 시험하지 않았습니다.
- 배포용 CLI 1.5.1을 다시 빌드한 후 check:instructions 23개와 node scripts/check-humanstyle-drift.mjs가 통과했습니다.
- npm run tauri:build가 프런트엔드·앱·NSIS 설치 파일 빌드까지 종료 코드 0으로 완료되었습니다.
- 새 기록 파일의 마지막 빈 줄은 기록 도구가 생성한 형식이라 직접 수정하지 않았습니다. 소스 파일 대상 git 공백 검사는 통과했습니다.

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

2026년 9월 5일, AgentMonitoring 1.5.1을 공개했습니다. Claude와 Codex의 연결 설정 생성 기능과 프로젝트 메뉴 정리가 포함되어 있습니다.

**공개된 설치 파일까지 확인했습니다.** GitHub에서 설치 파일을 다시 내려받아 크기와 SHA-256을 비교했습니다. SHA-256은 파일 내용이 같은지 확인하는 값입니다. 포장을 마친 물건을 다시 열어 출고품과 대조하는 것과 같습니다. 두 값 모두 로컬 빌드와 같았습니다.

**앱 제작과 동작 검사를 통과했습니다.** 파일 생성과 화면 선택 검사 23개, 키보드 검사 276개가 통과했습니다. 배포용 빌드도 완료했습니다. 설치 프로그램을 직접 실행하거나 Codex에서 실제 재연결하는 과정은 시험하지 않았습니다.

현재 다운로드 가능한 버전은 1.5.1이며, 개발 앱과 서버는 종료했습니다.
