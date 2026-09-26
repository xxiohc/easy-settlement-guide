import { chromium } from 'playwright-core'
const BASE = process.env.BASE || 'http://localhost:8799/index.html'
const DOC  = '/Users/jiseokchoi/ODDCHOI/workspace/09_교육, 출장 정산 가이드/app/test-docs/삼일아카데미_교육.pdf'
const b = await chromium.launch()
const out = []
const check = (name, ok, note='') => { out.push(`${ok?'PASS':'FAIL'}  ${name}${note?' — '+note:''}`); console.log(out.at(-1)) }

async function newPage(){
  const ctx = await b.newContext({viewport:{width:420,height:900}})
  const p = await ctx.newPage()
  p.on('pageerror', e => check('페이지 예외 없음', false, e.message))
  await p.goto(BASE, {waitUntil:'networkidle'})
  return [ctx, p]
}
const active = p => p.evaluate(()=>[...document.querySelectorAll('.flow-card.active')].map(c=>c.id).join(','))
const vis = (p,sel) => p.evaluate(s=>{const e=document.querySelector(s); return !!e && !e.classList.contains('hidden')}, sel)

// ── A. 공문 없음 · 오프라인 · 등록비 없음 → 카드4에서 카드8로 ──
{
  const [ctx,p] = await newPage()
  await p.click('[data-choice="done"]'); await p.waitForTimeout(400)
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(700)
  check('A 카드4 도달', await active(p) === 'card-4')
  await p.fill('#input-title','전산세무회계 실무교육')
  await p.fill('#input-start','2026-10-12'); await p.fill('#input-end','2026-10-12')
  await p.fill('#input-starttime','09:30')
  await p.fill('#input-region','부산'); await p.waitForTimeout(300)
  // ① 온라인 → 없어요 버튼이 남아 있는가
  await p.click('#modeBtn-online'); await p.waitForTimeout(200)
  check('① 온라인에서도 "없어요" 노출', await vis(p,'#feeBtn-no'))
  check('② 온라인이면 KTX 역산 힌트 숨김', !(await vis(p,'#time-ktx-hint')))
  await p.click('#feeBtn-no'); await p.waitForTimeout(150)
  await p.click('#modeBtn-offline'); await p.waitForTimeout(200)
  const hasFee = await p.evaluate(()=>state.hasFee)
  check('① 오프라인 복귀 후에도 "없어요" 유지', hasFee === false, `hasFee=${hasFee}`)
  // P3 장소 검색 드롭다운이 아래 내용을 덮지 않는가 (폰에서 탭이 먹히던 문제)
  await p.click('#modeBtn-offline'); await p.waitForTimeout(150)
  await p.fill('#input-place','부산 벡스코'); await p.waitForTimeout(500)
  const covered = await p.evaluate(() => {
    const sg = document.getElementById('placeSuggest')
    if (!sg || sg.classList.contains('hidden')) return 'dropdown-닫힘'
    const targets = ['#input-region', '#field-fee']
    return targets.filter(sel => {
      const r = document.querySelector(sel).getBoundingClientRect()
      const sr = sg.getBoundingClientRect()
      return !(sr.bottom <= r.top || sr.top >= r.bottom)
    }).join(',') || '겹침없음'
  })
  check('P3 드롭다운이 아래 칸을 덮지 않음', covered === '겹침없음', covered)
  await p.fill('#input-place','')
  await p.click('#ctaNext4'); await p.waitForTimeout(600)
  check('A 등록비 없음 → 카드8', await active(p) === 'card-8')
  check('⑦ 8시간 질문에 시작시각 표시', (await p.textContent('#shortday-auto') || '').includes('09:30'),
        (await p.textContent('#shortday-auto')||'').trim().slice(0,60))
  await p.click('#field-shortdaytrip .yn-btn:nth-child(2)'); await p.waitForTimeout(200)
  await p.click('#field-rank .yn-btn:nth-child(2)'); await p.waitForTimeout(200)
  // 부산은 시외버스 구간이라 역산이 안 된다 — 전날 이동을 직접 묻는 갈래(④)
  check('④ 역산 불가 구간은 전날이동을 08:30 기준으로 직접 묻는다',
        await vis(p,'#field-daytrip') && (await p.evaluate(()=>state.prevDayMove)) === null)
  await p.click('#field-daytrip .yn-btn:nth-child(2)'); await p.waitForTimeout(200)
  await p.click('#ctaNext8'); await p.waitForTimeout(800)
  check('A 카드9 도달', await active(p) === 'card-9')
  check('⑨ 다녀온 출장 버튼 문구', (await p.textContent('#card9-next-btn')).includes('내용 확인'),
        await p.textContent('#card9-next-btn'))
  await p.click('#card9-next-btn'); await p.waitForTimeout(700)
  check('⑨ 카드10 제목 과거형', (await p.textContent('#card10-title')).includes('결재된'), await p.textContent('#card10-title'))
  await p.click('#card-10 .cta-btn'); await p.waitForTimeout(600)
  const docs = await p.evaluate(()=>[...document.querySelectorAll('#finalChecklist strong')].map(e=>e.textContent.trim()))
  check('④ 공문 없으면 구비서류에 공문 없음', !docs.some(d=>d.includes('공문')), docs.join(' / '))
  const voucher = await p.textContent('#voucherItems')
  check('④ 하단 안내문에도 공문 없음', !voucher.includes('공문'), voucher.trim().slice(0,70))
  await ctx.close()
}

// ── B. 서울 · 숙박 · 등록비 있음(카드6 통합) ──
{
  const [ctx,p] = await newPage()
  await p.click('[data-choice="planned"]'); await p.waitForTimeout(400)
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(700)
  await p.fill('#input-title','의료기관 평가 연수')
  await p.fill('#input-start','2026-10-12'); await p.fill('#input-end','2026-10-13')
  await p.fill('#input-starttime','09:30')
  await p.fill('#input-region','서울'); await p.waitForTimeout(300)
  await p.click('#feeBtn-yes'); await p.waitForTimeout(200)
  await p.fill('#input-fee','510000'); await p.waitForTimeout(200)
  await p.click('#ctaNext4'); await p.waitForTimeout(700)
  check('B 카드6 도달', await active(p) === 'card-6')
  check('⑧ 카드6이 3지선다 한 화면', (await p.evaluate(()=>document.querySelectorAll('#card-6 > .card-body > .choice-list > .choice-btn').length)) === 3)
  const step = await p.textContent('#trail-6 ~ *, .trail-current-info').catch(()=>'')
  await p.click('#c6-btn-bank'); await p.waitForTimeout(300)
  check('⑧ 계좌이체 선택 시 증빙 3종 인라인 노출', await vis(p,'#c6-bank-opts'))
  await p.click('#c6-bank-opts .choice-btn:nth-child(2)'); await p.waitForTimeout(600)
  check('⑧ 카드6 → 카드8 직행(카드7 없음)', await active(p) === 'card-8')
  const rt = await p.evaluate(()=>state.receiptType)
  check('⑧ 세금계산서 선택이 state에 반영', rt === 'tax-invoice', `receiptType=${rt}`)
  check('⑥ 전날이동 질문 자동판정 안내 노출', await vis(p,'#daytrip-auto'), (await p.textContent('#daytrip-auto')||'').trim().slice(0,70))
  const pdm = await p.evaluate(()=>state.prevDayMove)
  check('⑥ 서울 09:30 시작 → 전날 이동 자동 인정', pdm === true, `prevDayMove=${pdm}`)
  // 뒤로가기: 카드8 → 카드6
  await p.click('#card-8 .back-footer-btn'); await p.waitForTimeout(600)
  check('⑧ 카드8 뒤로 → 카드6', await active(p) === 'card-6')
  await ctx.close()
}

// ── C. 공문 업로드 경로 (파싱 + 등록비 미리선택) ──
{
  const [ctx,p] = await newPage()
  await p.click('[data-choice="planned"]'); await p.waitForTimeout(400)
  await p.click('[data-choice="has-doc"]'); await p.waitForTimeout(600)
  await (await p.$('input[type=file]')).setInputFiles(DOC)
  try {
    await p.waitForFunction(()=>{const b=document.getElementById('ctaNext3'); return b && !b.disabled}, {timeout:90000})
    check('C 공문 파싱 완료', true)
  } catch { check('C 공문 파싱 완료', false, '90초 초과') }
  const labels = await p.evaluate(()=>[...document.querySelectorAll('#resultGrid label')].map(e=>e.textContent))
  check('P3 결과에 "지역"·"장소" 분리 표기', labels.includes('지역') && labels.includes('장소'), labels.join('/'))
  await p.click('#ctaNext3'); await p.waitForTimeout(900)
  check('C 카드4 도달', await active(p) === 'card-4')
  const hf = await p.evaluate(()=>state.hasFee)
  check('⑤ 금액 인식 시 "있어요" 미리선택', hf === true, `hasFee=${hf}`)
  const title = await p.inputValue('#input-title')
  check('③ 제목에 낱글자 공백 없음', !/(^| )[가-힣]( )[가-힣]( )/.test(title), title.slice(0,50))
  await ctx.close()
}

await b.close()
console.log('\n── 요약 ──')
console.log(`총 ${out.length}건 · FAIL ${out.filter(l=>l.startsWith('FAIL')).length}건`)
