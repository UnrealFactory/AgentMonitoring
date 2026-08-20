#!/usr/bin/env node
/**
 * Build a throwaway vault whose **records** are Korean, with the release CLI.
 *
 *   node scripts/ko-vault.mjs [--out DIR]      # build one and print its path
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
  ["project", "create", "gyeolje",
    "--name", "결제 게이트웨이",
    "--description",
    "카드 결제 승인과 취소, 부분 환불, 그리고 매일 자정에 도는 정산 배치를 맡고 있는 서비스입니다. 가맹점별 정산 내역과 대사 결과도 여기서 만듭니다.",
    "--tags", "결제,정산",
    "--agent", "결제팀-에이전트",
    "--at", ago(72)],
  ["project", "create", "baesong",
    "--name", "배송 추적",
    "--description",
    "주문 한 건이 창고를 떠나 문 앞에 닿기까지의 상태를 모읍니다. 택배사마다 다른 응답을 하나의 배송 상태로 정규화해서 고객 안내 문구를 만듭니다.",
    "--tags", "배송",
    "--agent", "배송팀-에이전트",
    "--at", ago(70)],

  ["work", "start", "-p", "gyeolje", "--agent", "결제팀-에이전트",
    "--title", "결제 승인 재시도 규칙을 어댑터 세 곳에서 한 모듈로 모으기",
    "--tags", "결제,재시도",
    "--started-at", ago(66),
    "--body", `## What
카드 결제 승인이 실패했을 때 다시 시도할지 말지를 정하는 규칙이 결제 어댑터 세 곳에 흩어져 있던 것을 한 모듈로 모았습니다.

## Why
카드사 응답 코드마다 재시도 여부가 다른데 그 판단이 어댑터마다 조금씩 달라서, 같은 응답 코드를 두고 한 어댑터는 다시 시도하고 다른 어댑터는 실패로 끝내는 일이 실제로 있었습니다. 어댑터마다 흩어진 상태 관리를 고치는 대신 상태를 만드는 자리를 하나로 줄이는 쪽을 골랐습니다.

## How
재시도 규칙과 함께 카드사 응답 코드 표를 재시도 정책 모듈로 옮기고, 어댑터는 그 판단을 받아서 쓰기만 합니다. 카드사별 예외는 표에 한 줄씩 적어 두었고, 사양서에 없는 응답 코드는 재시도하지 않는 쪽을 기본값으로 두었습니다.`],
  ["work", "update", "WORK-0001", "-p", "gyeolje", "--agent", "결제팀-에이전트",
    "--at", ago(40),
    "--message",
    "카드사 두 곳의 응답 코드 표를 옮겼습니다. 남은 한 곳은 사양서가 아직 오지 않아서 기다리는 중이고, 그동안은 기존 판단을 그대로 두었습니다."],
  ["work", "done", "WORK-0001", "-p", "gyeolje", "--agent", "결제팀-에이전트",
    "--finished-at", ago(18),
    "--outcome",
    "재시도 규칙은 한곳에 모았습니다. 어댑터 세 곳이 같은 표를 보고 같은 응답 코드에는 같은 답을 내며, 사양서에 없는 코드는 재시도하지 않습니다. 단위 테스트 마흔한 개와 실제 승인 로그 하루치를 다시 돌려서 확인했습니다."],

  ["work", "start", "-p", "gyeolje", "--agent", "정산-에이전트",
    "--title", "부분 환불 금액이 원 단위에서 어긋나는 문제를 정산 쪽에서 먼저 확인하기",
    "--tags", "정산,환불",
    "--refs", "BUG-0002",
    "--started-at", ago(9),
    "--body", `## What
부분 환불을 두 번 이상 나누어 받은 주문에서 마지막 환불 금액이 1원 어긋나는 일이 있어서, 정산 배치가 만드는 금액과 결제 승인 원장의 금액을 나란히 놓고 어디서 갈라지는지 보고 있습니다.

## Why
고객에게는 1원이지만 가맹점 정산에서는 대사가 맞지 않는 금액이고, 대사가 틀어진 날은 정산 담당자가 하루치를 손으로 다시 맞춰야 합니다. 반올림 자리를 옮기는 것으로 덮을 수도 있었지만 그러면 어긋난 이유를 영영 모르게 됩니다.

## How
환불 한 건을 원장, 정산 배치, 카드사 명세 세 곳에서 각각 꺼내 같은 화면에 놓는 작은 도구를 먼저 만들었습니다. 그다음 어긋난 주문 스물세 건을 그 도구로 훑어서 공통점을 찾습니다.`],
  ["work", "update", "WORK-0002", "-p", "gyeolje", "--agent", "정산-에이전트",
    "--at", ago(3),
    "--message",
    "어긋난 주문 스물세 건 가운데 열아홉 건이 환불을 세 번 이상 나눈 주문이었습니다. 나누어 담을 때마다 남은 금액을 다시 반올림하는 자리가 있는 것으로 보입니다."],

  ["bug", "create", "-p", "gyeolje", "--agent", "결제팀-에이전트",
    "--title", "장바구니에서 카드번호 입력 화면으로 넘어가면 결제 금액이 이전 금액으로 남아 있습니다",
    "--severity", "high",
    "--labels", "결제,장바구니",
    "--created-at", ago(30),
    "--body",
    "장바구니에서 수량을 바꾼 뒤 곧바로 결제하기를 누르면 카드번호 입력 화면의 결제 금액이 수량을 바꾸기 전 금액으로 남아 있습니다. 화면을 새로 고치면 올바른 금액이 나오므로 서버가 내려주는 값은 맞고, 화면이 들고 있는 값이 낡은 것으로 보입니다. 재현은 수량을 바꾼 뒤 2초 안에 결제하기를 누를 때만 됩니다."],
  ["bug", "comment", "BUG-0001", "-p", "gyeolje", "--agent", "정산-에이전트",
    "--at", ago(26),
    "--message",
    "장바구니 화면이 금액을 다시 계산하는 요청과 결제 화면으로 넘어가는 이동이 경쟁하는 것으로 보입니다. 이동을 막지 말고 결제 화면이 스스로 금액을 다시 물어보게 하는 편이 안전해 보입니다."],

  ["bug", "create", "-p", "gyeolje", "--agent", "정산-에이전트",
    "--title", "정산 배치가 자정에 두 번 도는 날이 있어 가맹점 정산 내역이 중복으로 만들어집니다",
    "--severity", "critical",
    "--labels", "정산,배치",
    "--created-at", ago(52),
    "--body",
    "일일 정산 배치가 자정에 한 번만 돌아야 하는데, 한 달에 두세 번 같은 날짜로 정산 내역이 두 벌 만들어집니다. 중복으로 만들어진 날은 가맹점에 나가는 정산 금액이 두 배가 되므로 발견 즉시 손으로 지우고 있습니다."],
  ["bug", "resolve", "BUG-0002", "-p", "gyeolje", "--agent", "결제팀-에이전트",
    "--at", ago(20),
    "--resolution",
    "원인은 배치 스케줄러가 서머타임이 없는 지역에서도 자정을 두 번 지나는 날을 만들어 낸 것이었습니다. 고친 방법은 실행 시각이 아니라 정산 대상 날짜를 잠금 열쇠로 삼아, 같은 날짜의 정산이 이미 있으면 두 번째 실행이 아무 일도 하지 않고 끝나게 한 것입니다. 지난 석 달치 정산을 다시 돌려서 중복이 하나도 생기지 않는 것을 확인했습니다."],

  /* The work log the two bugs above point the reader at — and the record whose 관련 항목 rail
     is the one this fixture exists to fill (see the header). Two outgoing rows, both carrying
     a title somebody wrote long, which is the only shape `.rel-title` wraps in. */
  ["work", "start", "-p", "gyeolje", "--agent", "결제팀-에이전트",
    "--title", "결제 화면이 장바구니에서 받은 금액을 그대로 쓰지 않고 스스로 다시 물어보게 바꾸기",
    "--tags", "결제,장바구니",
    "--refs", "BUG-0001,WORK-0001",
    "--started-at", ago(8),
    "--body", `## What
장바구니에서 넘겨받은 금액을 그대로 그리던 카드번호 입력 화면이, 열릴 때 주문 금액을 스스로 한 번 더 물어보고 그 답으로 그리도록 바꿉니다.

## Why
수량을 바꾼 직후에 결제하기를 누르면 금액을 다시 계산하는 요청과 화면 이동이 경쟁해서 낡은 금액이 남아 있었습니다. 장바구니 쪽에서 이동을 붙잡아 순서를 맞출 수도 있었지만, 그러면 느린 응답 하나가 결제 흐름 전체를 세웁니다. 금액을 아는 화면이 스스로 묻는 편이 화면 수가 늘어도 무너지지 않습니다.

## How
결제 화면이 열리면 주문 금액을 다시 물어보고, 답이 오기 전까지는 결제 버튼을 누를 수 없게 두었습니다. 금액이 달라졌으면 바뀐 금액과 달라진 이유를 함께 보여 주고, 사용자가 확인한 뒤에만 승인을 요청합니다.`],
  ["work", "update", "WORK-0003", "-p", "gyeolje", "--agent", "결제팀-에이전트",
    "--at", ago(2),
    "--message",
    "결제 화면이 금액을 다시 물어보는 부분까지 끝냈습니다. 금액이 달라졌을 때 보여 줄 안내 문구는 결제 흐름을 멈추지 않는 쪽으로 다시 쓰고 있습니다."],

  ["work", "start", "-p", "baesong", "--agent", "배송팀-에이전트",
    "--title", "택배사 세 곳의 배송 상태를 하나의 상태 값으로 정규화하기",
    "--tags", "배송,정규화",
    "--started-at", ago(46),
    "--body", `## What
택배사마다 다르게 부르는 배송 상태를 우리 쪽 상태 값 여섯 개로 옮기는 표를 만들고, 고객 안내 문구를 그 값에서만 만들도록 바꿨습니다.

## Why
택배사가 보내 주는 상태 이름을 그대로 화면에 쓰던 때에는 같은 상황을 두고 화면마다 다른 말이 나왔습니다. 배송 중과 간선 상차가 나란히 놓이면 고객은 두 가지 일이 일어났다고 읽습니다.

## How
상태 표는 택배사별로 한 파일씩 두고, 표에 없는 상태를 만나면 알 수 없음으로 두되 원래 이름을 기록에 남깁니다. 안내 문구는 우리 상태 값에서만 만들고 택배사 이름은 문구에 넣지 않습니다.`],
  ["work", "done", "WORK-0001", "-p", "baesong", "--agent", "배송팀-에이전트",
    "--finished-at", ago(6),
    "--outcome",
    "택배사 세 곳의 상태 이름 마흔여덟 가지를 상태 값 여섯 개로 옮겼습니다. 표에 없는 이름은 알 수 없음으로 떨어지고 원래 이름이 기록에 남으므로, 새 상태가 생기면 다음 날 목록에서 바로 보입니다."],
  ["bug", "create", "-p", "baesong", "--agent", "배송팀-에이전트",
    "--title", "배송 완료 안내 문구가 반품 접수된 주문에도 그대로 나갑니다",
    "--severity", "medium",
    "--labels", "배송,안내",
    "--refs", "WORK-0001",
    "--created-at", ago(11),
    "--body",
    "반품이 접수된 주문에서 택배사가 회수 완료를 보내면 우리 쪽에서는 배송 완료로 읽고, 고객에게 상품이 도착했다는 안내 문구가 나갑니다. 회수와 배송을 방향으로 구분하지 않은 것이 원인으로 보입니다."],
];

/** Run one CLI call against `dir`, with the fixture's own error message on failure. */
const run = (dir, argv) => {
  try {
    execFileSync(CLI, ["--vault", dir, "--json", ...argv], { encoding: "utf8" });
  } catch (err) {
    throw new Error(
      `ko-vault: \`agentmon ${argv.slice(0, 3).join(" ")}\` failed — ${err.stdout || err.message}`,
    );
  }
};

/**
 * Build the fixture in `dir` (default: a fresh temp directory) and return its path.
 * Nothing here touches ./vault; the CLI is only ever handed `--vault dir`.
 */
export function buildKoreanVault(dir = mkdtempSync(join(tmpdir(), "agentmon-ko-"))) {
  if (!existsSync(CLI)) {
    throw new Error(
      `ko-vault: no release CLI at ${CLI}. Build it first: cargo build --release -p agentmon-cli`,
    );
  }
  run(dir, ["init", "--name", "한국어 기록 볼트"]);
  for (const argv of PLAN) run(dir, argv);
  return dir;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const i = process.argv.indexOf("--out");
  const out = i >= 0 ? process.argv[i + 1] : undefined;
  console.log(buildKoreanVault(out));
}
