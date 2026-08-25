#!/usr/bin/env node
/**
 * Build throwaway Korean project folders with the release CLI.
 *
 *   node scripts/ko-vault.mjs [--out DIR]      # build them and print AGENTMON_DIRS
 *
 * Five rounds of Korean review read Korean chrome over English data, because the only vault
 * this repo has ever pointed the app at is its own — and its records are written in English
 * (P9 round 6 critic). That hole is not a missing assertion, it is a missing *fixture*: the
 * gates walk `.prose`, `.project-desc`, `.now-row-title` and `.feed-summary` on every screen
 * and every one of them held English, so "how does this app break a Korean line" was a
 * question nothing here could ask. A Korean team's vault is the ordinary case, not an exotic
 * one, and it took 59 mid-syllable splits to notice.
 *
 * Built rather than committed. The vault format is files the CLI writes — ids, event lines,
 * timestamps, `vault.json` — and a copy of it checked into git is a second implementation of
 * that format that rots the first time the real one changes. Building it with the release
 * binary means the fixture is by construction a vault this app's own CLI produces, and the
 * gate that uses it fails loudly when it is not.
 *
 * The Korean here is written, not translated: a payments team and a delivery-tracking team
 * writing up their own work, with the section headings the CLI requires and the ordinary
 * shape of a Korean engineering note. Long unbroken sentences on purpose — a line breaker is
 * only interesting where a line has to break.
 *
 * **And the records point at each other** (`--refs`), which is not decoration. A fixture is a
 * question the gate is able to ask, and the first version of this one had no refs at all, so
 * 관련 항목 was empty on every screen it swept and `.rel-title` — the one author-title box in
 * this app that *wraps* rather than ellipsising — was never handed a Korean title. The gate
 * asked the right question of the right screens and got no answer, while the live vault filled
 * the same box with English, which only breaks at spaces (P9 round 7 critic). So every record
 * the sweep opens has a rail: WORK-0003 points at BUG-0001 and WORK-0001, WORK-0002 at
 * BUG-0002, and 배송's bug at the work log that normalised the states it is about — which
 * fills both directions, since a reference is drawn on the record it points at too.
 *
 * Timestamps are relative to the moment it is built, so the dashboard's last-24-hours panel,
 * its hour strip and both burn-ups have something in them at every range.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "./dev-server.mjs";

export const CLI = join(
  repoRoot,
  "target",
  "release",
  process.platform === "win32" ? "agentmon.exe" : "agentmon",
);

/** ISO8601 for `hours` ago, which is how every record below places itself. */
const ago = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();

/**
 * The vault, as a list of CLI calls. Kept declarative so that reading this file tells you
 * what is in the fixture without running it.
 */
const PLAN = [
  ["gyeolje", "init",
    "--name", "결제 게이트웨이",
    "--description",
    "카드 결제 승인과 취소, 부분 환불, 그리고 매일 자정에 도는 정산 배치를 맡고 있는 서비스입니다. 가맹점별 정산 내역과 대사 결과도 여기서 만듭니다.",
    "--tags", "결제,정산",
    "--agent", "결제팀-에이전트",
    "--at", ago(72)],
  ["baesong", "init",
    "--name", "배송 추적",
    "--description",
    "주문 한 건이 창고를 떠나 문 앞에 닿기까지의 상태를 모읍니다. 택배사마다 다른 응답을 하나의 배송 상태로 정규화해서 고객 안내 문구를 만듭니다.",
    "--tags", "배송",
    "--agent", "배송팀-에이전트",
    "--at", ago(70)],

  ["gyeolje", "work", "start", "--agent", "결제팀-에이전트",
    "--title", "결제 승인 재시도 규칙을 어댑터 세 곳에서 한 모듈로 모으기",
    "--tags", "결제,재시도",
    "--started-at", ago(66),
    "--human",
    "카드 결제가 한 번에 안 됐을 때 다시 시도할지 말지를 정하는 규칙이 프로그램 세 군데에 따로 적혀 있었습니다. 같은 답을 받고도 어떤 곳은 다시 시도하고 어떤 곳은 그냥 실패로 끝내는 일이 실제로 있었고, 손님 쪽에서 보면 될 때도 있고 안 될 때도 있는 결제였습니다. 흩어진 규칙을 한곳에 모으는 일을 시작했습니다.",
    "--body", `## What
카드 결제 승인이 실패했을 때 다시 시도할지 말지를 정하는 규칙이 결제 어댑터 세 곳에 흩어져 있던 것을 한 모듈로 모았습니다.

## Why
카드사 응답 코드마다 재시도 여부가 다른데 그 판단이 어댑터마다 조금씩 달라서, 같은 응답 코드를 두고 한 어댑터는 다시 시도하고 다른 어댑터는 실패로 끝내는 일이 실제로 있었습니다. 어댑터마다 흩어진 상태 관리를 고치는 대신 상태를 만드는 자리를 하나로 줄이는 쪽을 골랐습니다.

## How
재시도 규칙과 함께 카드사 응답 코드 표를 재시도 정책 모듈로 옮기고, 어댑터는 그 판단을 받아서 쓰기만 합니다. 카드사별 예외는 표에 한 줄씩 적어 두었고, 사양서에 없는 응답 코드는 재시도하지 않는 쪽을 기본값으로 두었습니다.`],
  ["gyeolje", "work", "update", "WORK-0001", "--agent", "결제팀-에이전트",
    "--at", ago(40),
    "--message",
    "카드사 두 곳의 응답 코드 표를 옮겼습니다. 남은 한 곳은 사양서가 아직 오지 않아서 기다리는 중이고, 그동안은 기존 판단을 그대로 두었습니다.",
    "--human",
    "카드사 세 곳 가운데 두 곳의 규칙 표를 새 자리로 옮겼습니다. 남은 한 곳은 규칙이 적힌 문서가 아직 오지 않아 기다리는 중이고, 그동안 그 카드사 결제는 예전 방식 그대로 처리됩니다."],
  ["gyeolje", "work", "done", "WORK-0001", "--agent", "결제팀-에이전트",
    "--finished-at", ago(18),
    "--human",
    "이제 규칙이 한곳에만 있습니다. 카드사가 어떤 답을 보내오든 세 군데가 모두 같은 표를 보고 같은 판단을 하므로, 같은 결제가 어떤 날은 되고 어떤 날은 안 되는 일이 사라졌습니다. 테스트 마흔한 개와 실제 하루치 결제 기록을 다시 돌려서 확인했고, 사양서에 없는 답이 오면 다시 시도하지 않는 것이 기본값입니다.",
    "--outcome",
    "재시도 규칙은 한곳에 모았습니다. 어댑터 세 곳이 같은 표를 보고 같은 응답 코드에는 같은 답을 내며, 사양서에 없는 코드는 재시도하지 않습니다. 단위 테스트 마흔한 개와 실제 승인 로그 하루치를 다시 돌려서 확인했습니다."],

  ["gyeolje", "work", "start", "--agent", "정산-에이전트",
    "--title", "부분 환불 금액이 원 단위에서 어긋나는 문제를 정산 쪽에서 먼저 확인하기",
    "--tags", "정산,환불",
    "--refs", "BUG-0002",
    "--started-at", ago(9),
    "--human",
    "환불을 여러 번 나누어 받은 주문에서 마지막 환불 금액이 1원씩 어긋나는 일이 있습니다. 손님에게는 1원이지만 가게에 보내는 정산 금액이 맞지 않아, 그런 날은 담당자가 하루치를 손으로 다시 맞춰야 합니다. 반올림 자리를 옮겨 덮을 수도 있었지만 그러면 어긋난 이유를 영영 모르게 되므로, 금액이 어디서 갈라지는지부터 보고 있습니다. 아직 고쳐진 것은 없습니다.",
    "--body", `## What
부분 환불을 두 번 이상 나누어 받은 주문에서 마지막 환불 금액이 1원 어긋나는 일이 있어서, 정산 배치가 만드는 금액과 결제 승인 원장의 금액을 나란히 놓고 어디서 갈라지는지 보고 있습니다.

## Why
고객에게는 1원이지만 가맹점 정산에서는 대사가 맞지 않는 금액이고, 대사가 틀어진 날은 정산 담당자가 하루치를 손으로 다시 맞춰야 합니다. 반올림 자리를 옮기는 것으로 덮을 수도 있었지만 그러면 어긋난 이유를 영영 모르게 됩니다.

## How
환불 한 건을 원장, 정산 배치, 카드사 명세 세 곳에서 각각 꺼내 같은 화면에 놓는 작은 도구를 먼저 만들었습니다. 그다음 어긋난 주문 스물세 건을 그 도구로 훑어서 공통점을 찾습니다.`],
  ["gyeolje", "work", "update", "WORK-0002", "--agent", "정산-에이전트",
    "--at", ago(3),
    "--message",
    "어긋난 주문 스물세 건 가운데 열아홉 건이 환불을 세 번 이상 나눈 주문이었습니다. 나누어 담을 때마다 남은 금액을 다시 반올림하는 자리가 있는 것으로 보입니다.",
    "--human",
    "금액이 어긋난 주문 스물세 건을 하나씩 살펴보니 열아홉 건이 환불을 세 번 넘게 나눈 주문이었습니다. 환불을 나눌 때마다 남은 돈을 다시 반올림하는 곳이 있는 것 같아 그 자리를 찾는 중입니다."],

  ["gyeolje", "bug", "create", "--agent", "결제팀-에이전트",
    "--title", "장바구니에서 카드번호 입력 화면으로 넘어가면 결제 금액이 이전 금액으로 남아 있습니다",
    "--severity", "high",
    "--labels", "결제,장바구니",
    "--created-at", ago(30),
    "--human",
    "장바구니에서 수량을 바꾸고 곧바로 결제하기를 누르면, 카드번호를 넣는 화면에 바꾸기 전 금액이 그대로 남아 있습니다. 화면을 새로 고치면 제 금액이 나오니 서버가 보내 주는 값은 맞고, 화면이 옛 값을 들고 있는 것입니다. 수량을 바꾼 뒤 2초 안에 누를 때만 나타납니다.",
    "--body",
    "장바구니에서 수량을 바꾼 뒤 곧바로 결제하기를 누르면 카드번호 입력 화면의 결제 금액이 수량을 바꾸기 전 금액으로 남아 있습니다. 화면을 새로 고치면 올바른 금액이 나오므로 서버가 내려주는 값은 맞고, 화면이 들고 있는 값이 낡은 것으로 보입니다. 재현은 수량을 바꾼 뒤 2초 안에 결제하기를 누를 때만 됩니다."],
  ["gyeolje", "bug", "comment", "BUG-0001", "--agent", "정산-에이전트",
    "--at", ago(26),
    "--message",
    "장바구니 화면이 금액을 다시 계산하는 요청과 결제 화면으로 넘어가는 이동이 경쟁하는 것으로 보입니다. 이동을 막지 말고 결제 화면이 스스로 금액을 다시 물어보게 하는 편이 안전해 보입니다.",
    "--human",
    "장바구니가 새 금액을 계산하는 일과 결제 화면으로 넘어가는 일이 서로 앞서려다 생기는 문제로 보입니다. 넘어가는 것을 막기보다, 결제 화면이 열릴 때 금액을 한 번 더 물어보게 하는 쪽이 안전하다는 의견을 남겼습니다."],

  ["gyeolje", "bug", "create", "--agent", "정산-에이전트",
    "--title", "정산 배치가 자정에 두 번 도는 날이 있어 가맹점 정산 내역이 중복으로 만들어집니다",
    "--severity", "critical",
    "--labels", "정산,배치",
    "--created-at", ago(52),
    "--human",
    "하루에 한 번만 돌아야 하는 정산 계산이 한 달에 두세 번 같은 날짜로 두 번 돌아서, 가게에 보낼 정산 내역이 두 벌씩 만들어집니다. 그런 날은 정산 금액이 두 배로 잡히기 때문에 발견하는 대로 손으로 지우고 있습니다.",
    "--body",
    "일일 정산 배치가 자정에 한 번만 돌아야 하는데, 한 달에 두세 번 같은 날짜로 정산 내역이 두 벌 만들어집니다. 중복으로 만들어진 날은 가맹점에 나가는 정산 금액이 두 배가 되므로 발견 즉시 손으로 지우고 있습니다."],
  ["gyeolje", "bug", "resolve", "BUG-0002", "--agent", "결제팀-에이전트",
    "--at", ago(20),
    "--human",
    "이제 같은 날짜의 정산은 한 번만 만들어집니다. 원인은 자정을 두 번 지나는 날이 생겨 계산이 두 번 돈 것이었고, 실행한 시각 대신 정산할 날짜를 열쇠로 삼아 이미 있는 날짜면 두 번째 실행이 아무 일도 하지 않고 끝나게 했습니다. 지난 석 달치를 다시 돌려 중복이 하나도 생기지 않는 것을 확인했습니다.",
    "--resolution",
    "원인은 배치 스케줄러가 서머타임이 없는 지역에서도 자정을 두 번 지나는 날을 만들어 낸 것이었습니다. 고친 방법은 실행 시각이 아니라 정산 대상 날짜를 잠금 열쇠로 삼아, 같은 날짜의 정산이 이미 있으면 두 번째 실행이 아무 일도 하지 않고 끝나게 한 것입니다. 지난 석 달치 정산을 다시 돌려서 중복이 하나도 생기지 않는 것을 확인했습니다."],

  /* The work log the two bugs above point the reader at — and the record whose 관련 항목 rail
     is the one this fixture exists to fill (see the header). Two outgoing rows, both carrying
     a title somebody wrote long, which is the only shape `.rel-title` wraps in. */
  ["gyeolje", "work", "start", "--agent", "결제팀-에이전트",
    "--title", "결제 화면이 장바구니에서 받은 금액을 그대로 쓰지 않고 스스로 다시 물어보게 바꾸기",
    "--tags", "결제,장바구니",
    "--refs", "BUG-0001,WORK-0001",
    "--started-at", ago(8),
    "--human",
    "결제 화면이 장바구니에서 받은 금액을 그대로 믿고 그리던 것을, 화면이 열릴 때 스스로 한 번 더 물어보게 바꾸는 일입니다. 장바구니 쪽에서 화면 이동을 붙잡아 순서를 맞출 수도 있었지만, 그러면 답이 늦는 날 결제 흐름 전체가 멈춥니다. 금액이 달라졌으면 달라진 이유와 함께 보여 주고, 손님이 확인한 뒤에만 결제를 넘깁니다.",
    "--body", `## What
장바구니에서 넘겨받은 금액을 그대로 그리던 카드번호 입력 화면이, 열릴 때 주문 금액을 스스로 한 번 더 물어보고 그 답으로 그리도록 바꿉니다.

## Why
수량을 바꾼 직후에 결제하기를 누르면 금액을 다시 계산하는 요청과 화면 이동이 경쟁해서 낡은 금액이 남아 있었습니다. 장바구니 쪽에서 이동을 붙잡아 순서를 맞출 수도 있었지만, 그러면 느린 응답 하나가 결제 흐름 전체를 세웁니다. 금액을 아는 화면이 스스로 묻는 편이 화면 수가 늘어도 무너지지 않습니다.

## How
결제 화면이 열리면 주문 금액을 다시 물어보고, 답이 오기 전까지는 결제 버튼을 누를 수 없게 두었습니다. 금액이 달라졌으면 바뀐 금액과 달라진 이유를 함께 보여 주고, 사용자가 확인한 뒤에만 승인을 요청합니다.`],
  ["gyeolje", "work", "update", "WORK-0003", "--agent", "결제팀-에이전트",
    "--at", ago(2),
    "--message",
    "결제 화면이 금액을 다시 물어보는 부분까지 끝냈습니다. 금액이 달라졌을 때 보여 줄 안내 문구는 결제 흐름을 멈추지 않는 쪽으로 다시 쓰고 있습니다.",
    "--human",
    "결제 화면이 열릴 때 금액을 한 번 더 물어보는 부분은 끝났습니다. 금액이 달라졌을 때 보여 줄 안내 문구는, 결제하던 사람이 흐름을 잃지 않도록 고쳐 쓰는 중입니다."],

  /* The notes: the third record kind, in Korean, because the notes screens are swept by the
     same gates as the rest. Names are explicit ASCII — a fully Korean title has nothing to
     derive a kebab name from, which is itself the case worth fixturing (the CLI's own error
     says to pass --name). One note is updated after creation so 수정 ≠ 작성 renders. */
  ["gyeolje", "note", "add", "--agent", "결제팀-에이전트",
    "--name", "retry-policy-table",
    "--type", "memory",
    "--title", "카드사 응답 코드의 재시도 여부는 재시도 정책 모듈의 표가 원본입니다",
    "--description", "응답 코드별 재시도 여부를 고칠 때는 어댑터가 아니라 재시도 정책 모듈의 표를 고칩니다.",
    "--tags", "결제,재시도",
    "--refs", "WORK-0001",
    "--at", ago(16),
    "--human",
    "카드사 답에 다시 시도할지 말지는 재시도 정책 표 한 장이 원본이라는 것을 적어 둔 쪽지입니다. 다음 사람이 어댑터 쪽에 판단을 하나 더 붙이면 예전처럼 곳곳이 서로 다른 답을 하게 되므로, 예외는 반드시 표에 한 줄로 적으라는 뜻입니다.",
    "--body",
    "어댑터 세 곳이 같은 표를 읽습니다. 어댑터 쪽에서 판단을 덧붙이면 WORK-0001 이전의 상태로 돌아가는 것이므로, 카드사별 예외는 반드시 표에 한 줄로 적습니다. 사양서에 없는 응답 코드는 재시도하지 않는 것이 기본값입니다."],
  ["gyeolje", "note", "add", "--agent", "정산-에이전트",
    "--name", "refund-rounding-handoff",
    "--type", "handoff",
    "--title", "부분 환불 1원 오차 조사 인계",
    "--description", "어긋난 주문 스물세 건 중 열아홉 건이 세 번 이상 나눈 환불입니다. 반올림 자리부터 보세요.",
    "--tags", "정산,환불",
    "--refs", "WORK-0002,BUG-0002",
    "--at", ago(8),
    "--human",
    "1원 오차를 조사하던 사람이 다음 사람에게 남긴 인계 쪽지입니다. 고쳐진 것은 아직 없고, 어긋난 주문 스물세 건 가운데 열아홉 건이 환불을 세 번 이상 나눈 주문이었다는 데까지 와 있습니다. 먼저 볼 곳은 나눌 때마다 남은 금액을 다시 반올림하는 자리입니다.",
    "--body", `## 지금까지
원장·정산 배치·카드사 명세를 나란히 놓는 도구는 만들어져 있고, 어긋난 주문 스물세 건을 훑은 결과 열아홉 건이 환불을 세 번 이상 나눈 주문이었습니다.

## 먼저 할 일
나누어 담을 때마다 남은 금액을 다시 반올림하는 자리를 찾는 것입니다. 정산 배치 쪽이 아니라 환불 요청을 만드는 쪽일 가능성이 높습니다.`],
  /* Rewritten by a DIFFERENT agent on purpose: the list row and the detail byline show
     the last rewriter beside the author, and this is the fixture that puts that surface
     in front of the Korean gates. */
  ["gyeolje", "note", "update", "refund-rounding-handoff", "--agent", "결제팀-에이전트",
    "--at", ago(2),
    "--description",
    "반올림 자리는 환불 요청을 만드는 쪽으로 좁혀졌습니다. 남은 금액 계산 함수부터 보세요."],
  ["baesong", "note", "add", "--agent", "배송팀-에이전트",
    "--name", "carrier-status-source",
    "--type", "reference",
    "--title", "택배사별 상태 이름 원본 문서",
    "--description", "상태 표에 없는 이름을 만나면 각 택배사의 연동 사양서에서 원래 정의를 먼저 확인합니다.",
    "--tags", "배송,정규화",
    "--refs", "WORK-0001",
    "--at", ago(5),
    "--human",
    "택배사마다 다르게 부르는 배송 상태 이름의 원래 정의가 어디에 있는지 적어 둔 쪽지입니다. 표에 없는 이름을 만나면 짐작하지 말고 사양서부터 확인하라는 뜻이고, 표를 고칠 때는 사양서 판이 바뀌었는지 먼저 봅니다.",
    "--body",
    "택배사 세 곳의 연동 사양서는 사내 위키의 배송 연동 페이지에 모여 있습니다. 상태 표 파일과 사양서의 판번호를 함께 적어 두었으므로, 표를 고칠 때는 사양서 판이 바뀌었는지부터 확인합니다."],

  ["baesong", "work", "start", "--agent", "배송팀-에이전트",
    "--title", "택배사 세 곳의 배송 상태를 하나의 상태 값으로 정규화하기",
    "--tags", "배송,정규화",
    "--started-at", ago(46),
    "--human",
    "택배사마다 부르는 이름이 달라서, 같은 상황을 두고 화면마다 다른 말이 나오고 있었습니다. 배송 중과 간선 상차가 나란히 놓이면 손님은 두 가지 일이 일어난 줄로 읽습니다. 택배사들의 상태 이름을 우리 쪽 여섯 가지로 옮기는 표를 만드는 일을 시작했습니다.",
    "--body", `## What
택배사마다 다르게 부르는 배송 상태를 우리 쪽 상태 값 여섯 개로 옮기는 표를 만들고, 고객 안내 문구를 그 값에서만 만들도록 바꿨습니다.

## Why
택배사가 보내 주는 상태 이름을 그대로 화면에 쓰던 때에는 같은 상황을 두고 화면마다 다른 말이 나왔습니다. 배송 중과 간선 상차가 나란히 놓이면 고객은 두 가지 일이 일어났다고 읽습니다.

## How
상태 표는 택배사별로 한 파일씩 두고, 표에 없는 상태를 만나면 알 수 없음으로 두되 원래 이름을 기록에 남깁니다. 안내 문구는 우리 상태 값에서만 만들고 택배사 이름은 문구에 넣지 않습니다.`],
  ["baesong", "work", "done", "WORK-0001", "--agent", "배송팀-에이전트",
    "--finished-at", ago(6),
    "--human",
    "이제 안내 문구는 우리 쪽 상태 여섯 가지에서만 만들어집니다. 택배사 세 곳의 이름 마흔여덟 가지를 그 여섯 가지로 옮겼고, 표에 없는 이름은 알 수 없음으로 두되 원래 이름을 남기므로 새 상태가 생기면 다음 날 목록에서 바로 보입니다.",
    "--outcome",
    "택배사 세 곳의 상태 이름 마흔여덟 가지를 상태 값 여섯 개로 옮겼습니다. 표에 없는 이름은 알 수 없음으로 떨어지고 원래 이름이 기록에 남으므로, 새 상태가 생기면 다음 날 목록에서 바로 보입니다."],
  ["baesong", "bug", "create", "--agent", "배송팀-에이전트",
    "--title", "배송 완료 안내 문구가 반품 접수된 주문에도 그대로 나갑니다",
    "--severity", "medium",
    "--labels", "배송,안내",
    "--refs", "WORK-0001",
    "--created-at", ago(11),
    "--human",
    "반품을 보낸 손님에게 상품이 도착했다는 안내가 나갑니다. 택배사가 회수를 마쳤다고 알려 주면 우리 쪽에서는 배송이 끝난 것으로 읽기 때문이고, 가는 것과 오는 것을 구분하지 않은 것이 원인으로 보입니다.",
    "--body",
    "반품이 접수된 주문에서 택배사가 회수 완료를 보내면 우리 쪽에서는 배송 완료로 읽고, 고객에게 상품이 도착했다는 안내 문구가 나갑니다. 회수와 배송을 방향으로 구분하지 않은 것이 원인으로 보입니다."],
  /* A **mixed** handle, and the only one in this fixture: a Latin agent name with a Korean
     team on the end of it, which is what a Korean team's vault looks like the day it adopts
     an off-the-shelf agent. It is here because the monogram beside it is drawn by a function
     with a Korean branch and a Latin branch (agentInitials, src/components/ui.tsx), and a
     handle that is both went down the Korean one and came out as a lowercase "n" — the only
     lowercase monogram in an app full of uppercase ones (P9 rounds 7 and 8 critics). One
     comment on a swept screen is enough for the gate to read it. */
  ["baesong", "bug", "comment", "BUG-0001", "--agent", "nova-배송팀",
    "--at", ago(5),
    "--message",
    "회수 건은 택배사 응답에 방향 표시가 따로 오고 있어서, 상태 표에 방향 칸을 하나 더 두면 배송 완료와 회수 완료를 갈라낼 수 있습니다. 안내 문구는 그 뒤에 방향별로 나누어 쓰면 됩니다.",
    "--human",
    "택배사가 보내는 응답에는 물건이 가는 길인지 돌아오는 길인지가 따로 표시되어 있습니다. 상태 표에 그 방향 칸을 하나 더 두면 배송 완료와 회수 완료를 구분할 수 있다는 의견을 남겼습니다."],
];

/** Run one CLI call against `dir`, with the fixture's own error message on failure. */
const run = (dir, argv, base) => {
  try {
    execFileSync(CLI, ["--dir", dir, "--json", ...argv], {
      encoding: "utf8",
      // A scratch registry: fixtures must not bookmark themselves on the real machine.
      env: { ...process.env, AGENTMON_REGISTRY_DIR: join(base, ".registry") },
    });
  } catch (err) {
    throw new Error(
      `ko-vault: \`agentmon ${argv.slice(0, 3).join(" ")}\` failed — ${err.stdout || err.message}`,
    );
  }
};

/**
 * Build the fixture under `base` (default: a fresh temp directory) — one location per
 * project, each holding its AgentMonitoring folder — and return the project folders,
 * ready to join(";") into AGENTMON_DIRS. Nothing here touches the repo's own records;
 * the CLI is only ever handed `--dir`.
 */
export function buildKoreanProjects(base = mkdtempSync(join(tmpdir(), "agentmon-ko-"))) {
  if (!existsSync(CLI)) {
    throw new Error(
      `ko-vault: no release CLI at ${CLI}. Build it first: cargo build --release -p agentmon-cli`,
    );
  }
  const dirs = [];
  for (const [name, ...argv] of PLAN) {
    const dir = join(base, name);
    run(dir, argv, base);
    const root = join(dir, "AgentMonitoring");
    if (!dirs.includes(root)) dirs.push(root);
  }
  return dirs;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const i = process.argv.indexOf("--out");
  const out = i >= 0 ? process.argv[i + 1] : undefined;
  console.log(buildKoreanProjects(out).join(";"));
}
