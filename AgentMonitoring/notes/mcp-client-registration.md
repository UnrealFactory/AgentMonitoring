---
name: mcp-client-registration
title: MCP 지원 범위는 Claude·Codex(항상 함께) — Cursor 제외
type: decision
description: "Claude Code·Codex MCP를 앱에서는 항상 함께 등록합니다(WORK-0122). .mcp.json은 Claude Code가 루트에서만 읽어 이동하지 않으며, Cursor는 사용자 결정으로 제외합니다."
agent: codex
updated_by: fable-unified-scaffold
created: 2026-09-05T11:52:08Z
updated: 2026-09-13T11:48:14Z
tags: []
refs: [WORK-0104, WORK-0105, WORK-0122, project-organization-and-create-defaults, handoff-v1-release]
---

2026-09-05 사용자께서 **Cursor는 필요하지 않고 사용하지 않는다**고 명시하셨습니다. 참고 문서 언급을 지원 범위로 해석하여 WORK-0104에서 추가했던 Cursor 코드는 WORK-0105에서 모두 철회했습니다. 다음 세션에서 Cursor 지원을 다시 추가하지 마세요.

지원 범위는 Claude Code와 Codex 두 도구이며, 2026-09-13 WORK-0122(v1.7.0)부터 앱은 두 도구를 **항상 함께** 처리합니다.

- Claude Code: `.mcp.json`의 `mcpServers.agentmon`, CLI `init --claude-mcp` / `project claude-mcp`(`--mcp-json` / `project mcp-json`은 별칭). Claude Code는 프로젝트 범위 MCP를 저장소 루트 `.mcp.json`에서만 읽으므로 이 파일은 `.claude/` 안으로 옮기지 않습니다(공식 문서 확인).
- Codex: `.codex/config.toml`의 `[mcp_servers.agentmon]`, CLI `init --codex-mcp` / `project codex-mcp`. 다른 TOML 설정·주석을 보존하며 신뢰한 프로젝트에서만 읽힙니다.
- 앱: 새 프로젝트 화면의 단일 선택 **에이전트 지침·MCP → 추가**가 두 등록을 함께 만들고, 기존 프로젝트 우클릭의 **MCP 추가하기** 한 항목이 두 등록을 병렬로 실행해 파일별 결과를 한 토스트로 보고합니다. 화면에는 Claude/Codex 하위 메뉴가 없습니다. 개별 선택은 CLI 플래그로만 합니다.
- 기록 작성자 기본값은 claude·codex이며 화면에서는 바꾸지 않습니다(CLI `--mcp-agent`, `--codex-agent`, `--agent`로만 변경).
- AGENTS.md·CLAUDE.md 생성과 MCP 등록은 CLI에서 독립적이고, 앱에서는 각각 **지침 쓰기**·**MCP 추가하기** 항목으로 나뉩니다. 지침 파일 위치는 [[project-organization-and-create-defaults]]를 보세요.

검증은 WORK-0122의 `check:instructions` 28개(CLI·폼·메뉴 실제 파일 쓰기)로 했습니다. 실제 클라이언트 접속 시험은 하지 않았습니다.

WORK-0104의 세 클라이언트 그림과 완료 내용은 철회 전 이력입니다. 현재 기능 판단에는 이 노트와 WORK-0105, WORK-0122를 사용하세요.

## For humans

2026년 9월 5일, 사용자께서 Cursor는 사용하지 않으므로 제외한다고 정하셨습니다. 지원 대상은 Claude Code와 Codex 두 도구입니다.

2026년 9월 13일 공개한 1.7.0부터는 두 도구를 따로 고르지 않습니다. 새 프로젝트를 만들 때 "추가"를 고르거나, 기존 프로젝트에서 "MCP 추가하기"를 한 번 누르면 두 도구의 연결 설정이 함께 만들어집니다. Claude용 연결 파일은 Claude Code가 저장소 맨 위에서만 읽기 때문에 그 자리에 그대로 둡니다.
