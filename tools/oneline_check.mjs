import { webkit } from 'playwright-core'
const BASE = process.env.BASE || 'http://localhost:8799/index.html'
const b = await webkit.launch({})
const out = []
const log = (w, item, status, note = '') => out.push({ w, item, status, note })

for (const width of [320, 390, 430]) {
  const ctx = await b.newContext({ viewport: { width, height: 900 } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  await p.goto(BASE, { waitUntil: 'networkidle' })

  await p.click('[data-choice="done"]'); await p.waitForTimeout(300)
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(600)

  // 온라인 선택 → 교육 시각·장소·지역 숨김
  await p.click('#modeBtn-online'); await p.waitForTimeout(300)
  for (const [id, label] of [['field-time', '교육 시각'], ['field-place', '출장 장소'], ['field-region', '출장 지역']]) {
    const vis = await p.isVisible('#' + id)
    log(width, `온라인: ${label} 숨김`, vis ? 'FAIL' : 'PASS')
  }
  const labels = await p.evaluate(() => ({
    title: document.getElementById('label-title').textContent,
    period: document.getElementById('label-period').textContent,
  }))
  log(width, '온라인: 라벨 교육명/교육 기간',
    labels.title === '교육명' && labels.period === '교육 기간' ? 'PASS' : 'FAIL', JSON.stringify(labels))

  // 오프라인으로 되돌리면 교육 시각 복귀
  await p.click('#modeBtn-offline'); await p.waitForTimeout(300)
  log(width, '오프라인: 교육 시각 복귀', await p.isVisible('#field-time') ? 'PASS' : 'FAIL')

  // 카드6 대체 증빙 배지 한 줄 여부
  await p.fill('#input-title', '온라인 교육 테스트')
  await p.evaluate(() => {
    document.getElementById('input-start').value = '2026-10-12'
    document.getElementById('input-end').value = '2026-10-12'
    onDateChange()
    document.getElementById('input-region').value = '서울'
    onRegionInput()
  })
  await p.click('#feeBtn-yes'); await p.waitForTimeout(200)
  await p.fill('#input-fee', '200000')
  await p.evaluate(() => goToCard(6)); await p.waitForTimeout(500)
  await p.evaluate(() => select6Method('bank')); await p.waitForTimeout(400)

  const pill = await p.evaluate(() => {
    const el = document.querySelector('.alt-tag')
    if (!el) return null
    const cs = getComputedStyle(el)
    const lines = Math.round(el.getBoundingClientRect().height /
      (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4))
    const parent = el.parentElement, ps = getComputedStyle(parent)
    const avail = parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight)
    return { text: el.textContent, font: cs.fontSize, w: el.getBoundingClientRect().width, avail, lines,
             scrollW: el.scrollWidth, clientW: el.clientWidth, display: cs.display }
  })
  if (!pill) log(width, '대체 증빙 배지 노출', 'FAIL', '.alt-tag 없음')
  else {
    log(width, '대체 증빙 배지 한 줄', pill.lines <= 1 ? 'PASS' : 'FAIL', `lines=${pill.lines} font=${pill.font}`)
    log(width, '배지 폭 ≤ 칸 폭', pill.w <= pill.avail + 0.5 ? 'PASS' : 'FAIL',
      `${pill.w.toFixed(1)} / ${pill.avail.toFixed(1)} font=${pill.font}`)
    log(width, '배지 글자 넘침 없음', pill.scrollW <= pill.clientW + 0.5 ? 'PASS' : 'FAIL',
      `scroll ${pill.scrollW} / client ${pill.clientW} display=${pill.display}`)
  }
  log(width, 'JS 에러 없음', errs.length ? 'FAIL' : 'PASS', errs.join(' | '))
  await ctx.close()
}
await b.close()
for (const r of out) console.log(`[${r.w}px] ${r.status} — ${r.item}${r.note ? ' · ' + r.note : ''}`)
console.log('FAIL', out.filter(r => r.status === 'FAIL').length, '/ 총', out.length)
