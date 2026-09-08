---
name: korean-only-ui
title: 앱은 한국어만 사용합니다
type: decision
description: 사용자 요청으로 한국어 전용 앱을 채택하고 v1.6.0에 공개했습니다. 영어 UI·설정 경로를 제거하고 트레이·업데이트·설치 프로그램도 한국어로 표시합니다.
agent: codex
updated_by: codex
created: 2026-09-08T11:47:15Z
updated: 2026-09-08T12:30:18Z
tags: []
refs: [WORK-0119, project-organization-and-create-defaults, handoff-v1-release]
---

2026-09-08 사용자 요청으로 한국어 전용 앱을 채택했고 WORK-0119에서 v1.6.0으로 공개했습니다. 배포 근거는 [[handoff-v1-release]]를 확인하세요.

- src/lib/i18n/ko.ts가 문구와 매개변수 타입의 단일 원본입니다. index.ts의 t()는 이 사전만 사용합니다. en.ts, LocaleToggle, 언어 store·구독·Tauri get_locale/set_locale IPC를 제거했습니다.
- 화면 언어는 ko이며 URL ?lang=en, agentmon.locale의 en, 구형 settings.json의 locale은 읽지 않습니다. 기존 설정 파일은 보존합니다.
- 날짜·차트·트레이·업데이트 스플래시와 오류 안내는 한국어입니다. tauri.release.conf.json의 NSIS languages는 Korean 하나이며 언어 선택창을 표시하지 않습니다.
- 새 프로젝트 지침 선택은 추가 안 함 / 한국어입니다. AGENTS.md 한국어·Codex MCP 추가가 기본이고 CLAUDE.md·Claude MCP는 추가 안 함입니다. 기존 프로젝트 우클릭 지침 쓰기도 한국어를 요청합니다.
- 기존 작성 기록·파일·식별자 같은 사용자 데이터는 번역하지 않습니다. CLI의 독립 언어 옵션과 기존 지침의 언어 보존은 호환성을 위해 유지합니다. 앱은 영어 UI나 영어 생성 선택을 제공하지 않습니다.
- check:locale은 scripts/check-korean-only.mjs입니다. 구 영어 프로필·새 프로필·저장소 거부에서 시작·재로드·새 프로젝트 폼·날짜·404를 검사합니다. 구 부팅 언어 경합 검사는 제거했으며 화면 검사는 한국어로 실행합니다.

## For humans

앱은 한국어로만 표시하며 이 변경을 1.6.0에 공개했습니다. 예전에 영어를 골랐더라도 한국어로 열리고, 트레이와 업데이트 안내, 설치 프로그램도 한국어입니다.

새로 만드는 지침은 한국어만 선택할 수 있습니다. 기존에 작성한 기록이나 지침은 자동 번역하지 않고 보존합니다.
