---
name: work-boundaries-and-explanatory-visuals-proposal
title: 기록 정책 v4 — 목적 단위 WORK·현재 지식·내용에 맞는 그림
type: decision
description: "2026-09-06 승인·구현한 정책입니다. 설계 대화에서 WORK를 만들지 않고, 개발·별도 조사와 중요한 진척만 기록합니다. 새 에이전트 인계와 그림 생성까지 검증했습니다."
agent: codex
updated_by: codex
created: 2026-09-06T09:28:42Z
updated: 2026-09-06T10:07:43Z
tags: [기록정책, 메모리, 설명이미지, 검증]
refs: [WORK-0107, WORK-0108]
---

# 채택과 적용 범위

2026-09-06 사용자께서 WORK-0107의 개선 방향을 수정·적용하고 서브에이전트로 검증하도록 승인하셨습니다. WORK-0108에서 구현했습니다. 이 노트는 이전의 채택 전 검토안을 현재 정책과 실제 결과로 갱신한 것입니다.

현재 소스와 재빌드한 `target/release/agentmon.exe`에 반영되어 있습니다. 이 저장소의 AGENTS.md는 갱신하고 CLAUDE.md에는 기존 프로젝트 규칙을 보존하여 관리 구간을 추가했습니다. **설치 앱 공개 배포와 다른 프로젝트의 지침 갱신은 수행하지 않았습니다.** 설치된 MCP 서버를 가리키는 `.codex/config.toml`도 변경하지 않았습니다.

# 현재 정책

| 상황 | 기록 |
|---|---|
| 질문·설명·제안·이해 정정 | 새 WORK나 반복 진척을 만들지 않습니다. |
| 다음 작업에도 필요한 사실·범위가 바뀜 | 기존 주제 노트에 반영합니다. 변한 지식이 없으면 다시 쓰지 않습니다. |
| 개발·수정·검증 또는 별도로 맡긴 조사 | 목적·범위·완료 조건으로 WORK를 엽니다. |
| 같은 목적의 구현·검증·후속 수정 | 기존 미완료 WORK를 이어갑니다. |
| 일시 중단·새 세션으로 이동 | in_progress와 handoff를 유지합니다. 영구 중단만 abandon입니다. |
| 완료 조건 충족 | 검증 결과와 한계를 outcome으로 남깁니다. |
| 미채택 제안 / 채택 결정 | 구별하며 decision은 실제 채택한 결정에만 사용합니다. |

사람 설명은 핵심 변화·이유·작동 방식·근거와 한계를 담습니다. 짧은 진척은 한두 문단으로 충분합니다. 필수 다섯 단계 서사·비유·마지막 교훈·문단별 SVG를 없앴습니다. 어려운 관계·순서·분기·해제·전후 변화는 시간축·연결도·전후 비교·실제 화면 주석·표·실측 그래프 등 알맞은 형식으로 보여줍니다. 자동 기하 검사 통과와 사람의 이해도를 구분합니다.

# 구현 위치

- 한·영 지침: `crates/agentmon-core/templates/claude-md.{ko,en}.md`의 관리 구간 version=2입니다.
- 기존 지침 갱신: `claude_md.rs`가 version marker 안만 갱신하고 사용자 앞뒤 내용과 기존 언어를 보존합니다. legacy v1 원본 완전 일치 구간만 자동 이전하며, 손상·미래 marker나 사용자가 바꾼 legacy는 덮어쓰지 않고 병합 안내를 반환합니다.
- 도구: `mcp/lib/tools.mjs`에 목적 기준 설명과 note 목록 limit/offset을 추가했습니다. `format.mjs`는 600자 안에서 이름과 설명을 한 항목으로 유지하고 다음 offset을 제공합니다. 관련 기억을 검색·조회하고 필요한 페이지를 이어서 읽습니다.
- refs·화면: `write.rs`와 `src/lib/record-ref.ts`는 숫자 접미사를 가진 WORK/BUG만 기록 번호로 구분합니다. work-/bug- 접두사 노트는 정상 노트 참조·화면·메뉴를 사용합니다(FB-0004).
- 사람 설명: `docs/HUMAN_STYLE.md` v4, 코어 doctor 안내와 검사 기준을 일치시켰습니다. 문서 전체와 compact는 CLI에 내장하므로 재빌드가 필요합니다.
- 그림 검사: `scripts/check-scenes.mjs --asset <filename.svg>`로 게시 전 초안을 검사합니다. 상속·인라인·tspan 글꼴, 조상 변환, root/viewBox 비율과 원점을 반영합니다. 양수 고정 root 크기를 요구하며 화면 배치 통과를 이해도 증명으로 표현하지 않습니다.

# 서브에이전트 행동 검증

시험 데이터와 레지스트리는 모두 OS 임시 폴더로 격리했습니다. baseline은 git HEAD의 기존 지침, updated는 수정 지침을 읽은 별도 새 에이전트입니다. resume 에이전트에는 이전 대화를 주지 않고 프로젝트 경로·현재 지침·작업 재개 요청만 제공했습니다.

| 시나리오 | 확인한 실제 결과 |
|---|---|
| 개념 설명 → await 장단점 → Entity 관계라는 정정 | baseline: 완료 WORK 2개·Correction 업데이트 1개. updated: WORK 0개·미확정 reference 1개. |
| 제안 채택 후 구현, 검증은 다음 세션으로 보류 | updated: WORK-0001 하나를 in_progress로 유지. 기존 reference를 decision으로 갱신하고 handoff 작성. 테스트 실행·완료 처리는 하지 않았습니다. |
| 이전 대화 없는 새 에이전트가 재개 | 노트와 status로 맥락 확인. WORK-0001을 이어받아 자동검사 12/12·예제·구문 검사를 통과하고 같은 WORK를 완료. decision 갱신 및 끝난 handoff 제거. 새 WORK 없음. |
| 별도로 맡긴 이벤트/주기 확인 비교 보고서 | comparison-report.md를 작성하고 별도 WORK-0002로 완료. 코드 기반 개념 비교로 표시하며 성능 측정치를 만들지 않았습니다. |

최종 임시 프로젝트 상태를 직접 재조회하여 WORK 2개 모두 done, 진행 0개, decision 1개, handoff 0개를 확인했습니다. 이는 제한된 시나리오의 실제 관찰이며 모든 모델·대화에서의 성공률을 측정한 실험은 아닙니다.

원본 증거 위치:
- baseline: `C:/Users/User/AppData/Local/Temp/agentmon-behavior-baseline-f1ccc8e3926a40cebbe5bf080df67fbe`
- updated/resume: `C:/Users/User/AppData/Local/Temp/agentmon-behavior-updated-c12e10fee0c9`
- 각 레지스트리는 별도의 `agentmon-behavior-*-registry-*` 임시 폴더입니다. 원본 모델은 독립 Node.js 시험물이며 실제 게임 엔진·네트워크 동작의 증거가 아닙니다.

![새 세션의 에이전트가 생성한 참조와 연결의 차이, 대상 소멸 시 해제를 설명하는 관계도](assets/recording-v4-agent-connection-result.svg)

위 그림은 재개 에이전트가 생성한 실제 결과물의 복사본입니다. 점선은 참조 ID, 초록 화살표는 사용 가능한 연결, 주황 ×는 연결 부재, 점선 원은 대상 부재를 나타냅니다. 395px 렌더링은 `assets/recording-v4-agent-connection-result-395.png`로 보존했습니다.

# 검증과 한계

- Rust 코어·CLI 전체 테스트, 최종 doctor 집중 11개, MCP 최종 267개, 지침 생성 CLI·브라우저 33개, Markdown smoke 1,062개, geometry 회귀 7개, 프런트엔드 build 및 Tauri cargo check가 통과했습니다.
- 최종 HUMAN_STYLE 전체 16,377자·compact 5,491자가 소스와 CLI 내장 규칙에 일치했습니다.
- 독립 리뷰가 발견한 옛 doctor 안내 문구, 잘못된 SVG 비율의 작은 글자 통과, 0 크기 허용, viewBox 원점 오판을 수정하고 재현 사례가 해소됐음을 재확인했습니다.
- 실제 WebView 앱 설치·공개 배포·실제 Codex 클라이언트 재연결은 이번 범위에 포함하지 않았습니다. 개별 UI 참조 경로는 공통 함수를 통한 회귀 검증이며 새 링크 클릭의 실앱 검증은 하지 않았습니다.

다음 세션에서는 기존 설치 앱을 최신 소스로 공개하려면 별도 배포 작업으로 진행하세요. 재발한 사례가 생기면 대화 흐름·실제 기록 선택을 이 시험과 비교하시면 됩니다.

## For humans

기록을 질문 수가 아니라 하나의 작업 목적에 맞추도록 바꿨습니다. 설명만 요청한 대화에는 WORK를 만들지 않고, 개발이나 별도로 맡긴 조사에 기록을 남깁니다. 필요한 현재 지식은 기존 노트에서 갱신합니다.

같은 질문 세 번을 기존 지침과 새 지침의 에이전트에게 각각 주었습니다. 기존 방식은 완료 작업 두 개와 정정을 만들었습니다. 새 방식은 작업 없이 미확정 참고 노트 하나를 남겼습니다. 실제 개발을 요청하고 중간에 멈추자 진행 중 작업과 인계가 유지됐고, 다음 에이전트가 기억을 읽어 검사 12개를 마친 뒤 같은 작업을 완료했습니다.

![서브에이전트가 참조와 실제 연결, 대상 소멸의 차이를 보여준 결과](assets/recording-v4-agent-connection-result.svg)

그림도 문장 상자를 반복하는 대신 대상과 연결 상태를 보여주도록 안내합니다. 위 그림은 새 에이전트가 만든 시험 결과이며 실제 게임 실행 화면은 아닙니다. 코드와 그림 검사는 통과했지만 이 사례만으로 모든 대화의 성공을 보장하지는 않습니다. 저장소 지침과 개발용 CLI에 반영했으며 설치 앱 공개 배포는 아직 하지 않았습니다.
