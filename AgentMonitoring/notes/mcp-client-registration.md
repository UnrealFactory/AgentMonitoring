---
name: mcp-client-registration
title: MCP 지원 범위는 Claude·Codex — Cursor 제외
type: decision
description: 2026-09-05 사용자께서 Cursor는 사용하지 않으므로 제외하셨습니다. WORK-0104의 추가분은 전부 철회했으며 기존 Claude·Codex 구현을 유지합니다.
agent: codex
updated_by: codex
created: 2026-09-05T11:52:08Z
updated: 2026-09-05T11:53:44Z
tags: []
refs: [WORK-0104, WORK-0105, handoff-v1-release]
---

2026-09-05 사용자께서 **Cursor는 필요하지 않고 사용하지 않는다**고 명시하셨습니다. 참고 문서 언급을 지원 범위로 해석하여 WORK-0104에서 추가했던 Cursor 코드는 WORK-0105에서 모두 철회했습니다. 다음 세션에서 Cursor 지원을 다시 추가하지 마세요.

현재 소스는 기존 v1.5.1의 Claude·Codex 개별 선택 기능을 유지합니다.

- Claude Code: `.mcp.json`의 `mcpServers.agentmon`, `init --claude-mcp` / `project claude-mcp`입니다. `--mcp-json` / `project mcp-json`은 기존 별칭입니다.
- Codex: `.codex/config.toml`의 `[mcp_servers.agentmon]`, `init --codex-mcp` / `project codex-mcp`입니다. 다른 TOML 설정·주석을 보존하며 신뢰한 프로젝트에서만 읽힙니다.
- 새 프로젝트 화면과 기존 프로젝트 MCP 하위 메뉴에서 각각 선택합니다. 작성자 핸들은 기록 작성자만 바꿉니다.
- AGENTS.md·CLAUDE.md 생성과 MCP 등록은 독립적입니다.

복원한 개발 CLI·프런트엔드 빌드와 `AGENTMON_BIN=target/debug/agentmon.exe`를 사용한 `check:instructions` 23개가 통과했습니다. 기존 `.codex/config.toml`은 수정하지 않았습니다. Cursor 추가와 철회 작업에서 커밋·배포 또는 실제 클라이언트 접속 시험은 수행하지 않았습니다.

WORK-0104의 세 클라이언트 그림과 완료 내용은 철회 전 이력입니다. 현재 기능 판단에는 이 노트와 WORK-0105를 사용하세요.

## For humans

2026년 9월 5일, 사용자께서 Cursor는 사용하지 않으므로 제외한다고 정하셨습니다. 추가했던 기능은 되돌렸고 기존 Claude·Codex 선택을 유지합니다.

**참고로 등장한 도구를 구현 대상으로 넓게 해석했습니다.** 이제 지원 범위는 사용자께서 사용하는 두 도구입니다. 선택지 목록에서 불필요한 항목을 다시 거둔 것과 같습니다.

**복원한 기능의 검사 23개가 통과했습니다.** 화면과 명령줄에서 설정 파일을 생성하는 검사입니다. 실제 클라이언트 접속이나 배포는 수행하지 않았습니다.

Cursor는 현재 지원 범위에 포함하지 않습니다.
