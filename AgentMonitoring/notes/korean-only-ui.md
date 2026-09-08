---
name: korean-only-ui
title: 앱은 한국어만 사용합니다
type: decision
description: WORK-0119에서 사용자 요청에 따라 앱 영어 사전·전환·설정 경로를 제거했습니다. 화면·트레이·업데이트·설치 프로그램과 새 지침 생성은 한국어입니다.
agent: codex
updated_by: null
created: 2026-09-08T11:47:15Z
updated: 2026-09-08T11:47:15Z
tags: []
refs: [WORK-0119, project-organization-and-create-defaults, handoff-v1-release]
---

2026-09-08 사용자 요청으로 한국어 전용 앱을 채택했습니다. 공개 배포는 WORK-0119에서 진행하며, 실제 배포 상태는 handoff-v1-release를 확인하세요.

- src/lib/i18n/ko.ts가 문구와 매개변수 타입의 단일 원본입니다. index.ts의 t()는 이 사전만 사용합니다. en.ts, LocaleToggle, 언어 store·구독·Tauri get_locale/set_locale IPC를 제거했습니다.
- 화면 언어는 ko이며 URL ?lang=en, agentmon.locale의 en, 구형 settings.json의 locale은 읽지 않습니다. 기존 파일을 삭제하지 않아 다른 기기 설정을 건드리지 않습니다.
- 날짜·차트·트레이·업데이트 스플래시와 오류 안내는 한국어입니다. tauri.release.conf.json의 NSIS languages는 Korean 하나이며 언어 선택창을 표시하지 않습니다.
- 새 프로젝트 지침 생성 선택은 추가 안 함 / 한국어입니다. 기본값은 AGENTS.md 한국어·Codex MCP 추가, CLAUDE.md·Claude MCP 추가 안 함입니다. 기존 프로젝트 우클릭 지침 쓰기도 한국어를 요청합니다.
- 기존 작성 기록·파일·식별자 같은 사용자 데이터는 번역하지 않습니다. CLI의 독립 언어 옵션과 기존 지침의 언어 보존은 호환성을 위해 유지합니다. 앱에서 영어 UI나 영어 생성 선택을 제공하지 않습니다.
- check:locale은 scripts/check-korean-only.mjs이며 구 영어 프로필·새 프로필·저장소 거부에서 시작/재로드/새 프로젝트 폼/날짜/404를 검사합니다. 기존 부팅 언어 경합 검사는 제거했습니다. 화면 검사는 한국어로 실행합니다.

## For humans

이제 앱은 한국어로만 표시합니다. 예전에 영어를 골랐더라도 한국어로 열리고, 언어 전환 버튼은 사라집니다. 트레이와 업데이트 안내, 설치 프로그램도 한국어입니다.

새 프로젝트에서 만드는 지침 파일은 한국어만 선택할 수 있습니다. 기존에 작성한 기록이나 지침 내용은 자동 번역하지 않고 보존합니다.
