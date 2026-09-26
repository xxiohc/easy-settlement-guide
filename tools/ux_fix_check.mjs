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
  // 데스크톱 크롬은 날짜 칸을 눌러도 달력이 안 열렸다 — 클릭이 showPicker 로 이어지는지 본다
  await p.evaluate(()=>{ window.__picker=0; HTMLInputElement.prototype.showPicker = function(){ window.__picker++ } })
  await p.click('#start-box'); await p.waitForTimeout(150)
  check('⑫ 날짜 칸 클릭 → 달력 열기 호출', (await p.evaluate(()=>window.__picker)) > 0)
  await p.keyboard.press('Escape')
  await p.fill('#input-title','전산세무회계 실무교육')
  await p.fill('#input-start','2026-10-12'); await p.fill('#input-end','2026-10-12')
  await p.selectOption('#input-starthour','09'); await p.selectOption('#input-startmin','30')
  await p.fill('#input-region','부산'); await p.waitForTimeout(300)
  { const vd = ((await p.textContent('#prevday-verdict').catch(()=>''))||'').replace(/\s+/g,' ')
    check('⑮ 시외버스 구간은 터미널 시간표로 탈 버스를 안내', /마산시외버스터미널 \d\d:\d\d 출발/.test(vd), vd.slice(0,80)) }
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

// ── R. 새 공문을 올리면 앞서 넣은 장소·시각이 남지 않는다 (2026-09-26 지석초이 제보) ──
{
  const DOCS = '/Users/jiseokchoi/ODDCHOI/workspace/09_교육, 출장 정산 가이드/테스트공문_업로드함/'
  const F = DOCS + '제31차 대한의료관련감염관리학회 학술대회와 연수교육 개최 안내件.pdf'
  const fs = await import('node:fs')
  if (fs.existsSync(F)) {
    const [ctx,p] = await newPage()
    await p.click('[data-choice="planned"]'); await p.waitForTimeout(500)
    await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(700)
    await p.fill('#input-place','강북삼성병원'); await p.dispatchEvent('#input-place','input')
    await p.selectOption('#input-starthour','12'); await p.selectOption('#input-startmin','10')
    await p.click('#card-4 .back-footer-btn'); await p.waitForTimeout(600)
    await p.click('[data-choice="has-doc"]'); await p.waitForTimeout(600)
    await p.setInputFiles('#fileInput', F)
    await p.waitForFunction(()=>!document.getElementById('ctaNext3').disabled,{timeout:120000})
    await p.click('#ctaNext3'); await p.waitForTimeout(700)
    const v = await p.evaluate(()=>[document.getElementById('input-place').value, state.startTime, document.getElementById('time-ktx-hint').textContent])
    check('R 새 공문 장소로 바뀐다(이전 입력 안 남음)', v[0].startsWith('스위스 그랜드 호텔'), v[0])
    check('R 공문에 시작시각이 없으면 비우고 직접 입력 안내', v[1]==='' && v[2].includes('찾지 못했어요'), v[1]+' / '+v[2].slice(0,30))
    await ctx.close()
  }
}

// ── B. 서울 · 숙박 · 등록비 있음(카드6 통합) ──
{
  const [ctx,p] = await newPage()
  await p.click('[data-choice="planned"]'); await p.waitForTimeout(400)
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(700)
  await p.fill('#input-title','의료기관 평가 연수')
  await p.fill('#input-start','2026-10-12'); await p.fill('#input-end','2026-10-13')
  await p.selectOption('#input-starthour','09'); await p.selectOption('#input-startmin','30')
  await p.fill('#input-region','서울'); await p.waitForTimeout(300)
  const vd = (await p.textContent('#prevday-verdict').catch(()=>'')) || ''
  check('⑩ 시작시각·지역을 넣으면 카드4에서 바로 탈 기차 안내', await vis(p,'#prevday-verdict') && vd.includes('이렇게 이동하세요') && /마산역 \d\d:\d\d 출발/.test(vd) && !vd.includes('135,000'), vd.replace(/\s+/g,' ').trim().slice(0,90))
  { const hours = await p.$$eval('#input-starthour option', os=>os.map(o=>o.value).filter(Boolean))
    check('⑬ 시작시각은 16시까지만', hours[hours.length-1]==='16' && hours[0]==='05', hours.join(','))
    await p.selectOption('#input-starthour','16'); await p.waitForTimeout(100)
    const st = await p.evaluate(()=>[state.startTime, [...document.querySelectorAll('#input-startmin option:not([disabled])')].map(o=>o.value).filter(Boolean).join(',')])
    check('⑬ 16시를 고르면 00분만', st[0]==='16:00' && st[1]==='00', st.join(' / ')) }
  { await p.selectOption('#input-starthour','13'); await p.waitForTimeout(300)
    const t = (await p.textContent('#prevday-verdict')).replace(/\s+/g,' ')
    check('⑭ 바로 앞 직통편(조금 더 일찍 가려면)도 안내', /이렇게 이동하세요\s*마산역 09:21/.test(t) && /조금 더 일찍 가려면\s*마산역\s*06:35/.test(t), (t.match(/조금 더 일찍.{0,40}/)||[''])[0]) }
  // 시각을 비우고 다음 → 필수 오류
  await p.selectOption('#input-starthour',''); await p.selectOption('#input-startmin','')
  await p.click('#feeBtn-yes'); await p.waitForTimeout(200)
  await p.fill('#input-fee','510000'); await p.click('#ctaNext4'); await p.waitForTimeout(500)
  check('⑪ 오프라인은 첫날 시작시각이 필수', await active(p) === 'card-4' && (await p.textContent('#c4-err-banner')).includes('시작시각'))
  await p.selectOption('#input-starthour','09'); await p.selectOption('#input-startmin','30')
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
  check('⑥ 역산되는 구간은 카드8에서 전날이동을 다시 묻지 않는다', !(await vis(p,'#field-daytrip')))
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
