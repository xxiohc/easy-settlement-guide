# tools/ui_sweep.mjs — 화면 입력 전수 점검

카드4(출장 정보 입력)의 모든 입력을 **공문 있음 / 공문 없음** 두 경로로 각각 눌러보고,
카드9(예상 정산 금액)까지 주행해 총액·역산 역·교통비 역을 대조한다.

## 왜 있나
2026-09-24, 공문을 올리지 않으면 출장기간 날짜를 고를 수 없는 버그가 있었다.
원인은 `.date-native { pointer-events: none }` + `showPicker()` 의존이었고,
WebKit(사파리·iOS)에서 `showPicker()` 는 **예외도 던지지 않고 아무 일도 하지 않는다.**
공문을 올리면 날짜가 자동입력돼 이 버그가 가려졌다.
크롬에서만 보면 절대 안 잡히므로, 이 점검은 **반드시 WebKit으로도** 돌린다.

## 실행
    npm i playwright-core && npx playwright install webkit chromium
    python3 -m http.server 8799          # app/ 에서
    ENGINE=webkit node tools/ui_sweep.mjs
    ENGINE=chrome node tools/ui_sweep.mjs

`BASE` 로 배포본도 점검할 수 있다.
    BASE=https://smc-expense-guide.vercel.app/index.html ENGINE=webkit node tools/ui_sweep.mjs

## 판정
- `FAIL` 이 하나라도 있으면 배포하지 않는다.
- `N/A` 는 그 일정에 해당 없는 조건부 질문(예: 2박3일에서 "8시간 이하냐")이라 정상이다.

---

# tools/ux_fix_check.mjs — 2026-09-25 UX 점검 지적사항 회귀

ui_sweep이 "입력이 눌리는가"를 보는 반면, 이쪽은 **고친 동작이 그대로인가**를 본다.
온라인↔오프라인 등록비 유지, KTX 힌트 숨김, 카드6 3지선다 통합, 전날이동 자동판정,
공문 없을 때 구비서류에서 공문 제외, 다녀온 출장 문구, 드롭다운 겹침까지 25건.

    python3 -m http.server 8799   # app/ 에서
    node tools/ux_fix_check.mjs   # chromium 헤드리스 420x900
