// 테스트공문_업로드함의 공문을 실제 화면에 올려 parseDocMeta 결과를 정답표(parse_expected.json)와 대조한다.
// 공문 원본은 저장소 밖(../테스트공문_업로드함)에 있다 — 개인정보가 섞여 있어 커밋하지 않는다.
//   python3 -m http.server 8799   # app/ 에서
//   node tools/parse_sweep.mjs     (ENGINE=chrome 가능, BASE 로 배포본 점검)
import { webkit, chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOCS = path.join(HERE, '../../테스트공문_업로드함')
const BASE = process.env.BASE || 'http://localhost:8799/index.html'
const EXP = JSON.parse(fs.readFileSync(path.join(HERE, 'parse_expected.json'), 'utf8'))
const b = await (process.env.ENGINE === 'chrome' ? chromium.launch() : webkit.launch())
const p = await (await b.newContext({ viewport: { width: 420, height: 900 } })).newPage()
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.click('[data-choice="done"]'); await p.click('[data-choice="has-doc"]')
const sq = v => String(v ?? '').replace(/\s+/g, '')
let fields = 0, wrong = 0
for (const [file, exp] of Object.entries(EXP)) {
  if (file.startsWith('_')) continue
  if (!fs.existsSync(path.join(DOCS, file))) { console.log(`SKIP ${file} (파일 없음)`); continue }
  await p.evaluate(() => { try { clearUpload() } catch {} })
  await p.setInputFiles('#fileInput', path.join(DOCS, file))
  await p.waitForFunction(() => !document.getElementById('ctaNext3').disabled, { timeout: 180000 }).catch(() => {})
  const m = await p.evaluate(() => state.parsedMeta || {})
  const got = { docKind: m.docKind, title: m.title, start: m.startDate, end: m.endDate, time: m.startTime,
    dest: m.destination, venue: m.venue, fee: m.registration ?? null, online: m.isOnline, multiSession: !!m.multiSession }
  const bad = []
  for (const k of Object.keys(exp)) {
    fields++
    const ok = (k === 'title' || k === 'venue') ? sq(got[k]) === sq(exp[k]) : (got[k] ?? '') === (exp[k] ?? '')
    if (!ok) { wrong++; bad.push(`${k}: 기대 ${JSON.stringify(exp[k])} / 실제 ${JSON.stringify(got[k])}`) }
  }
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${file}${bad.map(x => '\n     ' + x).join('')}`)
}
console.log(`\n필드 ${fields}개 중 불일치 ${wrong}개 — 정확도 ${((1 - wrong / fields) * 100).toFixed(1)}%`)
await b.close()
