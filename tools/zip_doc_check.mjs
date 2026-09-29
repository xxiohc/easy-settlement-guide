// 실제 한글(.hwpx)·워드(.docx) 파일에서 본문이 뽑히는지 확인한다(합성 fixture가 아닌 원본 검증).
//   node tools/zip_doc_check.mjs <파일> [<파일> …]
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
const { extractZipDocText, parseDocMeta } = ctx

let bad = 0
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f)
  const name = path.basename(f)
  const ext = name.split('.').pop().toLowerCase()
  const file = { name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
  try {
    const text = await extractZipDocText(file, ext)
    const chars = text.replace(/\s/g, '').length
    const m = parseDocMeta(name, text)
    console.log(`${chars >= 100 ? 'OK  ' : 'FAIL'} ${name} — ${chars}자 · 제목 ${JSON.stringify(m.title)} · 기간 ${m.startDate || '-'}~${m.endDate || '-'}`)
    if (chars < 100) bad++
  } catch (e) {
    console.log(`FAIL ${name} — ${e.message}`)
    bad++
  }
}
console.log(bad ? `\n${bad}건 실패` : '\n전부 읽었습니다')
process.exit(bad ? 1 : 0)
