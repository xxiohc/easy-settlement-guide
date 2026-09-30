#!/bin/bash
# 배포 전 전체 점검(app/ 에서 실행). 하나라도 실패하면 main 병합·push 하지 않는다.
#   bash tools/check_all.sh          # 단위·경로·화면·공문 판독(사파리·크롬)
#   QUICK=1 bash tools/check_all.sh  # 공문 판독 실측 생략(단위·경로만)
cd "$(dirname "$0")/.."
fail=0
step() { echo; echo "── $1"; }
step "문법"; node -e "new Function(require('fs').readFileSync('src/app.js','utf8'))" && echo ok || fail=1
step "단위 테스트(npm test)"; out=$(npm test --silent 2>&1); echo "$out" | grep -E '^ℹ (pass|fail)'; echo "$out" | grep -q '^ℹ fail 0' || { echo "$out" | grep '^✖' | head; fail=1; }
step "경로·역산(test_route)"; out=$(node --test tools/test_route.js 2>&1); echo "$out" | grep -E '^ℹ (pass|fail)'; echo "$out" | grep -q '^ℹ fail 0' || fail=1
if [ -z "$QUICK" ]; then
  # 로컬 서버(8799)가 없으면 띄운다 — 판독·화면 점검은 실제 브라우저로 한다
  if ! curl -s -o /dev/null http://localhost:8799/; then (npx serve -l 8799 --no-clipboard . >/dev/null 2>&1 &); sleep 4; fi
  step "화면 점검(ux_fix_check)"; out=$(node tools/ux_fix_check.mjs 2>&1); echo "$out" | tail -1; echo "$out" | grep -q 'FAIL 0건' || { echo "$out" | grep '^FAIL' | head; fail=1; }
  # 2026-09-30: 여정 카드의 줄바꿈·가로넘침을 배포 뒤에야 따로 돌려 잡았다 — 배포 전 점검에 넣는다
  step "줄바꿈·가로넘침(wrap_scan)"; out=$(node tools/wrap_scan.mjs 2>&1); echo "$out" | tail -1; echo "$out" | grep -q '총 0건' || { echo "$out" | grep '^FAIL' | head; fail=1; }
  for e in webkit chrome; do
    step "공문 판독 정답 대조($e)"; out=$(ENGINE=$e node tools/parse_sweep.mjs 2>&1); echo "$out" | tail -1
    echo "$out" | grep -q '불일치 0개' || { echo "$out" | grep -A6 '^FAIL' | head -30; fail=1; }
    echo "$out" | grep '^SKIP' && fail=1
  done
fi
echo; [ $fail = 0 ] && echo "✅ 전체 통과 — 병합·배포 가능" || { echo "❌ 실패 — 원인을 고치고 다시 돌린다(정답표·테스트를 결과에 맞춰 고치지 말 것)"; exit 1; }
