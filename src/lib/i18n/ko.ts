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
 *   에이전트    an agent
 *   볼트        the vault — the directory of plain files. Deliberately not 보관함/보관소,
 *               which would collide with 보관됨 (archived) one row away in the same column.
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
  "app.undo": "실행 취소",
  "app.copy": "복사",
  "app.copied": "복사됨",
  "app.selectIt": "직접 선택",
  "app.copyToClipboard": "클립보드에 복사",
  "app.notFound.title": "화면이 없습니다",
  "app.notFound.sub": "이 주소에 해당하는 화면이 앱에 없습니다.",

  "shell.trouble.headline": "지금 볼트를 읽지 못하고 있습니다.",
  /* 경로 뒤에 조사를 붙이지 않는다 — 이 파일의 규칙이고, "…\vault 에서"처럼 한 칸 띄운 조사는
     그 규칙을 어긴 흔적이다. 경로는 문장 끝에 이름표를 달아 따로 붙인다. */
  "shell.trouble.body": (path, when) =>
    `아래 내용은 마지막으로 정상 조회한 데이터입니다. 기준 시각 ${when}${path ? ` · 볼트 경로 ${path}` : ""}`,

  /* -- language ------------------------------------------------------------- */

  "locale.label": "언어",
  "locale.ko": "한국어",
  "locale.en": "English",
  /* No particle after the language name: 한국어 and English take different ones, and the
     one thing a language picker may not do is get its own name's grammar wrong. */
  "locale.switchTo": (language) => `표시 언어: ${language}`,

  /* -- sidebar -------------------------------------------------------------- */

  "nav.project": "프로젝트",
  "nav.vault": "볼트",
  "nav.dashboard": "대시보드",
  "nav.work": "작업",
  "nav.bugs": "버그",
  "nav.projects": "프로젝트",
  "nav.search": "검색",
  "nav.searchTip": "검색 (Ctrl+K)",
  "nav.allProjects": "전체 프로젝트",
  "nav.noWorkYet": "작업 로그 없음",
  "nav.manageProjects": "프로젝트 관리…",
  "nav.activeProjects": (n) => `활성 프로젝트 ${n}개`,
  "nav.moreOnProjects": (n) => `프로젝트 화면에 ${n}개 더`,
  "nav.moreTip": (n) => `이 볼트에는 프로젝트가 ${n}개 있습니다. 프로젝트 화면에서 모두 볼 수 있습니다.`,
  "nav.archivedFlag": " 보관됨",

  "vault.none": "열린 볼트 없음",
  "vault.unreadable": "읽을 수 없음 — 볼트를 여세요",
  "vault.resolving": "확인 중…",
  "vault.readerDesktop": "데스크톱 앱",
  "vault.readerBrowser": "개발 서버",

  /* -- the two menus (right button) ----------------------------------------- */

  "menu.open": "열기",
  "menu.copyId": "ID 복사",
  "menu.copyTitle": "제목 복사",
  "menu.copyLink": "링크 복사",
  "menu.copySlug": "슬러그 복사",
  "menu.archive": "보관",
  "menu.unarchive": "보관 해제",
  "menu.archiveHint": "기록은 그대로 보존",
  "menu.unarchiveHint": "전환 메뉴로 복귀",
  "menu.openHint": "대시보드",
  "menu.selection": "선택 영역",
  "menu.theTitle": "제목",
  "menu.copiedSelection": "선택 영역을 복사했습니다",
  "menu.copyFailed": "클립보드에 접근하지 못했습니다 — 직접 선택해 복사하세요.",
  /* "제목 복사됨" / "WORK-0021 복사됨": a toast about an arbitrary value — an id, a route, a
     title — cannot take 을/를 without knowing how the value ends. Noun-final says the same
     thing and is right whatever is copied. */
  "menu.copiedWhat": (what) => `${what} 복사됨`,
  "menu.archivedToast": (name) => `${name} — 보관했습니다. 삭제된 것은 없습니다.`,
  "menu.restoredToast": (name) => `${name} — 전환 메뉴로 되돌렸습니다.`,

  /* -- command palette ------------------------------------------------------ */

  "palette.title": "명령 팔레트",
  "palette.placeholder": "작업 로그·버그 ID, 제목, 프로젝트, 화면…",
  "palette.inputLabel": "작업 로그, 버그, 프로젝트, 화면 검색",
  "palette.results": "검색 결과",
  "palette.groupRecords": "작업 로그 · 버그",
  "palette.groupProjects": "프로젝트",
  "palette.groupGoTo": "이동",
  "palette.noMatch": (query) => `“${query}” 검색 결과가 없습니다.`,
  "palette.searching": (records, projects) =>
    `프로젝트 ${projects}개의 작업 로그·버그 ${records}건을 ID(WORK-12)와 제목으로 검색합니다.`,
  "palette.nothingLoaded":
    "아직 불러온 항목이 없습니다 — 이 볼트에 작업 로그와 버그가 없거나, 읽지 못했습니다.",
  "palette.move": "이동",
  "palette.open": "열기",
  "palette.close": "닫기",
  "palette.kindWork": "작업",
  "palette.kindBug": "버그",
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

  /* -- bug board ------------------------------------------------------------ */

  "bugs.title": "버그",
  "bugs.sub": "에이전트가 찾아낸 모든 결함, 지금 맡고 있는 담당자, 그리고 각각의 해결 내용.",
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
  "rec.referencedByHint": (id) => `이 기록(${id})을 가리키는 작업 로그와 버그`,
  "rec.missingRef": "이 프로젝트에 해당 ID의 작업 로그나 버그가 없습니다",
  /* 문장 속 칩의 툴팁. ID 뒤에 조사를 붙이지 않고 —로 잇는다: BUG-0004는 를, BUG-0011은 을을
     받으므로 어느 쪽도 이 파일이 고를 수 없다. */
  "rec.missingRefTip": (id) => `${id} — 이 프로젝트에 해당 ID의 작업 로그나 버그가 없습니다`,
  "rec.corrections": (n, where) => `이 기록에 **정정 ${n}건** — ${where} 참고`,
  "ui.severityOf": (label) => `심각도 ${label}`,
  "ui.handoff": (from, to) => `등록 ${from} · 담당 ${to}`,
  "ui.handoffNone": (from, unassigned) => `등록 ${from} · ${unassigned}`,
  "rec.correction": "정정",
  "rec.inUpdates": "진행 노트",
  "rec.inThread": "스레드",
  "rec.staleGone": (id) => `${id} — 이 볼트에 더 이상 없습니다.`,
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
  "bd.fixBelow": "해결 내용은 아래에 있습니다",
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
    "모든 것이 평범한 파일로 된 볼트 디렉터리 하나에 담깁니다 — 다른 기기로 복사하면 기록도 함께 따라갑니다.",
  "proj.new": "새 프로젝트",
  "proj.newTitle": "새 프로젝트",
  "proj.create": "프로젝트 만들기",
  "proj.creating": "만드는 중…",
  "proj.active": "활성",
  "proj.archived": "보관됨",
  "proj.archivedPill": "보관됨",
  "proj.show": "펼치기",
  "proj.hide": "접기",
  "proj.count": (n) => `프로젝트 ${n}개`,
  "proj.allArchived":
    "이 볼트의 프로젝트가 모두 보관되었습니다. 아래에서 되돌리거나 새로 만드세요.",
  "proj.archive": "보관",
  "proj.archiving": "보관하는 중…",
  "proj.unarchive": "보관 해제",
  "proj.restoring": "되돌리는 중…",
  "proj.archiveTip":
    "전환 메뉴와 기본 목록에서 이 프로젝트를 숨깁니다. 삭제되는 것은 없고, 바로 아래 줄에서 실행 취소할 수 있습니다.",
  "proj.undoBar": (name) =>
    `${name} — 보관했습니다. 삭제된 것은 없습니다. 작업 로그와 버그, 이벤트는 볼트에 그대로 있고 계속 읽을 수 있습니다.`,
  "proj.noDescription": "아직 설명이 없습니다.",
  "proj.workLogs": "작업 로그",
  "proj.unresolvedBugs": "미해결 버그",
  "proj.events": "이벤트",
  "proj.eventsNote": "기록됨",
  "proj.noneYet": "아직 없음",
  "proj.noneFiled": "등록 없음",
  "proj.ofFiled": (total) => `등록 ${total}개 중`,
  "proj.workNote": (done, inProgress, doneWord, inProgressWord) =>
    `${doneWord} ${done} · ${inProgressWord} ${inProgress}`,
  "proj.lastActivity": "마지막 활동 ",
  "proj.startedOn": (date) => `시작 ${date}`,
  "proj.noActivity": "아직 활동 없음",
  "proj.createdOn": (date) => `생성 ${date}`,
  "proj.dotArchived": "보관된 프로젝트",
  "proj.dotLive": "최근 두 시간 안에 기록됨",
  "proj.dotQuiet": "최근 활동 없음",
  "proj.dotStale": "하루 넘게 활동 없음",
  "proj.nothingRecordedYet": "아직 기록 없음",
  "proj.acrossVault": "볼트 전체 활동",
  "proj.newest": (n) => `최신 ${n}건`,
  "proj.recent": "최근",
  "proj.vaultEmptyFeed": "이 볼트에는 아직 기록된 것이 없습니다. 첫",
  "proj.vaultEmptyFeedTail": "명령이 실행되면 여기에 나타납니다.",

  "proj.form.name": "이름",
  "proj.form.namePlaceholder": "결제 화면 재작성",
  "proj.form.slug": "슬러그",
  "proj.form.slugPlaceholder": "checkout-rewrite",
  "proj.form.slugTaken": "이 슬러그를 쓰는 프로젝트가 볼트에 이미 있습니다.",
  "proj.form.slugBad": "소문자, 숫자, - 또는 _ 만 쓸 수 있습니다.",
  "proj.form.slugHint": "projects/ 아래의 디렉터리 이름입니다. 만든 뒤에는 바꿀 수 없습니다.",
  "proj.form.description": "설명",
  "proj.form.descriptionPlaceholder":
    "이 프로젝트를 처음 보는 사람이 출발점으로 삼을 수 있는 한두 문장.",
  "proj.form.tags": "태그",
  "proj.form.tagsPlaceholder": "frontend, payments",
  "proj.form.writes": (slug) => `projects/${slug}/project.json 파일과 첫 이벤트를 씁니다 —`,
  "proj.form.writesTail": "명령과 똑같습니다.",

  /* -- the vault bar and onboarding -------------------------------------------- */

  "vault.bar": "볼트",
  "vault.label": "볼트",
  "vault.activeProjects": "활성 프로젝트",
  "vault.archivedAside": (n) => ` · 보관 ${n}개`,
  "vault.schema": "스키마",
  "vault.created": "생성",
  /* "읽는 주체"는 번역서의 말투다. 이 칸이 실제로 구분하는 것은 데스크톱 앱이냐 개발 서버냐,
     곧 실행 환경이다. */
  "vault.readBy": "실행 환경",
  "vault.openedFrom": (source) => `열린 위치: ${source}`,
  "vault.openFolder": "볼트 폴더 열기…",
  "vault.opening": "여는 중…",
  "vault.createVault": "볼트 만들기…",
  "vault.creating": "만드는 중…",
  "vault.createTip":
    "폴더를 고르면 그 안에 vault.json과 projects/ 폴더를 만듭니다. `agentmon init`과 똑같습니다.",
  "vault.noneOpenTitle": "열린 볼트 없음",
  "vault.noneOpenSub": "이 앱은 평범한 파일로 된 디렉터리 하나를 읽습니다. 이 디렉터리는 읽지 못했습니다.",
  "vault.readFailed": "볼트를 읽지 못했습니다",
  "vault.notInThisVault": "이 볼트에 없습니다",
  "vault.noProject": (slug) => `이 볼트에는 “${slug}” 프로젝트가 없습니다`,
  "vault.noRecord": (id) => `이 프로젝트에 ${id} 기록이 없습니다`,
  "vault.source.query": "이 창 주소의 ?vault=",
  "vault.source.env": "AGENTMON_VAULT 환경 변수",
  "vault.source.flag": "이 앱에서 연 폴더",
  "vault.source.cwdVault": "작업 디렉터리의 ./vault",
  "vault.source.cwd": "작업 디렉터리",
  "vault.source.exeVault": "앱 옆의 vault 폴더",

  /* -- 실패했을 때의 문장 ----------------------------------------------------------
     실패 화면의 제목은 위 vault.* 네 줄 중 하나이고, 아래는 그 밑에 붙는 설명 — 백엔드가
     내놓은 진단이다. 백엔드는 영어로 쓰여 있으므로, src/lib/api.ts가 그 문장을 알아보고
     여기의 한국어로 바꿔 준다. 경로와 ID, 명령줄은 백엔드가 쓴 그대로 둔다.

     조사 규칙은 이 파일의 머리말과 같다: 경로·슬러그·ID 뒤에는 조사를 붙이지 않고 —나 :로
     잇는다. 그 값이 무엇으로 끝날지 이 파일은 알 수 없다. 에/에서처럼 형태가 하나뿐인
     조사만 예외다. */

  "err.noVaultForQuery": (dir, cmd) =>
    `\`?vault=\`로 지정한 폴더에 \`vault.json\`이 없습니다 — \`${dir}\`. 볼트 폴더를 지정하거나, 다음 명령으로 새 볼트를 만드세요: \`${cmd}\``,
  "err.noVaultForEnv": (dir, fallback, cmd) =>
    `\`AGENTMON_VAULT\`가 가리키는 폴더에 \`vault.json\`이 없습니다 — \`${dir}\`. 볼트를 지정해 두면 이 서버는 그 볼트만 제공하므로, 다른 경로로 물러나지 않습니다: \`${fallback}\`. 해당 폴더를 되살리거나 환경 변수를 고치거나, 다음 명령으로 볼트를 만드세요: \`${cmd}\``,
  "err.noVaultAnywhere": (dirs, cmd) =>
    `다음 경로에 \`vault.json\`이 없습니다 — ${dirs}. \`AGENTMON_VAULT\` 환경 변수를 설정하거나, 주소에 \`?vault=<dir>\` 형식으로 볼트를 지정하거나, 다음 명령으로 새 볼트를 만드세요: \`${cmd}\``,
  "err.orJoin": " 또는 ",
  "err.noVaultAt": (path, hint) => `이 경로에 볼트가 없습니다 — \`${path}\`. ${hint}`,
  "err.noVaultJsonHint": (cmd) =>
    `해당 폴더에 \`vault.json\`이 없습니다. 다음 명령으로 만드세요: \`${cmd}\``,
  "err.notAVault": (dir, cmd) =>
    `볼트 폴더가 아닙니다 — \`${dir}\`에 \`vault.json\`이 없습니다. \`vault.json\`과 \`projects/\`가 들어 있는 폴더를 고르거나, 다음 명령으로 새 볼트를 만드세요: \`${cmd}\``,
  "err.folderUnreadable": (detail) => `이 폴더를 읽지 못했습니다: \`${detail}\``,
  "err.projectNotFound": (slug, vault) =>
    `이 볼트에 \`${slug}\` 프로젝트가 없습니다 — 볼트 경로: \`${vault}\``,
  "err.projectListHint": (cmd) => ` 등록된 프로젝트는 다음 명령으로 볼 수 있습니다: \`${cmd}\``,
  "err.recordNotFound": (id, slug) => `\`${slug}\` 프로젝트에 \`${id}\` 기록이 없습니다`,
  "err.expectedFile": (path) => ` 찾은 파일 경로: \`${path}\``,
  "err.badSlug": (slug) =>
    `쓸 수 없는 프로젝트 슬러그입니다 — \`${slug}\`. 소문자와 숫자, \`-\`, \`_\` 만 쓸 수 있습니다.`,
  "err.badId": (id, expected, example) =>
    `쓸 수 없는 ID입니다 — \`${id}\`. \`${expected}\` 형식이어야 합니다 (예: \`${example}\`).`,
  "err.noRoute": (path) => `이 주소를 처리하는 볼트 API 경로가 없습니다 — \`${path}\``,
  "err.unreachable": (path, detail) =>
    `볼트 API에 연결하지 못했습니다 — \`${path}\`. 개발 서버가 실행 중인지 확인하세요. (\`${detail}\`)`,
  "err.httpStatus": (status) => `볼트 API가 \`${status}\`로 응답했습니다`,
  "err.stoppedAnswering": "볼트가 응답하지 않습니다",
  "err.desktopOnlySwitch":
    "볼트 전환은 데스크톱 앱에서만 됩니다. 브라우저 모드에서는 주소에 `?vault=<dir>` 형식으로 지정하거나, `npm run dev` 전에 `AGENTMON_VAULT` 환경 변수를 설정하세요.",
  "err.desktopOnlyPicker": "폴더 선택 창은 데스크톱 앱에서만 열 수 있습니다.",
  "err.desktopOnlyCreate":
    '창에서 볼트를 만드는 기능은 데스크톱 앱에서만 됩니다. 브라우저 모드에서는 다음 명령을 실행하세요: `agentmon init --vault <dir> --name "<vault name>"`',

  "onboard.titleEmpty": "이 볼트에는 아직 프로젝트가 없습니다",
  "onboard.titleNone": "여기에는 아직 볼트가 없습니다",
  "onboard.sub":
    "볼트는 평범한 파일로 된 디렉터리입니다. `vault.json`이 있고, 프로젝트마다 폴더 하나가 작업 로그와 버그, 이벤트 로그를 담습니다. 에이전트가 `agentmon` CLI로 쓰고, 이 앱이 읽습니다.",
  "onboard.stepVault": "볼트 만들기",
  "onboard.stepProject": "프로젝트 만들기",
  "onboard.stepWork": "첫 작업 기록하기",
  "onboard.noteCreateVault":
    "또는 위의 **볼트 만들기…**를 눌러 폴더를 고르세요. 같은 두 가지를 만들고 여기에서 바로 엽니다.",
  "onboard.noteNewProject": "또는 위의 **새 프로젝트**를 누르세요 — 같은 파일을 씁니다.",
  "onboard.noteBody":
    "본문에는 `## What`, `## Why`, `## How`가 필요합니다. 빠져 있으면 CLI가 템플릿을 출력합니다.",
  "onboard.footCli": (path) =>
    `\`agentmon\` 실행 파일은 이 앱과 함께 \`${path}\`에 설치됩니다 — 위 명령은 이미 그 경로를 가리킵니다.`,
  "onboard.footDesktop": "이미 볼트가 있나요? 위의 **볼트 폴더 열기…**를 쓰세요.",
  "onboard.footBrowser":
    "이미 볼트가 있나요? 개발 서버는 `AGENTMON_VAULT`로, 이 창은 `?vault=<dir>`로 볼트를 지정하세요.",
  "onboard.footHelp": (cli) => ` 전체 명령은 \`${cli} --help\`에 있고, 하위 명령마다 \`--help\`를 지원합니다.`,
  "onboard.footManual": (path) => ` 매뉴얼은 이 기기의 \`${path}\`에 있습니다.`,
  "vault.browserHint":
    "다른 볼트는 `?vault=<dir>`로 열거나, 개발 서버를 `AGENTMON_VAULT`와 함께 시작하세요.",

  /* -- dashboard --------------------------------------------------------------- */

  "dash.currentState": "현재 상태",
  "dash.timeRange": "기간",
  "dash.range7": "7일",
  "dash.range30": "30일",
  "dash.rangeAll": "전체 기간",
  "dash.live": "실시간",
  "dash.liveTip": "최근 두 시간 안에 기록된 활동이 있습니다",
  "dash.archivedPill": "보관됨",
  "dash.archivedTip":
    "보관된 프로젝트입니다. 삭제된 것은 없으며, 프로젝트 화면에서 되돌릴 수 있습니다.",
  "dash.lastActivity": (when) => `마지막 활동 ${when}`,
  /* "…는 ${range} 기준입니다" rather than "…는 ${range}을 다룹니다": 기준입니다 needs no
     particle, so the sentence stays right whether the range ends in 일, 건 or a digit. */
  /* "위 현황 띠는 항상 현재이며"는 "The strip above is always now"를 그대로 옮긴 말이었다 —
     띠는 현재일 수 없고, 화면에 '현황 띠'라는 이름도 없다. 맨 위 카드들이 실제로 달고 있는
     이름(현재 상태)으로 부른다. */
  "dash.scope": (range) =>
    `아래 차트와 에이전트, 활동 기록은 ${range} 기준입니다. 맨 위 현재 상태는 기간과 상관없이 항상 지금이며, 이 페이지의 모든 날짜와 시각은 UTC입니다.`,
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
  "dash.countPart": (count, label) => `${label} ${count}`,
  "dash.hoursLabel": (counts) => `최근 24시간의 시간대별 이벤트 수, 오래된 순: ${counts}`,

  "dash.chartWork": "작업",
  "dash.chartBugs": "버그",
  "dash.chartWorkSub": (change) => `시작 대비 완료 누적 추이${change}`,
  "dash.chartBugsSub": (change) => `등록 대비 해결 누적 추이${change}`,
  "dash.changeOver": (range) => ` · ${range} 변화 포함`,
  "dash.allWork": "작업 전체",
  "dash.bugBoard": "버그 보드",
  "dash.chartWorkEmpty": "아직 작업 로그가 없습니다",
  "dash.chartWorkEmptyHint": (slug) =>
    `에이전트가 \`agentmon work start -p ${slug}\`를 실행하는 순간 이 차트가 그려집니다.`,
  "dash.chartBugsEmpty": "아직 등록된 버그가 없습니다",
  "dash.chartBugsEmptyHint": "그릴 것이 없습니다. 이 차트에서는 그것이 좋은 상태입니다.",
  "dash.seriesStarted": "시작",
  "dash.seriesFiled": "등록",
  "dash.nounWorkLogs": "작업 로그",
  "dash.nounBugs": "버그",

  "dash.agentsCard": "에이전트",
  "dash.agentsEmpty": "이 기간에 기록을 남긴 에이전트가 없습니다",
  "dash.agentsEmptyHint":
    "위에서 기간을 넓히거나 볼트를 확인하세요. CLI로 무언가 바꿀 때마다 events.jsonl 에 한 줄이 추가됩니다.",
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
  "dash.legendProject": "프로젝트",
  "dash.agentBarTip": (total, work, bugs, project) =>
    `이벤트 ${total}건 — 작업 ${work}, 버그 ${bugs}${project ? `, 프로젝트 ${project}` : ""}`,
  "dash.agentDotTip": (count, inProgress, seen) => `${count} ${inProgress} · 마지막 기록 ${seen}`,
  "dash.agentIdleTip": (inProgress, seen) => `${inProgress}인 작업 로그 없음 · 마지막 기록 ${seen}`,
  "dash.agentIdleLabel": "진행 중인 작업 로그 없음",
  "dash.agentTableNote": (events) =>
    `이 기간의 이벤트 ${events}건을 각각 기록한 에이전트 앞으로 모두 집계했습니다 — 프로젝트 변경 포함.`,

  "dash.activity": "활동",
  "dash.activityNote": (events, days) => `이벤트 ${events}건 · ${days}일 · UTC`,
  "dash.expandAll": "모두 펼치기",
  "dash.collapseAll": "모두 접기",
  "dash.activityEmpty": "이 기간에 기록된 것이 없습니다",
  "dash.activityEmptyHint":
    "CLI로 무언가 바꿀 때마다 events.jsonl 에 한 줄이 추가됩니다. 위에서 기간을 넓히면 이전 기록도 볼 수 있습니다.",
  "dash.dayMix": (events, parts) => `이벤트 ${events}건 — ${parts}`,
  "dash.showOther": (n, day) => `${day} 나머지 ${n}건 보기`,
  "dash.today": "오늘",
  "dash.yesterday": "어제",

  /* -- charts ------------------------------------------------------------------ */

  "chart.now": "지금",
  "chart.busiestHourPre": "가장 바쁜 시간대 이벤트 ",
  "chart.busiestHour": () => "건 · 시각은 UTC",
  "chart.hourTip": (hour, count) => `${hour} UTC — 이벤트 ${count}건`,
  "chart.bucketHours": (day, from, to) => `${day} ${from} – ${to}`,
  "chart.summary": (upperLabel, upper, lowerLabel, lower, noun, periods, from, to) =>
    `${noun}: ${upperLabel} ${upper}, ${lowerLabel} ${lower}. ${from}부터 ${to}까지 ${periods}개 구간, UTC 기준. `,
  "chart.summaryDelta": (range, upper, upperLabel, lower, lowerLabel) =>
    `${range} 변화: ${upperLabel} ${upper}, ${lowerLabel} ${lower}. `,
  "chart.summaryKeys": "왼쪽·오른쪽 화살표 키로 구간을 하나씩 읽을 수 있습니다.",
  "chart.reading": (when, upper, upperLabel, lower, lowerLabel, gap, gapLabel) =>
    `${when}: ${upperLabel} ${upper}, ${lowerLabel} ${lower}, ${gapLabel} ${gap}.`,
  "chart.deltaTip": (delta, label, range) => `${range} 동안 ${label} ${delta}`,

  /* -- the vocabulary (lib/words.ts) -------------------------------------------- */

  "word.workNoun": "작업 로그",
  "word.bugNoun": "버그",
  "word.workLogs": (n) => `작업 로그 ${n}개`,
  "word.bugs": (n) => `버그 ${n}개`,
  "word.events": (n) => `이벤트 ${n}건`,

  "word.work.in_progress": "진행 중",
  "word.work.done": "완료",
  "word.work.abandoned": "중단",
  "word.bug.open": "열림",
  "word.bug.in_progress": "진행 중",
  "word.bug.resolved": "해결됨",
  "word.bug.closed": "닫힘",
  "word.sev.critical": "치명적",
  "word.sev.high": "높음",
  "word.sev.medium": "보통",
  "word.sev.low": "낮음",

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

  "word.inProgressOf": (n, total) => `${total}개 중 ${n}개 진행 중`,
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
  "verb.project_created": "프로젝트 생성",
  "verb.project_updated": "프로젝트 수정",

  "recent.started": "시작",
  "recent.notes": "노트",
  "recent.done": "완료",
  "recent.abandoned": "중단",
  "recent.filed": "등록",
  "recent.claimed": "담당 지정",
  "recent.resolved": "해결",
  "recent.closed": "닫힘",
  "recent.project": "프로젝트",
  "recent.other": "기타",

  "tone.work": "작업",
  "tone.done": "완료",
  "tone.bug": "버그",
  "tone.resolved": "해결",
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
