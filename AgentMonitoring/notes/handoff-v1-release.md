---
name: handoff-v1-release
title: v1.6.0 배포 완료 — 한국어 전용 UI와 프로젝트 정리
type: handoff
description: v1.6.0 소스·태그·설치 파일을 공개했고 다운로드 크기·SHA-256과 업데이트 경로를 검증했습니다. 이 기기의 설치본 업데이트는 실행하지 않았습니다.
agent: fable-release-builder
updated_by: codex
created: 2026-08-21T08:29:26Z
updated: 2026-09-08T12:29:32Z
tags: []
refs: [WORK-0119, WORK-0118, WORK-0116, BUG-0031, korean-only-ui, project-organization-and-create-defaults]
---

현재 공개 버전은 **v1.6.0**입니다(2026-09-08). WORK-0119 배포를 완료했습니다.

## 현재 배포

- 릴리스: https://github.com/UnrealFactory/AgentMonitoring/releases/tag/v1.6.0
- 최신 릴리스 API는 v1.6.0, draft=false, prerelease=false이며 공개 시각은 2026-09-08T12:28:02Z(한국 시각 21:28:02)입니다. 앱 업데이트 확인에 쓰는 /releases/latest의 HEAD 리다이렉트도 v1.6.0을 가리킵니다.
- 기능 커밋: be43b732e774a26f0cfeb1731176c9847b056c89입니다. main과 주석 태그 v1.6.0을 원자적으로 푸시했고 원격 태그가 같은 커밋을 가리킴을 확인했습니다. 배포 완료 기록은 후속 문서 커밋으로 남깁니다.
- 설치 파일: AgentMonitoring_1.6.0_x64-setup.exe, 8,261,051바이트입니다.
- SHA-256: 2e4f559ddf83306dfcf6afbb616cef89dce3cc47b5a51879722ad9f91e91263b입니다.
- 로컬 빌드, GitHub 자산 메타데이터, 공개 주소에서 다시 내려받은 파일의 크기·해시가 모두 일치했습니다. 앱·설치 파일 ProductVersion과 CLI --version은 1.6.0이며 번들 CLI와 target/release CLI의 해시도 같습니다.

## 포함된 변경과 적용 범위

앱의 영어 사전·언어 전환·설정 경로를 제거했습니다. 기존 영어 설정이 있어도 화면·날짜·트레이·업데이트 안내와 Windows 설치 프로그램은 한국어를 사용합니다. 자세한 결정은 [[korean-only-ui]]를 확인하세요.

프로젝트 정리 폴더 생성·이름 변경·삭제, 프로젝트의 폴더 간 드래그 이동, 폴더 및 폴더 안 프로젝트의 순서 저장을 포함합니다. 새 프로젝트는 AGENTS.md 한국어와 Codex MCP 추가가 기본입니다. 실제 프로젝트 파일은 이동하지 않습니다. 동작과 저장 위치는 [[project-organization-and-create-defaults]]에 있습니다. 개발 중 코드 갱신 뒤 화면이 비던 문제도 수정했습니다(WORK-0116, BUG-0030).

이 기기의 설치 프로그램 실행, .codex/config.toml 변경, 다른 프로젝트 지침 일괄 갱신은 하지 않았습니다. 공개 배포와 로컬 설치본 적용을 구분하세요. 실행 중인 MCP 연결은 앱 업데이트 후 재연결해야 새 서버 코드를 사용합니다. 기존 프로젝트 지침은 필요할 때 프로젝트 우클릭 → 지침 쓰기에서 갱신합니다.

## 검증

- 재개 후 npm run tauri:build가 CLI·프런트엔드·앱·NSIS까지 종료 0으로 완료됐습니다.
- Rust 212개, 키보드·메뉴 276개, 실시간 갱신 19개가 통과했습니다.
- 전체 한국어 검사 327화면과 960–1600px의 11개 너비에서 363회 판독이 통과했습니다.
- HUMAN_STYLE 전체 16,377자·compact 5,491자가 배포 CLI의 내장 내용과 같습니다.
- 이전 실행 기록의 한국어 시작 9개, 프로젝트 정리 19개, HMR 6회, 지침 26개, MCP 270개 성공을 확인했습니다. 남아 있던 로그에서도 화면 잘림 1,416회 로드·툴팁 234개, 오류 안내 7조건, 마크다운 1,105개 성공을 확인했습니다.
- 재개 중 발견한 BUG-0031은 앱의 잘림이 아니라 검사 도구의 코드 경계 오탐이었습니다. 구 코드에서 오탐을 재현했고 코드 앞뒤의 정상 단어 및 실제 단어 잘림 구분 4개를 확인했습니다. 앱 화면을 바꾸지 않고 검사 스크립트만 보완했습니다.
- 이번 작업에서 설치 프로그램 실행이나 실제 Codex 클라이언트 재연결은 시험하지 않았습니다.

## 다음 버전을 배포할 때

- package.json, src-tauri/tauri.conf.json, 루트 Cargo.toml의 버전과 package-lock.json·Cargo.lock의 로컬 패키지 버전을 맞춥니다. MCP 패키지 버전은 앱과 독립적입니다.
- 빌드와 공개를 나누면 node scripts/check-humanstyle-drift.mjs → npm run tauri:build → 소스 커밋·태그 푸시 → gh release create --verify-tag --notes-file 순서로 진행합니다. npm run release는 검사·빌드·GitHub 공개를 한 번에 수행하므로 소스와 태그를 먼저 정확히 푸시합니다.
- 설치 파일 이름 AgentMonitoring_<version>_x64-setup.exe를 유지합니다. 업데이트 코드가 이 이름으로 다운로드 주소를 만듭니다.
- HUMAN_STYLE 검사가 실패하면 배포 CLI를 다시 빌드합니다. 전체 문서와 compact 규칙 모두 바이너리 내장 내용과 같아야 합니다.
- Windows 설치 파일은 mcp/server.mjs·mcp/lib·mcp/node_modules와 CLI를 포함합니다. Tauri 리소스는 디렉터리 매핑을 유지하며 glob으로 평탄화하지 않습니다.
- PowerShell 5.1의 Invoke-WebRequest에는 -UseBasicParsing을 사용합니다. NSIS는 HKCU/Software/agentmonitoring/AgentMonitoring에 마지막 설치 위치를 기억하므로 시험 설치가 기본 설치 위치를 바꿀 수 있습니다.
- v1.1.0 이후 자동 업데이트는 기존 바탕화면 아이콘 상태를 보존합니다. .mcp.json은 Claude Code용이고 .codex/config.toml은 Codex용입니다.

중단 지점과 재개 경위는 WORK-0119에, 이전 배포는 WORK-0110 등 기존 WORK에 남아 있습니다.

## For humans

AgentMonitoring 1.6.0을 공개했습니다. 한국어 전용 화면과 프로젝트·폴더 정리, 순서 저장, 새 프로젝트 기본값 개선이 포함됐습니다.

공개 설치 파일을 다시 내려받아 로컬 빌드와 크기·SHA-256이 같음을 확인했고 앱의 최신 버전 확인 경로도 1.6.0을 가리킵니다. 빌드와 기능·화면 검사를 마쳤습니다. 이 기기에 설치 프로그램을 실행하지는 않았습니다.
