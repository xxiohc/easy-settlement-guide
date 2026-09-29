// 공문 판독 오탐 평가 — 정답표와 비교해 칸마다 '맞음 / 누락(빈칸) / 오탐(틀린 값)'으로 나누고,
// 확신도(meta.confidence)별로 센다. 자동 채움(확신도 high·mid)에 오탐이 섞이면 안 된다(2026-09-29).
//   node tools/parse_eval.cjs <texts.json …> [--noise N]   (--noise: 스캔 오독 흉내 변형 N벌 추가)
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : stub), apply: () => stub, set: () => true })
const ctx = vm.createContext({ document: stub, window: stub, navigator: { userAgent: '' }, location: { href: '' }, localStorage: stub, sessionStorage: stub,
  fetch: () => Promise.resolve(stub), setTimeout, clearTimeout, setInterval, clearInterval, console: { ...console, log() {}, warn() {} } })
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8'), ctx)
const EXP = JSON.parse(fs.readFileSync(path.join(__dirname, 'parse_expected.json'), 'utf8'))
const args = process.argv.slice(2)
const noiseN = args.includes('--noise') ? +args[args.indexOf('--noise') + 1] : 0
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--noise')

// 실제 스캔 판독에서 나온 오독을 흉내 낸다(이 세션 실측: 월→%·9, 일→윌, 년→4, 시→A1, ':'→';', 라벨 뭉개짐, 괄호 요일 누락)
let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const NOISE = [
  t => t.replace(/(\d)월/g, (m, d) => (rnd() < 0.5 ? `${d}%` : m)),
  t => t.replace(/(\d)일/g, (m, d) => (rnd() < 0.4 ? `${d}윌` : m)),
  t => t.replace(/(20\d{2})년/g, (m, y) => (rnd() < 0.4 ? `${y}4` : m)),
  t => t.replace(/(\d{1,2})시/g, (m, h) => (rnd() < 0.4 ? `${h}A1` : m)),
  t => t.replace(/(\d{1,2}):(\d{2})/g, (m, h, mm) => (rnd() < 0.3 ? `${h};${mm}` : m)),
  t => t.replace(/일\s*시|장\s*소|기\s*간/g, m => (rnd() < 0.35 ? '~~' : m)),
  t => t.replace(/\(\s*[월화수목금토일]\s*\)/g, m => (rnd() < 0.5 ? '()' : m)),
  t => t.replace(/0/g, m => (rnd() < 0.05 ? 'O' : m)),
]
const noisy = t => NOISE.reduce((acc, f) => f(acc), t)

const FIELDS = { start: ['date', m => m.startDate], end: ['date', m => m.endDate], time: ['time', m => m.startTime], dest: ['dest', m => m.destination], fee: ['fee', m => m.registration ?? null] }
const tally = {}
const bump = (k) => { tally[k] = (tally[k] || 0) + 1 }
const wrongs = []
function evalOne(name, text, tag) {
  const exp = EXP[name.normalize('NFC')]; if (!exp) return
  const m = ctx.parseDocMeta(name, text)
  if (m.docKind !== 'notice') return
  for (const [k, [ck, get]] of Object.entries(FIELDS)) {
    if (!(k in exp)) continue
    const want = exp[k] ?? '', got = get(m) ?? ''
    const conf = (m.confidence || {})[ck] || (got ? 'none' : '')
    const verdict = String(got) === String(want) ? (got === '' ? '빈칸맞음' : '맞음') : got === '' ? '누락' : '오탐'
    bump(`${tag}|${verdict}|${conf || '-'}`)
    if (verdict === '오탐' && conf !== 'low') wrongs.push(`${tag} ${k} [${conf}/${(m.rules || {})[ck === 'date' ? 'date' : ck]}] ${name.slice(0, 40)}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}${(m.checks || []).length ? ' · ' + m.checks.map(c => c.why).join('; ') : ''}`)
  }
}
for (const f of files) {
  const texts = JSON.parse(fs.readFileSync(f, 'utf8'))
  for (const [name, text] of Object.entries(texts)) {
    evalOne(name, text, '원문')
    for (let i = 0; i < noiseN; i++) evalOne(name, noisy(text), '변형')
  }
}
const sum = (tag, pred) => Object.entries(tally).filter(([k]) => k.startsWith(tag + '|') && pred(k.split('|'))).reduce((a, [, v]) => a + v, 0)
for (const tag of ['원문', '변형']) {
  const total = sum(tag, () => true); if (!total) continue
  const wrong = sum(tag, ([, v]) => v === '오탐'), miss = sum(tag, ([, v]) => v === '누락')
  const autoWrong = sum(tag, ([, v, c]) => v === '오탐' && c !== 'low'), autoFilled = sum(tag, ([, v, c]) => (v === '맞음' || v === '오탐') && c !== 'low')
  const lowRight = sum(tag, ([, v, c]) => v === '맞음' && c === 'low'), lowWrong = sum(tag, ([, v, c]) => v === '오탐' && c === 'low')
  console.log(`[${tag}] 칸 ${total} · 오탐 ${wrong}(${(wrong / total * 100).toFixed(1)}%) · 누락 ${miss}`)
  console.log(`   자동 채움(high·mid) ${autoFilled}칸 중 오탐 ${autoWrong} → 자동 채움 오탐률 ${(autoWrong / Math.max(1, autoFilled) * 100).toFixed(1)}%`)
  console.log(`   '넣기' 버튼으로 돌린 low ${lowRight + lowWrong}칸: 맞음 ${lowRight} · 오탐 ${lowWrong}`)
}
if (wrongs.length) console.log('\n자동 채움 오탐 목록:\n' + [...new Set(wrongs)].slice(0, 40).join('\n'))
