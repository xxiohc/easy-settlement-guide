import { webkit, chromium } from 'playwright-core'
const ENGINE = process.env.ENGINE || 'webkit'
const BASE   = process.env.BASE   || 'http://localhost:8799/index.html'
const DOC    = '/Users/jiseokchoi/ODDCHOI/workspace/09_교육, 출장 정산 가이드/app/test-docs/삼일아카데미_교육.pdf'
const launcher = ENGINE==='chrome' ? chromium : webkit
const b = await launcher.launch(ENGINE==='chrome'?{channel:'chrome'}:{})
const results = []
const log = (path,item,status,note='') => results.push({path,item,status,note})

async function run(withDoc){
  const P = withDoc ? '공문 있음' : '공문 없음'
  const ctx = await b.newContext({viewport:{width:430,height:900}})
  const p = await ctx.newPage()
  const errs=[]; p.on('pageerror',e=>errs.push(e.message))
  await p.goto(BASE,{waitUntil:'networkidle'})
  await p.click('[data-choice="done"]'); await p.waitForTimeout(400)
  if (withDoc) {
    await p.click('[data-choice="has-doc"]'); await p.waitForTimeout(600)
    const fi = await p.$('input[type=file]')
    if (!fi) { log(P,'카드3 파일입력','FAIL','input[type=file] 없음'); }
    else {
      await fi.setInputFiles(DOC)
      try { await p.waitForFunction(()=>{const b=document.getElementById('ctaNext3'); return b && !b.disabled}, {timeout:60000})
            log(P,'카드3 공문 파싱','PASS','ctaNext3 활성화') }
      catch { log(P,'카드3 공문 파싱','FAIL','60초 내 다음 버튼 활성화 안 됨') }
      await p.click('#ctaNext3'); await p.waitForTimeout(1200)
    }
  } else {
    await p.click('[data-choice="no-doc"]'); await p.waitForTimeout(800)
  }
  const step = await p.evaluate(()=>[...document.querySelectorAll('.flow-card.active')].map(c=>c.id).join(','))
  log(P,'카드4 도달', step==='card-4'?'PASS':'FAIL', step)
  if (step!=='card-4'){ await ctx.close(); return }

  // ── 날짜 ──
  for (const [id,label,val] of [['input-start','출장기간 시작','2026-10-12'],['input-end','출장기간 종료','2026-10-14']]) {
    const box = id==='input-start'?'#start-box':'#end-box'
    const pe = await p.evaluate(s=>getComputedStyle(document.querySelector(s)).pointerEvents, '#'+id)
    // 실제 사용자처럼 박스를 클릭 -> 입력이 포커스를 받는가
    await p.click(box, {force:true}).catch(()=>{})
    await p.waitForTimeout(250)
    const focused = await p.evaluate(()=>document.activeElement?.id)
    // 값 설정 -> 화면 반영
    await p.fill('#'+id, val); await p.waitForTimeout(300)
    const got = await p.inputValue('#'+id)
    const shown = await p.textContent(id==='input-start'?'#start-placeholder':'#end-placeholder')
    const ok = got===val && /월/.test(shown) && focused===id
    log(P,label, ok?'PASS':'FAIL', `pointerEvents=${pe} / 클릭후포커스=${focused||'없음'} / 값=${got} / 표시="${shown}"`)
  }
  const dur = await p.textContent('#duration-tag').catch(()=>'')
  log(P,'기간 자동계산(2박3일)', /2박\s*3일/.test(dur)?'PASS':'FAIL', `"${(dur||'').trim()}"`)

  // ── 나머지 입력 ──
  const textFields=[['input-title','출장/교육명','재무부서장 정기세미나'],['input-place','출장 장소','삼성서울병원'],['input-region','출장 지역','서울']]
  for(const [id,label,v] of textFields){
    await p.fill('#'+id, v).catch(()=>{}); await p.waitForTimeout(250)
    const got=await p.inputValue('#'+id).catch(()=>null)
    log(P,label, got===v?'PASS':'FAIL', `값=${got}`)
  }
  // 교육 시작시각은 시·분(10분 단위) 선택 두 칸이다
  await p.selectOption('#input-starthour','14').catch(()=>{}); await p.waitForTimeout(150)
  await p.selectOption('#input-startmin','00').catch(()=>{}); await p.waitForTimeout(250)
  { const got = await p.evaluate(()=>state.startTime)
    log(P,'교육 시작시각(시·분 선택)', got==='14:00'?'PASS':'FAIL', `state.startTime=${got}`) }
  { const opts = await p.$$eval('#input-startmin option', os=>os.map(o=>o.value).filter(Boolean).join(','))
    log(P,'분 선택지 10분 단위', opts==='00,10,20,30,40,50'?'PASS':'FAIL', opts) }
  // 토글 버튼들
  for(const [sel,label,active] of [['#modeBtn-offline','교육형태 오프라인',true],['#modeBtn-online','교육형태 온라인',true],['#modeBtn-offline','교육형태 오프라인 복귀',true],['#feeBtn-yes','교육비 있음',true],['#feeBtn-no','교육비 없음',true],['#feeBtn-yes','교육비 있음 복귀',true]]){
    const el = await p.$(sel)
    if(!el){ log(P,label,'FAIL','요소 없음'); continue }
    await el.click().catch(()=>{}); await p.waitForTimeout(250)
    const cls = await p.getAttribute(sel,'class')
    const on = /\bselected(-yes|-no)?\b/.test(cls||'')
    log(P,label, on?'PASS':'FAIL', `class=${cls}`)
  }
  // 교육비 금액
  const feeVis = await p.evaluate(()=>{const e=document.getElementById('input-fee'); if(!e)return 'MISSING'; const r=e.getBoundingClientRect(); return r.height>0?'VISIBLE':'HIDDEN'})
  if(feeVis==='VISIBLE'){ await p.fill('#input-fee','330000'); const g=await p.inputValue('#input-fee'); log(P,'교육비 금액', g?'PASS':'FAIL', `값=${g}`) }
  else log(P,'교육비 금액','SKIP',feeVis)

  // 역산 패널
  await p.waitForTimeout(1500)
  // 온라인 모드 힌트가 실제로 토글되는지
  await p.click('#modeBtn-online'); await p.waitForTimeout(300)
  const hOn = await p.evaluate(()=>!document.getElementById('online-mode-hint').classList.contains('hidden'))
  await p.click('#modeBtn-offline'); await p.waitForTimeout(300)
  const hOff = await p.evaluate(()=>document.getElementById('online-mode-hint').classList.contains('hidden'))
  log(P,'온라인/오프라인 전환 반영', (hOn&&hOff)?'PASS':'FAIL', `온라인힌트표시=${hOn} 오프라인복귀숨김=${hOff}`)

  // 다음으로 진행
  await p.click('#ctaNext4').catch(()=>{}); await p.waitForTimeout(900)
  const s2 = await p.evaluate(()=>[...document.querySelectorAll('.flow-card.active')].map(c=>c.id).join(','))
  log(P,'카드4 → 다음 단계', s2!=='card-4'?'PASS':'FAIL', `현재 ${s2}`)

  // ── 카드6 이후 끝까지 주행 ──────────────────────────────────────────
  const cur = () => p.evaluate(()=>[...document.querySelectorAll('.flow-card.active')].map(c=>c.id)[0]||'?')
  const tap = async (sel) => { const e = await p.$(sel); if(!e) return false
    const shown = await e.evaluate(n=>{const r=n.getBoundingClientRect(); return r.height>0 && getComputedStyle(n).visibility!=='hidden'})
    if(!shown) return false; await e.click().catch(()=>{}); await p.waitForTimeout(500); return true }

  const script = [
    ['카드6 카드로 결제했어요',    "[onclick=\"select6Method('card')\"]"],
    ['카드6 카드영수증 확인',      "[onclick=\"select6Receipt('card-receipt')\"]"],
    ['카드8 8시간이하 질문',       "[onclick=\"setYN('isShortDayTrip', false)\"]", 'field-shortdaytrip'],
    ['카드8 삼성계열 아니오',      "[onclick=\"setYN('isMS', false)\"]"],
    ['카드8 전날이동 질문',        "[onclick=\"setYN('prevDayMove', true)\"]", 'field-daytrip'],
    ['카드8 숙소제공 아니오',      "[onclick=\"setYN('lodgingProvided', false)\"]"],
  ]
  for(const [label,sel,gate] of script){
    if(gate){ // 조건부 질문 — 숨겨져 있으면 '해당없음'이 정상
      const hidden = await p.evaluate(g=>document.getElementById(g)?.classList.contains('hidden'), gate)
      if(hidden){ log(P,label,'N/A',`${gate} 숨김 — 이 일정엔 해당 없는 질문`); continue }
    }
    const before = await cur()
    const hit = await tap(sel)
    log(P,label, hit?'PASS':'FAIL', hit?`${before} → ${await cur()}`:'버튼 없음/숨김')
  }
  // 카드8에 남아 보이는 예/아니오 질문 모두 응답
  for(const btn of await p.$$('#card-8 .yn-btn')){
    const t=(await btn.innerText()).trim()
    if(await btn.evaluate(n=>n.getBoundingClientRect().height>0) && /아니요|그 이상/.test(t)){ await btn.click().catch(()=>{}); await p.waitForTimeout(300) }
  }
  // 카드8 푸터 다음
  for(let i=0;i<6 && (await cur())!=='card-9';i++){
    if(!await tap('.flow-card.active .cta-btn:not(.disabled)')) break
  }
  const c9 = await cur()
  log(P,'카드9 도달', c9==='card-9'?'PASS':'FAIL', `현재 ${c9}`)
  if(c9==='card-9'){
    // 2026-09-26: 카드9의 '정산 기준' 상자는 없앴다 — 역산이 고른 역은 계산 결과에서 직접 읽는다
    const rp = await p.evaluate(()=>{const r=computeRoutePlan(); return {text: r && r.plan && r.plan.ok ? `마산역 → ${r.plan.best.station}역` : ''}})
    log(P,'역산 결과(카드9)', /마산역 → \S+역/.test(rp.text)?'PASS':'FAIL', rp.text)
    const tot = (await p.textContent('#totalAmount')||'').trim()
    const bd  = (await p.innerText('#amountBreakdown')||'').replace(/\n/g,' | ')
    log(P,'카드9 총액 산출', /[0-9],?[0-9]*원/.test(tot)?'PASS':'FAIL', `총액 ${tot}`)
    // 역산이 고른 역과 교통비 항목의 역이 같은가 (지난번 수서/서울 불일치 회귀 방지)
    const panelSt = (rp.text.match(/마산역 → (\S+역)/)||[])[1]
    const bdSt    = (bd.match(/KTX[^()]*\((\S+역)\)/)||[])[1]
    log(P,'역산 역 = 교통비 역', (panelSt&&panelSt===bdSt)?'PASS':'FAIL', `패널=${panelSt} 교통비=${bdSt}`)
    log(P,'카드9 내역', 'INFO', bd.slice(0,260))
  }
  log(P,'JS 런타임 오류', errs.length?'FAIL':'PASS', errs.join(' | ')||'0건')
  await ctx.close()
}
await run(false)
await run(true)
await b.close()
console.log('ENGINE='+ENGINE)
for(const r of results) console.log([r.status.padEnd(4), r.path, r.item, r.note].join(' | '))
