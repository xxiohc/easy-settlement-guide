// data/bus_masan.json 이 마산시외버스터미널 홈페이지 원문과 아직 같은지 대조한다.
// 시간표가 바뀌면 FAIL 이 난다 — 원문을 보고 bus_masan.json 을 고친다.
//   node tools/check_bus_masan.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(fs.readFileSync(path.join(HERE, '../data/bus_masan.json'), 'utf8'))
const pages = {}
const text = async page => {
  if (!pages[page]) {
    const buf = Buffer.from(await (await fetch(`http://www.masantr.com/data/${page}`)).arrayBuffer())
    let t = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    // 페이지마다 인코딩이 다르다(부산은 EUC-KR) — 깨진 글자가 많으면 EUC-KR로 다시 읽는다
    if ((t.match(/\uFFFD/g) || []).length > 10) t = new TextDecoder('euc-kr').decode(buf)
    pages[page] = t.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').replace(/(\d{1,2}):\s+(\d{2})/g, '$1:$2')
  }
  return pages[page]
}
let bad = 0
for (const r of data.routes) {
  const t = await text(r.page)
  const missTimes = r.times.filter(x => !t.includes(x))
  const fareStr = r.fare.toLocaleString() + '원'
  const ok = !missTimes.length && t.includes(fareStr)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${r.terminal} — ${r.times.length}편 ${fareStr}${missTimes.length ? ` · 원문에 없는 시각 ${missTimes.join(',')}` : ''}${t.includes(fareStr) ? '' : ' · 요금 불일치'}`)
}
console.log(bad ? `\n불일치 ${bad}건 — 원문 확인 필요` : '\n원문과 모두 일치')
