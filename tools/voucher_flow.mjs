// 전표 작성 안내(카드12) 화면 점검 — 실제 흐름(카드2→4→6→8→9→10→11)을 지나 전표 안내로 들어간다.
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
const next = async p => { await p.click('#vg-next'); await p.waitForTimeout(250) }
const clickText = async (p, t) => { await p.locator('#vg-screen button', { hasText: t }).first().click(); await p.waitForTimeout(200) }

// 카드8 이후 보이는 질문은 첫 답을 고르고 끝까지
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

// ── 1. 선지급(증빙은 교육 후) → 저장 → 첫 화면에서 최종 정산 재개 ──
for (const width of [1280, 390]) {
  const [ctx, p] = await page(width)
  const at = await toCard11(p)
  check(`[${width}] 카드11 도달`, at === 'card-11', at)
  check(`[${width}] 카드11에 전표 안내 진입 상자`, await p.isVisible('#vg-entry'))
  await shot(p, `${width}-card11`)
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(500)
  check(`[${width}] 카드12 진입·첫 화면 확인`, (await active(p)) === 'card-12' && (await screen(p)) === 'confirm')
  const t1 = await text(p)
  check(`[${width}] 앞 단계 금액을 가져온다(등록비 300,000)`, t1.includes('300,000원') && t1.includes('예상 금액'), t1.slice(0, 80))
  await shot(p, `${width}-confirm`)
  await next(p)
  check(`[${width}] 할 일 선택 화면`, (await screen(p)) === 'task')
  check(`[${width}] 선택 전엔 다음 버튼 잠김`, await p.isDisabled('#vg-next'))
  await clickText(p, '등록비를 먼저 보내야 해요'); await shot(p, `${width}-task`); await next(p)
  await clickText(p, '교육이 끝난 뒤 받을 수 있어요'); await shot(p, `${width}-adv`); await next(p)
  const tp = await text(p)
  check(`[${width}] 처리 방법 B(선지급 후 최종 정산)`, tp.includes('등록비를 먼저 보내고'), tp.slice(0, 60))
  await shot(p, `${width}-plan`); await next(p)
  const tv = await text(p)
  check(`[${width}] 전표: 차 가지급금-기타 1114-99 / 대 보통예금 1102-02 300,000`, /가지급금-기타\s*1114-99.*300,000원.*보통예금\s*1102-02.*300,000원/.test(tv) && tv.includes('일치'), tv.slice(0, 160))
  await shot(p, `${width}-voucher`); await next(p)
  const td = await text(p)
  check(`[${width}] 선지급 서류: 출장신청서·통장 사본(필요할 때만), 공문 없음 건은 공문 빼기`, td.includes('출장신청서') && td.includes('통장 사본') && !td.includes('실시 공문'), td.slice(0, 80))
  await shot(p, `${width}-docs`); await next(p)
  const tc = await text(p)
  check(`[${width}] 점검: 서류·확인을 안 하면 남은 일로 표시`, /아직 \d+가지가 남았어요/.test(tc))
  await shot(p, `${width}-check-left`)
  await next(p)
  const tdn = await text(p)
  check(`[${width}] 남은 일이 있으면 '제출 준비 끝' 대신 '남아 있어요'`, tdn.includes('아직 확인할 것이') && !tdn.includes('준비가 끝났어요'))
  await p.click('.back-footer-btn >> nth=-1').catch(() => {}); await p.evaluate(() => vgGo(-1)); await p.waitForTimeout(200)
  // 점검 화면에서 모두 체크
  await p.evaluate(() => { vgGo(-1) }); await p.waitForTimeout(200)
  await p.evaluate(() => { const r = vgResult(); r.docs.forEach(d => { if (!d.optional) vg.checks['doc-' + d.key] = true }); vgUserChecks(r).forEach(([k]) => { vg.checks[k] = true }); vg.screen = 'check'; renderVoucher() })
  const tc2 = await text(p)
  check(`[${width}] 모두 확인하면 남은 확인 없음`, tc2.includes('남은 확인이 없어요'), tc2.slice(-60))
  await next(p)
  const tdone = await text(p)
  check(`[${width}] 제출 안내: 선지급 전표 준비 끝 + 1~2일 전 제출 안내 + 지급 완료 아님`, tdone.includes('선지급 전표') && tdone.includes('1~2일 전') && tdone.includes('지급이나 정산이 끝난 것은 아니에요'))
  await shot(p, `${width}-done`)
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('expense_guide_voucher_v1') || 'null'))
  check(`[${width}] 이 기기에 저장·최종 정산 남음 표시`, saved && saved.pendingFinal === true && saved.advanceAmount === 300000)
  // 새로 열면 첫 화면에 이어하기
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400)
  const rs = await p.evaluate(() => document.getElementById('voucher-resume').innerText.replace(/\s+/g, ' '))
  check(`[${width}] 첫 화면에 '최종 정산이 남아 있어요'`, rs.includes('최종 정산이 남아 있어요') && rs.includes('300,000원'), rs.slice(0, 80))
  await shot(p, `${width}-resume-banner`)
  await p.click('#voucher-resume .vg-btn-primary'); await p.waitForTimeout(400)
  check(`[${width}] 재개: 실제 처리 상태를 다시 묻는다(예정액을 지급액으로 보지 않음)`, (await screen(p)) === 'resume' && (await p.evaluate(() => vg.bankPay.amount)) === null)
  await clickText(p, '가지급금으로 보냈어요')
  await p.fill('[data-money="bankPay.amount"]', '300000'); await p.dispatchEvent('[data-money="bankPay.amount"]', 'change'); await p.waitForTimeout(150)
  await p.fill('[data-text="bankPay.ref"]', '20261101-0001-001'); await p.dispatchEvent('[data-text="bankPay.ref"]', 'change'); await p.waitForTimeout(150)
  await clickText(p, '끝났어요'); await clickText(p, '바뀐 것 없어요')
  await shot(p, `${width}-resume`); await next(p)
  check(`[${width}] 재개 → 지급 내역(송금·가지급금 미리 선택)`, (await screen(p)) === 'paid' && (await p.evaluate(() => vg.paid.bank && vg.bankPay.status)) === 'advance')
  await next(p)
  await clickText(p, '받았어요'); await shot(p, `${width}-evidence`); await next(p)
  const tp2 = await text(p)
  check(`[${width}] 처리 방법 C(가지급금 포함 최종 정산)`, tp2.includes('먼저 보낸 등록비까지 포함'), tp2.slice(0, 60))
  await next(p)
  await clickText(p, '교육·학회 참석'); await clickText(p, '간호사')
  const ta = await text(p)
  check(`[${width}] 계정: 교육훈련비-간호사교육 5301-16-03`, ta.includes('교육훈련비-간호사교육') && ta.includes('5301-16-03'))
  await shot(p, `${width}-account`); await next(p)
  const tam = await text(p)
  check(`[${width}] 최종 금액: 선지급분은 이미 지급 내역, 직원 지급액은 등록비 제외`, tam.includes('먼저 보낸 등록비 정리') && tam.includes('이번에 직원에게 지급할 금액'), tam.slice(0, 120))
  await shot(p, `${width}-amounts`); await next(p)
  const tv2 = await text(p)
  check(`[${width}] 최종 전표: 대변 가지급금-기타에 원 전표번호`, tv2.includes('가지급금-기타') && tv2.includes('20261101-0001-001') && tv2.includes('일치'), tv2.slice(0, 200))
  await shot(p, `${width}-voucher-final`); await next(p)
  const td2 = await text(p)
  check(`[${width}] 최종 서류: 신청서를 다시 첨부 + 등록비 증빙`, td2.includes('다시 첨부') && td2.includes('등록비 증빙'))
  await shot(p, `${width}-docs-final`)
  await ctx.close()
}

// ── 2. 등록비 카드 결제 → 선지급 선택지 없음, 최종 전표에 법인카드 줄 ──
{
  const [ctx, p] = await page(1280)
  await toCard11(p, { feeMode: 'card' })
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400); await next(p)
  const tt = await text(p)
  check('카드 결제한 등록비는 선지급 선택지를 보이지 않는다', !tt.includes('등록비를 먼저 보내야 해요') && tt.includes('법인카드로 결제했다고'))
  await clickText(p, '다녀온 비용을 정산하려고 해요'); await next(p)
  check('지급 내역에 법인카드(등록비) 미리 선택', await p.evaluate(() => vg.paid.card && vg.cardItems.fee === 300000))
  await next(p); await clickText(p, '받았어요'); await next(p); await next(p)
  await clickText(p, '회의·협의회·업무 출장'); await next(p); await next(p)
  // 화면 안내문에도 '보통예금' 낱말이 있어 글자 대신 전표 줄로 본다
  const ln = await p.evaluate(() => vgResult().lines.map(l => [l.key, l.side, l.amount]))
  check('최종 전표: 여비교통비-국내출장비 + 미지급비용-법인개인카드 300,000, 보통예금 줄 없음',
    ln[0][0] === 'travel' && ln.some(([k, s, a]) => k === 'card' && s === 'C' && a === 300000) && !ln.some(([k]) => k === 'bank'), JSON.stringify(ln))
  // ⑫ 앞 답(금액)을 바꾸면 전표가 다시 계산되고, 이전 확인 표시는 풀리며 알린다
  await p.evaluate(() => { vg.checks = { 'user-dup': true, 'doc-application': true }; renderVoucher() })
  await p.evaluate(() => { vg.editKinds = { lodging: true }; vgSet('finalAmounts.lodging', 50000) })
  const after = await p.evaluate(() => [vgResult().lines[0].amount, Object.values(vg.checks).some(Boolean), document.getElementById('vg-screen').innerText])
  check('⑫ 금액을 바꾸면 전표 재계산 + 확인 표시 해제 + 알림', after[0] === 517200 && after[1] === false && after[2].includes('확인 표시를 다시 풀었어요'), `${after[0]} / checks=${after[1]}`)
  await ctx.close()
}

// ── 3. 등록비 없는 출장 → 선지급 선택지 없음 ──
{
  const [ctx, p] = await page(1280)
  await toCard11(p, { fee: 0 })
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400); await next(p)
  const tt = await text(p)
  check('등록비 없으면 선지급 질문 생략', !tt.includes('등록비를 먼저 보내야 해요'))
  await ctx.close()
}

// ── 4. 서류만 준비하고 마치기 → 추가 단계 없음 ──
{
  const [ctx, p] = await page(1280)
  await toCard11(p)
  await p.click('#vg-entry .vg-btn'); await p.waitForTimeout(200)
  check('서류만 준비하고 마치기 → 카드11 그대로', (await active(p)) === 'card-11' && await p.evaluate(() => document.getElementById('vg-entry').classList.contains('is-closed')))
  await ctx.close()
}

await b.close()
console.log(`\n총 ${out.length}건 · FAIL ${out.filter(l => l.startsWith('FAIL')).length}건`)
