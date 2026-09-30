// 테스트공문_업로드함의 공문을 실제 화면에 올려 parseDocMeta 결과를 정답표(parse_expected.json)와 대조한다.
// 공문 원본은 저장소 밖(../테스트공문_업로드함)에 있다 — 개인정보가 섞여 있어 커밋하지 않는다.
//   python3 -m http.server 8799   # app/ 에서
//   node tools/parse_sweep.mjs     (ENGINE=chrome 가능, BASE 로 배포본 점검)
import { webkit, chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOC_DIRS = [path.join(HERE, '../../테스트공문_업로드함')]
const findDoc = f => DOC_DIRS.map(d => path.join(d, f)).find(p => fs.existsSync(p))
const BASE = process.env.BASE || 'http://localhost:8799/index.html'
const EXP = JSON.parse(fs.readFileSync(path.join(HERE, 'parse_expected.json'), 'utf8'))
const b = await (process.env.ENGINE === 'chrome' ? chromium.launch() : webkit.launch())
const ctx = await b.newContext({ viewport: { width: 420, height: 900 } })
let p
// 판독이 시간 초과되면 뒤에서 계속 돌던 OCR이 다음 공문 결과 자리에 끼어든다(2026-09-29 check_all 중 Veeam 칸에
// 수술감염학회 결과가 들어간 원인). 시간 초과 뒤에는 페이지를 새로 열어 이전 판독을 끊는다.
async function freshPage() {
  if (p) await p.close()
  p = await ctx.newPage()
  await p.goto(BASE, { waitUntil: 'networkidle' })
  await p.click('[data-choice="has-doc"]')
}
await freshPage()
const sq = v => String(v ?? '').replace(/\s+/g, '')
let fields = 0, wrong = 0
for (const [file, exp] of Object.entries(EXP)) {
  if (file.startsWith('_')) continue
  const docPath = findDoc(file)
  if (!docPath) { console.log(`SKIP ${file} (파일 없음)`); continue }
  await p.evaluate(() => { try { clearUpload() } catch {} })
  await p.setInputFiles('#fileInput', docPath)
  // 화면에 뜬 파일명이 지금 올린 공문일 때만 결과를 읽는다. 맥 파일명은 NFD라 NFC로 맞추고, 화면은 연속 공백을
  // 한 칸으로 합치므로("보험심사 2026-34  2026…") 공백을 모두 빼고 비교한다
  const squash = x => x.normalize('NFC').replace(/\s+/g, '')
  const done = await p.waitForFunction(name => !document.getElementById('ctaNext3').disabled
    && (document.getElementById('parseResult')?.innerText || '').normalize('NFC').replace(/\s+/g, '').includes(name),
    squash(path.basename(docPath)), { timeout: 240000 }).then(() => true, () => false)
  if (!done) {
    fields += Object.keys(exp).length; wrong += Object.keys(exp).length
    console.log(`FAIL ${file}\n     판독 시간 초과(240초) — 결과를 읽지 않고 페이지를 새로 연다`)
    await freshPage(); continue
  }
  const m = await p.evaluate(() => state.parsedMeta || { docKind: document.querySelector('.result-warn') ? 'unreadable' : undefined })
  const got = { docKind: m.docKind, title: m.title, start: m.startDate, end: m.endDate, time: m.startTime,
    dest: m.destination, venue: m.venue, venueSearch: m.venueSearch, fee: m.registration ?? null, online: m.isOnline, multiSession: !!m.multiSession,
    titleLow: (m.confidence || {}).title === 'low' }
  const bad = []
  // 2026-09-30: 좌표만 맞으면 통과시키던 탓에 화면 장소 칸의 판독 찌꺼기("…미담당자반 : 206호 {담당강")를 놓쳤다.
  // 장소 글자 자체를 본다 — 원문 핵심어(venueHas)가 다 들어 있고, 찌꺼기 모양이 하나도 없어야 한다.
  const VENUE_JUNK = /반\s*[:：]\s*\d+\s*호|[『』%{}<>×∎]|\s[*※]|주\s*소\s*[:：]|\s[=:;]\s|\s\d{4,}(?:\s|$)|\s[a-z]{1,3}$|담당강사/
  const checks = { ...exp }
  if (got.docKind === 'notice' && !got.online && got.venue) checks.venueClean = true
  for (const k of Object.keys(checks)) {
    fields++
    let ok
    if (k === 'venueHas') ok = exp.venueHas.every(w => sq(got.venue).includes(sq(w)))
    else if (k === 'venueClean') ok = !VENUE_JUNK.test(got.venue) && got.venue.length <= 50
    // 제목은 맞게 읽거나, 못 읽었으면 '확인 필요'로 표시해야 한다 — 틀린 제목을 확신 있게 채우면 실패
    else if (k === 'title') ok = sq(got.title) === sq(exp.title) || (exp.titleMayFlag && got.titleLow)
    else if (k === 'titleMayFlag') { fields--; continue }
    else ok = (k === 'venue' || k === 'venueSearch') ? sq(got[k]) === sq(exp[k]) : (got[k] ?? '') === (exp[k] ?? '')
    if (k === 'venueHas' || k === 'venueClean') { if (!ok) { wrong++; bad.push(`${k}: 기대 ${JSON.stringify(exp[k] ?? '찌꺼기 없음')} / 실제 ${JSON.stringify(got.venue)}`) } continue }
    if (!ok) { wrong++; bad.push(`${k}: 기대 ${JSON.stringify(exp[k])} / 실제 ${JSON.stringify(got[k])}`) }
  }
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${file}${bad.map(x => '\n     ' + x).join('')}`)
}
console.log(`\n필드 ${fields}개 중 불일치 ${wrong}개 — 정확도 ${((1 - wrong / fields) * 100).toFixed(1)}%`)
await b.close()
