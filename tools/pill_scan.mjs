// 흐름 전체를 돌며 알약 배지가 두 줄로 접히거나 칸 밖으로 넘치는 곳이 남았는지 훑는다.
import { webkit } from 'playwright-core'
const BASE = process.env.BASE || 'http://localhost:8799/index.html'
const SEL = '.alt-tag, .auto-badge, .pending-badge, .doc-badge-jeju, .doc-badge-shortday, .duration-tag, .duration-badge, .sub-badge, .tf-post-badge'

const scan = async (p, where, out) => {
  await p.waitForTimeout(350)
  const bad = await p.evaluate(sel => {
    const res = []
    document.querySelectorAll(sel).forEach(el => {
      if (!el.offsetParent) return
      const cs = getComputedStyle(el)
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4
      const lines = Math.round(el.getBoundingClientRect().height / lh)
      const over = el.scrollWidth > el.clientWidth + 0.5
      if (lines > 1 || over) res.push({ cls: el.className, text: el.textContent.trim().slice(0, 40), lines, font: cs.fontSize, over })
    })
    return res
  }, SEL)
  const seen = await p.evaluate(sel => document.querySelectorAll(sel).length, SEL)
  out.push({ where, seen, bad })
}

const b = await webkit.launch({})
for (const width of [320, 390, 430]) {
  const out = []
  const ctx = await b.newContext({ viewport: { width, height: 900 } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  await p.goto(BASE, { waitUntil: 'networkidle' })
  await p.click('[data-choice="done"]'); await p.waitForTimeout(300)
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(600)

  await p.fill('#input-title', '재무부서장 정기세미나')
  await p.evaluate(() => {
    document.getElementById('input-start').value = '2026-10-12'
    document.getElementById('input-end').value = '2026-10-14'
    onDateChange()
    document.getElementById('input-region').value = '제주'
    onRegionInput()
    document.getElementById('input-starttime').value = '14:00'
    onTimeChange()
  })
  await p.click('#feeBtn-yes'); await p.waitForTimeout(150)
  await p.fill('#input-fee', '330000')
  await scan(p, '카드4 정보확인', out)

  await p.evaluate(() => goToCard(6))
  await p.evaluate(() => select6Method('bank')); await scan(p, '카드6 계좌이체 증빙', out)
  await p.evaluate(() => select6Method('pending'))
  await p.evaluate(() => select6PendingMethod('bank')); await scan(p, '카드6 납부전', out)
  await p.evaluate(() => select6Method('bank'))
  await p.evaluate(() => select6Receipt('transfer')); await p.waitForTimeout(500)

  await p.evaluate(() => goToCard(8))
  await p.evaluate(() => { try { setYN('lodgingProvided', false); setYN('mealProvided', false); setYN('isMS', false) } catch {} })
  await scan(p, '카드8 추가확인', out)
  await p.evaluate(() => goToCard(9)); await scan(p, '카드9 예상금액', out)
  await p.evaluate(() => goToCard(10)); await scan(p, '카드10 출장신청서', out)
  await p.evaluate(() => goToCard(11)); await scan(p, '카드11 구비서류', out)

  for (const r of out) {
    const status = r.bad.length ? 'FAIL' : 'PASS'
    console.log(`[${width}px] ${status} — ${r.where} · 배지 ${r.seen}개` +
      (r.bad.length ? ' · ' + JSON.stringify(r.bad) : ''))
  }
  console.log(`[${width}px] ${errs.length ? 'FAIL' : 'PASS'} — JS 에러 ${errs.length}건 ${errs.join(' | ')}`)
  await ctx.close()
}
await b.close()
