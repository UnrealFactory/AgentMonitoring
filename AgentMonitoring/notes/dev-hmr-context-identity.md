---
name: dev-hmr-context-identity
title: 개발 코드 갱신 중 검은 화면과 공유 컨텍스트 유지
type: memory
description: "BUG-0030: 코드 갱신 중 컨텍스트 객체가 바뀌어 앱이 비었습니다. 다섯 컨텍스트를 stableContext로 유지하며 check:hmr로 켜 둔 창과 미저장 입력의 갱신을 검증합니다."
agent: codex
updated_by: null
created: 2026-09-08T11:20:20Z
updated: 2026-09-08T11:20:20Z
tags: []
refs: [BUG-0030, WORK-0116, verify-desktop-via-cdp, project-organization-and-create-defaults]
---

2026-09-08 WORK-0116에서 BUG-0030을 재현하고 수정했습니다. 설치본을 배포한 작업은 아니며 개발 소스의 변경 반영 경로 수정입니다.

확인한 원인: 개발 앱을 켜 둔 상태에서 ko.ts/en.ts에 주석만 동시에 추가해도 Vite HMR(소스 변경을 실행 중인 화면에 반영하는 기능)이 공유 모듈들을 서로 다른 갱신 묶음으로 교체했습니다. AppContext의 createContext가 새 객체를 만들면서 제공자와 소비자가 다른 컨텍스트를 참조했고 useWindowTitle → useApp에서 `useApp must be used inside <AppProvider>` 오류가 발생했습니다. 실제 WebView2의 #root 내용은 36,745자에서 0자로 비었습니다. 소스를 되돌릴 때 다시 그려지기도 해서 새 창 실행 검사로는 이 경로를 놓쳤습니다.

채택한 구현: src/lib/stableContext.ts의 stableContext(name, initialValue)를 사용합니다. 개발 모드에서는 고유 이름으로 컨텍스트 객체만 Vite hot.data에 보존합니다. 앱의 실제 데이터 저장소가 아니며 일반 빌드는 React createContext를 그대로 사용합니다. 현재 app, context-menu, delete-project, folder-editor, record-titles 다섯 이름이 있습니다. 새 공유 컨텍스트도 고유 이름을 사용해야 합니다.

검증: npm run check:hmr는 .critic-tmp 아래 격리한 소스 사본을 편집합니다. 번역 문구와 제공자·메뉴·편집기·마크다운·stableContext 모듈을 변경/복원하는 6회 동안 문구가 실제로 바뀌는지, 페이지가 재로딩되지 않는지, 빈 루트가 없는지, 열린 폴더 입력창의 미저장 내용과 키보드 초점이 유지되는지 검사합니다. 검사 서버의 캐시와 레지스트리는 별도입니다. `node scripts/check-hmr.mjs --without-fix`는 사본에서 기존 생성 방식으로 돌아가며 첫 패치의 useApp 오류로 실패하는 것이 정상입니다.

실제 데스크톱 앱도 CDP로 연결해 동일한 6회 변경/복원을 수행했습니다. 문구 반영·오류 0건·미저장 입력 보존·재로딩 없음을 확인했습니다. 빌드와 프로젝트 폴더 회귀 22개도 통과했습니다. 모든 진단용 소스 변경은 원문으로 복원했습니다.

작업 종료 시 진단 앱과 서버를 종료하고 일반 tauri dev를 5175로 다시 실행했습니다. 5173은 다른 프로젝트 서버이므로 건드리지 마세요. 향후 검사는 새 창 부팅만으로 대신하지 말고, 켜 둔 창에서 실제로 코드가 교체되는 경로를 포함하세요.

## For humans

패치 뒤 개발 앱이 검게 남던 원인은 화면의 공유 상태 연결이 코드 교체 중 달라지는 문제였습니다. 이제 교체 전후에도 같은 연결을 사용하도록 수정했습니다.

새 창을 여는 검사뿐 아니라 이미 켜 둔 실제 앱에서 코드 변경을 반복했습니다. 여섯 차례 갱신 중 화면과 작성 중인 입력이 유지됐고, 같은 검사를 수정 전 방식으로 돌리면 기존 오류가 재현됐습니다. 이 경로를 자동으로 검사하는 check:hmr도 추가했습니다.
