---
name: project-organization-and-create-defaults
title: "새 프로젝트 기본값(지침·MCP 통합), .claude/CLAUDE.md 위치와 사이드바 정리 폴더"
type: memory
description: "WORK-0122: 새 프로젝트는 추가/추가 안 함 한 선택으로 .claude/CLAUDE.md·AGENTS.md·.mcp.json·.codex/config.toml을 함께 만들고, 우클릭 지침 쓰기·MCP 추가하기는 Claude·Codex를 한 번에 처리합니다. v1.6.0의 드래그·순서 저장·우클릭 관리는 그대로입니다."
agent: codex
updated_by: fable-unified-scaffold
created: 2026-09-08T09:29:00Z
updated: 2026-09-13T11:26:56Z
tags: []
refs: [WORK-0111, WORK-0113, WORK-0115, WORK-0116, WORK-0117, WORK-0118, WORK-0119, WORK-0122, dev-hmr-context-identity, korean-only-ui, handoff-v1-release, mcp-client-registration]
---

2026-09-08 공개한 **v1.6.0**의 동작에 2026-09-13 WORK-0122의 새 프로젝트 기본값 변경을 반영한 현재 상태입니다. WORK-0111~0118에서 구현하고 WORK-0119에서 한국어 전용 UI와 함께 배포했으며, WORK-0122는 아직 배포 전 소스입니다. 배포 근거는 [[handoff-v1-release]], 언어 결정은 [[korean-only-ui]]를 확인하세요.

- **새 프로젝트 기본값(WORK-0122)**: 화면의 지침·MCP 선택은 **에이전트 지침·MCP → 추가 / 추가 안 함** 하나뿐이며 기본은 추가입니다. 추가는 `.claude/CLAUDE.md`(한국어), `AGENTS.md`(한국어), `.mcp.json`(작성자 claude), `.codex/config.toml`(작성자 codex)을 한 번에 만듭니다. 화면에서 작성자 이름은 바꾸지 않습니다. CLI `init`의 독립 플래그(`--claude-md`, `--agents-md`, `--claude-mcp`, `--codex-mcp`)와 언어 옵션, 기존 지침 언어 보존은 유지합니다. 이전(v1.6.0) 기본값 "AGENTS.md 한국어 + Codex MCP만"은 더 이상 유효하지 않습니다.
- **Claude 지침 파일 위치(WORK-0122)**: `write_claude_md`는 `<repo>/.claude/CLAUDE.md`에 씁니다(Codex의 `.codex/`처럼 폴더로 모음. Claude Code는 `./CLAUDE.md`와 `./.claude/CLAUDE.md`를 모두 읽습니다). 루트 `CLAUDE.md`에 이미 agentmon 구역(관리 마커 또는 정확한 구버전)이 있으면 그 자리에서 갱신하고 `.claude/`에 복사본을 만들지 않습니다(두 파일이 모두 로드되면 지침이 중복). 루트 `CLAUDE.md`가 사용자 소유(구역 없음)면 손대지 않고 `.claude/CLAUDE.md`를 새로 만듭니다. `AGENTS.md`는 Codex가 루트에서만 읽으므로 루트에 둡니다. `.mcp.json`도 루트에 남기는 이유는 [[mcp-client-registration]]에 있습니다.
- **기존 프로젝트 우클릭(WORK-0122)**: **지침 쓰기**는 `.claude/CLAUDE.md`와 `AGENTS.md`를, **MCP 추가하기**는 `.mcp.json`과 `.codex/config.toml`을 한 번에 씁니다. 하위 메뉴가 없고, 두 쓰기를 병렬로 실행해 하나가 실패해도 다른 하나는 진행하며, 결과가 같으면 한 문장, 다르면 파일별 절을 `·`로 이어 한 토스트로 보고합니다. 메뉴 항목 id는 그대로 `instructions`·`mcp`입니다.
- 사이드바 프로젝트 제목은 클릭하면 목록으로 이동하고 우클릭하면 폴더를 생성합니다. 폴더 우클릭 메뉴는 이름 변경·삭제입니다. 사이드바와 프로젝트 화면이 같은 메뉴를 쓰며 다른 화면에서도 이름 입력 대화상자를 열 수 있습니다. 상단 새 폴더 버튼과 미분류 그룹은 없습니다.
- 프로젝트를 끌어 폴더에 놓으면 옮기고, 프로젝트 제목이나 폴더 밖 목록에 놓으면 꺼냅니다. 대상 폴더를 강조하며 접힌 사이드바 폴더는 저장 성공 후 펼칩니다. 연결 불가 프로젝트도 프로젝트 목록에서 정리할 수 있습니다.
- 폴더 제목을 다른 폴더의 위·아래로 끌면 폴더 순서를 바꿉니다. 제목 위쪽 절반은 앞, 아래쪽 절반과 내부 영역은 뒤로 처리하며 삽입선을 표시합니다. 프로젝트 소속과 폴더 펼침 상태는 유지합니다. 폴더 중첩이나 폴더와 프로젝트를 섞는 정렬은 지원하지 않습니다.
- 같은 폴더의 프로젝트와 루트 프로젝트는 다른 프로젝트의 위·아래로 끌어 내부 순서를 바꿉니다. 삽입선을 표시하며 사이드바·프로젝트 화면이 같은 순서를 사용합니다. 활동 순서가 바뀌거나 앱을 다시 열어도 수동 순서를 유지합니다.
- 폴더 순서는 folders 배열, 프로젝트 순서는 projectOrder(폴더 id → 등록 경로 배열)에 저장합니다. 기존 설정에 projectOrder가 없으면 빈 순서로 읽습니다. 다른 폴더로 옮기면 이전 순서에서 제거하고 대상의 저장 순서가 있으면 뒤에 추가하며 다른 폴더 순서는 유지합니다.
- 같은 단계의 폴더와 프로젝트는 아이콘 중심·이름 시작점·글자 크기·행 높이를 맞춥니다. 펼침 화살표는 아이콘 왼쪽에 두고 폴더 안 프로젝트만 한 단계 들여씁니다.
- 끌기는 마우스·펜으로 6px 이상 움직이면 시작하고 터치로는 시작하지 않습니다. Esc·유효하지 않은 대상·창 비활성화는 취소합니다. 끌기 뒤 클릭으로 항목을 열거나 접지 않습니다. 저장 실패 시 이전 소속·순서를 유지하며 같은 순서는 다시 저장하지 않습니다. 클릭·우클릭·정리 폴더 선택기를 계속 사용할 수 있습니다.
- 실제 프로젝트 파일은 이동하지 않고 기기별 정리 정보만 저장합니다. 폴더를 삭제하면 포함 프로젝트는 루트로 나옵니다. 소속은 등록 경로로 기억하고 사이드바에는 읽을 수 있는 프로젝트만 표시합니다. 데스크톱은 app_config_dir/project-folders.json에 원자 저장하고 브라우저는 localStorage의 agentmon.projectFolders를 사용합니다.

주요 소스는 src/components/ProjectDrag.tsx, ProjectFolders.tsx, Sidebar.tsx, src/pages/ProjectsPage.tsx(새 프로젝트 폼), src/lib/menus.ts(우클릭 메뉴), src/lib/projectFolders.ts, src-tauri/src/project_folders.rs, crates/agentmon-core/src/claude_md.rs(지침 파일 위치)입니다. 새 공유 컨텍스트는 [[dev-hmr-context-identity]]의 stableContext 방식을 사용하세요.

검증: WORK-0118에서 한국어·영어 정리 38개와 HMR 6회, Rust 설정 왕복·기존 형식 호환, 빌드가 통과했고 프로젝트 삽입선 화면을 확인했습니다. WORK-0119에서 정리 19개·한국어 시작 9개·HMR 6회와 Rust 212개, 키보드·메뉴 276개, 실시간 갱신 19개, 전체 한국어 327화면 검사가 통과했습니다. WORK-0122에서는 Rust 단위 테스트(claude_md 10개 포함 전체 통과), `check:instructions` 28개, `check:project-folders` 19개, `check:locale`, `check:keys`, 프런트엔드 빌드를 통과했고 새 폼·메뉴 화면을 확인했습니다. 이전 다국어 검사는 당시 결과이며 현재 앱은 한국어만 제공합니다.

2026-09-08 WORK-0116~0117에서 개발 서버로 5175를 사용했습니다. 당시 5173은 다른 프로젝트였으므로 새 세션에서는 포트와 프로세스 소유를 먼저 확인하고 타 프로젝트 서버를 종료하지 마세요.

## For humans

프로젝트와 폴더를 끌어 정리하고 순서를 저장하는 기능을 1.6.0에 공개했습니다. 사이드바와 프로젝트 화면에서 같은 순서를 사용하며, 실제 프로젝트 파일의 위치는 바뀌지 않습니다.

2026년 9월 13일부터 새 프로젝트를 만들 때 지침 파일과 MCP 연결은 "추가 / 추가 안 함" 하나로 고릅니다. 추가를 고르면 Claude와 Codex용 파일이 모두 만들어지고, Claude용 지침 파일은 Codex처럼 전용 폴더(.claude) 안에 들어갑니다. 기존 프로젝트에서 우클릭할 때도 한 번에 두 도구를 처리합니다. 이 변경은 아직 공개 배포 전입니다.
