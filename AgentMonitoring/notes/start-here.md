---
name: start-here
title: 시작 색인 — 현재 상태와 필요한 지침을 찾는 곳
type: essential
description: "공개 버전은 v1.6.0입니다. 배포는 handoff-v1-release, 한국어 전용 결정은 korean-only-ui, 프로젝트·폴더 정리는 project-organization-and-create-defaults를 읽으세요."
agent: fable-updater-splash
updated_by: codex
created: 2026-08-21T13:21:48Z
updated: 2026-09-08T12:30:18Z
tags: []
refs: [handoff-v1-release, korean-only-ui, project-organization-and-create-defaults, dev-hmr-context-identity, registry-sandbox-in-gates, python-is-a-store-stub, record-screens-have-two-halves, human-area-enforcement, notes-are-knowledge-not-history, verify-desktop-via-cdp, chart-note-series-colour, scene-geometry-is-measured, quality-bars, event-reconciliation, work-boundaries-and-explanatory-visuals-proposal, WORK-0119]
---

이 노트는 세션마다 읽는 기억 색인입니다. status로 현재 작업과 열린 버그를 확인하고 이번 주제의 관련 노트를 여세요. 목록이 잘리면 같은 조건의 note limit/offset으로 이어 읽습니다.

## 현재 상태

- **공개 버전은 v1.6.0입니다(2026-09-08).** [[handoff-v1-release]]에 소스·태그·설치 파일과 공개 다운로드 검증, 다음 배포 절차를 정리했습니다. WORK-0119를 완료했으며 이 기기의 설치 프로그램 실행은 하지 않았습니다.
- **한국어 전용 앱**: [[korean-only-ui]]는 사용자가 채택한 결정과 적용 범위를 설명합니다. 영어 UI·언어 설정 경로를 제거했지만 기존 기록·파일은 번역하지 않습니다.
- **프로젝트·폴더 정리**: [[project-organization-and-create-defaults]]에 드래그 이동·폴더 및 내부 프로젝트 순서 저장·우클릭 관리, AGENTS.md 한국어·Codex MCP 기본값을 정리했습니다. v1.6.0에 포함됐습니다.
- **WORK·메모리·그림 정책**: [[work-boundaries-and-explanatory-visuals-proposal]]은 WORK-0108에서 구현·검증한 현재 v4 결정입니다. 이름에 proposal이 남았어도 유형은 decision입니다. 기존 프로젝트 지침은 앱의 지침 쓰기에서 갱신하고 MCP는 다시 연결합니다. .codex/config.toml은 기기별 설정으로 커밋하지 않았습니다.

## 작업 전에

- [[dev-hmr-context-identity]]: 패치 뒤 검은 화면을 고친 BUG-0030, stableContext와 check:hmr를 설명합니다. 새 창만 열어 보는 것으로 코드 갱신 검증을 대신하지 마세요.
- [[registry-sandbox-in-gates]]: agentmon init을 쓰는 검사는 별도의 AGENTMON_REGISTRY_DIR를 설정합니다.
- [[python-is-a-store-stub]]: Python 실행 별칭 함정과 Node 스크립트 사용 안내입니다.
- [[record-screens-have-two-halves]]: 화면 검사 전에 기술·사람 영역 중 확인할 영역을 선택합니다.
- 전체 한국어 검사의 인라인 코드 경계 오탐은 WORK-0119에서 BUG-0031로 수정했습니다. 단어 시작과 끝의 텍스트 노드 경계를 다르게 처리해야 검사 제외된 코드가 다시 범위에 들어오지 않습니다.

## 관련 지침

| 대상 | 노트 |
|---|---|
| human 필수·날짜별 추가·전체 교체·v4 전달 | human-area-enforcement |
| 그림·실제 크기·의미 검증 | scene-geometry-is-measured |
| 실제 데스크톱 앱 Playwright 검사 | verify-desktop-via-cdp |
| 이벤트 로그·활동 목록·doctor | event-reconciliation |
| 차트 색상 | chart-note-series-colour |
| 화면·제품 품질 | quality-bars |
| 노트 갱신·삭제와 작업 이력 | notes-are-knowledge-not-history |

WORK는 목적과 완료 조건이 있는 개발·수정·검증 또는 독립 조사 단위입니다. 설명 대화마다 기록을 쪼개지 않고 같은 목적의 미완료 WORK를 이어갑니다. 상세 이력은 WORK, 현재 유효한 지식은 주제별 노트에 두고 이 색인은 길잡이로 유지하세요.

## For humans

공개 버전은 1.6.0입니다. 한국어 전용 화면과 프로젝트·폴더 드래그, 순서 저장을 배포했고 공개 설치 파일까지 확인했습니다. 이 기기에 설치 프로그램을 실행하지는 않았습니다.

작업을 시작할 때 진행 중인 기록을 확인하고, 배포·언어 결정·프로젝트 정리 등 주제에 맞는 노트를 읽으시면 됩니다.
