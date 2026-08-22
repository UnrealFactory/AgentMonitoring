/**
 * 한국어 — the app's own words, in Korean. Typed against `en.ts`, so a missing key is a
 * compile error rather than an English word that survives into the Korean screens.
 *
 * ## The words, decided once
 *
 * This is the Korean half of lib/words.ts's law — **one word per state, one noun per
 * object** — and the mapping below is the whole vocabulary. Nothing on any screen, in any
 * tooltip, in any chart legend, may use a synonym of these.
 *
 *   작업 로그   a work log (never 기록, 항목, 로그 alone)
 *   버그        a bug
 *   메모        a **note** — the shared knowledge record (memory / handoff / decision /
 *               reference). Deliberately not 노트: this app already spends 노트 on the
 *               progress notes inside a work log (진행 노트), and one word may not name
 *               two objects. Its four kinds: 지식 · 인계 · 결정 · 참조.
 *   기록        a **record**: the three nouns above, when which one it is cannot be known —
 *               a stale link, a ref chip, the backend's own `record 'BUG-9999' not found`.
 *               Never a work log that is known to be one; that is 작업 로그, always.
 *   에이전트    an agent
 *   프로젝트 폴더  the `AgentMonitoring` folder — the directory of plain files a project's
 *               records live in, inside the repo it describes. The v1 word 볼트 is gone
 *               from the product and from this file with it.
 *   삭제        deleting a project: the folder and its files, gone from the disk. The app's
 *               one destructive word, and it is used for nothing else — never for closing a
 *               bug, abandoning work or dismissing a line (닫기 · 중단 · 해제). Taking a
 *               note off the board is **제거** (the 목록에서 제거 word): a note is
 *               knowledge being retired with its event left on the feed, not a folder of
 *               history being destroyed.
 *
 *   work:  진행 중 · 완료 · 중단
 *   bug:   열림 · 진행 중 · 해결됨 · 닫힘
 *   the two bug states that still need somebody, as a set: **미해결** (= 열림 또는 진행 중)
 *   담당자 없음  a bug nobody holds (`unassigned`) — a condition, not a state
 *   심각도: 치명적 · 높음 · 보통 · 낮음
 *
 *   등록 / 등록자   filing a bug, and whoever filed it. **Never 신고 / 신고자.** English
 *               spends two words on this act (file / report) and Korean was spending two
 *               with them: the same bug was 등록 in its time row, its chart legend and the
 *               agents table, and 신고 in the people row and the side panel of the record
 *               it belonged to — 등록 and 신고 naming one event on one screen (P9 round 1
 *               critic). 등록 is the word Korean trackers use for creating an issue, so it
 *               takes the act, the person (등록자) and the section (등록 내용, beside
 *               해결 내용).
 *
 * **Why Korean abbreviates nothing.** English shortens severity to C/H/M/L in a narrow bug
 * row. Korean cannot, because a Hangul syllable is not an initial: the first syllable of
 * 높음 and 낮음 is 높 and 낮, bound stems of 높다/낮다 that never stand alone, 보 is half of
 * 보통, and 낮 *is* a word — it means **daytime** — printed in the column that is supposed
 * to say lowest severity. The board did exactly this for a round, so between 960px and
 * 1058px the row's chip read 낮 while the severity legend 100px above it read 낮음: one
 * value, two spellings, one screen (P9 round 3 critic). Nor was anything bought. Measured
 * in this app at the pill's own 11px: 치명적 33.72px, 높음/보통/낮음 22.48px each, against
 * Critical 43.08, High 28.48, Medium 49.52, Low 25.56. Every Korean word is narrower than
 * the English word it replaces — 낮음 is narrower than Low, and the widest Korean word is
 * 16px narrower than Medium, which the app prints in full one pixel above the threshold.
 * The 760px rule was cut to fit "Medium"; Korean was being abbreviated for a constraint
 * only English has. So `word.sevAbbr.*` is empty here, and the column keeps the word.
 *
 * **Why `open` is 열림 and not 미해결.** The brief suggested 미해결 for a bug's `open`
 * state. That spends the name of the *set* on one of the two members inside it — exactly
 * the defect the P6 critic caught in English ("an Open 5 tab above an Open 3 group, and a
 * claimed bug under a heading saying nobody had it"). 미해결 is the honest Korean for
 * "not resolved yet", which is precisely 열림 ∪ 진행 중, so it is kept for the union; the
 * single state takes 열림, the word Korean issue trackers already use for it. Everything
 * else in the brief's list is unchanged: 진행 중 / 완료 / 중단, 해결됨 / 닫힘.
 *
 * ## The grammar rules this file keeps
 *
 *   * **Counts carry their counter and their denominator.** `12개 중 2개 진행 중`, never a
 *     bare "2 진행 중" and never a numerator without what it is out of.
 *   * **No guessed particles.** Labels are phrased so that 은/는/이/가/을/를 never has to
 *     follow an agent name, a project name or a record title — those are Latin slugs out of
 *     the vault, and no rule picks the right particle for them. Where a name must be joined,
 *     it is joined with `·`, `—` or a noun ending, not with a particle.
 *   * **Endings are short and even.** Screen chrome is noun-final (진행 중, 마지막 활동),
 *     sentences that address the reader end in -습니다. A dense table does not shout.
 *   * **Technical tokens stay as written**: WORK-0001, BUG-0004, UTC, agentmon, vault.json,
 *     file paths, agent handles, tags. They are data, not language.
 */
import type { Dict } from "./en";

export const ko: Dict = {
  /* -- the app, the shell ---------------------------------------------------- */

  "app.name": "AgentMonitoring",
  "app.mainNav": "주요 메뉴",
  "app.loading": "불러오는 중",
  "app.loadingShort": "불러오는 중…",
  "app.retry": "다시 시도",
  "app.dismiss": "닫기",
  "app.cancel": "취소",
  "app.copy": "복사",
  "app.copied": "복사됨",
  "app.selectIt": "직접 선택",
  "app.copyToClipboard": "클립보드에 복사",
  "app.notFound.title": "화면이 없습니다",
  "app.notFound.sub": "이 주소에 해당하는 화면이 앱에 없습니다.",

  /* -- the window's own title bar (desktop only) ----------------------------
     Windows' own Korean words for these buttons: 최소화 · 최대화 · 이전 크기로 · 닫기.
     A title bar this app draws itself has no licence to invent new ones — a reader who
     has used a window before already knows what they are called. */

  "window.minimize": "최소화",
  "window.maximize": "최대화",
  "window.restore": "이전 크기로",
  "window.close": "닫기",
  "window.closeToTray": "닫기 — 앱은 트레이에서 계속 실행됩니다",

  /* -- mouse gestures (desktop) ----------------------------------------------
     우클릭 드래그 중 말풍선에 뜨는 말: 지금 손을 떼면 무엇이 실행되는지를 동작이 일어나기
     전에 이름으로 보여 준다 (components/MouseGestures.tsx). */

  "gesture.scrollTop": "맨 위로",
  "gesture.scrollBottom": "맨 아래로",
  "gesture.back": "뒤로",
  "gesture.forward": "앞으로",
  "gesture.refresh": "기록 새로 읽기",
  "gesture.maximize": "창 최대화",
  "gesture.restore": "이전 크기로",
  "gesture.close": "창 닫기",

  "shell.trouble.headline": "지금 기록을 읽지 못하고 있습니다.",
  /* 경로 뒤에 조사를 붙이지 않는다 — 이 파일의 규칙이고, "…\records 에서"처럼 한 칸 띄운 조사는
     그 규칙을 어긴 흔적이다. 경로는 문장 끝에 이름표를 달아 따로 붙인다. */
  "shell.trouble.body": (path, when) =>
    `아래 내용은 마지막으로 정상 조회한 데이터입니다. 기준 시각 ${when}${path ? ` · 폴더 경로 ${path}` : ""}`,

  /* -- language ------------------------------------------------------------- */

  "locale.label": "언어",
  "locale.ko": "한국어",
  "locale.en": "English",
  /* No particle after the language name: 한국어 and English take different ones, and the
     one thing a language picker may not do is get its own name's grammar wrong. */
  "locale.switchTo": (language) => `표시 언어: ${language}`,

  /* -- sidebar -------------------------------------------------------------- */

  "nav.project": "프로젝트",
  "nav.vault": "로컬",
  "nav.dashboard": "대시보드",
  "nav.work": "작업",
  "nav.bugs": "버그",
  "nav.notes": "메모",
  "nav.projects": "프로젝트",
  "nav.search": "검색",
  "nav.searchTip": "검색 (Ctrl+K)",
  "nav.allProjects": "전체 프로젝트",
  "nav.noWorkYet": "작업 로그 없음",
  "nav.manageProjects": "프로젝트 관리…",
  "nav.projectCount": (n) => `로컬 프로젝트 ${n}개`,
  "nav.moreOnProjects": (n) => `프로젝트 화면에 ${n}개 더`,
  "nav.moreTip": (n) => `로컬에 등록된 프로젝트가 ${n}개 있습니다. 프로젝트 화면에서 모두 볼 수 있습니다.`,
  "nav.appFeedback": "앱 피드백",
  "nav.appFeedbackTip": (n) => `이 앱에 대한 미처리 피드백 ${n}건`,

  /* -- 앱 피드백 보드 ------------------------------------------------------------ */

  "fb.title": "앱 피드백",
  "fb.sub":
    "에이전트가 이 앱을 쓰다가 남긴 버그와 건의입니다 — 작업 중이던 프로젝트가 아니라 AgentMonitoring 자체에 대한 것.",
  "fb.count": (total, open) =>
    open > 0 ? `피드백 ${total}건 · 미처리 ${open}건` : `피드백 ${total}건`,
  "fb.kindBug": "버그",
  "fb.kindIdea": "건의",
  "fb.markDone": "처리됨으로 표시",
  "fb.reopen": "다시 열기",
  "fb.doneOn": (when) => `처리됨 · ${when}`,
  "fb.delete": "삭제",
  "fb.deleteArmed": "정말 삭제할까요?",
  "fb.deleteTip": "처리됨 항목만 삭제할 수 있습니다 — 보드에서 완전히 사라집니다.",
  "fb.emptyTitle": "아직 피드백이 없습니다",
  "fb.emptyHint":
    "에이전트가 MCP 도구 `app_feedback`(CLI: `agentmon app-feedback`)로 이 앱에 대한 버그와 건의를 남기면 여기에 쌓입니다.",
  "fb.noMatch": "이 필터에 해당하는 항목이 없습니다",

  "vault.readerDesktop": "데스크톱 앱",
  "vault.readerBrowser": "개발 서버",

  /* -- 앱 자체 업데이트 카드 (데스크톱 전용, src/components/AppUpdate.tsx) ------ */

  "update.title": "새 버전이 나왔어요",
  "update.later": "나중에",
  "update.go": "업데이트",
  "update.applying": "설치 창이 열립니다 — 이 앱은 곧 닫히고, 설치가 끝나면 자동으로 다시 열립니다.",
  "update.failed": "업데이트를 시작하지 못했습니다",

  /* -- the two menus (right button) ----------------------------------------- */

  "menu.open": "열기",
  "menu.copyId": "ID 복사",
  "menu.copyTitle": "제목 복사",
  "menu.copyLink": "링크 복사",
  "menu.copyPath": "폴더 경로 복사",
  /* 이 앱에서 무언가를 지우는 항목은 이것 하나뿐이다. 힌트는 "위험" 같은 분류가 아니라 결과를
     그대로 적는다 — 뒤따르는 확인 창이 반복하는 바로 그 말이다. */
  "menu.delete": "삭제",
  "menu.deleteHint": "영구 삭제 — 되돌릴 수 없습니다",
  "menu.openHint": "대시보드",
  "menu.selection": "선택 영역",
  "menu.theTitle": "제목",
  "menu.copiedSelection": "선택 영역을 복사했습니다",
  "menu.copyFailed": "클립보드에 접근하지 못했습니다 — 직접 선택해 복사하세요.",
  /* "제목 복사됨" / "WORK-0021 복사됨": a toast about an arbitrary value — an id, a route, a
     title — cannot take 을/를 without knowing how the value ends. Noun-final says the same
     thing and is right whatever is copied. */
  "menu.copiedWhat": (what) => `${what} 복사됨`,
  /* 새 프로젝트 대화상자의 두 옵션을 만든 뒤에도 누를 수 있게 한 것 — 템플릿과 서버 경로는
     앱과 함께 움직인다. 쓰기는 코어의 보수적 규칙 그대로라 몇 번 눌러도 안전하고, 토스트가
     실제로 일어난 일을 말한다. */
  "menu.claudeMd": "CLAUDE.md 지침 쓰기",
  "menu.claudeMdHint": "없으면 만들고, 있으면 덧붙입니다",
  "menu.mcpJson": ".mcp.json MCP 등록",
  "menu.mcpJsonHint": "agentmon 항목만 갱신 — 다른 서버는 보존",
  "menu.scaffoldCreated": (file) => `${file} 파일을 만들었습니다`,
  "menu.scaffoldAppended": (file) => `${file}에 지침을 덧붙였습니다`,
  "menu.scaffoldUpdated": (file) => `${file}의 agentmon 항목을 갱신했습니다`,
  "menu.scaffoldPresent": (file) => `${file} — 이미 최신입니다`,

  /* -- 프로젝트 삭제 (components/DeleteProject.tsx) ---------------------------
     조사는 프로젝트 이름 뒤가 아니라 "프로젝트" 뒤에 붙는다: 이름은 볼트에서 온 데이터이고,
     그 뒤에 무슨 조사가 맞는지 정하는 규칙은 없다(이 파일 머리말). */

  "del.title": "프로젝트 삭제",
  "del.contains": "이 프로젝트에 들어 있는 기록",
  "del.warn": (path) =>
    `\`${path}\` 폴더와 그 안의 기록이 모두 영구히 지워집니다. 옆에 있는 코드는 건드리지 않습니다. 휴지통으로 가지 않고, 되돌릴 수 없습니다.`,
  "del.warnRefs":
    "다른 프로젝트의 기록은 그대로 남습니다. 다만 이 프로젝트를 가리키던 링크는 앱에 없는 주소가 되고, 앱은 그 화면에서 없는 프로젝트라고 알려 줍니다.",
  "del.confirmLabel": "확인을 위해 프로젝트 이름을 입력하세요",
  "del.confirmHint": (name) => `정확히 일치해야 합니다: ${name}`,
  "del.confirm": "프로젝트 삭제",
  "del.deleting": "삭제하는 중…",
  "del.doneToast": (name) => `${name} 프로젝트를 삭제했습니다`,

  /* -- command palette ------------------------------------------------------ */

  "palette.title": "명령 팔레트",
  "palette.placeholder": "기록 ID나 메모 이름, 제목, 프로젝트, 화면…",
  "palette.inputLabel": "작업 로그, 버그, 메모, 프로젝트, 화면 검색",
  "palette.results": "검색 결과",
  "palette.groupRecords": "작업 로그 · 버그 · 메모",
  "palette.groupProjects": "프로젝트",
  "palette.groupGoTo": "이동",
  "palette.noMatch": (query) => `“${query}” 검색 결과가 없습니다.`,
  "palette.searching": (records, projects) =>
    `프로젝트 ${projects}개의 작업 로그·버그·메모 ${records}건을 ID(WORK-12)와 이름, 제목으로 검색합니다.`,
  "palette.nothingLoaded":
    "아직 불러온 항목이 없습니다 — 어느 프로젝트에도 작업 로그·버그·메모가 없거나, 읽지 못했습니다.",
  "palette.move": "이동",
  "palette.open": "열기",
  "palette.close": "닫기",
  "palette.kindWork": "작업",
  "palette.kindBug": "버그",
  "palette.kindNote": "메모",
  "palette.metaProject": "프로젝트",
  "palette.metaAgent": "에이전트",
  "palette.metaSeverity": "심각도",
  "palette.metaState": "상태",

  /* -- list keyboard legend -------------------------------------------------- */

  "keys.move": "이동",
  "keys.open": "열기",
  "keys.search": "검색",

  /* -- filters -------------------------------------------------------------- */

  "filter.byStatus": "상태로 거르기",
  "filter.byType": "유형으로 거르기",
  "filter.byAgent": "에이전트로 거르기",
  "filter.byTag": "태그로 거르기",
  "filter.bySeverity": "심각도로 거르기",
  "filter.byLabel": "레이블로 거르기",
  "filter.byAssignee": "담당자로 거르기",
  "filter.byReporter": "등록자로 거르기",
  "filter.allAgents": "전체 에이전트",
  "filter.allTags": "전체 태그",
  "filter.allSeverities": "전체 심각도",
  "filter.allLabels": "전체 레이블",
  "filter.allAssignees": "전체 담당자",
  "filter.allReporters": "전체 등록자",
  "filter.all": "전체",
  "filter.clearAll": "모두 지우기",
  "filter.clear": "필터 지우기",
  "filter.matches": (n) => `${n}건 일치`,
  "filter.chipStatus": (value) => `상태: ${value}`,
  "filter.chipType": (value) => `유형: ${value}`,
  "filter.chipAgent": (value) => `에이전트: ${value}`,
  "filter.chipTag": (value) => `태그: ${value}`,
  "filter.chipSeverity": (value) => `심각도: ${value}`,
  "filter.chipLabel": (value) => `레이블: ${value}`,
  "filter.chipAssignee": (value) => `담당자: ${value}`,
  "filter.chipReporter": (value) => `등록자: ${value}`,
  "filter.chipQuery": (value) => `“${value}”`,

  /* -- work list ------------------------------------------------------------ */

  "work.title": "작업",
  "work.sub": "각 에이전트가 무엇을, 왜, 어떻게 했는지 — 작업 하나에 작업 로그 하나.",
  "work.searchPlaceholder": "작업 검색",
  "work.searchLabel": "작업 로그 검색",
  "work.sortNote": "그룹 안에서 최근 활동순으로 정렬했습니다.",
  "work.empty.title": "아직 기록된 작업이 없습니다",
  "work.empty.hint":
    "에이전트는 코드를 건드리기 전에 작업 로그를 시작합니다. 판단이 유효한 동안 이유를 적어 두기 위해서입니다:",
  "work.emptyFiltered.title": "이 필터에 맞는 작업이 없습니다",
  "work.emptyFiltered.hint": (total) =>
    `이 프로젝트의 작업 로그 ${total}개 중 위 필터를 모두 만족하는 것이 없습니다.`,

  /* -- 메모 목록 ---------------------------------------------------------------
     에이전트들이 서로에게 남기는 지식: 지식·인계·결정·참조. 메모는 역사가 아니라 지식이라
     그 자리에서 고쳐 쓰고, 틀린 것은 제거한다 — 그 흔적은 활동 기록이 가지고 있다. */

  "notes.title": "메모",
  "notes.sub":
    "에이전트들이 서로에게 남기는 지식 — 필수·지식·인계·결정·참조 메모를, 사실이 바뀌면 그 자리에서 고쳐 씁니다.",
  "notes.searchPlaceholder": "메모 검색",
  "notes.searchLabel": "메모 검색",
  "notes.sortNote": "최근 수정순 정렬 — 가장 새 인계 메모가 맨 위에 옵니다.",
  "notes.tabAllTip": "이 프로젝트의 모든 메모",
  "notes.tipEssential": "작업 시작 전에 반드시 읽는 메모 — 나머지를 가리키는 색인",
  "notes.tipMemory": "이 프로젝트에 대한 지속 지식과 주의점",
  "notes.tipHandoff": "다음에 작업할 에이전트를 위한 인계 상태",
  "notes.tipDecision": "여기서 내린 선택과 그 이유",
  "notes.tipReference": "프로젝트 밖 자료를 가리키는 포인터",
  "notes.empty.title": "아직 메모가 없습니다",
  "notes.empty.hint":
    "에이전트는 이전 에이전트가 말해 줬으면 했던 것을 여기에 남깁니다 — 주의점, 인계, 결정:",
  "notes.emptyFiltered.title": "이 필터에 맞는 메모가 없습니다",
  "notes.emptyFiltered.hint": (total) =>
    `이 프로젝트의 메모 ${total}개 중 위 필터를 모두 만족하는 것이 없습니다.`,

  /* -- 메모 상세 --------------------------------------------------------------- */

  "nd.note": "메모",
  "nd.type": "유형",
  "nd.agent": "에이전트",
  "nd.created": "작성",
  "nd.updated": "수정",
  "nd.lastActivity": "마지막 활동",
  "nd.backToList": "메모 목록으로",
  "nd.notesList": "메모 목록",
  "nd.bylineLeft": "— 이 메모를 남겼습니다:",
  /* 뒤에 수정자 칩이 온다: "· 수정 [nova] 5분 전". 이름은 칩이므로 조사를 붙일 자리가
     없고, 명사 라벨 하나면 된다(ui.handoff의 "담당 ${to}"와 같은 꼴). */
  "nd.revisedBy": "수정",
  "nd.neverRevised": "작성 후 수정 없음",
  "nd.body": "본문",
  /* 명령 뒤에 조사를 붙이지 않는다(이 파일 머리말): `…update <name>`으로 처럼 코드 스팬에
     조사를 붙이면 줄바꿈이 요소 경계에서 일어나 조사만 다음 줄로 떨어진다 — 실제로 그렇게
     깨졌다. 명령은 절 끝에 두고, 조사는 우리말 명사(명령은/제거는)에 단다. */
  "nd.updateHint": (name) =>
    `메모에는 지금 참인 내용만 남깁니다 — 그 자리에서 고쳐 쓰는 명령은 \`agentmon note update ${name}\`, 남겨 두면 오히려 혼동을 주는 메모의 제거는 \`agentmon note remove ${name}\`. 모든 변경은 활동 기록에 남습니다.`,

  /* -- bug board ------------------------------------------------------------ */

  "bugs.title": "버그",
  /* 한국어 나열에는 영어의 serial "and"에 해당하는 접속사가 없다 — 마지막 항목 앞의 "그리고"는
     번역의 흔적이다. 쉼표로 잇고 명사로 끝낸다. */
  "bugs.sub": "에이전트가 찾아낸 모든 결함, 지금 맡고 있는 담당자, 각각의 해결 내용.",
  "bugs.searchPlaceholder": "버그 검색",
  "bugs.searchLabel": "버그 검색",
  "bugs.unresolvedMeansTip": (label, means) => `${label} = ${means}`,
  "bugs.noneUnresolved": (unresolved) => `${unresolved} 없음`,
  "bugs.tabUnresolvedTip": (means) => `${means} 상태인 버그`,
  "bugs.tabResolvedTip": "해결됨 또는 닫힘 상태인 버그",
  "bugs.tabAllTip": "이 프로젝트에 등록된 모든 버그",
  "bugs.severityBreakdown": "심각도별 분포",
  "bugs.severityChipTip": (count, severity) => `이 탭에서 심각도 ${severity} 버그 ${count}개`,
  "bugs.rowTimeUnresolved": (filed, last) => `등록 ${filed} · 마지막 활동 ${last}`,
  "bugs.rowTimeSettled": (resolved, filed) => `해결 ${resolved} · 등록 ${filed}`,
  "bugs.groupNoteUnresolved": "심각도순, 그다음 최신순",
  "bugs.groupNoteSettled": "최신순",
  "bugs.sortMixed":
    "미해결 버그는 심각도순, 그다음 등록 시각순입니다. 나머지는 해결된 시각순입니다.",
  "bugs.sortUnresolved": "심각도순, 그다음 최근 등록순으로 정렬했습니다.",
  "bugs.sortSettled": "해결된 시각 기준 최신순으로 정렬했습니다.",
  "bugs.empty.title": "등록된 버그가 없습니다",
  "bugs.empty.hint":
    "에이전트는 버그를 발견한 즉시 등록합니다. 다음 에이전트가 묻지 않고 재현할 수 있도록 재현 절차를 본문에 함께 적습니다:",
  "bugs.emptyUnresolved.title": "미해결 버그 없음",
  "bugs.emptyUnresolved.hint": (resolved) =>
    `이 프로젝트에 등록된 버그 ${resolved}개가 모두 해결되었고, 각각에 해결 내용이 적혀 있습니다.`,
  "bugs.emptyUnresolved.action": "해결된 버그 보기",
  "bugs.emptyResolved.title": "아직 해결된 버그가 없습니다",
  "bugs.emptyResolved.hint": (unresolved) =>
    `이 프로젝트에 미해결 버그가 ${unresolved}개 있습니다. 에이전트가 \`agentmon bug resolve\`로 해결 내용을 적으면 이 탭으로 옮겨집니다.`,
  "bugs.emptyResolved.action": "미해결 버그 보기",
  "bugs.emptyFiltered.title": "이 필터에 맞는 버그가 없습니다",
  "bugs.emptyFiltered.hint": (total) =>
    `이 프로젝트의 버그 ${total}개 중 위 필터를 모두 만족하는 것이 없습니다.`,

  /* -- record detail, shared -------------------------------------------------- */

  "rec.onThisPage": "이 페이지 목차",
  "rec.related": "관련 항목",
  "rec.references": "참조",
  "rec.referencedBy": "역참조",
  "rec.referencesHint": (noun) => `이 ${noun}의 refs에 적힌 항목`,
  /* The particle lands on 기록, not on the id: BUG-0004 takes 를 and BUG-0011 takes 을, and
     nothing in this file can tell which without pronouncing the number. */
  "rec.referencedByHint": (id) => `이 기록(${id})을 가리키는 작업 로그·버그·메모`,
  "rec.missingRef": "이 프로젝트에 해당 ID의 작업 로그·버그·메모가 없습니다",
  /* 문장 속 칩의 툴팁. ID 뒤에 조사를 붙이지 않고 —로 잇는다: BUG-0004는 를, BUG-0011은 을을
     받으므로 어느 쪽도 이 파일이 고를 수 없다. */
  "rec.missingRefTip": (id) => `${id} — 이 프로젝트에 해당 ID의 작업 로그·버그·메모가 없습니다`,

  /* -- record bodies: the renderer's own words --------------------------------
     `> [!note]` 콜아웃의 이름표와, 이미지를 읽지 못했을 때의 한 문장 (lib/markdown.tsx). */

  "md.calloutNote": "참고",
  "md.calloutTip": "팁",
  "md.calloutImportant": "중요",
  "md.calloutWarning": "주의",
  "md.calloutCaution": "경고",
  "md.imageFailed": "이미지를 불러오지 못했습니다",
  "rec.corrections": (n, where) => `이 기록에 **정정 ${n}건** — ${where} 참고`,
  "ui.severityOf": (label) => `심각도 ${label}`,
  "ui.handoff": (from, to) => `등록 ${from} · 담당 ${to}`,
  "ui.handoffNone": (from, unassigned) => `등록 ${from} · ${unassigned}`,
  "rec.correction": "정정",
  "rec.inUpdates": "진행 노트",
  "rec.inThread": "스레드",
  "rec.staleGone": (id) => `${id} — 이 프로젝트에 더 이상 없습니다.`,
  "rec.staleUnread": (id) => `${id} — 다시 읽지 못했습니다.`,
  "rec.staleBody": "아래는 마지막으로 읽었을 때 화면에 있던 내용입니다.",
  "rec.checks": (n) => `검증 ${n}건`,

  /* -- work detail ------------------------------------------------------------ */

  "wd.what": "한 일",
  "wd.why": "이유",
  "wd.how": "방법",
  "wd.files": "파일",
  "wd.filesTouched": "변경한 파일",
  "wd.updates": "진행 노트",
  "wd.outcome": "결과",
  "wd.workLog": "작업 로그",
  "wd.status": "상태",
  "wd.agent": "에이전트",
  "wd.started": "시작",
  "wd.finished": "완료",
  "wd.duration": "소요 시간",
  "wd.lastActivity": "마지막 활동",
  "wd.andCounting": "계속 진행 중",
  "wd.backToList": "작업 목록으로",
  "wd.workList": "작업 목록",
  "wd.noSection": (title) => `이 기록에는 \`## ${title}\` 섹션이 없습니다.`,
  "wd.bylineDone": "— 이 작업을 마쳤습니다:",
  "wd.bylineAbandoned": "— 이 작업을 중단했습니다:",
  "wd.bylineRunning": "— 이 작업을 진행 중입니다. 시작:",
  "wd.filesAcross": (files, dirs) => `디렉터리 ${dirs}개에 걸쳐 파일 ${files}개`,
  "wd.startedThisWork": (agent) => `${agent} — 이 작업을 시작했습니다`,
  "wd.noNotes": "아직 진행 노트가 없습니다. 에이전트는 다음 명령으로 남깁니다:",
  "wd.postedUpdate": (n) => `${n}번째 노트`,
  "wd.endDone": "완료 처리됨",
  "wd.endAbandoned": "중단됨",
  "wd.endRunning": "아직 진행 중",
  "wd.inTotal": (duration) => `총 ${duration}`,
  "wd.soFar": (duration) => `현재까지 ${duration}`,
  "wd.shipped": "적용:",
  "wd.recorded": "기록됨",
  "wd.insideOutcome": "결과 안의 항목",
  "wd.doneCount": "이 에이전트가 완료 처리한 작업 로그",

  /* -- bug detail ------------------------------------------------------------- */

  "bd.report": "등록 내용",
  "bd.thread": "스레드",
  "bd.resolution": "해결 내용",
  "bd.bug": "버그",
  "bd.severity": "심각도",
  "bd.status": "상태",
  "bd.reporter": "등록자",
  "bd.assignee": "담당자",
  "bd.participants": "참여자",
  "bd.lastWord": "마지막 발언",
  "bd.filed": "등록",
  "bd.age": "경과 시간",
  "bd.lastActivity": "마지막 활동",
  "bd.andCounting": "계속 진행 중",
  "bd.noReplies": "아직 답글 없음",
  "bd.backToBoard": "버그 보드로",
  "bd.bugBoard": "버그 보드",
  "bd.noReportSection": "이 버그에는 `## Report` 섹션이 없습니다.",
  "bd.reportBy": (agent, when) => `${agent} · ${when}`,
  "bd.bylineFiled": "— 이 버그를 등록했습니다:",
  "bd.bylineResolvedInPre": "해결까지 ",
  "bd.bylineOpenForPre": "열린 지 ",
  "bd.statusHistory": "상태 이력",
  "bd.stepFiled": "등록",
  "bd.stepClaimed": "담당 지정",
  "bd.stepResolved": "해결됨",
  "bd.stepClosed": "닫힘",
  "bd.stepUnresolved": "미해결",
  "bd.waiting": (duration) => `${duration}째 대기`,
  "bd.soFar": (duration) => `현재까지 ${duration}`,
  "bd.notYet": "아직 없음",
  "bd.anAgent": "에이전트",
  "bd.someAgent": "에이전트",
  "bd.filedThisBug": (agent) => `${agent} — 이 버그를 등록했습니다`,
  "bd.noAnswers": "아직 아무도 답하지 않았습니다. 에이전트는 다음 명령으로 답합니다:",
  "bd.claimedThisBug": "— 이 버그를 맡았습니다",
  "bd.afterFiled": (duration) => `등록 ${duration} 후`,
  "bd.endResolved": (agent) => `${agent} — 이 버그를 해결했습니다`,
  "bd.endClosed": "닫힘",
  "bd.endWorking": (agent) => `${agent} — 작업 중입니다`,
  "bd.endWaiting": "담당자를 기다리는 중",
  "bd.fixAbove": "해결 내용은 위에 있습니다",
  "bd.openFor": (duration) => `열린 지 ${duration}`,
  "bd.addedToReport": "등록 내용 보강",
  "bd.repliedAsAssignee": "담당자 답변",
  "bd.commented": "댓글",
  "bd.comments": (n) => `댓글 ${n}개`,
  "bd.closedNoFix.title": "해결 내용 없이 닫힘",
  "bd.closedNoFix.text":
    "이 버그는 닫혔지만 해결 내용이 기록되지 않아, 무슨 일이 있었는지 기록만으로는 알 수 없습니다. 읽는 사람의 문제가 아니라 기록의 공백입니다.",
  "bd.resolvedOn": "해결:",
  "bd.afterItWasFiled": (duration) => `등록 ${duration} 후`,
  "bd.insideResolution": "해결 내용 안의 항목",
  "bd.unknownAgent": "알 수 없음",

  /* -- projects --------------------------------------------------------------- */

  "proj.title": "프로젝트",
  "proj.sub":
    "프로젝트마다 평범한 파일로 된 `AgentMonitoring` 폴더 하나가 그 코드 레포 안에 살고 있습니다 — 폴더를 커밋하면 기록이 코드와 함께 이동합니다.",
  "proj.new": "새 프로젝트",
  "proj.newTitle": "새 프로젝트",
  "proj.create": "프로젝트 만들기",
  "proj.creating": "만드는 중…",
  "proj.inVault": "로컬 프로젝트",
  "proj.count": (n) => `프로젝트 ${n}개`,
  "proj.noDescription": "아직 설명이 없습니다.",
  "proj.workLogs": "작업 로그",
  "proj.unresolvedBugs": "미해결 버그",
  "proj.events": "이벤트",
  "proj.eventsNote": "기록됨",
  "proj.noneYet": "아직 없음",
  "proj.noneFiled": "등록 없음",
  "proj.ofFiled": (total) => `등록 ${total}개 중`,
  /* 수는 단위 명사를 달고 다닌다(이 파일 머리말). 옆 칸이 "등록 22개 중"이고 사이드바가
     "진행 중 2개"인데 여기만 "완료 27 · 진행 중 0"이면, 한 화면에서 세는 방식이 두 가지가 된다. */
  "proj.workNote": (done, inProgress, doneWord, inProgressWord) =>
    `${doneWord} ${done}개 · ${inProgressWord} ${inProgress}개`,
  "proj.lastActivity": "마지막 활동 ",
  "proj.startedOn": (date) => `시작 ${date}`,
  "proj.noActivity": "아직 활동 없음",
  "proj.createdOn": (date) => `생성 ${date}`,
  "proj.dotLive": "최근 두 시간 안에 기록됨",
  "proj.dotQuiet": "최근 활동 없음",
  "proj.dotStale": "하루 넘게 활동 없음",
  "proj.nothingRecordedYet": "아직 기록 없음",
  "proj.acrossVault": "전체 프로젝트 활동",
  "proj.newest": (n) => `최신 ${n}건`,
  "proj.recent": "최근",
  "proj.vaultEmptyFeed": "아직 어느 프로젝트에도 기록된 것이 없습니다. 첫",
  "proj.vaultEmptyFeedTail": "명령이 실행되면 여기에 나타납니다.",

  "proj.form.name": "이름",
  "proj.form.namePlaceholder": "결제 화면 재작성",
  "proj.form.location": "위치",
  "proj.form.locationPlaceholder": "C:\\Code\\my-app",
  "proj.form.locationHint":
    "보통 작업이 일어나는 코드 레포입니다. 기록은 그 안의 AgentMonitoring 폴더에 저장됩니다 — 그 폴더를 커밋하면 기록이 코드와 함께 이동합니다.",
  "proj.form.browse": "찾아보기…",
  "proj.form.locationNeeded": "프로젝트 기록을 둘 위치를 골라 주세요.",
  "proj.form.description": "설명",
  "proj.form.descriptionPlaceholder":
    "이 프로젝트를 처음 보는 사람이 출발점으로 삼을 수 있는 한두 문장.",
  "proj.form.tags": "태그",
  "proj.form.tagsPlaceholder": "frontend, payments",
  "proj.form.claudeMd": "CLAUDE.md",
  "proj.form.claudeMdNone": "추가 안 함",
  "proj.form.claudeMdHint":
    "코딩 에이전트가 작업을 여기에 기록하도록 안내하는 CLAUDE.md를 저장소 루트에 만듭니다. 파일이 이미 있으면 안내 섹션만 덧붙입니다.",
  "proj.form.mcpJson": "MCP 자동 등록 (.mcp.json)",
  "proj.form.mcpJsonOn": "만들기",
  "proj.form.mcpJsonOff": "안 만듦",
  "proj.form.mcpAgent": "기본 에이전트 핸들",
  "proj.form.mcpJsonHint":
    "agentmon MCP 서버를 등록하는 .mcp.json을 저장소 루트에 만듭니다 — Claude Code가 이 파일을 스스로 읽어, 에이전트는 첫 세션부터 기록 도구를 가집니다. 파일이 이미 있으면 agentmon 항목만 더하거나 바꿉니다. 오른쪽은 기록에 남을 기본 에이전트 핸들입니다.",
  "proj.form.writes": (location) =>
    `\`${location}\\AgentMonitoring\` 폴더에 project.json과 첫 이벤트를 만듭니다 —`,
  "proj.form.writesTail": "명령과 똑같습니다.",

  /* -- 프로젝트 행, 열기와 목록 제거 --------------------------------------------- */

  "proj.openFolder": "프로젝트 열기…",
  "proj.opening": "여는 중…",
  "proj.openTip":
    "AgentMonitoring 폴더가 들어 있는 폴더를 고르세요 — 다른 컴퓨터에서 clone한 레포, 다시 꽂은 드라이브 — 그러면 이 목록에 올라옵니다.",
  "proj.remove": "목록에서 제거",
  "proj.removeHint": "파일은 그대로 남습니다 — 언제든 다시 열 수 있습니다",
  "proj.unavailable": "사용 불가",
  "proj.unavailableHint":
    "지금 이 폴더를 읽을 수 없습니다 — 옮겨진 폴더이거나, 뽑힌 드라이브일 수 있습니다. 무엇이 없는지 보이도록 행은 남겨 둡니다. 완전히 사라진 폴더라면 목록에서 제거하세요.",
  "proj.noneRegisteredTitle": "로컬에 아직 프로젝트가 없습니다",
  "proj.noneRegisteredSub":
    "프로젝트는 평범한 파일로 된 `AgentMonitoring` 폴더 하나입니다. 여기에서 만들거나, 이미 있는 폴더를 여세요.",
  "proj.readFailed": "프로젝트를 읽지 못했습니다",
  "proj.notHere": "이 프로젝트에 없습니다",
  "proj.notRegistered": (id) => `로컬에 “${id}” 프로젝트가 없습니다`,
  "proj.noRecord": (id) => `이 프로젝트에 ${id} 기록이 없습니다`,
  "proj.badAddress": "잘못된 주소입니다",

  /* -- 실패했을 때의 문장 ----------------------------------------------------------
     실패 화면의 제목은 위 proj.* 줄 중 하나이고, 아래는 그 밑에 붙는 설명 — 백엔드가
     내놓은 진단이다. 백엔드는 영어로 쓰여 있으므로, src/lib/api.ts가 그 문장을 알아보고
     여기의 한국어로 바꿔 준다. 경로와 ID, 명령줄은 백엔드가 쓴 그대로 둔다.

     조사 규칙은 이 파일의 머리말과 같다: 경로·ID 뒤에는 조사를 붙이지 않고 —나 :로
     잇는다. 그 값이 무엇으로 끝날지 이 파일은 알 수 없다. 에/에서처럼 형태가 하나뿐인
     조사만 예외다. */

  "err.noProjectAt": (path) =>
    `이 경로에 프로젝트가 없습니다 — \`${path}\`에 \`AgentMonitoring/project.json\`이 없습니다. AgentMonitoring 폴더가 들어 있는 폴더를 고르거나, 거기에 새 프로젝트를 만드세요.`,
  "err.noProjectAtHint": (path, hint) => `이 경로에 프로젝트가 없습니다 — \`${path}\`. ${hint}`,
  "err.projectNotRegistered": (id) =>
    `로컬에 \`${id}\` ID의 프로젝트가 등록되어 있지 않습니다 — 목록에서 제거되었거나, 폴더가 사라졌습니다.`,
  "err.foldersUnreachable": (id, n, paths) =>
    `\`${id}\` 프로젝트가 여기 있는지 지금은 알 수 없습니다 — 등록된 폴더 ${n}곳을 읽지 못하고 있습니다: \`${paths}\``,
  "err.recordNotFound": (id, hint) => `이 프로젝트에 \`${id}\` 기록이 없습니다.${hint}`,
  /* 찾은 ≠ 찾으려던. 앞 문장이 "없습니다"인데 "찾은 파일 경로"라고 하면 *찾아낸* 경로가
     되어 뜻이 뒤집힌다 — 앱이 그 경로를 확인했지만 파일은 없었다는 뜻이어야 한다. */
  "err.expectedFile": (path) => ` 찾으려던 파일 경로: \`${path}\``,
  "err.badId": (id, expected, example) =>
    `쓸 수 없는 ID입니다 — \`${id}\`. \`${expected}\` 형식이어야 합니다 (예: \`${example}\`).`,
  "err.folderUnreadable": (detail) => `이 폴더를 읽지 못했습니다: \`${detail}\``,
  "err.noDirsToServe": (hint) =>
    `개발 서버가 읽을 AgentMonitoring 폴더가 없습니다 — ${hint}`,
  "err.noRoute": (path) => `이 주소를 처리하는 프로젝트 API 경로가 없습니다 — \`${path}\``,
  "err.unreachable": (path, detail) =>
    `프로젝트 API에 연결하지 못했습니다 — \`${path}\`. 개발 서버가 실행 중인지 확인하세요. (\`${detail}\`)`,
  "err.httpStatus": (status) => `프로젝트 API가 \`${status}\`로 응답했습니다`,
  "err.desktopOnlyPicker": "폴더 선택 창은 데스크톱 앱에서만 열 수 있습니다.",
  "err.desktopOnlyOpen":
    "프로젝트 폴더 열기는 데스크톱 앱에서만 됩니다. 브라우저 모드에서는 개발 서버를 `AGENTMON_DIRS=<folder;folder>`로 시작하거나, 주소에 `?dirs=`를 붙이세요.",
  "err.desktopOnlyRemove":
    "프로젝트 목록은 데스크톱 앱의 것입니다. 브라우저 모드는 정해진 폴더 집합을 제공합니다.",

  "onboard.titleEmpty": "아직 기록된 작업이 없습니다",
  "onboard.titleNone": "로컬에 아직 프로젝트가 없습니다",
  "onboard.sub":
    "프로젝트는 코드 레포 안에 사는 평범한 파일 폴더 하나(`AgentMonitoring`)입니다. 작업 로그와 버그, 이벤트 로그가 거기에 담깁니다. 에이전트가 `agentmon` CLI로 쓰고, 이 앱이 위 목록의 폴더를 전부 읽습니다.",
  "onboard.stepProject": "레포 안에 프로젝트 만들기",
  "onboard.stepWork": "첫 작업 기록하기",
  "onboard.noteNewProject": "또는 위의 **새 프로젝트**를 누르세요 — 같은 파일을 씁니다.",
  "onboard.noteBody":
    "본문에는 `## What`, `## Why`, `## How`가 필요합니다. 빠져 있으면 CLI가 템플릿을 출력합니다.",
  "onboard.footCli": (path) =>
    `\`agentmon\` 실행 파일은 이 앱과 함께 \`${path}\`에 설치됩니다 — 위 명령은 이미 그 경로를 가리킵니다.`,
  "onboard.footDesktop":
    "로컬에 이미 프로젝트가 있나요 — 다른 컴퓨터에서 clone한 레포라든가? 위의 **프로젝트 열기…**를 쓰세요.",
  "onboard.footBrowser":
    "이미 프로젝트가 있나요? 개발 서버는 `AGENTMON_DIRS=<folder>`로, 이 창은 `?dirs=<folder>`로 지정하세요.",
  "onboard.footHelp": (cli) => ` 전체 명령은 \`${cli} --help\`에 있고, 하위 명령마다 \`--help\`를 지원합니다.`,
  "onboard.footManual": (path) => ` 매뉴얼은 이 기기의 \`${path}\`에 있습니다.`,

  /* -- dashboard --------------------------------------------------------------- */

  "dash.currentState": "현재 상태",
  "dash.timeRange": "기간",
  "dash.range7": "7일",
  "dash.range30": "30일",
  "dash.rangeAll": "전체 기간",
  "dash.live": "실시간",
  "dash.liveTip": "최근 두 시간 안에 기록된 활동이 있습니다",
  "dash.lastActivity": (when) => `마지막 활동 ${when}`,
  /* "…는 ${range} 기준입니다" rather than "…는 ${range}을 다룹니다": 기준입니다 needs no
     particle, so the sentence stays right whether the range ends in 일, 건 or a digit. */
  /* "위 현황 띠는 항상 현재이며"는 "The strip above is always now"를 그대로 옮긴 말이었다 —
     띠는 현재일 수 없고, 화면에 '현황 띠'라는 이름도 없다. 맨 위 카드들이 실제로 달고 있는
     이름(현재 상태)으로 부른다. */
  "dash.scope": (range) =>
    `아래 차트와 에이전트, 활동 기록은 ${range} 기준입니다. 맨 위 현재 상태는 기간과 상관없이 항상 지금이며, 이 페이지의 모든 날짜와 시각은 이 컴퓨터의 시간대를 따릅니다.`,
  "dash.rangeDays": (days) => `최근 ${days}일`,
  "dash.rangeOneEvent": (date) => `${date}에 기록된 이벤트 1건`,
  "dash.rangeAllEvents": (n, date) => `${date}까지 거슬러 올라가는 전체 이벤트 ${n}건`,

  "dash.workingNow": "지금 진행 중",
  "dash.workLogsHere": "이 프로젝트의 작업 로그",
  "dash.heroUnit": (total) => `진행 중 · 전체 작업 로그 ${total}개`,
  "dash.agents": (n) => `에이전트 ${n}명`,
  "dash.took": "소요",
  "dash.finishedWhen": (when) => `완료 ${when}`,
  "dash.nothingInProgress": "진행 중인 작업이 없습니다 — 가장 최근 작업 로그가 위에 있습니다.",
  "dash.noWorkYet":
    "아직 기록된 작업이 없습니다. 에이전트는 코드를 건드리기 전에 `agentmon work start`로 작업 로그를 시작합니다.",
  "dash.moreInProgress": (n) => `진행 중 ${n}개 더 보기`,
  "dash.noUpdates": "아직 노트 없음",
  "dash.updatedWhen": (when) => `${when} 갱신`,
  "dash.noUpdateIn": (duration) => `${duration}째 노트 없음`,
  "dash.rowInProgress": "진행 중",
  "dash.rowStartedTip": (when) => `시작 ${when}`,
  "dash.rowStateTip": (state, since) => `${state} · ${since}`,
  "dash.latestNote": "최신 노트",
  "dash.latestNoteTip": (when) => `${when}에 올라온 노트의 문단별 첫 문장`,
  /* "${agent} 대기 중" 은 "그 에이전트가 기다리는 중"으로 읽힌다 — 뜻이 정반대다. 이 칩은
     노트가 그 에이전트의 답을 기다린다는 뜻이므로, 이름이 응답을 수식하게 둔다. */
  "dash.waitingOn": (agent) => `${agent} 응답 대기`,
  "dash.waitingOnTip": (agent, sentence) => `${agent}의 최신 노트: “${sentence}”`,

  "dash.unresolvedBugs": "미해결 버그",
  "dash.bugsFiledHere": "이 프로젝트에 등록된 버그",
  "dash.unresolvedOfFiled": (unresolved, total) => `${unresolved} · 전체 등록 ${total}개`,
  "dash.sevChipTip": (count, unresolved, severity) => `${unresolved} 심각도 ${severity} 버그 ${count}개`,
  "dash.openFor": "열린 지",
  "dash.filedTip": (when) => `등록 ${when}`,
  "dash.lastActivityTip": (when) => `마지막 활동 ${when}`,
  "dash.untouched": "변동 없음",
  "dash.untouchedTip": "등록 이후 이 버그에 아무 일도 없었습니다: 담당 지정도, 댓글도 없습니다",
  "dash.moreUnresolved": (n, unresolved) => `${unresolved} ${n}개 더 보기`,
  "dash.triageNote": (unassigned) => `심각한 것부터 · 같은 심각도에서는 ${unassigned} 먼저.`,
  "dash.noBugsFiled": "이 프로젝트에 등록된 버그가 없습니다.",
  "dash.allResolved": "여기에 등록된 버그는 모두 해결되었습니다.",
  "dash.noOwnerTip": (severity, duration) =>
    `심각도 ${severity} 버그를 ${duration}째 아무도 맡지 않았습니다. 이 화면은 담당자 없이 네 시간이 지난 치명적·높음 버그를 표시합니다.`,
  "dash.hasOwnerTip": "이 버그에 지정된 담당자가 없습니다",

  "dash.last24h": "최근 24시간",
  "dash.eventsRecorded": () => "이벤트 기록됨",
  "dash.quiet": "조용합니다.",
  "dash.lastThing": (when) => `여기에 마지막으로 기록된 것은 ${when}입니다.`,
  "dash.neverAnything": "여기에는 아직 아무것도 기록된 적이 없습니다.",
  "dash.quietFor": (duration) => `${duration}째 조용함`,
  /* 세는 것은 모두 이벤트이므로 단위는 `건`이다(이 파일 머리말의 "수는 단위 명사를 달고
     다닌다"). 이 한 줄이 대시보드 첫 화면의 최근 24시간 문장과 활동 카드의 날짜 머리글을
     함께 만드는데, 단위를 빼면 "시작 16 · 완료 16 · 노트 30 · … · 에이전트 6명"처럼 한
     문장 안에서 여섯 번은 맨 숫자로, 한 번은 단위를 달고 세게 된다. 사람은 단위를 뺄 수
     없어서 `명`이 남은 것이고, 나머지가 빠져 있던 것이다(P9 5·6라운드 비평). */
  "dash.countPart": (count, label) => `${label} ${count}건`,
  "dash.hoursLabel": (counts) => `최근 24시간의 시간대별 이벤트 수, 오래된 순: ${counts}`,

  "dash.chartWork": "작업",
  "dash.chartBugs": "버그",
  "dash.chartWorkSub": (change) => `시작 대비 완료 누적 추이${change}`,
  "dash.chartBugsSub": (change) => `등록 대비 해결 누적 추이${change}`,
  "dash.changeOver": (range) => ` · ${range} 변화 포함`,
  "dash.allWork": "작업 전체",
  "dash.bugBoard": "버그 보드",
  "dash.chartWorkEmpty": "아직 작업 로그가 없습니다",
  "dash.chartWorkEmptyHint":
    "에이전트가 이 프로젝트에서 `agentmon work start`를 실행하는 순간 이 차트가 그려집니다.",
  "dash.chartBugsEmpty": "아직 등록된 버그가 없습니다",
  /* 영어의 "Nothing to plot, which on this chart is the good state."를 절 단위로 옮기면
     "그릴 것이 없습니다. 이 차트에서는 그것이 좋은 상태입니다."가 되는데, 앞 문장을 대명사로
     받는 이 말투는 한국어 UI의 말이 아니다. 뜻만 남기고 한국어 문장으로 다시 쓴다. */
  "dash.chartBugsEmptyHint": "이 차트는 비어 있는 편이 좋습니다.",
  "dash.seriesStarted": "시작",
  "dash.seriesFiled": "등록",
  "dash.nounWorkLogs": "작업 로그",
  "dash.nounBugs": "버그",

  "dash.agentsCard": "에이전트",
  "dash.agentsEmpty": "이 기간에 기록을 남긴 에이전트가 없습니다",
  /* `events.jsonl에` — 파일 이름은 고정 문자열이고 `에`는 형태가 하나뿐인 조사이므로 이 파일의
     예외 규칙(위 err.* 머리말)에 해당한다. 예외라도 조사는 붙여 쓴다: `events.jsonl 에`처럼 띄우면
     `_ 만`과 같은 흔적이 된다. 같은 문장이 dash.activityEmptyHint에도 있다. */
  "dash.agentsEmptyHint":
    "위에서 기간을 넓히거나 프로젝트 폴더를 확인하세요. CLI로 무언가 바꿀 때마다 events.jsonl에 한 줄이 추가됩니다.",
  "dash.colAgent": "에이전트",
  "dash.colActivity": "활동",
  "dash.colDone": "완료",
  "dash.colFiled": "등록",
  "dash.colResolved": "해결",
  "dash.colLastSeen": "마지막 기록",
  "dash.colFiledTip": "이 에이전트가 등록한 버그",
  "dash.colResolvedTip": "이 에이전트가 해결한 버그",
  "dash.legendWork": "작업",
  "dash.legendBugs": "버그",
  "dash.legendNotes": "메모",
  "dash.legendProject": "프로젝트",
  /* 앞의 합계만 `건`을 달고 뒤의 내역은 맨 숫자로 두면 한 문장 안에서 세는 방식이 두 가지가
     된다. 내역도 같은 이벤트를 세므로 같은 단위를 단다(dash.countPart와 같은 이유). */
  "dash.agentBarTip": (total, work, notes, bugs, project) =>
    `이벤트 ${total}건 — 작업 ${work}건${notes ? `, 메모 ${notes}건` : ""}, 버그 ${bugs}건${project ? `, 프로젝트 ${project}건` : ""}`,
  "dash.agentDotTip": (count, inProgress, seen) => `${count} ${inProgress} · 마지막 기록 ${seen}`,
  "dash.agentIdleTip": (inProgress, seen) => `${inProgress}인 작업 로그 없음 · 마지막 기록 ${seen}`,
  "dash.agentIdleLabel": "진행 중인 작업 로그 없음",
  "dash.agentTableNote": (events) =>
    `이 기간의 이벤트 ${events}건을 각각 기록한 에이전트 앞으로 모두 집계했습니다 — 프로젝트 변경 포함.`,

  "dash.activity": "활동",
  "dash.activityNote": (events, days) => `이벤트 ${events}건 · ${days}일`,
  "dash.expandAll": "모두 펼치기",
  "dash.collapseAll": "모두 접기",
  "dash.activityEmpty": "이 기간에 기록된 것이 없습니다",
  "dash.activityEmptyHint":
    "CLI로 무언가 바꿀 때마다 events.jsonl에 한 줄이 추가됩니다. 위에서 기간을 넓히면 이전 기록도 볼 수 있습니다.",
  /* `parts`는 dash.countPart가 만들고, 거기서 이미 단위를 달고 온다 —
     "이벤트 77건 — 작업 42건, 완료 15건, 버그 12건, 해결 8건". */
  "dash.dayMix": (events, parts) => `이벤트 ${events}건 — ${parts}`,
  "dash.showOther": (n, day) => `${day} 나머지 ${n}건 보기`,
  "dash.today": "오늘",
  "dash.yesterday": "어제",

  /* -- charts ------------------------------------------------------------------ */

  "chart.now": "지금",
  "chart.busiestHourPre": "가장 바쁜 시간대 이벤트 ",
  "chart.busiestHour": () => "건",
  "chart.hourTip": (hour, count) => `${hour} — 이벤트 ${count}건`,
  "chart.bucketHours": (day, from, to) => `${day} ${from} – ${to}`,
  "chart.summary": (upperLabel, upper, lowerLabel, lower, noun, periods, from, to) =>
    `${noun}: ${upperLabel} ${upper}, ${lowerLabel} ${lower}. ${from}부터 ${to}까지 ${periods}개 구간. `,
  "chart.summaryDelta": (range, upper, upperLabel, lower, lowerLabel) =>
    `${range} 변화: ${upperLabel} ${upper}, ${lowerLabel} ${lower}. `,
  "chart.summaryKeys": "왼쪽·오른쪽 화살표 키로 구간을 하나씩 읽을 수 있습니다.",
  "chart.reading": (when, upper, upperLabel, lower, lowerLabel, gap, gapLabel) =>
    `${when}: ${upperLabel} ${upper}, ${lowerLabel} ${lower}, ${gapLabel} ${gap}.`,
  "chart.deltaTip": (delta, label, range) => `${range} 동안 ${label} ${delta}`,

  /* -- the vocabulary (lib/words.ts) -------------------------------------------- */

  "word.workNoun": "작업 로그",
  "word.bugNoun": "버그",
  "word.noteNoun": "메모",
  "word.workLogs": (n) => `작업 로그 ${n}개`,
  "word.bugs": (n) => `버그 ${n}개`,
  "word.notes": (n) => `메모 ${n}개`,
  "word.events": (n) => `이벤트 ${n}건`,

  "word.work.in_progress": "진행 중",
  "word.work.done": "완료",
  "word.work.abandoned": "중단",
  /* 메모의 네 유형 — 이 파일 머리말의 어휘. */
  "word.note.essential": "필수",
  "word.note.memory": "지식",
  "word.note.handoff": "인계",
  "word.note.decision": "결정",
  "word.note.reference": "참조",
  "word.bug.open": "열림",
  "word.bug.in_progress": "진행 중",
  "word.bug.resolved": "해결됨",
  "word.bug.closed": "닫힘",
  "word.sev.critical": "치명적",
  "word.sev.high": "높음",
  "word.sev.medium": "보통",
  "word.sev.low": "낮음",

  /* **Korean has no short form for severity, so it keeps the word.** Empty on purpose; see
     the header of this file. The board reads these four and, finding nothing, never swaps. */
  "word.sevAbbr.critical": "",
  "word.sevAbbr.high": "",
  "word.sevAbbr.medium": "",
  "word.sevAbbr.low": "",

  "word.inProgress": "진행 중",
  "word.done": "완료",
  "word.abandoned": "중단",
  "word.open": "열림",
  "word.resolved": "해결됨",
  "word.closed": "닫힘",
  "word.unresolved": "미해결",
  "word.unresolvedLabel": "미해결",
  "word.unresolvedMeans": "열림 또는 진행 중",
  "word.unassigned": "담당자 없음",
  "word.unassignedLabel": "담당자 없음",
  "word.unassignedFor": (duration) => `${duration}째 담당자 없음`,
  "word.timeToResolve": "해결 소요 시간",

  /* 스위처 카드의 수는 분모를 달지 않는다(머리말 규칙에 대한 소유자 결정 예외) — 전체
     개수는 바로 아래 작업 행이 들고 있고, "9개 중 1개 진행 중"은 아홉 개가 아직 움직이는
     것처럼 읽혔다. 분모는 툴팁이 유지하고, 문구는 아래 word.inProgressCount 하나를 쓴다. */
  "word.workLogsInProgressOf": (n, total) => `작업 로그 ${total}개 중 ${n}개 진행 중`,
  "word.unresolvedOf": (n, total) => `${total}개 중 ${n}개 미해결`,
  "word.unresolvedCount": (n) => `미해결 ${n}개`,
  /* 버그 보드의 "미해결 2개"와 같은 어순. "2 진행 중"처럼 숫자가 상태어 앞에 오는 영어 어순은
     쓰지 않는다 — 총계가 바로 앞에 있으므로 분모는 생략한다. */
  "word.inProgressCount": (n) => `진행 중 ${n}개`,
  "word.workTip": (total, inProgress, where) =>
    `${where ?? "이 프로젝트"}의 작업 로그 ${total}개 · ${inProgress}개 진행 중`,
  "word.workTipHere": (total, inProgress) => `작업 로그 ${total}개 · ${inProgress}개 진행 중`,
  "word.bugTip": (unresolved, total, where) =>
    `${where ? `${where}에 ` : ""}등록된 버그 ${total}개 중 ${unresolved}개 미해결 — 열림 또는 진행 중`,
  "word.bugTipHere": (unresolved, total) =>
    `여기에 등록된 버그 ${total}개 중 ${unresolved}개 미해결 — 열림 또는 진행 중`,
  "word.doneOrAbandoned": "완료 또는 중단",
  "word.resolvedOrClosed": "해결됨 또는 닫힘",
  "word.noteTipHere": (n) =>
    `여기의 메모 ${n}개 — 에이전트들이 서로를 위해 남기는 필수·지식·인계·결정·참조`,

  /* -- feed verbs ---------------------------------------------------------------- */

  "verb.work_started": "시작",
  "verb.work_updated": "노트 작성",
  "verb.work_done": "완료",
  "verb.work_abandoned": "중단",
  "verb.bug_created": "등록",
  "verb.bug_claimed": "담당 지정",
  "verb.bug_commented": "댓글 작성",
  "verb.bug_resolved": "해결",
  "verb.bug_closed": "닫음",
  "verb.note_created": "메모 작성",
  "verb.note_updated": "메모 수정",
  /* 제거이지 삭제가 아니다 — 삭제는 프로젝트 폴더가 디스크에서 사라질 때 하나뿐인 말이고,
     메모 제거는 그 흔적(이 이벤트)이 기록에 남는 정리다(이 파일 머리말). */
  "verb.note_removed": "메모 제거",
  /* 사람용 영역만 다시 쓴 변경. Updates/Comments에는 아무것도 남기지 않으므로
     이 피드 줄이 그 사실을 보여 주는 유일한 자리다. */
  "verb.human_updated": "사람용 설명 수정",
  "verb.project_created": "프로젝트 생성",
  "verb.project_updated": "프로젝트 수정",

  "recent.started": "시작",
  "recent.notes": "진행 노트",
  "recent.done": "완료",
  "recent.abandoned": "중단",
  "recent.filed": "등록",
  "recent.claimed": "담당 지정",
  "recent.resolved": "해결",
  "recent.closed": "닫힘",
  "recent.sharedNotes": "메모",
  "recent.project": "프로젝트",
  "recent.other": "기타",

  "tone.work": "작업",
  "tone.done": "완료",
  "tone.bug": "버그",
  "tone.resolved": "해결",
  "tone.note": "메모",
  "tone.neutral": "프로젝트",

  /* -- time ------------------------------------------------------------------------ */

  "time.justNow": "방금",
  "time.ago": (value) => `${value} 전`,
  "time.in": (value) => `${value} 후`,
  "time.minutes": (n) => `${n}분`,
  "time.hours": (n) => `${n}시간`,
  "time.days": (n) => `${n}일`,
  "time.weeks": (n) => `${n}주`,
  "time.months": (n) => `${n}개월`,
  "time.years": (n) => `${n}년`,
  "time.durMinutes": (n) => `${n}분`,
  "time.durHours": (n) => `${n}시간`,
  "time.durHoursMinutes": (h, m) => `${h}시간 ${m}분`,
  "time.durDays": (n) => `${n}일`,
  "time.durDaysHours": (d, h) => `${d}일 ${h}시간`,
  "time.empty": "—",
};
