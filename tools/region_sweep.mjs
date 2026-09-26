// 공문 → 지역 판정 전수 점검. 브라우저(pdf.js)가 실제로 뽑은 글자로 검사한다 —
// node에서 텍스트를 넣어 보는 단위 테스트와 달리 PDF 추출 단계까지 함께 본다.
// 사용: app/ 에서 `npx serve -l 8799` 후 `ENGINE=webkit node tools/region_sweep.mjs`
//       BASE=https://smc-expense-guide.vercel.app/index.html 로 배포본도 같은 검사를 돌린다.
import { webkit, chromium } from 'playwright-core'
const ENGINE = process.env.ENGINE || 'webkit'
const BASE   = process.env.BASE   || 'http://localhost:8799/index.html'
const DIR    = '/Users/jiseokchoi/ODDCHOI/workspace/09_교육, 출장 정산 가이드/app/test-docs/'

// 공문마다 화면에 나와야 하는 값. 지역은 교통비 기준 도시다 —
// 성균관대 자연과학캠퍼스는 수원이고, 발신처 주소(서울 종로구)에 끌려가면 안 된다.
const CASES = [
  { file: '세무조정_공문.pdf',      region: '수원', venue: '성균관대학교 자연과학캠퍼스', tripDoc: true },
  { file: '학술사업_공문.pdf',      region: '서울', tripDoc: true },
  { file: '삼일아카데미_교육.pdf',  tripDoc: true },
]

const launcher = ENGINE === 'chrome' ? chromium : webkit
const b = await launcher.launch(ENGINE === 'chrome' ? { channel: 'chrome' } : {})
const results = []
const log = (file, item, status, note = '') => results.push({ file, item, status, note })

for (const c of CASES) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(BASE, { waitUntil: 'networkidle' })
  await p.click('[data-choice="done"]');     await p.waitForTimeout(400)
  await p.click('[data-choice="has-doc"]');  await p.waitForTimeout(600)
  const fi = await p.$('input[type=file]')
  await fi.setInputFiles(DIR + c.file)
  try {
    await p.waitForFunction(() => { const b = document.getElementById('ctaNext3'); return b && !b.disabled }, { timeout: 60000 })
  } catch {
    log(c.file, '공문 파싱', 'FAIL', '60초 내 파싱 안 됨'); await ctx.close(); continue
  }
  const meta = await p.evaluate(() => {
    const grid = document.getElementById('resultGrid')
    const pick = label => {
      const it = [...grid.querySelectorAll('.result-item')].find(e => e.querySelector('label')?.textContent.trim() === label)
      return it ? it.querySelector('span')?.textContent.trim() : null
    }
    return { region: pick('지역'), venue: pick('장소'),
             warn: grid.textContent.includes('출장·교육 공문으로 보이지 않아요') }
  })
  if (c.region)  log(c.file, '지역', meta.region === c.region ? 'PASS' : 'FAIL', `화면="${meta.region}" 기대="${c.region}"`)
  if (c.venue)   log(c.file, '장소', meta.venue  === c.venue  ? 'PASS' : 'FAIL', `화면="${meta.venue}" 기대="${c.venue}"`)
  if (c.tripDoc) log(c.file, '출장 공문 인정', meta.warn ? 'FAIL' : 'PASS', meta.warn ? '"공문으로 보이지 않아요" 배너 표시' : '경고 없음')

  await p.click('#ctaNext3'); await p.waitForTimeout(1000)
  const shown = await p.inputValue('#input-region').catch(() => null)
  if (c.region) log(c.file, '카드4 지역칸', shown === c.region ? 'PASS' : 'FAIL', `값="${shown}"`)
  await ctx.close()
}
await b.close()

for (const r of results) console.log(`${r.status.padEnd(4)} | ${r.file} | ${r.item} | ${r.note}`)
const fail = results.filter(r => r.status === 'FAIL').length
console.log(`\n${ENGINE} — ${results.length}건 검사 · PASS ${results.length - fail} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
