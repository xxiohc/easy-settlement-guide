#!/bin/bash
# ../KTX 운임표·시간표/ 에 새 KORAIL 엑셀을 넣은 뒤 실행한다(app/ 에서).
# 운임·시간표 JSON과 app.js·admin.js·rates.json 운임표를 다시 만들고, 바뀐 운임과 테스트 결과를 보여 준다.
# 배포(main 병합·push)는 하지 않는다 — 교통비 금액이 바뀌므로 지석초이 확인 뒤에 한다.
set -e
cd "$(dirname "$0")/.."
python3 tools/build_fares.py
python3 tools/build_timetable.py
echo; echo "── 바뀐 운임(rates.json fareTable) ──"
git diff -U0 data/rates.json | grep -E '^[-+] ' || echo "운임 변경 없음"
echo; echo "── 테스트 ──"
node --test tools/test_route.js 2>&1 | grep -E '^ℹ (pass|fail)'
npm test --silent 2>&1 | grep -E '^ℹ (pass|fail)'
