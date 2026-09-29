// 실제 옛 한글(.hwp, HWP 5.0 이진) 파일에서 본문이 뽑히는지 확인한다(합성 fixture가 아닌 원본 검증).
//   node tools/hwp_check.mjs <파일.hwp> [<파일.hwp> …]
// 본문 20자 미만이면 실패로 센다. 사람 눈 대조용으로 앞 6줄과 판독 결과를 함께 찍는다.
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const stub = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : stub), apply: () => stub, set: () => true,
})
const ctx = vm.createContext({
  document: stub, window: stub, navigator: { userAgent: '' }, location: { href: '' },
  localStorage: stub, sessionStorage: stub, fetch: () => Promise.resolve(stub),
  setTimeout, clearTimeout, setInterval, clearInterval, console,
  Blob, Response, DecompressionStream, TextDecoder, TextEncoder, URL,
})
vm.runInContext(fs.readFileSync(path.join(HERE, '../src/app.js'), 'utf8'), ctx)
const { extractHwpText, parseDocMeta } = ctx

let bad = 0
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f)
  const name = path.basename(f)
  const file = { name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
  try {
    const text = await extractHwpText(file)
    const chars = text.replace(/\s/g, '').length
    const m = parseDocMeta(name, text)
    if (chars < 20) { bad++; console.log(`FAIL ${name} — 본문 ${chars}자`); continue }
    console.log(`OK   ${name} — ${chars}자 | ${m.startDate || '날짜?'} ${m.startTime || ''} | ${m.destination || '지역?'} | ${m.venue || '장소?'}`)
    console.log(text.split('\n').filter(Boolean).slice(0, 6).map(l => `       ${l.slice(0, 80)}`).join('\n'))
  } catch (e) {
    bad++
    console.log(`FAIL ${name} — ${e.message}`)
  }
}
console.log(`\n파일 ${process.argv.length - 2}건 중 실패 ${bad}건`)
process.exit(bad ? 1 : 0)
