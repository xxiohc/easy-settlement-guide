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
// '신청서와 금액이 바뀌었나요?'(2026-10-01)는 따로 시험하는 경우가 아니면 '그대로예요'로 넘긴다
let autoSame = true
const tap = async (p, t) => {
  clicks++; await p.locator('#vg-screen button', { hasText: t }).first().click(); await p.waitForTimeout(380)
  if (autoSame && await p.evaluate(() => vg && vg.screen === 'changed')) { clicks++; await p.locator('#vg-screen button', { hasText: '신청서 금액 그대로예요' }).click(); await p.waitForTimeout(380) }
}
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
// bankOpt: 카드6 계좌 증빙 칸 순서 — 0 현금영수증 · 1 세금계산서 · 2 둘 다 받기 어려워요(기관 영수증·이수증)
async function toCard11(p, { fee = 300000, feeMode = 'bank', bankOpt = 0, region = '서울', title = '의료기관 회계기준 연수' } = {}) {
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(600)
  await p.fill('#input-title', title)
  await p.fill('#input-start', '2026-11-12'); await p.fill('#input-end', '2026-11-13'); await p.dispatchEvent('#input-start', 'change')
  await p.selectOption('#input-starthour', '13'); await p.selectOption('#input-startmin', '00')
  await p.fill('#input-region', region); await p.waitForTimeout(300)
  if (fee) { await p.click('#feeBtn-yes'); await p.fill('#input-fee', String(fee)) } else await p.click('#feeBtn-no')
  await p.waitForTimeout(200); await p.click('#ctaNext4'); await p.waitForTimeout(600)
  if (fee) {
    if (feeMode === 'bank') { await p.click('#c6-btn-bank'); await p.waitForTimeout(200); await p.locator('#c6-bank-opts .choice-btn').nth(bankOpt).click(); await p.waitForTimeout(500) }
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
  check(`[${width}] 카드11 도달`, (await toCard11(p, { bankOpt: 2 })) === 'card-11')
  await shot(p, `${width}-card11`)
  clicks = 0
  clicks++; await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(500)
  check(`[${width}] 첫 화면은 비용 목적(2026-10-01)`, (await screen(p)) === 'purpose' && (await text(p)).includes('예상 567,200원'))
  await shot(p, `${width}-purpose`)
  await tap(p, '교육·학회 참석'); await tap(p, '간호사')
  check(`[${width}] 목적·직종 다음이 정산 방법`, (await screen(p)) === 'task' && (await text(p)).includes('이렇게 정산하면 돼요'))
  check(`[${width}] 앞에서 적격증빙을 받기 어렵다고 했으면 해당 칸 하나만(등록비만 먼저 → 두 번 정산) + 이유`, (await text(p)).includes('받기 어렵다고 하셨어요') && (await p.locator('#vg-screen .choice-btn').count()) === 1 && (await p.locator('#vg-screen .choice-btn.is-on').innerText()).includes('등록비만 먼저'))
  check(`[${width}] 선택 화면은 다음 버튼 없이 고르면 넘어간다`, await p.isHidden('#vg-next'))
  await shot(p, `${width}-task`)
  { const tt = await text(p); check(`[${width}] 두 번 정산 칸: 금액 흐름·전표 두 번 + 왜 두 번인지 + 납부 방법 바꾸기 링크, 다른 선택지 없음`,
    tt.includes('지금 등록비 300,000원') && tt.split('번거롭지만 전표를 두 번 작성해야 해요').length === 2 && tt.includes('영수증(적격증빙)이 나중에 나오거나') && tt.includes('왜 두 번 정산하나요?')
    && tt.includes('등록비 납부 방법 바꾸러 가기') && !tt.includes('법인카드로 결제해요') && !tt.includes('여비(일당') && !tt.includes('출장 전에 먼저 받아야'), tt.slice(0, 200)) }
  await tap(p, '등록비만 먼저 보내고')
  check(`[${width}] 두 번 정산은 영수증 시점을 다시 묻지 않고 바로 ① 전표`, (await screen(p)) === 'voucher')
  const ln = await lines(p)
  check(`[${width}] 보통예금 줄 보조 설명은 은행코드 AC001(지석초이)`, (await text(p)).includes('은행코드 AC001을 적어 주세요') && !(await text(p)).includes('적요 · 은행코드'))
  check(`[${width}] 선지급 전표: 차 가지급금-기타 1114-99 / 대 보통예금 1102-02 · 300,000`,
    JSON.stringify(ln) === JSON.stringify([['가지급금-기타', '1114-99', 'D', 300000], ['보통예금', '1102-02', 'C', 300000]]), JSON.stringify(ln))
  check(`[${width}] 차변·대변 장부 한 줄씩 + 칸마다 합계, 합계가 맞으면 일치 문구 없음`, (await p.locator('.vt-row').count()) === 2 && (await p.locator('.vt-sum').count()) === 2 && (await p.locator('.vt-total').count()) === 0)
  { const x = await p.evaluate(() => [...document.querySelectorAll('.vt-row')].map(r => [r.querySelector('.vt-code').getBoundingClientRect(), r.querySelector('.vt-name').getBoundingClientRect(), r.querySelector('.vt-plain').getBoundingClientRect()]).map(([c, n, pl]) => [Math.round(c.left), Math.round(n.left), Math.round(pl.left), Math.round(c.bottom - n.bottom)]))
    // 넓은 화면: 코드|계정과목 한 줄(바닥선 같음) · 폰: 코드가 계정과목 위 줄, 같은 왼쪽 선. 어느 쪽이든 설명은 계정과목과 같은 시작, 코드가 이름을 덮지 않는다
    check(`[${width}] 코드·계정과목 정렬, 설명은 계정과목과 같은 시작`, x.every(([c, n, pl, dy]) => n === pl && (width > 640 ? Math.abs(dy) <= 3 : c === n)), JSON.stringify(x))
    const overlap = await p.evaluate(() => [...document.querySelectorAll('.vt-row')].some(r => { const a = r.querySelector('.vt-code').getBoundingClientRect(), b = r.querySelector('.vt-name').getBoundingClientRect(); return a.right > b.left + 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1 }))
    check(`[${width}] 코드가 계정과목 글자를 덮지 않는다`, !overlap) }
  check(`[${width}] 오른쪽 신청서: 등록비 행만 형광펜, 나머지 흐림`, await p.evaluate(() => { const f = document.querySelector('.vx-form'); return !!f.querySelector('tr.hl-main[data-kind="fee"]') && f.querySelectorAll('tr.hl-main').length === 1 && f.querySelectorAll('tr.hl-dim').length >= 3 }))
  check(`[${width}] 전표 화면에 복사 버튼 없음`, (await p.locator('#vg-screen [data-copy], #vg-screen .vg-copy').count()) === 0)
  if (width >= 1280) {
    const y = await p.evaluate(() => [...document.querySelectorAll('.vt-sum')].map(e => Math.round(e.getBoundingClientRect().top)))
    check(`[${width}] 차변·대변 합계 줄이 같은 높이`, y[0] === y[1], JSON.stringify(y))
  }
  // 2026-10-01 지석초이: 등록비는 '먼저 받는' 돈이 아니라 병원 통장에서 먼저 지급하는 돈
  check(`[${width}] 전표 화면에 큰 제목·차변대변 설명·이어서 쓰는 안내 없음(2026-10-02 지석초이)`, (await p.locator('#vg-screen h1').count()) === 0 && !(await text(p)).includes('차변·대변이 뭐예요') && !(await text(p)).includes('이어서 써요'))
  { const all = await p.evaluate(() => document.getElementById('card-12').innerText.replace(/\s+/g, ' '))
    check(`[${width}] 등록비만 먼저: 형광펜 안내는 '병원 통장에서 기관(업체)으로 먼저 지급', 화면 어디에도 '먼저 받' 없음(지석초이)`, all.includes('병원 통장에서 기관(업체)으로 먼저 지급하는 금액') && !all.includes('먼저 받'), (all.match(/.{20}먼저 받.{20}/) || [''])[0]) }
  check(`[${width}] 단계 표시만: ① 등록비 선지급 → ② 증빙 수취 후 최종 출장비 정산`, /1\s*등록비 선지급\s*→\s*2\s*증빙 수취 후 최종 출장비 정산/.test(await text(p)) && !(await text(p)).includes('왜 두 번 정산하나요?'))
  // 2026-10-01 지석초이: 크로스체크는 금액이 다를 때만 보인다
  check(`[${width}] 오른쪽에 내가 쓴 출장신청서 원본, 금액이 같으면 크로스체크 숨김`, (await p.locator('.vx-form .tf-box').count()) === 1 && (await p.locator('.vx-check').count()) === 0)
  await shot(p, `${width}-voucher-adv`)
  await next(p)
  check(`[${width}] ② 최종 정산 전표 미리 보기: 단계 표시 ②가 켜짐`, (await screen(p)) === 'voucher2' && (await p.locator('.vs-step.is-on').innerText()).includes('증빙 수취 후 최종 출장비 정산') && (await p.locator('#vg-screen h1').count()) === 0)
  const ln2p = await p.evaluate(() => vgFinalPreview().lines.map(l => [l.name, l.side, l.amount]))
  check(`[${width}] ② 미리 보기: 차 교육훈련비-간호사교육 / 대 가지급금-기타 300,000 + 현금`,
    JSON.stringify(ln2p) === JSON.stringify([['교육훈련비-간호사교육', 'D', 567200], ['가지급금-기타', 'C', 300000], ['현금', 'C', 267200]]), JSON.stringify(ln2p))
  await shot(p, `${width}-voucher2-preview`)
  await next(p)
  check(`[${width}] 서류: 출장신청서 + 통장 사본(필요할 때만)`, /출장신청서.*통장 사본/.test(await text(p)))
  // 2026-10-02 지석초이: 두 번 정산이면 마지막 화면에서 ① 가지급금 전표 | ② 최종 정산 전표 준비물을 좌우로 — 같은 서류는 같은 줄, ②에서만 내는 건 '+ 추가'
  { const st = await p.evaluate(() => {
      const g = document.querySelector('#vg-screen .vd-cmp')
      const kids = [...g.children].slice(2)
      const pairs = []; for (let i = 0; i < kids.length; i += 2) pairs.push([kids[i].innerText.replace(/\s+/g, ' ').slice(0, 12), kids[i + 1].innerText.replace(/\s+/g, ' ').slice(0, 20), kids[i + 1].classList.contains('is-added')])
      const lr = [...g.querySelectorAll('.vd-cmp-head')].map(h => h.getBoundingClientRect().left)
      return { heads: [...g.querySelectorAll('.vd-cmp-head b')].map(b => b.textContent), pairs, sideBySide: lr[1] > lr[0] } })
    check(`[${width}] 마지막 화면: ① 가지급금 전표 | ② 최종 정산 전표 좌우, 전표·신청서는 같은 줄, 등록비 증빙은 ②에 '+ 추가'`,
      JSON.stringify(st.heads) === JSON.stringify(['가지급금 전표', '최종 정산 전표']) && st.sideBySide
      && st.pairs[0][0].startsWith('전표') && st.pairs[0][1].startsWith('전표') && st.pairs[1][0].startsWith('출장신청서') && st.pairs[1][1].startsWith('출장신청서')
      && st.pairs.some(([l, r, added]) => added && l === '' && r.includes('등록비 영수증')), JSON.stringify(st)) }
  // 2026-10-01 지석초이: 병원 계좌로 냈으면 계좌이체내역서는 필요 없다(본인 이체만) · 적격증빙이 없으면 기관이 주는 별도 영수증·이수증
  { const td = await text(p)
    check(`[${width}] 병원 계좌 + 적격증빙 없음: 증빙은 '기관 영수증 또는 이수증', 계좌이체내역서 없음, 정산 방법 '등록비 먼저 지급'`,
      td.includes('등록비 영수증 (기관 영수증 또는 이수증)') && !td.includes('이체내역서') && td.includes('두 번 정산 · ① 등록비 먼저 지급'), td.slice(0, 300))
    const self = await p.evaluate(() => { const k = [vg.task, vg.evType]; vg.task = 'final'; vg.evType = 'personal'; const n = vgReceiptName(); [vg.task, vg.evType] = k; return n })
    check(`[${width}] 본인이 이체했을 때만 계좌이체내역서를 함께`, self === '기관 영수증 또는 이수증 + 계좌이체내역서', self) }
  check(`[${width}] 제출 준비 한 화면: 체크 전엔 '남은 일', 전표 요약 반복 없음`, (await screen(p)) === 'done' && (await text(p)).includes('남은 일') && (await p.locator('.vd-voucher').count()) === 0)
  await checkAll(p)
  const td = await text(p)
  check(`[${width}] 제출 준비 끝 + 1~2일 전 + 지급 완료 아님`, td.includes('① 가지급금 전표 제출 준비 끝') && td.includes('1~2일 전') && td.includes('지급·정산이 끝난 건 아니에요'), td.slice(0, 60))
  check(`[${width}] 선지급(①+② 미리 보기) 끝까지 클릭 수 ≤ 14(서류 체크 포함)`, clicks <= 14, `${clicks}번`)
  await shot(p, `${width}-done-adv`)
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('expense_guide_voucher_v1') || 'null'))
  check(`[${width}] 이 기기에 저장·최종 정산 남음`, saved && saved.pendingFinal === true && saved.advanceAmount === 300000)
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400)
  const rs = await p.evaluate(() => document.getElementById('voucher-resume').innerText.replace(/\s+/g, ' '))
  check(`[${width}] 첫 화면에 '최종 정산이 남아 있어요'(먼저 지급한 등록비)`, rs.includes('최종 정산이 남아 있어요') && rs.includes('먼저 지급한 등록비 300,000원') && rs.includes('영수증 받았어요 · 최종 정산 시작'), rs.slice(0, 80))
  await shot(p, `${width}-resume-banner`)
  clicks = 0
  clicks++; await p.click('#voucher-resume .vg-btn-primary'); await p.waitForTimeout(400)
  // 2026-10-02 지석초이: ②에 왔다면 먼저 지급한 등록비는 처리된 것 — '처리됐나요?' 대신 영수증 종류를 묻는다(카드6 답으로 미리 선택)
  check(`[${width}] 재개: '처리됐나요?' 없이 등록비 영수증 종류를 묻는다(카드6 답 미리 선택)`, (await screen(p)) === 'feeRcpt' && (await text(p)).includes('등록비 영수증은 어떤 걸 받았나요?') && !(await text(p)).includes('처리됐나요') && (await p.locator('#vg-screen .choice-btn.is-on').innerText()).includes('기관 영수증 또는 이수증'))
  await shot(p, `${width}-feeRcpt`)
  await tap(p, '기관 영수증 또는 이수증')
  check(`[${width}] 재개: 선지급 때 고른 목적·직종은 다시 묻지 않는다`, (await screen(p)) === 'evidence')
  await shot(p, `${width}-evidence`)
  await tap(p, '네, 다 받았어요')
  const ln2 = await lines(p)
  check(`[${width}] 최종 전표: 차 교육훈련비-간호사교육 567,200 / 대 가지급금-기타 300,000 + 현금 267,200`,
    JSON.stringify(ln2) === JSON.stringify([['교육훈련비-간호사교육', '5301-16-03', 'D', 567200], ['가지급금-기타', '1114-99', 'C', 300000], ['현금', '1101', 'C', 267200]]), JSON.stringify(ln2))
  check(`[${width}] ② 최종 전표: 긴 계정과목(교육훈련비-간호사교육)도 코드와 겹치지 않음`, !(await p.evaluate(() => [...document.querySelectorAll('.vt-row')].some(r => { const a = r.querySelector('.vt-code').getBoundingClientRect(), b = r.querySelector('.vt-name').getBoundingClientRect(); return a.right > b.left + 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1 }))))
  check(`[${width}] ② 신청서: 합계 형광펜 + 항목별 현금·가지급금 꼬리표`, await p.evaluate(() => { const f = document.querySelector('.vx-form'); const t = f.innerText; return !!f.querySelector('.tf-total-row.hl-main') && t.includes('가지급금 정리') && t.includes('현금 지급') }))
  await p.hover('.vt-row >> nth=2'); await p.waitForTimeout(150)
  check(`[${width}] 전표 현금 줄을 가리키면 신청서의 일당·숙박·교통비 행이 칠해진다`, await p.evaluate(() => [...document.querySelectorAll('.vx-form tr.is-focus')].map(t => t.dataset.kind).filter((v, i, a) => a.indexOf(v) === i).sort().join(',')) === 'daily,lodging,transport')
  check(`[${width}] 대변 현금 줄을 가리켜도 출장비 합계는 칠하지 않는다`, await p.evaluate(() => !document.querySelector('.vx-form .tf-total-row').classList.contains('is-focus') && document.querySelector('.vx-form').classList.contains('has-focus')))
  await p.hover('.vt-row >> nth=0'); await p.waitForTimeout(150)
  check(`[${width}] 차변(전체 비용) 줄을 가리키면 합계 줄만 칠한다(항목 행은 안 칠함)`, await p.evaluate(() => document.querySelector('.vx-form .tf-total-row').classList.contains('is-focus') && !document.querySelector('.vx-form tr[data-kind].is-focus')))
  check(`[${width}] 신청서 크로스체크: 합계가 같으면 숨김`, (await p.locator('.vx-check').count()) === 0)
  check(`[${width}] 현금 줄 보조 설명은 펌뱅킹 사번(지석초이)`, (await text(p)).includes('펌뱅킹 직원 사번을 입력해 주세요') && !(await text(p)).includes('적요 · 펌뱅킹') && !(await text(p)).includes('받는 직원 사번'))
  check(`[${width}] ② 최종 정산: 큰 제목 없이 단계 표시 ②`, (await p.locator('#vg-screen h1').count()) === 0 && (await p.locator('.vs-step.is-on').innerText()).includes('최종 출장비 정산'))
  if (width >= 1280) {
    const pos = await p.evaluate(() => [document.querySelector('.vg-aside').getBoundingClientRect().left, document.querySelector('.vt-ledger').getBoundingClientRect().right, document.documentElement.scrollWidth, innerWidth])
    check(`[${width}] 넓은 화면: 비교 패널은 전표 오른쪽, 가로 넘침 없음`, pos[0] > pos[1] || width < 1480, JSON.stringify(pos))
  }
  await shot(p, `${width}-voucher-final`)
  check(`[${width}] 금액이 그대로면 전표에 '출장정산서 만들기' 링크 없음`, (await p.locator('#vg-screen .vg-link', { hasText: '출장정산서' }).count()) === 0)
  await p.evaluate(() => vgJump('changed')); await p.waitForTimeout(250)
  autoSame = false; await tap(p, '바뀌었거나 추가된 비용이 있어요'); autoSame = true
  check(`[${width}] 전표에서 '금액이 바뀌었어요' → 출장정산서(먼저 지급한 돈 칸, 전표번호 칸 없음 — 2026-10-02 지석초이)`, (await screen(p)) === 'settle' && (await p.locator('[data-text="advanceRef"]').count()) === 0 && (await p.locator('[data-money="advanceAmount"]').count()) === 1)
  // 전표번호는 받지 않는다(회사 시스템과 연결돼 있지 않음)
  await next(p); await next(p)
  check(`[${width}] 가지급금 줄에 전표번호 적요 없음`, !(await text(p)).includes('원 전표'))
  await next(p)
  const tdocs = await text(p)
  check(`[${width}] 최종 서류: 신청서 다시 첨부 + 등록비 증빙`, tdocs.includes('다시 첨부') && tdocs.includes('등록비 영수증'))
  await checkAll(p)
  check(`[${width}] 최종 제출 준비 끝`, (await text(p)).includes('전표 제출 준비 끝'))
  check(`[${width}] 최종 정산 클릭 수 ≤ 13(서류 체크 포함)`, clicks <= 13, `${clicks}번`)
  await shot(p, `${width}-done-final`)
  await ctx.close()
}

// ── 1-b. 등록비 + 여비 함께 먼저 받기(2026-09-30 지석초이 "일당·숙박·교통비도 먼저 받는 경우") ──
{
  const [ctx, p] = await page(390)
  await toCard11(p)
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  await tap(p, '교육·학회 참석'); await tap(p, '그 외 직원')
  // 여비까지 먼저 받기는 화면에서 뺐다(2026-10-01 지석초이 "해당되는 것만") — 다시 넣을 때를 위해 계산만 지킨다
  await p.evaluate(() => vgPickCase('advance', ['fee', 'travel'])); await p.waitForTimeout(400)
  const ln = await lines(p)
  check('등록비+여비 선지급: 차 가지급금 567,200 / 대 보통예금 300,000 + 현금 267,200',
    JSON.stringify(ln.map(l => [l[0], l[2], l[3]])) === JSON.stringify([['가지급금-기타', 'D', 567200], ['보통예금', 'C', 300000], ['현금', 'C', 267200]]), JSON.stringify(ln))
  { const tt = await text(p); check('여비 포함이면 ② 시점은 "다녀와서"', /등록비·여비선지급.*다녀와서최종출장비정산/.test(tt.replace(/\s+/g, '')), tt.slice(0, 120)) }
  check('신청서 형광펜: 등록비·일당·숙박·교통 행 모두', await p.evaluate(() => ['fee', 'daily', 'lodging', 'transport'].every(k => document.querySelector(`.vx-form tr.hl-main[data-kind="${k}"]`))))
  // x-nb(줄바꿈 방지 토막)가 flex·grid의 바로 아래 자식이면 토막마다 따로 놓여 '일당 ·숙 박비'처럼 갈라진다(2026-09-30 발견)
  const split = await p.evaluate(() => [...document.querySelectorAll('#card-12 x-nb')].filter(x => /flex|grid/.test(getComputedStyle(x.parentElement).display)).map(x => x.parentElement.className + ':' + x.textContent))
  check('전표 안내 화면에 flex·grid 안에서 갈라지는 글자 없음', split.length === 0, JSON.stringify(split.slice(0, 5)))
  await shot(p, 'adv-both-voucher')
  await next(p)
  const ln2 = await p.evaluate(() => vgFinalPreview().lines.map(l => [l.name, l.side, l.amount]))
  check('② 미리 보기: 가지급금 한 줄로 567,200 정리, 더 줄 현금 없음',
    JSON.stringify(ln2) === JSON.stringify([['교육훈련비-기타', 'D', 567200], ['가지급금-기타', 'C', 567200]]), JSON.stringify(ln2))
  await ctx.close()
}

// ── 1-c. 같은 건에 이어하기 흔적(resumed·처리 상태)이 저장돼 있어도 카드11에서 다시 시작하면 정산 방법부터(2026-10-01) ──
{
  const [ctx, p] = await page(1280)
  await toCard11(p)
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  await p.evaluate(() => { Object.assign(vg, { resumed: true, task: 'final', feePay: 'advance', evAll: 'received', screen: 'voucher', pendingFinal: false }); vgSave(); goToCard(11) })
  await p.waitForTimeout(400)
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  check('흔적이 있어도 다시 시작하면 처음(목적)부터', (await screen(p)) === 'purpose' && !(await p.evaluate(() => vg.resumed)))
  await tap(p, '회의·업무 출장')
  // 여비까지 먼저 받기는 화면에서 뺐다(2026-10-01 지석초이 "해당되는 것만") — 다시 넣을 때를 위해 계산만 지킨다
  await p.evaluate(() => vgPickCase('advance', ['fee', 'travel'])); await p.waitForTimeout(400)
  check('다시 시작해도 먼저 받기는 ① 가지급금 전표', (await lines(p))[0][0] === '가지급금-기타' && (await text(p)).includes('등록비·여비 선지급'))
  await ctx.close()
}

// ── 1-d. 영수증으로 바로 정산(2026-10-01 지석초이 "적격증빙이 나오는 곳이면 출장 전이라도 바로 정산") ──
//   계좌 + 현금영수증(5만 원 초과) → 병원 계좌·바로 발급을 미리 선택. 본인 돈으로 냈으면 현금으로 돌려받는다
{
  const [ctx, p] = await page(1280)
  await toCard11(p)
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  await tap(p, '회의·업무 출장')
  check('계좌+현금영수증: "병원 계좌로 보내고 현금영수증" 한 칸만 + 출장 전이라도 바로 정산 안내', (await text(p)).includes('출장 전이라도 바로 정산') && (await p.locator('#vg-screen .choice-btn').count()) === 1 && (await p.locator('#vg-screen .choice-btn.is-on').innerText()).includes('병원 계좌로 보내고'))
  { const bankLn = await p.evaluate(() => { vg.task = 'final'; vg.evType = 'bank-now'; const r = vgResult(); vg.task = null; vg.evType = null; return [r.lines.filter(x => x.side === 'C').map(x => [x.name, x.amount]), r.docs.some(d => d.key === 'bankCopy' && d.optional), r.ready] })
    check('바로 발급 → 한 장으로: 대 보통예금 300,000 + 현금 267,200, 가지급금 없음, 통장 사본은 필요할 때만', JSON.stringify(bankLn[0]) === JSON.stringify([['보통예금', 300000], ['현금', 267200]]) && bankLn[1] && bankLn[2], JSON.stringify(bankLn)) }
  await tap(p, '병원 계좌로 보내고')
  check('바로 정산은 영수증 종류를 다시 묻지 않고 전표로', (await screen(p)) === 'voucher')
  await p.evaluate(() => { vg.evType = 'personal'; renderVoucher() }); await p.waitForTimeout(200)
  const ln = await lines(p)
  { const cardLn = await p.evaluate(() => { const keep = vg.evType; vg.evType = 'card-receipt'; const l = vgResult().lines.filter(x => x.side === 'C').map(x => [x.name, x.amount]); vg.evType = keep; return l })
    check('법인카드 매출전표면 등록비는 법인카드 줄', JSON.stringify(cardLn) === JSON.stringify([['미지급비용-법인개인카드', 300000], ['현금', 267200]]), JSON.stringify(cardLn)) }
  check('내 돈으로 낸 등록비 → 현금 한 줄 567,200(여비+등록비)', JSON.stringify(ln.filter(l => l[2] === 'C').map(l => [l[0], l[3]])) === JSON.stringify([['현금', 567200]]) && !(await text(p)).includes('확인할 것'), JSON.stringify(ln))
  await ctx.close()
}

// ── 1-e. 금액이 바뀌었거나 추가 비용(리무진 등)이 있으면 출장정산서를 만든다(2026-10-01 지석초이) ──
{
  const [ctx, p] = await page(1280)
  await toCard11(p, { feeMode: 'card' })
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  autoSame = false
  await tap(p, '회의·업무 출장'); await tap(p, '다녀와서 한 번에 정산받을게요')
  check('한 번 정산: 전표 전에 "금액이 바뀌었나요?"를 묻는다', (await screen(p)) === 'changed')
  await tap(p, '바뀌었거나 추가된 비용이 있어요')
  check('바뀌었으면 출장정산서 화면', (await screen(p)) === 'settle' && (await text(p)).includes('출 장 정 산 서'))
  await p.fill('[data-money="finalAmounts.lodging"]', '120000'); await p.dispatchEvent('[data-money="finalAmounts.lodging"]', 'change'); await p.waitForTimeout(250)
  await p.locator('#vg-screen button', { hasText: '+ 리무진(공항버스)' }).click(); await p.waitForTimeout(250)
  await p.fill('[data-money="extras.0.amount"]', '15000'); await p.dispatchEvent('[data-money="extras.0.amount"]', 'change'); await p.waitForTimeout(250)
  check('바뀐 칸·추가 칸은 노랗게(변경·추가 표시)', (await p.locator('.st-table tr.is-changed').count()) === 1 && (await p.locator('.st-table tr.is-added').count()) === 1 && (await text(p)).includes('+35,000원'))
  await shot(p, 'settle')
  await next(p)
  check('완성된 출장정산서 확인: 왼쪽 신청서·오른쪽 정산서, 바뀐 칸(숙박·리무진·합계) 형광펜', (await screen(p)) === 'settleView'
    && (await p.locator('.sv-orig .tf-title').innerText()).includes('신') && (await p.locator('.sv-new .tf-title').innerText()).includes('정 산')
    && (await p.locator('.sv-new [data-chg]').count()) === 3, String(await p.locator('.sv-new [data-chg]').count()))
  await shot(p, 'settle-view')
  await next(p)
  const ln = await lines(p)
  check('정산서 금액으로 전표: 차변 602,200, 현금에 숙박 증가분·리무진 포함', ln[0][3] === 602200 && ln.some(l => l[0] === '현금' && l[3] === 302200), JSON.stringify(ln))
  { const r = await p.evaluate(() => [document.querySelector('.vc-title')?.innerText || '', document.querySelector('.vg-aside .tf-title')?.innerText || '', document.querySelectorAll('.vg-aside .st-doc').length, document.getElementById('card-12').innerText.includes('출장여비 정산서')])
    check('오른쪽은 신청서 양식의 출장정산서(비교표 아님), 문구에 출장여비 정산서 없음', r[0].includes('출장정산서') && r[1].includes('정 산') && r[2] === 0 && !r[3], JSON.stringify(r)) }
  await shot(p, 'settle-voucher')
  await next(p)
  check('제출 서류에 출장정산서·리무진 영수증', /출장정산서/.test(await text(p)) && (await text(p)).includes('리무진(공항버스) 영수증'))
  autoSame = true
  await ctx.close()
}

// ── 1-f. 계좌 이체 + 현금영수증 + 5만 원 이하 → 본인 이체로 보고 한 번에 정산을 미리 선택(2026-10-01 지석초이) ──
{
  const [ctx, p] = await page(1280)
  await toCard11(p, { fee: 40000 })
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  await tap(p, '회의·업무 출장')
  check('5만 원 이하 현금영수증: "내 돈으로 내고 영수증" 미리 선택 + 본인 이체 안내', (await text(p)).includes('5만 원 이하는 보통') && (await p.locator('#vg-screen .choice-btn.is-on').innerText()).includes('내 돈으로'))
  await tap(p, '내 돈으로 내고 영수증을 받아요')
  const ln = await lines(p)
  check('본인이 낸 4만 원은 현금으로 돌려받는다(보통예금·가지급금 없음)', (await screen(p)) === 'voucher' && !ln.some(l => ['보통예금', '가지급금-기타'].includes(l[0])) && ln.some(l => l[0] === '현금'), JSON.stringify(ln))
  await ctx.close()
}

// ── 1-g. 세금계산서는 발급 시점에 따라 갈린다 — 미리 고르지 않고 시점으로 고르게 안내(2026-10-01 지석초이) ──
{
  const [ctx, p] = await page(390)
  await toCard11(p, { bankOpt: 1 })
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  await tap(p, '회의·업무 출장')
  check('세금계산서: 앞 답 안내 + "언제 나오나요?" 두 칸(바로 / 교육 뒤)만, 미리 고르지 않음', (await text(p)).includes('세금계산서를 받는다고 하셨어요') && (await text(p)).includes('세금계산서는 언제 나오나요?') && (await p.locator('#vg-screen .choice-btn').count()) === 2 && (await p.locator('#vg-screen .choice-btn.is-on').count()) === 0)
  // 같은 건을 지난번에 '교육 뒤'로 골라 저장해 둔 채 카드11에서 다시 시작해도 예전 칸이 골라져 있으면 안 된다(2026-10-01 지석초이 제보)
  await p.evaluate(() => { vgPickCase('advance', ['fee']); vgSave(); goToCard(11) }); await p.waitForTimeout(500)
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  await tap(p, '회의·업무 출장')
  check('다시 시작하면 지난번 정산 방법이 골라져 있지 않다', (await screen(p)) === 'task' && (await p.locator('#vg-screen .choice-btn.is-on').count()) === 0 && !(await p.evaluate(() => vg.task)))
  await tap(p, '입금하면 바로 나와요')
  check('세금계산서 바로 → 한 장 전표(보통예금, 가지급금 없음)', (await screen(p)) === 'voucher' && (await lines(p)).some(l => l[0] === '보통예금') && !(await lines(p)).some(l => l[0] === '가지급금-기타'))
  await next(p)
  { const td = await text(p)
    check('마지막 화면: 내가 고른 내용 목록 + 등록비 영수증은 고른 이름(세금계산서)만, 현금영수증 말 없음',
      (await screen(p)) === 'done' && td.includes('내가 고른 내용') && /등록비 300,000원 · 병원 계좌로 이체 · 세금계산서/.test(td) && td.includes('입금하면 바로 나와요') && td.includes('한 번에 정산')
      && td.includes('등록비 영수증 (세금계산서)') && !td.includes('현금영수증'), td.slice(0, 300))
    await shot(p, 'done-tax') }
  await p.evaluate(() => vgJump('task')); await p.waitForTimeout(300)
  await shot(p, 'task-tax')
  await ctx.close()
}

// ── 1-i. 넓은 화면(1920)에서 오른쪽 신청서는 600px — 교통비 줄이 두 줄로 넘어가지 않는다(2026-10-01 지석초이) ──
{
  const [ctx, p] = await page(1920)
  await toCard11(p, { bankOpt: 2 })
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  await tap(p, '회의·업무 출장'); await tap(p, '등록비만 먼저 보내고')
  const m = await p.evaluate(() => ({ w: Math.round(document.querySelector('.vg-aside').getBoundingClientRect().width),
    over: document.documentElement.scrollWidth > innerWidth,
    wrapped: [...document.querySelectorAll('.vx-form tr[data-kind="transport"] td')].filter(td => td.getBoundingClientRect().height > parseFloat(getComputedStyle(td).lineHeight) * 1.6 + 16).map(td => td.textContent.trim().slice(0, 30)) }))
  check('1920: 신청서 600px · 가로 넘침 없음 · 교통비 줄 한 줄', m.w === 600 && !m.over && m.wrapped.length === 0, JSON.stringify(m))
  await shot(p, 'wide-aside')
  await ctx.close()
}

// ── 1-j. 제주 실제 신청서 양식으로 출장정산서 — 항공료 총액이 '항공 김해 ↔ 제주 왕복' 한 줄로 들어간다(2026-10-02 지석초이 제보) ──
{
  const [ctx, p] = await page(1600)
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(600)
  await p.fill('#input-title', '재무부서장협의회 정기세미나')
  await p.fill('#input-start', '2026-06-10'); await p.fill('#input-end', '2026-06-12'); await p.dispatchEvent('#input-start', 'change')
  await p.fill('#input-region', '제주'); await p.waitForTimeout(300)
  await p.click('#feeBtn-yes'); await p.fill('#input-fee', '400000'); await p.waitForTimeout(200)
  await p.click('#ctaNext4'); await p.waitForTimeout(600)
  await p.click('#c6-btn-card'); await p.waitForTimeout(200); await p.click('#c6-card-note .cta-btn'); await p.waitForTimeout(600)
  await p.click('#shuttle-yes'); await p.waitForTimeout(150)
  for (let i = 0; i < 3 && (await active(p)) === 'card-8'; i++) { await answerVisible(p); await p.click('#ctaNext8'); await p.waitForTimeout(600) }
  if ((await active(p)) === 'card-9') { await p.click('#card9-next-btn'); await p.waitForTimeout(600) }
  const formTxt = await p.evaluate(() => document.querySelector('#card-10 .tf-box')?.innerText.replace(/\s+/g, ' ') || '')
  check('제주 신청서: 항공은 김해 기준(마산엔 공항 없음)', formTxt.includes('항공 김해 → 제주') && formTxt.includes('항공 제주 → 김해') && !formTxt.includes('마산 → 제주'), formTxt.slice(0, 120))
  if ((await active(p)) === 'card-10') { await p.locator('#card-10 .cta-btn').first().click(); await p.waitForTimeout(600) }
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  autoSame = false
  await tap(p, '회의·업무 출장'); await tap(p, '다녀와서 한 번에 정산받을게요')
  await tap(p, '바뀌었거나 추가된 비용이 있어요')
  await p.fill('[data-money="finalAmounts.air"]', '200000'); await p.dispatchEvent('[data-money="finalAmounts.air"]', 'change'); await p.waitForTimeout(200)
  await p.fill('[data-money="finalAmounts.shuttle"]', '9900'); await p.dispatchEvent('[data-money="finalAmounts.shuttle"]', 'change'); await p.waitForTimeout(200)
  await next(p)
  const sv = await p.evaluate(() => { const f = document.querySelector('.sv-new'); const th = [...f.querySelectorAll('th')].find(t => t.textContent.replace(/\s+/g, '') === '교통비')
    const rows = [...f.querySelectorAll('tr')].filter(tr => /항공|셔틀/.test(tr.textContent) && /정산 ₩/.test(tr.textContent)).map(tr => tr.innerText.replace(/\s+/g, ' ').trim())
    return { rows, span: th ? th.rowSpan : 0, total: f.querySelector('.tf-total-amount')?.innerText.replace(/\s+/g, ' ') } })
  check('제주 출장정산서: 항공료 200,000이 "항공 김해 ↔ 제주 왕복" 한 줄로, 셔틀 9,900, 교통비 칸 병합 2줄',
    (await screen(p)) === 'settleView' && sv.rows.length === 2 && sv.rows[0].includes('항공 김해 ↔ 제주 왕복 정산 ₩ 200,000') && sv.rows[1].includes('공항 셔틀버스 정산 ₩ 9,900') && sv.span === 2 && !JSON.stringify(sv).includes('마산'), JSON.stringify(sv))
  await shot(p, 'jeju-settle-view')
  autoSame = true
  await ctx.close()
}

// ── 1-h. 카드6 증빙 칸에 바로 정산 여부 표시 ──
{
  const [ctx, p] = await page(390)
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(400)
  const v = await p.evaluate(() => [...document.querySelectorAll('#card-6 .c6-verdict')].map(e => e.textContent))
  check('카드6: 카드·현금영수증 = 바로 정산 / 세금계산서 = 시점에 따라 / 기관 영수증·이수증 = 두 번 정산', v.length === 4 && v[0].includes('바로 정산') && v[1].includes('바로 정산') && v[2].includes('교육 뒤') && v[3].includes('두 번 정산'), JSON.stringify(v))
  await ctx.close()
}

// ── 2. 등록비 카드 결제 → 선지급·납부 방법 질문 생략, 카드 줄 ──
{
  const [ctx, p] = await page(1280)
  await toCard11(p, { feeMode: 'card' })
  await p.click('#vg-entry .cta-btn'); await p.waitForTimeout(400)
  await tap(p, '회의·업무 출장')
  check('앞에서 법인카드라고 했으면 한 번에 정산을 미리 골라 두고 이유를 알린다', (await text(p)).includes('법인카드로 결제한다고 하셨어요') && (await p.locator('#vg-screen .choice-btn.is-on').innerText()).includes('한 번에 정산'))
  check('카드로 냈으면 한 번에 정산 한 칸만', (await p.locator('#vg-screen .choice-btn').count()) === 1 && !(await text(p)).includes('여비를 먼저 받아 둘게요'))
  await tap(p, '다녀와서 한 번에 정산받을게요')
  check('카드 결제면 영수증 종류도 묻지 않고 바로 전표', (await screen(p)) === 'voucher')
  check('건너뛴 답은 전표 위에 크게 알린다(법인카드로 결제)', (await p.locator('.va-box').count()) === 1 && (await text(p)).includes('법인카드로 결제한다고 하셔서'))
  const ln = await lines(p)
  check('최종: 여비교통비-국내출장비 / 법인카드 300,000 + 현금, 보통예금 없음',
    ln[0][0] === '여비교통비-국내출장비' && ln.some(([n, , s, a]) => n === '미지급비용-법인개인카드' && s === 'C' && a === 300000) && !ln.some(([n]) => n === '보통예금'), JSON.stringify(ln))
  await next(p)
  const tone = await text(p)
  check('한 번에 정산 제출 준비: 전표/증빙 두 묶음(마지막 확인 없음), 증빙에 신청서·공문·등록비 영수증, 다시 첨부 문구 없음',
    (await screen(p)) === 'done' && /전표.*증빙.*출장신청서/.test(tone) && !tone.includes('대체전표') && !tone.includes('마지막 확인') && tone.includes('등록비 영수증') && !tone.includes('다시 첨부'), tone.slice(0, 160))
  await p.evaluate(() => vgJump('voucher'))
  await p.evaluate(() => { vg.checks = { 'doc-voucher': true }; vg.amtChanged = 'yes'; vgJump('settle') })
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
  await tap(p, '회의·업무 출장')
  check('등록비 없으면 선지급은 여비만', (await text(p)).includes('여비를 먼저 받아 둘게요') && !(await text(p)).includes('등록비만 먼저'))
  await tap(p, '다녀와서 한 번에 정산받을게요')
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

// ── 5. 제주(항공·셔틀 '사후정산') — 신청서에 금액이 비어 있으니 '바뀌었나요?'를 묻지 않고 바로 출장정산서(2026-10-02 지석초이) ──
{
  const [ctx, p] = await page(390)
  await p.evaluate(() => {
    vg = { version: 2, checks: {}, trip: { title: '재무부서장협의회 세미나', startDate: '2026-11-19', endDate: '2026-11-21', isJeju: true, hasDoc: true },
      costs: [{ kind: 'air', label: '항공료 (왕복)', amount: null }, { kind: 'shuttle', label: '공항 셔틀버스', amount: null }, { kind: 'daily', label: '일당 (3일)', amount: 105000 }, { kind: 'fee', label: '교육비 / 등록비', amount: 400000 }],
      planTotal: 505000, task: 'final', resumed: true, advKinds: ['fee'], feePay: 'advance', purpose: 'trip', screen: 'feeRcpt' }
    vgFrom = 11; goToCard(12); renderVoucher()
  })
  await p.waitForTimeout(500)
  autoSame = false
  await tap(p, '세금계산서'); await tap(p, '네, 다 받았어요')
  // 2026-10-02 지석초이: '금액이 바뀌었나요?'는 처음 만든 대로 두 칸(제주도 같다)
  check('제주: "신청서와 금액이 바뀌었나요?" 두 칸 단계', (await screen(p)) === 'changed' && (await text(p)).includes('신청서와 금액이 바뀌었나요?') && (await p.locator('#vg-screen .choice-btn').count()) === 2, await screen(p))
  await tap(p, '바뀌었거나 추가된 비용이 있어요')
  check('제주: 출장정산서 화면', (await screen(p)) === 'settle', await screen(p))
  check('제주: 영수증 금액 전엔 다음 잠김', await p.isDisabled('#vg-next'))
  await p.fill('[data-money="finalAmounts.air"]', '145000'); await p.dispatchEvent('[data-money="finalAmounts.air"]', 'change'); await p.waitForTimeout(200)
  await p.fill('[data-money="finalAmounts.shuttle"]', '15900'); await p.dispatchEvent('[data-money="finalAmounts.shuttle"]', 'change'); await p.waitForTimeout(200)
  check('제주: 금액을 다 넣으면 다음 열림', !(await p.isDisabled('#vg-next')))
  await shot(p, 'jeju-settle')
  await next(p); await next(p)
  const ln = await lines(p)
  check('제주: 가지급금 400,000 + 카드 145,000·15,900 + 현금 105,000 (p.7 구조)',
    (await screen(p)) === 'voucher' && JSON.stringify(ln.map(l => [l[0], l[3]])) === JSON.stringify([['여비교통비-국내출장비', 665900], ['가지급금-기타', 400000], ['미지급비용-법인개인카드', 145000], ['미지급비용-법인개인카드', 15900], ['현금', 105000]]), JSON.stringify(ln))
  check('제주 ②: 고른 영수증 종류(세금계산서)가 서류 이름에', await p.evaluate(() => vgReceiptName() === '세금계산서'))
  check('제주: 오른쪽은 출장정산서, 서류에 출장정산서', (await p.locator('.vc-title').innerText()).includes('출장정산서') && await p.evaluate(() => vgResult().docs.some(d => d.key === 'settlement')))
  await shot(p, 'jeju-voucher')
  // ① 마지막 화면(두 번 정산)의 ② 준비물에도 출장정산서가 미리 보인다
  await p.evaluate(() => { Object.assign(vg, { task: 'advance', resumed: false, feePay: null, screen: 'done' }); renderVoucher() }); await p.waitForTimeout(300)
  const added = await p.evaluate(() => [...document.querySelectorAll('.vd-ro-cell.is-added strong')].map(e => e.textContent))
  check('제주 ① 마지막 화면: ②에 항공·셔틀 매출전표·출장정산서가 + 추가', added.some(t => t.includes('항공권')) && added.some(t => t.includes('셔틀')) && added.includes('출장정산서'), JSON.stringify(added))
  // 같은 화면에서 바로 ②로 — 첫 화면 이어하기 버튼을 찾지 않아도 된다(2026-10-02 지석초이 "금액이 다른가요 단계가 안 나온다")
  check('① 마지막 화면: ② 최종 정산 시작은 큰 버튼', (await p.locator('#vg-screen .vd-go2-big').count()) === 1 && (await p.locator('#vg-screen .vd-go2-big').innerText()).includes('최종 정산 전표 작성하기'))
  await p.click('#vg-screen .vd-go2-big'); await p.waitForTimeout(500)
  check('큰 버튼 → ② 첫 질문은 등록비 영수증 종류(처리됐나요 없음)', (await screen(p)) === 'feeRcpt' && (await p.evaluate(() => vg.resumed && vg.task === 'final' && vg.feePay === 'advance')) && (await text(p)).includes('어떤 걸 받았나요'), await screen(p))
  autoSame = true
  await ctx.close()
}

await b.close()
console.log(`\n총 ${out.length}건 · FAIL ${out.filter(l => l.startsWith('FAIL')).length}건`)
