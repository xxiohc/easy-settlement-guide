// 전표 작성 안내(카드12) 화면 점검 — 실제 흐름(카드2→4→6→8→9→10→11)을 지나 전표 안내로 들어간다.
// 2026-09-30 개편: 한 화면 한 질문, 고르면 바로 넘어간다. 클릭 수도 센다(클릭클릭 넘어가야 한다는 지석초이 기준).
//   node tools/voucher_flow.mjs            # 점검만
//   SHOT=1 node tools/voucher_flow.mjs     # 화면마다 스크린샷(TMPDIR/vg-*.png)
import { webkit } from 'playwright-core'
const BASE = process.env.BASE || 'http://localhost:8799/index.html'
const SHOT = !!process.env.SHOT
const out = []
const check = (name, ok, note = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`); console.log(out.at(-1)) }
const b = await webkit.launch()

async function page(width) {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: SHOT ? 2 : 1 })
  const p = await ctx.newPage()
  p.on('pageerror', e => check('페이지 예외 없음', false, e.message))
  await p.goto(BASE, { waitUntil: 'networkidle' })
  await p.evaluate(() => localStorage.clear())
  return [ctx, p]
}
const active = p => p.evaluate(() => document.querySelector('.flow-card.active')?.id)
const screen = p => p.evaluate(() => vg && vg.screen)
const text = p => p.evaluate(() => document.getElementById('vg-screen').innerText.replace(/\s+/g, ' '))
const lines = p => p.evaluate(() => vgResult().lines.map(l => [l.name, l.code, l.side, l.amount]))
let shotN = 0
// 카드가 자체 스크롤 칸이라 전체를 찍으려면 카드 높이만큼 창을 늘려 찍고 되돌린다
const shot = async (p, name) => {
  if (!SHOT) return
  const vp = p.viewportSize()
  const h = await p.evaluate(() => document.querySelector('.flow-card.active').scrollHeight + 140)
  await p.setViewportSize({ width: vp.width, height: Math.max(vp.height, h) }); await p.waitForTimeout(150)
  await p.screenshot({ path: `${process.env.TMPDIR}/vg-${String(++shotN).padStart(2, '0')}-${name}.png` })
  await p.setViewportSize(vp)
}
let clicks = 0
const tap = async (p, t) => { clicks++; await p.locator('#vg-screen button', { hasText: t }).first().click(); await p.waitForTimeout(380) }
const next = async p => { clicks++; await p.click('#vg-next'); await p.waitForTimeout(250) }
// 체크할 때마다 화면을 다시 그리므로 매번 안 된 첫 칸을 다시 찾아 누른다
const checkAll = async p => {
  for (let i = 0; i < 12; i++) {
    const el = await p.$('#vg-screen input[type=checkbox]:not(:checked)')
    if (!el) break
    clicks++; await el.evaluate(e => e.click()); await p.waitForTimeout(120)
  }
}

async function answerVisible(p) {
  await p.evaluate(() => {
    const card = document.querySelector('.flow-card.active')
    card.querySelectorAll('.info-field, .yn-group, [id^="field-"]').forEach(f => {
      if (f.classList.contains('hidden') || !f.getBoundingClientRect().height) return
      const btns = [...f.querySelectorAll('.yn-btn')]
      if (btns.length && !btns.some(x => x.classList.contains('selected'))) btns[btns.length - 1].click()
    })
  })
}
async function toCard11(p, { fee = 300000, feeMode = 'pending-bank', region = '서울', title = '의료기관 회계기준 연수' } = {}) {
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(600)
  await p.fill('#input-title', title)
  await p.fill('#input-start', '2026-11-12'); await p.fill('#input-end', '2026-11-13'); await p.dispatchEvent('#input-start', 'change')
  await p.selectOption('#input-starthour', '13'); await p.selectOption('#input-startmin', '00')
  await p.fill('#input-region', region); await p.waitForTimeout(300)
  if (fee) { await p.click('#feeBtn-yes'); await p.fill('#input-fee', String(fee)) } else await p.click('#feeBtn-no')
  await p.waitForTimeout(200); await p.click('#ctaNext4'); await p.waitForTimeout(600)
  if (fee) {
    if (feeMode === 'pending-bank') { await p.click('#c6-btn-pending'); await p.waitForTimeout(200); await p.click('#c6-pend-bank'); await p.waitForTimeout(500) }
    if (feeMode === 'card') { await p.click('#c6-btn-card'); await p.waitForTimeout(200); await p.click('#c6-card-note .cta-btn'); await p.waitForTimeout(500) }
    if ((await active(p)) === 'card-6') { await p.locator('#card-6 .cta-btn:visible').first().click().catch(() => {}); await p.waitForTimeout(400) }
  }
  for (let i = 0; i < 3 && (await active(p)) === 'card-8'; i++) { await answerVisible(p); await p.click('#ctaNext8'); await p.waitForTimeout(600) }
  if ((await active(p)) === 'card-9') { await p.click('#card9-next-btn'); await p.waitForTimeout(600) }
  if ((await active(p)) === 'card-10') { await p.locator('#card-10 .cta-btn').first().click(); await p.waitForTimeout(600) }
  return active(p)
}

// ── 1. 선지급 → 저장 → 첫 화면에서 최종 정산 재개 ──
for (const width of [1280, 390]) {
  const [ctx, p] = await page(width)
  check(`[${width}] 카드11 도달`, (await toCard11(p)) === 'card-11')
  await shot(p, `${width}-card11`)
  clicks = 0
  clicks++; await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(500)
  check(`[${width}] 첫 화면은 바로 '무엇을 하려고 하나요?'(확인 화면 없음)`, (await screen(p)) === 'task' && (await text(p)).includes('예상 567,200원'))
  check(`[${width}] 선택 화면은 다음 버튼 없이 고르면 넘어간다`, await p.isHidden('#vg-next'))
  await shot(p, `${width}-task`)
  await tap(p, '등록비를 먼저 보내요')
  check(`[${width}] 고르자마자 다음 화면`, (await screen(p)) === 'advEv')
  await shot(p, `${width}-advEv`)
  await tap(p, '교육이 끝난 뒤에 받아요')
  check(`[${width}] 전표 화면`, (await screen(p)) === 'voucher')
  const ln = await lines(p)
  check(`[${width}] 선지급 전표: 차 가지급금-기타 1114-99 / 대 보통예금 1102-02 · 300,000`,
    JSON.stringify(ln) === JSON.stringify([['가지급금-기타', '1114-99', 'D', 300000], ['보통예금', '1102-02', 'C', 300000]]), JSON.stringify(ln))
  check(`[${width}] 차변·대변 카드 + 칸마다 합계 + 일치 표시`, (await p.locator('.vt-card').count()) === 2 && (await p.locator('.vt-sum').count()) === 2 && (await p.textContent('.vt-total')).includes('같아요'))
  check(`[${width}] 전표 화면에 복사 버튼 없음`, (await p.locator('#vg-screen [data-copy], #vg-screen .vg-copy').count()) === 0)
  if (width >= 1280) {
    const y = await p.evaluate(() => [...document.querySelectorAll('.vt-sum')].map(e => Math.round(e.getBoundingClientRect().top)))
    check(`[${width}] 차변·대변 합계 줄이 같은 높이`, y[0] === y[1], JSON.stringify(y))
  }
  check(`[${width}] 2회 정산 단계 표시(① 지금 선지급 → ② 교육 후)`, /지금 · 등록비 선지급.*교육 후 · 최종 정산/.test(await text(p)))
  check(`[${width}] 오른쪽에 내가 쓴 출장신청서 원본 + 크로스체크`, (await p.locator('.vx-form .tf-box').count()) === 1 && /신청서 등록비.*300,000원.*✓ 같아요/.test(await p.evaluate(() => document.querySelector('.vx-check').innerText.replace(/\s+/g, ' '))))
  await shot(p, `${width}-voucher-adv`)
  await next(p)
  check(`[${width}] ① 다음은 최종 정산 전표를 위한 목적 질문`, (await screen(p)) === 'purpose')
  await tap(p, '교육·학회 참석'); await tap(p, '간호사')
  check(`[${width}] ② 교육 후 최종 정산 전표 미리 보기`, (await screen(p)) === 'voucher2')
  const ln2p = await p.evaluate(() => vgFinalPreview().lines.map(l => [l.name, l.side, l.amount]))
  check(`[${width}] ② 미리 보기: 차 교육훈련비-간호사교육 / 대 가지급금-기타 300,000 + 현금`,
    JSON.stringify(ln2p) === JSON.stringify([['교육훈련비-간호사교육', 'D', 567200], ['가지급금-기타', 'C', 300000], ['현금', 'C', 267200]]), JSON.stringify(ln2p))
  await shot(p, `${width}-voucher2-preview`)
  await next(p)
  check(`[${width}] 서류: 출장신청서 + 통장 사본(필요할 때만)`, /출장신청서.*통장 사본/.test(await text(p)))
  await checkAll(p); await shot(p, `${width}-docs-adv`); await next(p)
  const td = await text(p)
  check(`[${width}] 제출 준비 끝 + 1~2일 전 + 지급 완료 아님`, td.includes('선지급 전표 제출 준비 끝') && td.includes('1~2일 전') && td.includes('지급·정산이 끝난 건 아니에요'), td.slice(0, 60))
  check(`[${width}] 선지급(①+② 미리 보기) 끝까지 클릭 수 ≤ 13(서류 체크 포함)`, clicks <= 13, `${clicks}번`)
  await shot(p, `${width}-done-adv`)
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('expense_guide_voucher_v1') || 'null'))
  check(`[${width}] 이 기기에 저장·최종 정산 남음`, saved && saved.pendingFinal === true && saved.advanceAmount === 300000)
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400)
  const rs = await p.evaluate(() => document.getElementById('voucher-resume').innerText.replace(/\s+/g, ' '))
  check(`[${width}] 첫 화면에 '최종 정산이 남아 있어요'`, rs.includes('최종 정산이 남아 있어요') && rs.includes('300,000원'), rs.slice(0, 80))
  await shot(p, `${width}-resume-banner`)
  clicks = 0
  clicks++; await p.click('#voucher-resume .vg-btn-primary'); await p.waitForTimeout(400)
  check(`[${width}] 재개: 처리됐는지 다시 묻는다`, (await screen(p)) === 'resumeQ')
  await shot(p, `${width}-resumeQ`)
  await tap(p, '네, 보냈어요')
  check(`[${width}] 재개: 선지급 때 고른 목적·직종은 다시 묻지 않는다`, (await screen(p)) === 'evidence')
  await shot(p, `${width}-evidence`)
  await tap(p, '네, 다 받았어요')
  const ln2 = await lines(p)
  check(`[${width}] 최종 전표: 차 교육훈련비-간호사교육 567,200 / 대 가지급금-기타 300,000 + 현금 267,200`,
    JSON.stringify(ln2) === JSON.stringify([['교육훈련비-간호사교육', '5301-16-03', 'D', 567200], ['가지급금-기타', '1114-99', 'C', 300000], ['현금', '1101', 'C', 267200]]), JSON.stringify(ln2))
  const cmp = await p.evaluate(() => document.querySelector('.vc-status')?.innerText || '')
  check(`[${width}] 신청서 크로스체크: 합계가 같으면 ✓ 같아요`, cmp.includes('신청서와 전표 금액이 같아요'), cmp)
  check(`[${width}] ② 최종 정산 단계 표시`, (await text(p)).includes('② 최종 정산 전표'))
  if (width >= 1280) {
    const pos = await p.evaluate(() => [document.querySelector('.vg-aside').getBoundingClientRect().left, document.querySelector('.vt-grid').getBoundingClientRect().right, document.documentElement.scrollWidth, innerWidth])
    check(`[${width}] 넓은 화면: 비교 패널은 전표 오른쪽, 가로 넘침 없음`, pos[0] > pos[1] || width < 1480, JSON.stringify(pos))
  }
  await shot(p, `${width}-voucher-final`)
  await p.click('#vg-screen .vg-link'); await p.waitForTimeout(250)
  check(`[${width}] '금액이 달라요' → 고치기 화면`, (await screen(p)) === 'amounts')
  await p.fill('[data-text="advanceRef"]', '20261101-0001-001'); await p.dispatchEvent('[data-text="advanceRef"]', 'change'); await p.waitForTimeout(200)
  await next(p)
  check(`[${width}] 원 전표번호가 가지급금 줄 적요로`, (await text(p)).includes('20261101-0001-001'))
  await next(p)
  const tdocs = await text(p)
  check(`[${width}] 최종 서류: 신청서 다시 첨부 + 등록비 증빙`, tdocs.includes('다시 첨부') && tdocs.includes('등록비 증빙'))
  await checkAll(p); await shot(p, `${width}-docs-final`); await next(p)
  check(`[${width}] 최종 제출 준비 끝`, (await text(p)).includes('전표 제출 준비 끝'))
  check(`[${width}] 최종 정산 클릭 수 ≤ 12(서류 체크·전표번호 고치기 포함)`, clicks <= 12, `${clicks}번`)
  await shot(p, `${width}-done-final`)
  await ctx.close()
}

// ── 2. 등록비 카드 결제 → 선지급·납부 방법 질문 생략, 카드 줄 ──
{
  const [ctx, p] = await page(1280)
  await toCard11(p, { feeMode: 'card' })
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  check('카드 결제한 등록비는 선지급 선택지 없음', !(await text(p)).includes('등록비를 먼저 보내요'))
  await tap(p, '다녀온 비용을 정산해요')
  check('카드 결제는 납부 방법을 다시 묻지 않고 목적으로', (await screen(p)) === 'purpose')
  await tap(p, '회의·업무 출장'); await tap(p, '네, 다 받았어요')
  const ln = await lines(p)
  check('최종: 여비교통비-국내출장비 / 법인카드 300,000 + 현금, 보통예금 없음',
    ln[0][0] === '여비교통비-국내출장비' && ln.some(([n, , s, a]) => n === '미지급비용-법인개인카드' && s === 'C' && a === 300000) && !ln.some(([n]) => n === '보통예금'), JSON.stringify(ln))
  await p.evaluate(() => { vg.checks = { 'user-dup': true }; vgJump('amounts') })
  await p.fill('[data-money="finalAmounts.lodging"]', '50000'); await p.dispatchEvent('[data-money="finalAmounts.lodging"]', 'change'); await p.waitForTimeout(250)
  const after = await p.evaluate(() => [vgResult().lines[0].amount, Object.values(vg.checks).some(Boolean), document.getElementById('vg-screen').innerText])
  check('⑫ 금액을 바꾸면 재계산 + 체크 해제 + 알림', after[0] === 517200 && after[1] === false && after[2].includes('체크를 다시 풀었어요'), `${after[0]}`)
  await ctx.close()
}

// ── 3. 등록비 없는 출장 → 선지급·납부·영수증 질문 모두 생략 ──
{
  const [ctx, p] = await page(1280)
  await toCard11(p, { fee: 0 })
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  check('등록비 없으면 선지급 선택지 없음', !(await text(p)).includes('등록비를 먼저 보내요'))
  await tap(p, '다녀온 비용을 정산해요'); await tap(p, '회의·업무 출장')
  check('영수증 필요한 항목이 없으면 영수증 질문 없이 바로 전표', (await screen(p)) === 'voucher')
  await ctx.close()
}

// ── 4. 서류만 준비하고 마치기 ──
{
  const [ctx, p] = await page(1280)
  await toCard11(p)
  await p.click('#vg-entry .vg-btn'); await p.waitForTimeout(200)
  check('서류만 준비하고 마치기 → 카드11 그대로', (await active(p)) === 'card-11' && await p.evaluate(() => document.getElementById('vg-entry').classList.contains('is-closed')))
  await ctx.close()
}

// ── 5. 제주(항공·셔틀 영수증 금액) — 금액을 다 넣어야 다음 ──
{
  const [ctx, p] = await page(390)
  await p.evaluate(() => {
    vg = { version: 2, checks: {}, trip: { title: '재무부서장협의회 세미나', startDate: '2026-11-19', endDate: '2026-11-21', isJeju: true, hasDoc: true },
      costs: [{ kind: 'air', label: '항공료 (왕복)', amount: null }, { kind: 'shuttle', label: '공항 셔틀버스', amount: null }, { kind: 'daily', label: '일당 (3일)', amount: 105000 }, { kind: 'fee', label: '교육비 / 등록비', amount: 400000 }],
      planTotal: 505000, task: 'final', feePay: 'advance', purpose: 'trip', evAll: 'received', screen: 'receipts' }
    vgFrom = 11; goToCard(12); renderVoucher()
  })
  await p.waitForTimeout(500)
  check('제주: 영수증 금액 전엔 다음 잠김', await p.isDisabled('#vg-next'))
  await p.fill('[data-money="finalAmounts.air"]', '145000'); await p.fill('[data-money="finalAmounts.shuttle"]', '15900'); await p.waitForTimeout(150)
  check('제주: 금액을 다 넣으면 다음 열림', !(await p.isDisabled('#vg-next')))
  await shot(p, 'jeju-receipts')
  await p.dispatchEvent('[data-money="finalAmounts.air"]', 'change'); await p.dispatchEvent('[data-money="finalAmounts.shuttle"]', 'change'); await p.waitForTimeout(200)
  await next(p)
  const ln = await lines(p)
  check('제주: 가지급금 400,000 + 카드 145,000·15,900 + 현금 105,000 (p.7 구조)',
    JSON.stringify(ln.map(l => [l[0], l[3]])) === JSON.stringify([['여비교통비-국내출장비', 665900], ['가지급금-기타', 400000], ['미지급비용-법인개인카드', 145000], ['미지급비용-법인개인카드', 15900], ['현금', 105000]]), JSON.stringify(ln))
  const cmp = await p.evaluate(() => document.querySelector('.vc-status')?.innerText || '')
  check('제주: 신청서 공란(항공·셔틀) → +160,900원 달라요 · 출장여비 정산서', cmp.includes('+160,900원 달라요') && cmp.includes('출장여비 정산서'), cmp)
  await shot(p, 'jeju-voucher')
  await ctx.close()
}

await b.close()
console.log(`\n총 ${out.length}건 · FAIL ${out.filter(l => l.startsWith('FAIL')).length}건`)
