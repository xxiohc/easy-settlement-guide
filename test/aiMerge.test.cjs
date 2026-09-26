// AI 판독 + 규칙 판독 교차검증(mergeAiMeta)과 서버 함수(api/parse-doc.js) 검증.
// 원칙: 금액에 영향을 주는 항목은 두 판독이 같을 때만 채운다. 다르면 비우고 후보를 남긴다.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadApp() {
  const stub = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : stub),
    apply: () => stub,
    set: () => true,
  })
  const context = vm.createContext({
    document: stub, window: stub, navigator: { userAgent: '' }, location: { href: '' },
    localStorage: stub, sessionStorage: stub, fetch: () => Promise.resolve(stub),
    setTimeout, clearTimeout, setInterval, clearInterval, console,
  })
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8'), context)
  return context
}
const app = loadApp()

const F = (value, quote = null) => ({ value, quote })
const aiFields = over => ({
  docKind: 'notice', title: F('제31차 OO학회 학술대회', '제 목 : 제31차 OO학회 학술대회'),
  startDate: F('2026-05-28', '2026년 5월 28일(목) ~ 29일(금)'), endDate: F('2026-05-29'),
  startTime: F(null), venue: F('스위스 그랜드 호텔 (서울 서대문구 연희로 353)', '장 소 : 스위스 그랜드 호텔'),
  registrationFee: F(180000, '정회원 18만원'), isOnline: F(false), multiSession: F(false), ...over,
})
const rule = over => ({ title: 'OO학회', periodDisplay: '5월 28일 ~ 5월 29일', startDate: '2026-05-28', endDate: '2026-05-29',
  nights: 1, days: 2, destination: '서울', registration: 180000, registrationNote: null, isOnline: false,
  startTime: '', endTime: '', venue: '', yearGuessed: false, isTripDoc: true, docKind: 'notice', multiSession: false, ...over })

test('두 판독이 같으면 채우고 일치로 표시한다', () => {
  const m = app.mergeAiMeta(rule(), aiFields())
  assert.equal(m.startDate, '2026-05-28')
  assert.equal(m.registration, 180000)
  assert.equal(m.destination, '서울')
  assert.equal(m.checks.startDate.status, 'agree')
  assert.equal(m.venue, '스위스 그랜드 호텔 (서울 서대문구 연희로 353)')
})

test('기간이 다르면 비우고 두 후보를 남긴다 — 시행일자를 교육일로 읽은 경우', () => {
  const m = app.mergeAiMeta(rule({ startDate: '2026-03-27', endDate: '2026-03-27' }), aiFields())
  assert.equal(m.startDate, '')
  assert.equal(m.checks.startDate.status, 'conflict')
  assert.equal(m.checks.startDate.ai, '2026-05-28')
  assert.equal(m.checks.startDate.rule, '2026-03-27')
  assert.equal(m.periodDisplay, '')
})

test('한쪽만 읽은 시각은 채우지 않는다', () => {
  const m = app.mergeAiMeta(rule({ startTime: '12:10' }), aiFields())
  assert.equal(m.startTime, '')
  assert.equal(m.checks.startTime.status, 'rule-only')
  const m2 = app.mergeAiMeta(rule(), aiFields({ startTime: F('09:30', '09:30 등록') }))
  assert.equal(m2.startTime, '')
  assert.equal(m2.checks.startTime.status, 'ai-only')
})

test('AI 시각은 10분 단위로 내려 비교한다', () => {
  const m = app.mergeAiMeta(rule({ startTime: '09:30' }), aiFields({ startTime: F('9:35') }))
  assert.equal(m.startTime, '09:30')
})

test('등록비가 다르면 비운다', () => {
  const m = app.mergeAiMeta(rule({ registration: 200000 }), aiFields())
  assert.equal(m.registration, null)
  assert.equal(m.checks.registration.status, 'conflict')
})

test('AI가 영수증·출장신청서로 보면 아무 칸도 채우지 않는다', () => {
  const m = app.mergeAiMeta(rule(), aiFields({ docKind: 'receipt' }))
  assert.equal(m.isTripDoc, false)
  assert.equal(m.startDate, '')
  assert.equal(m.registration, null)
})

test('차수는 어느 한쪽이라도 차수 공문이라 하면 알린다', () => {
  const m = app.mergeAiMeta(rule({ multiSession: false }), aiFields({ multiSession: F(true) }))
  assert.equal(m.multiSession, true)
})

// ── 서버 함수 ──
const api = require('../api/parse-doc.js')
const fakeClient = (reply, capture = {}) => ({ beta: { messages: { create: async req => { capture.req = req; return reply } } } })

test('PDF는 document 블록, 이미지는 image 블록으로 보내고 JSON을 돌려준다', async () => {
  const cap = {}
  const reply = { model: 'claude-opus-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(aiFields()) }] }
  const out = await api.extractWithClaude({ data: 'AAAA', mediaType: 'application/pdf' }, fakeClient(reply, cap))
  assert.equal(cap.req.messages[0].content[0].type, 'document')
  assert.equal(cap.req.output_config.format.type, 'json_schema')
  assert.equal(out.fields.startDate.value, '2026-05-28')
  await api.extractWithClaude({ data: 'AAAA', mediaType: 'image/jpeg' }, fakeClient(reply, cap))
  assert.equal(cap.req.messages[0].content[0].type, 'image')
})

test('거절·길이 초과는 값 대신 오류로 돌려준다', async () => {
  await assert.rejects(api.extractWithClaude({ data: 'A', mediaType: 'application/pdf' }, fakeClient({ stop_reason: 'refusal', content: [] })))
  await assert.rejects(api.extractWithClaude({ data: 'A', mediaType: 'application/pdf' }, fakeClient({ stop_reason: 'max_tokens', content: [] })))
})

test('키가 없으면 503, 형식이 틀리면 400', async () => {
  const run = async (method, body, env) => {
    const saved = process.env.ANTHROPIC_API_KEY
    if (env) process.env.ANTHROPIC_API_KEY = env; else delete process.env.ANTHROPIC_API_KEY
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = JSON.parse(b) } }
    await api({ method, body }, res)
    if (saved) process.env.ANTHROPIC_API_KEY = saved; else delete process.env.ANTHROPIC_API_KEY
    return res
  }
  assert.equal((await run('POST', { data: 'A', mediaType: 'application/pdf' })).statusCode, 503)
  assert.equal((await run('POST', { data: 'A', mediaType: 'text/plain' }, 'x')).statusCode, 400)
  assert.equal((await run('GET', {}, 'x')).statusCode, 405)
})
