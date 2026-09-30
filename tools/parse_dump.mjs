// 폴더의 공문을 실제 화면에 올려 parseDocMeta 결과를 JSON으로 뽑는다(정답표 작성용).
//   node tools/parse_dump.mjs <폴더> [ENGINE=chrome]
import { webkit, chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
const DIR = process.argv[2]
const ONLY = process.argv[3]
const BASE = process.env.BASE || 'http://localhost:8799/index.html'
const b = await (process.env.ENGINE === 'chrome' ? chromium.launch() : webkit.launch())
const p = await (await b.newContext({ viewport: { width: 420, height: 900 } })).newPage()
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.evaluate(() => { const orig = parseDocMeta; window.__texts = {}; parseDocMeta = (f, t) => { window.__texts[f] = t; return orig(f, t) } })
await p.click('[data-choice="has-doc"]')
const out = {}
for (const file of fs.readdirSync(DIR).sort()) {
  if (file.startsWith('.') || fs.statSync(path.join(DIR, file)).isDirectory()) continue
  if (ONLY && !file.includes(ONLY)) continue
  await p.evaluate(() => { try { clearUpload() } catch {} ; state.parsedMeta = null })
  const t0 = Date.now()
  await p.setInputFiles('#fileInput', path.join(DIR, file))
  await p.waitForFunction(() => !document.getElementById('ctaNext3').disabled, { timeout: 240000 }).catch(() => {})
  const m = await p.evaluate(() => state.parsedMeta || null)
  const err = await p.evaluate(() => document.querySelector('.result-warn')?.innerText || '')
  out[file.normalize('NFC')] = m ? { docKind: m.docKind, title: m.title, start: m.startDate, end: m.endDate, time: m.startTime,
    dest: m.destination, venue: m.venue, fee: m.registration ?? null, online: m.isOnline, multiSession: !!m.multiSession,
    sec: Math.round((Date.now() - t0) / 1000) } : { error: err }
  console.error(file, JSON.stringify(out[file.normalize('NFC')]))
}
console.log(JSON.stringify(out, null, 2))
// 맥 파일명은 한글이 자모로 풀린 NFD라 정답표(NFC) 키와 안 맞는다 — 저장할 때 NFC로 맞춘다(원문이 빈 값으로 보이던 원인)
if (process.env.TEXTS) {
  const texts = await p.evaluate(() => window.__texts)
  fs.writeFileSync(process.env.TEXTS, JSON.stringify(Object.fromEntries(Object.entries(texts).map(([k, v]) => [k.normalize('NFC'), v])), null, 1))
}
await b.close()
