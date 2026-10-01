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
  // 2026-09-30: 첫 화면은 공문 여부, '다녀왔어요' 선택지는 없다
  check('0 첫 화면이 공문 여부(카드2)', await active(p) === 'card-2')
  check('0 다녀왔어요 선택지 없음', (await p.$('[data-choice="done"]')) === null)
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
  // 부산은 시외버스 구간 — 집에서 오가는 거리라 전날 이동을 묻지도 인정하지도 않는다(2026-09-26 지석초이)
  check('④ 시외버스 구간은 전날 이동을 묻지 않고 해당 없음',
        !(await vis(p,'#field-daytrip')) && (await p.evaluate(()=>state.prevDayMove)) === false)
  await p.click('#ctaNext8'); await p.waitForTimeout(800)
  check('A 카드9 도달', await active(p) === 'card-9')
  // 2026-09-30: 갈 예정 출장만 다룬다 — 신청서를 '작성'하는 문구여야 한다(다녀온 출장 문구는 v1)
  check('⑨ 갈 예정 출장 버튼 문구', (await p.textContent('#card9-next-btn')).includes('작성하기'),
        await p.textContent('#card9-next-btn'))
  await p.click('#card9-next-btn'); await p.waitForTimeout(700)
  check('⑨ 카드10 제목 미리 작성', (await p.textContent('#card10-title')).includes('미리 작성'), await p.textContent('#card10-title'))
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
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(700)
  await p.fill('#input-title','의료기관 평가 연수')
  await p.fill('#input-start','2026-10-12'); await p.fill('#input-end','2026-10-13')
  await p.selectOption('#input-starthour','09'); await p.selectOption('#input-startmin','30')
  await p.fill('#input-region','서울'); await p.waitForTimeout(300)
  const vd = (await p.textContent('#prevday-verdict').catch(()=>'')) || ''
  check('⑩ 시작시각·지역을 넣으면 카드4에서 바로 탈 기차 안내', await vis(p,'#prevday-verdict') && vd.includes('이렇게 이동하세요') && /마산역 \d\d:\d\d 출발/.test(vd) && !vd.includes('135,000'), vd.replace(/\s+/g,' ').trim().slice(0,90))
  { const hours = await p.$$eval('#input-starthour option', os=>os.map(o=>o.value).filter(Boolean))
    check('⑬ 시작시각은 18시까지만', hours[hours.length-1]==='18' && hours[0]==='05', hours.join(','))
    await p.selectOption('#input-starthour','18'); await p.waitForTimeout(100)
    const st = await p.evaluate(()=>[state.startTime, [...document.querySelectorAll('#input-startmin option:not([disabled])')].map(o=>o.value).filter(Boolean).join(',')])
    check('⑬ 18시를 고르면 30분까지만', st[0].startsWith('18:') && st[1]==='00,10,20,30', st.join(' / ')) }
  { await p.selectOption('#input-starthour','13'); await p.waitForTimeout(300)
    const t = (await p.textContent('#prevday-verdict')).replace(/\s+/g,' ')
    check('⑭ 바로 앞 직통편(조금 더 일찍 가려면)도 안내', /이렇게 이동하세요\s*마산역 09:21/.test(t) && /조금 더 일찍 가려면[\s\S]{0,60}마산\s*06:35/.test(t), (t.match(/조금 더 일찍.{0,40}/)||[''])[0]) }
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
  // 2026-10-01 지석초이: '아직 정하지 못했어요'를 없애 2지선다(법인카드 / 계좌)
  check('⑧ 카드6이 2지선다 한 화면(아직 정하지 못했어요 없음)', (await p.evaluate(()=>document.querySelectorAll('#card-6 > .card-body > .choice-list > .choice-btn').length)) === 2 && !(await p.textContent('#card-6')).includes('아직 정하지'))
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

// ── D. 창원 시내버스 + 8시간 이하 당일 출장 합계 (2026-09-29) ──
// 창원은 기차·시외버스 대신 시내버스 요금(교통카드 편도 × 2)으로 정산하고, 8시간 이하 당일 출장이어도
// 교통비는 신청서 합계에 들어가야 한다(예전엔 신청서 합계만 ₩0이라 예상 금액과 달랐다).
{
  const [ctx,p] = await newPage()
  await p.click('[data-choice="no-doc"]').catch(()=>{}); await p.waitForTimeout(300)
  await p.evaluate(() => {
    Object.assign(state, { title: '창원 교류회', startDate: '2026-10-13', endDate: '2026-10-13', nights: 0, days: 1,
      place: '창원컨벤션센터', region: '창원', startTime: '09:30', fee: 0, hasFee: false, feeStatus: 'no-fee',
      isMS: false, isShortDayTrip: true, isOnline: false, isJeju: false, dept: '경영지원팀', name: '홍길동' })
    // 앱은 장소·지역을 카드4 입력칸에서 다시 읽는다 — 상태만 넣으면 빈 입력칸 값으로 덮인다(점검 스크립트 첫 실패 원인)
    document.getElementById('input-place').value = '창원컨벤션센터'
    document.getElementById('input-region').value = '창원'
    goToCard(9)
  })
  await p.waitForTimeout(700)
  const c9 = await p.evaluate(() => document.getElementById('card-9').innerText.replace(/\s+/g, ' '))
  const city = await p.evaluate(() => getFare('창원')?.cityBus)
  check('D 창원 → 시내버스 요금(편도×2)', !!city && c9.includes('시내버스 (창원)') && c9.includes((city * 2).toLocaleString() + '원'), `편도 ${city}`)
  await p.evaluate(() => goToCard(10)); await p.waitForTimeout(700)
  const form = await p.evaluate(() => document.getElementById('tripFormWrap').innerText.replace(/\s+/g, ' '))
  const tot = (form.match(/출장비 합계\s*₩\s*([\d,]+)/) || [])[1]
  check('D 8시간 이하 당일이어도 신청서 합계에 교통비 포함', tot === (city * 2).toLocaleString(), `합계 ${tot}`)
  await ctx.close()
}

// ── F. 창원 시내 이동 여정표(2026-09-29) — 병원→교육장 시내버스·택시 추정 소요와 카카오맵 경로 ──
{
  const [ctx,p] = await newPage()
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(500)
  await p.fill('#input-region', '창원'); await p.evaluate(() => onRegionInput())
  await p.fill('#input-place', '마산대학교 청강기념관')
  await p.evaluate(() => { state.place = '마산대학교 청강기념관'; state.placeLat = 35.2603473; state.placeLon = 128.5059206 })
  await p.selectOption('#input-starthour', '14'); await p.waitForTimeout(300)
  await p.evaluate(() => renderPrevDayVerdict()); await p.waitForTimeout(200)
  const v = (await p.textContent('#prevday-verdict')).replace(/\s+/g, ' ')
  check('F 창원 시내: 병원 출발 시각·시내버스 추정', /병원 \d\d:\d\d 출발 · 시내버스/.test(v) && /시내버스 약 \d+분 추정/.test(v), v.slice(0, 90))
  check('F 창원 시내: 택시 대안·카카오맵 경로 링크', v.includes('택시로 가면') && await p.locator('#prevday-verdict a[href*="map.kakao.com/link/by/traffic"]').count() === 1)
  await ctx.close()
}

// ── E. 다시 입력하지 않게(2026-09-29 사용자 관점 점검) ──
{
  const [ctx,p] = await newPage()
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(500)
  await p.type('#input-place', '부산 벡스코'); await p.waitForTimeout(200)
  check('E 장소 글자로 지역 채움', await p.inputValue('#input-region') === '부산', await p.inputValue('#input-region'))
  await p.fill('#input-region', ''); await p.type('#input-region', '대전')
  await p.fill('#input-place', ''); await p.type('#input-place', '서울역 회의실'); await p.waitForTimeout(200)
  check('E 직접 친 지역은 덮지 않음', await p.inputValue('#input-region') === '대전', await p.inputValue('#input-region'))
  await p.evaluate(() => { saveProfile({ dept: '경영지원팀', name: '홍길동', isMS: false }); state.isMS = null; prefillProfileCard10() })
  check('E 지난번 소속·성명 미리 채움', await p.inputValue('#input-dept') === '경영지원팀' && await p.inputValue('#input-name') === '홍길동')
  await ctx.close()
}

// ── F. 2026-09-30 지석초이: "기간 / N박 M일 출장이시군요!"는 두 줄, 어중간한 곳에서 꺾이지 않는다 ──
{
  const fs = await import('node:fs')
  const DOCS = '/Users/jiseokchoi/ODDCHOI/workspace/09_교육, 출장 정산 가이드/테스트공문_업로드함/'
  const F = DOCS + '제31차 대한의료관련감염관리학회 학술대회와 연수교육 개최 안내件.pdf'
  if (fs.existsSync(F)) {
    for (const w of [360, 420]) {
      const [ctx,p] = await newPage()
      await p.setViewportSize({ width: w, height: 900 })
      await p.click('[data-choice="has-doc"]'); await p.waitForTimeout(600)
      await p.setInputFiles('#fileInput', F)
      await p.waitForFunction(()=>!document.getElementById('ctaNext3').disabled,{timeout:120000})
      await p.click('#ctaNext3'); await p.waitForTimeout(700)
      const r = await p.evaluate(() => {
        const lines = [...document.querySelectorAll('#c4-period-msg .period-line')]
        const lh = parseFloat(getComputedStyle(document.getElementById('c4-period-msg')).lineHeight) || 0
        return { n: lines.length, last: lines.at(-1)?.textContent || '', lastH: lines.at(-1)?.getBoundingClientRect().height || 0, lh }
      })
      check(`F ${w}px 기간 인사 두 줄(기간 / N박 M일 출장)`, r.n === 2 && /^\d+(박 \d+일|일 \(당일치기\)) 출장이시군요!$/.test(r.last), `${r.n}줄 · ${r.last}`)
      check(`F ${w}px "N박 M일 출장이시군요!" 한 줄 유지`, r.lastH > 0 && r.lastH < r.lh * 1.5, `높이 ${Math.round(r.lastH)} / 줄높이 ${Math.round(r.lh)}`)
      await ctx.close()
    }
  }
}

// ── G. 2026-09-30 지석초이: 대안 여정은 '마산에서 더 늦게 타고 동대구·대전에서 갈아타는 편'만. 같은 시각 출발 환승(광명 등)은 싣지 않는다.
//       대안 카드마다 그 도착역→현장 대중교통·택시 링크 ──
{
  const altCards = p => p.evaluate(() => [...document.querySelectorAll('#route-aside .rc-group')].filter(g => /대안 여정/.test(g.textContent))
    .flatMap(g => [...g.querySelectorAll('.rc')].map(c => ({ head: c.querySelector('.rc-head')?.textContent.replace(/\s+/g, ' '),
      st: [...c.querySelectorAll('.rs-node:not(.is-goal) b')].at(-1)?.textContent, links: [...c.querySelectorAll('.ra-link')].map(a => a.href) }))))
  const setup = async (p, place, region, hh, lat, lon) => {
    await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(600)
    await p.fill('#input-place', place); await p.dispatchEvent('#input-place', 'input')
    await p.fill('#input-region', region); await p.dispatchEvent('#input-region', 'input')
    await p.fill('#input-start', '2026-10-22'); await p.fill('#input-end', '2026-10-22'); await p.dispatchEvent('#input-start','change')
    await p.selectOption('#input-starthour', hh); await p.selectOption('#input-startmin', hh === '09' ? '30' : '00'); await p.waitForTimeout(800)
    await p.evaluate(([la, lo]) => { state.placeLat = la; state.placeLon = lo; state.placeNeedsPick = false; renderPrevDayVerdict() }, [lat, lon]); await p.waitForTimeout(800)
  }
  { const [ctx,p] = await newPage()
    await setup(p, '여의도 태영빌딩', '서울', '09', 37.5256, 126.9255)
    const r = await altCards(p)
    check('G 같은 시각 출발 환승(광명 등)만 있으면 대안 여정을 싣지 않는다', r.length === 0, JSON.stringify(r.map(c => c.head)))
    await ctx.close() }
  { const [ctx,p] = await newPage()
    await setup(p, '삼성전자 서천연수원', '수원', '14', 37.2215, 127.0735)
    const best = await p.evaluate(() => computeRoutePlan().plan.best.dep)
    const r = await altCards(p)
    const deps = r.map(c => (c.head.match(/마산 (\d\d):(\d\d) 출발/) || []).slice(1).map(Number)).map(([h, m]) => h * 60 + m)
    check('G 더 늦게 떠나는 동대구·대전 환승 대안을 싣는다', r.length > 0 && deps.every(d => d > best) && r.every(c => /동대구|대전/.test(c.head)), JSON.stringify(r.map(c => c.head)))
    check('G 카드마다 그 도착역에서 출발하는 대중교통·택시 링크', r.length > 0 && r.every(c => c.links.length === 2 && c.links.every(h => decodeURIComponent(h).includes(c.st + '역,'))), JSON.stringify(r.map(c => c.st + ':' + c.links.length)))
    await ctx.close() }
}

// ── H. 2026-09-30 지석초이: 공문에 연도가 없으면 추정 연도를 화면에 쓰지 않는다('(연도는 추정)' 문구도 없음) ──
{
  const F = '/Users/jiseokchoi/ODDCHOI/workspace/09_교육, 출장 정산 가이드/테스트공문_업로드함/삼일아카데미_비영리법인의 회계와 세무해설.pdf'
  const fs = await import('node:fs')
  if (fs.existsSync(F)) {
    const [ctx,p] = await newPage()
    await p.click('[data-choice="has-doc"]'); await p.waitForTimeout(500)
    await p.setInputFiles('#fileInput', F)
    await p.waitForFunction(()=>!document.getElementById('ctaNext3').disabled,{timeout:120000})
    const card3 = await p.evaluate(() => [state.parsedMeta.yearGuessed, document.getElementById('parseResult').innerText])
    await p.click('#ctaNext3'); await p.waitForTimeout(700)
    const head = await p.evaluate(() => document.getElementById('c4-period-msg').innerText)
    check('H 연도 없는 공문(삼일아카데미)은 연도 추정으로 읽힌다', card3[0] === true, String(card3[0]))
    check('H 카드3·카드4에 추정 연도·"추정" 문구가 없다', !/연도는 추정|요일이 맞는|\d{4}년/.test(card3[1] + head), head.replace(/\s+/g, ' '))
    await ctx.close()
  }
}

// ── I. 2026-10-01 지석초이: 윈도우 '애니메이션 효과 끔'(reduced-motion)에서도 현재 단계 빛이 은은하게 난다 ──
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  const p = await ctx.newPage()
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(500)
  const a = await p.evaluate(() => getComputedStyle(document.querySelector('.flow-card.active .trail-item.current .trail-dot')).animationName)
  check('I 움직임 줄이기 설정에서도 현재 단계 빛 효과 유지', a === 'trailGlow', a)
  await ctx.close()
}

// ── J. 2026-10-01 지석초이: 제주는 전날 이동(전날 일당·숙박)을 인정하지 않는다 — 묻지 않고, 카드9에 안내 한 줄 ──
{
  const [ctx, p] = await newPage()
  await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(700)
  await p.fill('#input-title', '재무부서장협의회 세미나')
  await p.fill('#input-start', '2026-11-19'); await p.fill('#input-end', '2026-11-21'); await p.dispatchEvent('#input-start', 'change')
  await p.fill('#input-region', '제주'); await p.waitForTimeout(300)
  await p.click('#feeBtn-no'); await p.waitForTimeout(200)
  await p.click('#ctaNext4'); await p.waitForTimeout(700)
  check('J 제주 → 카드8', await active(p) === 'card-8', await active(p))
  check('J 제주는 전날 이동을 묻지 않고 "아니요"로 고정', !(await vis(p, '#field-daytrip')) && (await p.evaluate(() => state.prevDayMove)) === false)
  for (let i = 0; i < 3 && (await active(p)) === 'card-8'; i++) {
    await p.evaluate(() => document.querySelectorAll('#card-8 [id^="field-"]').forEach(f => {
      if (f.classList.contains('hidden') || !f.getBoundingClientRect().height) return
      const bs = [...f.querySelectorAll('.yn-btn')]; if (bs.length && !bs.some(x => x.classList.contains('selected'))) bs[bs.length - 1].click() }))
    await p.click('#ctaNext8'); await p.waitForTimeout(700)
  }
  const h = await p.evaluate(() => { const e = document.getElementById('prevDayHint'); return [!e.classList.contains('hidden'), e.innerText] })
  check('J 카드9: 제주는 전날 이동 불인정 안내(밤색 전날 이동 상자 아님)', (await active(p)) === 'card-9' && h[0] && h[1].includes('전날 이동(전날 일당·숙박)을 인정하지 않아요') && !h[1].includes('135,000'), JSON.stringify(h))
  await ctx.close()
}

await b.close()
console.log('\n── 요약 ──')
console.log(`총 ${out.length}건 · FAIL ${out.filter(l=>l.startsWith('FAIL')).length}건`)
