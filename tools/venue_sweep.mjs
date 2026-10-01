// 공문 장소 → 좌표 → 여정표 소요시간까지 전수 점검(2026-09-29 지석초이: "여정에 해당 장소까지 소요시간이 안 나오면
// 장소가 제대로 입력 안 된 것"). 공문마다 실제 화면에 올려 카드4까지 가서 본다.
//   node tools/venue_sweep.mjs [파일명 일부]   (로컬 서버 8799, src/config.js 카카오 키 필요)
import { webkit, chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(HERE, '../../테스트공문_업로드함')
const BASE = process.env.BASE || 'http://localhost:8799/index.html'
const ONLY = process.argv[2]
const EXP = JSON.parse(fs.readFileSync(path.join(HERE, 'parse_expected.json'), 'utf8'))
const b = await (process.env.ENGINE === 'chrome' ? chromium : webkit).launch()
const rows = []
for (const file of Object.keys(EXP)) {
  if (file.startsWith('_') || (ONLY && !file.includes(ONLY))) continue
  const f = path.join(DIR, file); if (!fs.existsSync(f)) continue
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage()
  await p.goto(BASE, { waitUntil: 'networkidle' })
  await p.click('[data-choice="has-doc"]')
  await p.setInputFiles('#fileInput', f)
  const ok = await p.waitForFunction(() => !document.getElementById('ctaNext3').disabled, { timeout: 240000 }).then(() => true, () => false)
  if (!ok) { rows.push({ file, verdict: 'TIMEOUT' }); await p.close(); continue }
  const kind = await p.evaluate(() => state.parsedMeta?.docKind)
  if (kind !== 'notice') { rows.push({ file, verdict: '공문아님' }); await p.close(); continue }
  await p.click('#ctaNext3'); await p.waitForTimeout(3500)
  const r = await p.evaluate(() => ({
    online: state.isOnline, jeju: state.isJeju, region: state.region, venue: state.parsedMeta?.venue || '', place: state.place,
    lat: state.placeLat, geo: (document.getElementById('place-geo-note')?.dataset.geo || document.getElementById('place-geo-note')?.innerText || '').replace(/\s+/g, ' '),
    route: (document.getElementById('prevday-verdict')?.innerText || '').replace(/\s+/g, ' '), needsPick: !!state.placeNeedsPick,
  }))
  const hasGeo = Number.isFinite(r.lat)
  const stationOnly = /역 기준 계산|장소를 검색 목록에서 고르면/.test(r.route)
  const verdict = r.online ? '온라인(해당없음)' : r.jeju ? '제주(항공)' : r.needsPick && !hasGeo ? '직접검색 안내' : !hasGeo ? '⚠좌표없음·안내없음' : stationOnly ? '⚠여정 미반영' : 'OK'
  rows.push({ file, verdict, region: r.region, venue: r.venue.slice(0, 50), place: r.place, geo: r.geo.replace(/^📍\s*/, '').slice(0, 70) })
  await p.close()
}
await b.close()
for (const r of rows) console.log(`${r.verdict.padEnd(12)} | ${r.file.slice(0, 34).padEnd(34)} | 지역 ${r.region || '-'} | 장소 "${r.place || ''}" | ${r.geo || ''}${r.place !== r.venue && r.venue ? ` | 원문 "${r.venue}"` : ''}`)
const c = rows.reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {})
console.log('\n' + Object.entries(c).map(([k, v]) => `${k} ${v}`).join(' · '))
