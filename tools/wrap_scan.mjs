// 줄바꿈 전수 점검 — 한글 어절(띄어쓰기 단위) 중간에서 줄이 끊기는 자리를 찾는다.
// 사용: python3 -m http.server 8799  (app/ 에서) 후
//   ENGINE=webkit node tools/wrap_scan.mjs
//   BASE=https://smc-expense-guide.vercel.app/index.html node tools/wrap_scan.mjs
import { webkit, chromium } from 'playwright-core'
const ENGINE = process.env.ENGINE || 'webkit'
const BASE   = process.env.BASE   || 'http://localhost:8799/index.html'
const WIDTHS = (process.env.WIDTHS || '320,360,390,430,768').split(',').map(Number)
const DOC    = '/Users/jiseokchoi/ODDCHOI/workspace/09_교육, 출장 정산 가이드/app/test-docs/삼일아카데미_교육.pdf'
const launcher = ENGINE === 'chrome' ? chromium : webkit

const SCAN = `(() => {
  const path = el => {
    const parts = []
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase()
      if (e.id) { parts.unshift('#' + e.id); break }
      if (e.className && typeof e.className === 'string') s += '.' + e.className.trim().split(/\\s+/)[0]
      parts.unshift(s)
    }
    return parts.join('>')
  }
  const bad = [], over = []
  const seen = new Set()
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n
  while ((n = w.nextNode())) {
    const t = n.nodeValue
    if (!t || !t.trim() || t.trim().length < 2) continue
    const el = n.parentElement
    if (!el || !el.getClientRects().length) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.whiteSpace === 'pre') continue
    const r = document.createRange()
    let prevTop = null, prevIdx = -1
    for (let i = 0; i < t.length; i++) {
      if (/\\s/.test(t[i])) { prevIdx = i; continue }
      r.setStart(n, i); r.setEnd(n, i + 1)
      const rect = r.getBoundingClientRect()
      if (!rect.width && !rect.height) continue
      if (prevTop !== null && rect.top > prevTop + 2) {
        // 직전 글자가 공백이 아니면 어절 중간에서 끊긴 것
        if (i > 0 && !/\\s/.test(t[i - 1])) {
          bad.push({ sel: path(el), around: t.slice(Math.max(0, i - 10), i) + '⏎' + t.slice(i, i + 10), full: t.trim().slice(0, 70) })
        }
      }
      prevTop = rect.top; prevIdx = i
    }
  }
  // 줄바꿈 방지용 x-nb 가 기존 선택자에 걸려 블록이 되면 문장이 통째로 갈라진다
  document.querySelectorAll('x-nb').forEach(el => {
    const d = getComputedStyle(el).display
    if (d !== 'inline') over.push({ sel: 'x-nb(' + el.textContent + ')', scroll: d, client: 'inline' })
  })
  // 가로 넘침(keep-all 부작용) 점검
  document.querySelectorAll('body *').forEach(el => {
    if (!el.getClientRects().length) return
    // 8px 이하는 장식(현재 단계 dot의 ::after 글로우 링 inset:-4px)이라 넘침으로 보지 않는다.
    // 글자가 실제로 칸을 넘치는 경우는 그보다 크게 벌어진다.
    if (el.scrollWidth > el.clientWidth + 8 && getComputedStyle(el).overflowX === 'visible') {
      const k = path(el); if (seen.has(k)) return; seen.add(k)
      over.push({ sel: k, scroll: el.scrollWidth, client: el.clientWidth })
    }
  })
  return { bad, over, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 }
})()`

const rows = []
const b = await launcher.launch({})

// 시나리오: 정적 전체(모든 카드 강제 노출) + 실제 주행 2갈래
async function scanState(p, label, width) {
  const r = await p.evaluate(SCAN)
  for (const x of r.bad) rows.push({ w: width, label, kind: '어절중간끊김', ...x })
  for (const x of r.over) rows.push({ w: width, label, kind: '가로넘침', around: `${x.scroll}>${x.client}`, sel: x.sel, full: '' })
  if (r.docOverflow) rows.push({ w: width, label, kind: '문서가로스크롤', sel: 'html', around: '', full: '' })
}

for (const width of WIDTHS) {
  // (1) 정적: 모든 카드를 한꺼번에 보이게 해서 마크업 전문을 훑는다
  {
    const ctx = await b.newContext({ viewport: { width, height: 1400 } })
    const p = await ctx.newPage()
    await p.goto(BASE, { waitUntil: 'networkidle' })
    await p.evaluate(() => {
      document.querySelectorAll('.flow-card').forEach(c => { c.classList.add('active'); c.style.display = 'block' })
      document.querySelectorAll('[hidden]').forEach(e => e.removeAttribute('hidden'))
      document.querySelectorAll('[style*="display: none"],[style*="display:none"]').forEach(e => { e.style.display = '' })
    })
    await p.waitForTimeout(300)
    await scanState(p, '정적 전체카드', width)
    await ctx.close()
  }
  // (2) 주행: 공문 없음 → 카드4 입력 → 결과까지
  for (const withDoc of [false, true]) {
    const ctx = await b.newContext({ viewport: { width, height: 900 } })
    const p = await ctx.newPage()
    await p.goto(BASE, { waitUntil: 'networkidle' })
    const L = withDoc ? '주행(공문있음)' : '주행(공문없음)'
    try {
      await p.click('[data-choice="done"]'); await p.waitForTimeout(300)
      await scanState(p, L + ' 카드2', width)
      if (withDoc) {
        await p.click('[data-choice="has-doc"]'); await p.waitForTimeout(500)
        const fi = await p.$('input[type=file]')
        await fi.setInputFiles(DOC)
        await p.waitForFunction(() => { const b = document.getElementById('ctaNext3'); return b && !b.disabled }, { timeout: 90000 })
        await scanState(p, L + ' 카드3', width)
        await p.click('#ctaNext3')
      } else {
        await p.click('[data-choice="no-doc"]')
      }
      await p.waitForTimeout(900)
      await scanState(p, L + ' 카드4', width)
      // 카드4 채우기 (ui_sweep과 같은 순서 — 실제 입력 이벤트)
      for (const [id, v] of [['input-start','2026-10-12'],['input-end','2026-10-14'],
        ['input-title','2026년 병원 원가관리 실무 교육과정'],['input-place','삼성서울병원 암병원 지하 1층 강당'],
        ['input-region','서울'],['input-starttime','14:00'],['input-endtime','17:00']]) {
        await p.fill('#' + id, v).catch(() => {}); await p.waitForTimeout(150)
      }
      await p.click('#modeBtn-offline').catch(() => {}); await p.waitForTimeout(200)
      await p.click('#feeBtn-yes').catch(() => {}); await p.waitForTimeout(200)
      await p.fill('#input-fee', '330000').catch(() => {})
      await p.waitForTimeout(1800)
      await scanState(p, L + ' 카드4 입력후', width)
      await p.click('#ctaNext4').catch(() => {}); await p.waitForTimeout(1000)
      // 이후 카드들 — 각 질문 그룹의 첫 답을 고르고 CTA를 눌러 끝까지
      for (let i = 0; i < 24; i++) {
        const cur = await p.evaluate(() => (document.querySelector('.flow-card.active') || {}).id || '')
        // 보이는 질문 그룹마다 첫 선택지 클릭
        const answered = await p.evaluate(() => {
          const card = document.querySelector('.flow-card.active'); if (!card) return 0
          const vis = n => n.getBoundingClientRect().height > 0 && getComputedStyle(n).visibility !== 'hidden'
          const groups = new Map()
          card.querySelectorAll('.yn-btn, .choice-btn, .method-btn').forEach(b => {
            if (!vis(b)) return
            const g = b.parentElement
            if (g.querySelector('.selected, .selected-yes, .selected-no, .active')) return
            if (!groups.has(g)) groups.set(g, b)
          })
          let n = 0
          groups.forEach(b => { b.click(); n++ })
          return n
        })
        if (answered) await p.waitForTimeout(700)
        await scanState(p, `${L} ${cur}`, width)
        const moved = await p.evaluate(() => {
          const card = document.querySelector('.flow-card.active'); if (!card) return false
          const vis = n => n.getBoundingClientRect().height > 0 && getComputedStyle(n).visibility !== 'hidden'
          const cta = [...card.querySelectorAll('.cta-btn')].filter(b => vis(b) && !b.disabled && !b.classList.contains('disabled') && !/다시|처음|뒤로/.test(b.textContent))
          if (!cta.length) return false
          cta[cta.length - 1].click(); return true
        })
        await p.waitForTimeout(900)
        const now = await p.evaluate(() => (document.querySelector('.flow-card.active') || {}).id || '')
        if (process.env.TRACE) console.error('  trace', width, L, cur, '->', now, 'ans=' + answered, 'cta=' + moved)
        await scanState(p, `${L} ${now}`, width)
        if (!answered && !moved) break
        if (now === 'card-11') { await scanState(p, `${L} card-11`, width); break }
      }
    } catch (e) {
      rows.push({ w: width, label: L, kind: '주행실패', sel: '', around: String(e.message).slice(0, 80), full: '' })
    }
    await ctx.close()
  }
}
await b.close()

// 중복 제거 후 출력
const uniq = new Map()
for (const r of rows) {
  const k = `${r.kind}|${r.sel}|${r.around}`
  if (!uniq.has(k)) uniq.set(k, { ...r, widths: new Set([r.w]), labels: new Set([r.label]) })
  else { uniq.get(k).widths.add(r.w); uniq.get(k).labels.add(r.label) }
}
const list = [...uniq.values()]
for (const r of list) {
  console.log(`FAIL [${r.kind}] ${[...r.widths].join('/')}px  ${r.sel}\n      …${r.around}…  (${[...r.labels][0]})`)
}
console.log(`\n${ENGINE} ${WIDTHS.join('/')}px — 총 ${rows.length}건, 고유 ${list.length}건`)
process.exit(list.length ? 1 : 0)
