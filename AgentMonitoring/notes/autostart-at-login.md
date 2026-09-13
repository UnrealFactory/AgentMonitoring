---
name: autostart-at-login
title: "로그인 시 자동 실행 — Run 키, --autostart 숨김 시작, 배포 빌드 첫 실행 기본값"
type: memory
description: "v1.7.0: tauri-plugin-autostart로 HKCU Run 키에 --autostart를 등록하고, 그렇게 뜬 창은 트레이에만 둡니다. 배포 빌드 첫 실행은 기본 켬, 디버그 빌드는 기본 끔·표식 없음. check:autostart가 실제 데스크톱 앱에서 검증합니다."
agent: fable-unified-scaffold
updated_by: fable-unified-scaffold
created: 2026-09-13T11:40:58Z
updated: 2026-09-13T11:48:14Z
tags: []
refs: [WORK-0123, verify-desktop-via-cdp, handoff-v1-release]
---

2026-09-13 WORK-0123에서 추가한 로그인 시 자동 실행의 현재 동작입니다. v1.7.0(2026-09-13)에 포함됐습니다.

- **등록 방식**: tauri-plugin-autostart가 Windows HKCU `Software\Microsoft\Windows\CurrentVersion\Run`에 `AgentMonitoring = "<exe>" --autostart` 값을 씁니다. macOS는 LaunchAgent 방식으로 설정했지만 검증하지 않았습니다.
- **`--autostart`로 뜰 때는 창을 숨깁니다**: `tauri.conf.json`의 창이 `visible: false`로 만들어지고, setup에서 `--autostart` 인자가 없을 때만 `show_main_window`를 호출합니다. 트레이 아이콘을 만들지 못한 경우에는 인자와 무관하게 창을 보여 줍니다(숨긴 창 + 트레이 없음 = 되돌릴 수 없음). 단일 인스턴스 콜백과 트레이 클릭은 기존처럼 창을 띄웁니다.
- **기본값**: 배포(release) 빌드는 첫 실행에서 app_config_dir(`%APPDATA%\com.agentmonitoring.app`)에 `autostart.json` 표식이 없으면 등록을 켜고 표식을 씁니다. 스위치를 조작해도 표식을 씁니다. 그 뒤로는 사용자의 선택을 다시 뒤집지 않습니다. **디버그 빌드는 기본으로 켜지 않고 표식도 쓰지 않습니다** — `tauri dev`에서 스위치를 눌러 봐도 설치본의 첫 실행 기본값을 막지 않게 하기 위해서입니다.
- **UI**: 사이드바 아래(AppUpdate 다음) `src/components/Autostart.tsx`의 "시작 시 자동 실행" 스위치(role=switch). 저장된 설정이 아니라 실제 등록 상태를 `get_autostart`로 읽고, `set_autostart`는 등록 후 다시 읽은 상태를 돌려줍니다. 브라우저 모드에서는 그리지 않으므로 check:i18n·check:keys 같은 브라우저 검사에는 나타나지 않습니다.
- **검증 스크립트**: `npm run check:autostart`(scripts/check-autostart.mjs). `npm run dev`가 5173에 떠 있고 다른 인스턴스가 없어야 하며, 디버그 exe를 CDP(9223)로 직접 띄워 스위치 → Run 키 생성(`--autostart` 포함) → 새로고침 후 상태 유지 → 끄면 삭제 → `--autostart` 실행은 창 숨김 → 일반 실행은 창 표시를 확인합니다. 끝나면 Run 키를 정리합니다. 2026-09-13 6개 통과.
- 개발 중 스위치를 켜면 `target/debug/agentmonitoring.exe`가 Run 키에 들어갑니다. 시험 뒤에는 꺼 두세요(스크립트는 스스로 정리합니다).

## For humans

1.7.0(2026년 9월 13일 공개)부터 컴퓨터에 로그인하면 AgentMonitoring이 스스로 켜집니다. 이때는 창을 띄우지 않고 화면 오른쪽 아래 트레이에만 자리 잡으며, 트레이 아이콘을 누르면 창이 열립니다.

설치해서 쓰는 앱은 처음 실행할 때 자동 실행을 한 번 켜 두고, 그 뒤로는 사용자가 사이드바 아래 "시작 시 자동 실행" 스위치로 정한 대로 둡니다. 개발용으로 실행할 때는 자동으로 켜지 않습니다.

실제 설치형 프로그램 창을 자동으로 눌러 보는 검사로 여섯 가지를 확인했습니다.
