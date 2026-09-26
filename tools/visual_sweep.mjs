// 화면 깨짐 전수 점검 — 기기별 뷰포트마다 처음부터 끝까지 "실제 클릭"으로 주행하며
// 가로 오버플로 · 글자 잘림 · 카드 밀림(사파리 reveal 스크롤)을 잡고 화면을 캡처한다.
import { webkit, chromium } from 'playwright-core'
import fs from 'fs'
const ENGINE = process.env.ENGINE || 'webkit'
const BASE   = process.env.BASE   || 'http://localhost:8799/index.html'
const OUT    = process.env.OUT    || '/tmp/vsweep2'
fs.mkdirSync(OUT, {recursive:true})

const VIEWPORTS = (process.env.VPS || 'gal360:360:740,ip375:375:667,ip430:430:932,tab768:768:1024,lap1280:1280:800,lap1366:1366:768,lap1440:1440:900,lap1512:1512:982,desk1920:1920:1080')
  .split(',').map(v => { const [n,w,h] = v.split(':'); return [n, +w, +h] })

const DIAG = () => {
  const vw = innerWidth
  const out = { docW: document.documentElement.scrollWidth, vpShift: 0, over: [], clip: [] }
  const cv = document.getElementById('cardViewport')
  out.vpShift = cv ? cv.scrollLeft : 0
  const act = document.querySelector('.flow-card.active')
  out.cardLeft = act ? Math.round(act.getBoundingClientRect().left) : null
  const desc = el => el.tagName.toLowerCase() + (el.id?'#'+el.id:'') +
    (typeof el.className==='string' && el.className.trim() ? '.'+el.className.trim().split(/\s+/).slice(0,2).join('.') : '')
  for (const el of document.querySelectorAll('.flow-card.active *, .app-header *')) {
    const s = getComputedStyle(el)
    if (s.display==='none' || s.visibility==='hidden' || +s.opacity===0) continue
    const r = el.getBoundingClientRect()
    if (r.width===0 || r.height===0) continue
    if (r.right > vw + 1 || r.left < -1) out.over.push({el:desc(el), left:Math.round(r.left), right:Math.round(r.right)})
    const hasText = [...el.childNodes].some(n => n.nodeType===3 && n.textContent.trim())
    if (!hasText) continue
    if (el.scrollWidth > el.clientWidth + 1 && !['auto','scroll','visible'].includes(s.overflowX))
      out.clip.push({el:desc(el), axis:'x', need:el.scrollWidth, got:el.clientWidth, text:el.textContent.trim().slice(0,28)})
    if (el.scrollHeight > el.clientHeight + 2 && s.overflowY==='hidden')
      out.clip.push({el:desc(el), axis:'y', need:el.scrollHeight, got:el.clientHeight, text:el.textContent.trim().slice(0,28)})
  }
  return out
}

const FILL = () => {
  const set = (id,v) => { const e=document.getElementById(id); if(!e) return; e.value=v
    e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})) }
  set('input-title','의료기관 교육담당자 역량강화 연수 과정')
  set('input-start','2026-10-12'); set('input-end','2026-10-14')
  window.setStartTime && setStartTime('14:00')
  set('input-place','삼성서울병원'); set('input-region','서울')
  window.selectFeePresence && selectFeePresence(true)
  set('input-fee','330,000')
  document.getElementById('placeSuggest')?.classList.add('hidden')
  document.getElementById('regionSuggest')?.classList.add('hidden')
}

const launcher = ENGINE==='chrome' ? chromium : webkit
const b = await launcher.launch(ENGINE==='chrome'?{channel:'chrome'}:{})
const issues = []

for (const [name,w,h] of VIEWPORTS) {
  const ctx = await b.newContext({viewport:{width:w,height:h}, deviceScaleFactor:+(process.env.DPR||2)})
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(BASE, {waitUntil:'networkidle'})

  const check = async tag => {
    await p.waitForTimeout(900)
    const d = await p.evaluate(DIAG)
    await p.screenshot({path:`${OUT}/${ENGINE}_${name}_${tag}.png`, fullPage:false})
    const bad = d.docW > w+1 || d.vpShift !== 0 || d.cardLeft !== 0 || d.over.length || d.clip.length
    if (bad) issues.push({vp:name, w, h, tag, ...d})
    console.log(`[${ENGINE}] ${name} ${w}x${h} ${tag}`.padEnd(36),
      `docW=${d.docW} shift=${d.vpShift} cardL=${d.cardLeft} over=${d.over.length} clip=${d.clip.length}`,
      bad ? 'BAD' : 'ok')
  }

  await check('01')
  await p.click('[data-choice="done"]',{timeout:8000}); await check('02')
  await p.click('[data-choice="no-doc"]',{timeout:8000}); await p.waitForTimeout(600)
  await p.evaluate(FILL); await p.waitForTimeout(800)
  await p.evaluate(()=>{document.getElementById('placeSuggest')?.classList.add('hidden')})
  await check('04')
  await p.click('#ctaNext4',{timeout:8000}); await p.waitForTimeout(700)
  for (let i=0;i<7;i++){
    const cur = await p.evaluate(()=>document.querySelector('.flow-card.active')?.id)
    await check(cur)
    const sel = await p.evaluate(i=>{
      const c = document.querySelector('.flow-card.active')
      if (c.id==='card-6') return '[data-choice="paid"]'
      const pick = [...c.querySelectorAll('.cta-btn')].find(b=>!b.disabled && b.offsetParent!==null)
              || [...c.querySelectorAll('.choice-btn')].find(b=>b.offsetParent!==null)
      if (!pick) return null
      pick.setAttribute('data-sweep', 'step'+i)
      return `[data-sweep="step${i}"]`
    }, i)
    if (!sel) break
    await p.click(sel,{timeout:5000}).catch(()=>{}); await p.waitForTimeout(800)
    const after = await p.evaluate(()=>document.querySelector('.flow-card.active')?.id)
    if (after === cur) {
      const cta2 = await p.evaluate(i=>{ const c=document.querySelector('.flow-card.active')
        const b=[...c.querySelectorAll('.cta-btn')].find(x=>x.offsetParent!==null && !x.disabled)
        if(!b) return null; b.setAttribute('data-sweep','retry'+i); return `[data-sweep="retry${i}"]` }, i)
      if (cta2) { await p.click(cta2,{timeout:5000}).catch(()=>{}); await p.waitForTimeout(800) }
    }
  }
  if (errs.length) { issues.push({vp:name, tag:'pageerror', errs}); console.log('PAGEERROR', name, errs) }
  await ctx.close()
}
fs.writeFileSync(`${OUT}/issues_${ENGINE}.json`, JSON.stringify(issues,null,1))
console.log('BAD ROWS', issues.length)
await b.close()
