// 브라우저가 뽑은 공문 원문(parse_dump.mjs 의 TEXTS 출력)으로 parseDocMeta 만 다시 돌려 정답표와 비교한다.
// OCR을 매번 다시 하지 않아 규칙을 고칠 때 몇 초 만에 돌아간다. 최종 확인은 parse_sweep.mjs(실제 업로드)로 한다.
//   node tools/parse_offline.cjs <texts.json> [texts2.json …]
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const stub = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : stub),
  apply: () => stub, set: () => true,
})
const ctx = vm.createContext({ document: stub, window: stub, navigator: { userAgent: '' }, location: { href: '' },
  localStorage: stub, sessionStorage: stub, fetch: () => Promise.resolve(stub),
  setTimeout, clearTimeout, setInterval, clearInterval, console: { ...console, log() {}, warn() {} } })
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8'), ctx)
const EXP = JSON.parse(fs.readFileSync(path.join(__dirname, 'parse_expected.json'), 'utf8'))
const sq = v => String(v ?? '').replace(/\s+/g, '')
let fields = 0, wrong = 0
for (const file of process.argv.slice(2)) {
  const texts = JSON.parse(fs.readFileSync(file, 'utf8'))
  console.log(`\n## ${path.basename(file)}`)
  for (const [name, text] of Object.entries(texts)) {
    const exp = EXP[name.normalize('NFC')]
    if (!exp) continue
    const m = ctx.parseDocMeta(name, text)
    const got = { docKind: m.docKind, title: m.title, start: m.startDate, end: m.endDate, time: m.startTime,
      dest: m.destination, venue: m.venue, venueSearch: m.venueSearch, fee: m.registration ?? null, online: m.isOnline, multiSession: !!m.multiSession }
    const bad = []
    for (const k of Object.keys(exp)) {
      fields++
      const ok = ['title', 'venue', 'venueSearch'].includes(k) ? sq(got[k]) === sq(exp[k]) : (got[k] ?? '') === (exp[k] ?? '')
      if (!ok) { wrong++; bad.push(`${k}: 기대 ${JSON.stringify(exp[k])} / 실제 ${JSON.stringify(got[k])}`) }
    }
    console.log(`${bad.length ? 'FAIL' : 'PASS'} ${name}${bad.map(x => '\n     ' + x).join('')}`)
  }
}
console.log(`\n필드 ${fields}개 중 불일치 ${wrong}개 — 정확도 ${((1 - wrong / fields) * 100).toFixed(1)}%`)
