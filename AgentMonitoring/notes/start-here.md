---
name: start-here
title: 시작 색인 — 현재 상태와 필요한 지침을 찾는 곳
type: essential
description: "현재 공개 버전은 v1.5.2입니다. 배포·적용 절차는 handoff-v1-release, 기록 정책과 행동 검증은 work-boundaries-and-explanatory-visuals-proposal에서 확인하세요."
agent: fable-updater-splash
updated_by: codex
created: 2026-08-21T13:21:48Z
updated: 2026-09-06T10:24:43Z
tags: []
refs: [handoff-v1-release, registry-sandbox-in-gates, python-is-a-store-stub, record-screens-have-two-halves, human-area-enforcement, notes-are-knowledge-not-history, verify-desktop-via-cdp, chart-note-series-colour, scene-geometry-is-measured, quality-bars, event-reconciliation, work-boundaries-and-explanatory-visuals-proposal, WORK-0108, WORK-0110]
---

# 먼저 확인하세요

이 노트는 세션마다 읽는 기억 색인입니다. `status`로 현재 작업과 열린 버그를 확인하고 이번 주제에 필요한 노트만 여세요. 목록이 잘렸으면 현재 소스 MCP의 note limit/offset으로 다음 페이지를 읽을 수 있습니다.

- **공개 배포 상태·다음 배포 절차**: `handoff-v1-release`를 먼저 읽으세요. 공개 버전과 개발 소스 변경을 구분합니다.
- **현재 소스의 WORK·메모리·그림 정책(2026-09-06)**: [[work-boundaries-and-explanatory-visuals-proposal]]을 읽으세요. 사용자 승인 후 WORK-0108에서 구현·행동 검증한 v4 정책입니다. 이름에 proposal이 남아 있지만 현재 노트 유형은 decision입니다.
- **적용 범위**: 기록 정책·지침 갱신과 피드백 수정을 v1.5.2로 공개했습니다(WORK-0110). 이 기기의 설치 프로그램 실행과 다른 프로젝트 지침 일괄 갱신은 하지 않았습니다. 앱 업데이트 뒤 각 프로젝트에서 지침 쓰기 → Codex / Claude를 실행하고 MCP 연결을 다시 연결하세요. `.codex/config.toml`은 기기별 설정으로 커밋하지 않았습니다.

# 스크립트·검사 전에

- `registry-sandbox-in-gates`: agentmon init을 쓰는 검사는 별도의 AGENTMON_REGISTRY_DIR를 설정해야 합니다.
- `python-is-a-store-stub`: Python 실행 별칭 함정과 Node 스크립트 사용 안내입니다.
- `record-screens-have-two-halves`: 화면 검사 전에 기술/사람 영역 중 검사할 영역을 선택하세요.

# 관련 기능을 다룰 때

| 대상 | 노트 |
|---|---|
| human 필수·날짜별 추가·전체 교체·v4 전달 | `human-area-enforcement` |
| 그림 형식·초안 검사·실제 크기와 의미 검증의 차이 | `scene-geometry-is-measured` |
| 실제 데스크톱 앱 Playwright 검사 | `verify-desktop-via-cdp` |
| 이벤트 로그·활동 목록·doctor의 과거 불일치 | `event-reconciliation` |
| 차트 색상 | `chart-note-series-colour` |
| 화면·제품 품질 기준 | `quality-bars` |
| 노트 갱신·삭제와 작업 이력의 차이 | `notes-are-knowledge-not-history` |

# 기억을 유지하는 기준

WORK는 목적과 완료 조건을 가진 개발·수정·검증 또는 별도로 맡긴 조사에 사용합니다. 질문·설명·정정마다 새 기록을 만들지 않습니다. 필요한 현재 지식이 바뀌면 기존 주제 노트를 갱신하고, 채택 전 제안은 decision으로 확정하지 않습니다. 미완료 작업은 다음 세션에도 같은 WORK와 handoff로 이어갑니다.

상세 결과와 근거는 해당 WORK·노트에 두고 이 색인은 길잡이로 유지하세요. 관련 사실이 바뀌면 노트와 색인을 함께 최신화하세요.

## For humans

현재 공개 버전은 1.5.2입니다. 새 기록 정책은 질문마다 작업을 만들지 않고 개발 목적과 필요한 현재 지식을 이어가도록 바뀌었습니다.

배포 파일 확인 결과와 적용 방법은 배포 노트에 있습니다. 앱 업데이트 후 각 프로젝트에서 지침 쓰기를 실행하면 기존 지침을 갱신할 수 있습니다. 이 기기의 설치본 적용과 다른 프로젝트 파일 갱신은 별도입니다.
