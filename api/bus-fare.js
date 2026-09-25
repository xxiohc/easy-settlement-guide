// 시외·고속버스 구간 운임 자동조회 — 국토교통부 TAGO(공공데이터포털).
// 서비스키는 서버 환경변수 TAGO_SERVICE_KEY에만 둔다. 브라우저로 내려보내지 않는다.
//
// 구 경로(.../SuburbsBusInfoService/get...)는 returnReasonCode 12(폐기)로 답하고,
// 신 경로(.../SuburbsBusInfo/Get...)만 살아 있다(2026-09-26 실측, 키 없이 코드 30).
const BASE = 'https://apis.data.go.kr/1613000'

const SERVICES = [
  { kind: '고속버스', path: 'ExpBusInfo',     terminalOp: 'GetExpBusTrminlList',     routeOp: 'GetStrtpntAlocFndExpbusInfo' },
  { kind: '시외버스', path: 'SuburbsBusInfo', terminalOp: 'GetSuberbsBusTrminlList', routeOp: 'GetStrtpntAlocFndSuberbsBusInfo' },
]

const PAGE_SIZE = 500
const MAX_PAGES = 20

async function callPage(path, op, params, serviceKey, pageNo) {
  const qs = new URLSearchParams({
    serviceKey, _type: 'json', numOfRows: String(PAGE_SIZE), pageNo: String(pageNo), ...params,
  })
  const res = await fetch(`${BASE}/${path}/${op}?${qs}`)
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    const err = /<errMsg>([^<]*)</.exec(text) || /"errMsg"\s*:\s*"([^"]*)"/.exec(text)
    throw new Error(`TAGO ${op} 응답을 읽지 못했습니다${err ? ` (${err[1]})` : ''}`)
  }
  const fault = body?.OpenAPI_ServiceResponse?.cmmMsgHeader
  if (fault) throw new Error(`TAGO ${op} 오류: ${fault.returnReasonCode} ${fault.errMsg}`)
  const header = body?.response?.header
  if (header && header.resultCode !== '00' && header.resultCode !== '0') {
    throw new Error(`TAGO ${op} 오류: ${header.resultCode} ${header.resultMsg}`)
  }
  const resBody = body?.response?.body
  const total = Number(resBody?.totalCount)
  const item = resBody?.items?.item
  const list = Array.isArray(item) ? item : item ? [item] : []
  return { items: list, totalCount: Number.isFinite(total) ? total : list.length }
}

async function callAll(path, op, params, serviceKey) {
  const first = await callPage(path, op, params, serviceKey, 1)
  const all = [...first.items]
  for (let page = 2; all.length < first.totalCount && page <= MAX_PAGES; page++) {
    const next = await callPage(path, op, params, serviceKey, page)
    if (!next.items.length) break
    all.push(...next.items)
  }
  return all
}

const terminalCache = new Map()

async function terminals(service, serviceKey) {
  if (terminalCache.has(service.kind)) return terminalCache.get(service.kind)
  const list = await callAll(service.path, service.terminalOp, {}, serviceKey)
  terminalCache.set(service.kind, list)
  return list
}

// "마산" 으로 "마산시외버스터미널" 을 찾는다. 완전일치 → 접두 → 포함 순.
function matchTerminals(list, name) {
  const want = String(name || '').trim()
  if (!want) return []
  const rows = list.map(t => ({ id: t.terminalId, name: String(t.terminalNm || '') }))
  const exact  = rows.filter(r => r.name === want)
  const prefix = rows.filter(r => r.name.startsWith(want))
  const has    = rows.filter(r => r.name.includes(want))
  const seen = new Set()
  return [...exact, ...prefix, ...has].filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
}

function defaultDate() {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function fareOf(item) {
  const n = Number(item.charge)
  return Number.isFinite(n) && n > 0 ? n : null
}

// 한 방향의 편성을 등급별로 갈라 최저·최고 운임을 돌려준다.
function summarize(items) {
  const priced = items.map(i => ({ grade: String(i.gradeNm || '').trim() || '등급미상', fare: fareOf(i) }))
                      .filter(r => r.fare)
  if (!priced.length) return null
  const grades = new Map()
  for (const r of priced) {
    const g = grades.get(r.grade) || { grade: r.grade, count: 0, min: r.fare, max: r.fare }
    g.count += 1
    g.min = Math.min(g.min, r.fare)
    g.max = Math.max(g.max, r.fare)
    grades.set(r.grade, g)
  }
  const fares = priced.map(r => r.fare)
  return {
    runCount: items.length,
    pricedCount: priced.length,
    min: Math.min(...fares),
    max: Math.max(...fares),
    grades: [...grades.values()].sort((a, b) => a.min - b.min),
  }
}

async function direction(service, from, to, date, serviceKey) {
  const items = await callAll(service.path, service.routeOp,
    { depTerminalId: from.id, arrTerminalId: to.id, depPlandTime: date }, serviceKey)
  return summarize(items)
}

// 마산 → 목적지 왕복. 가는 방향·오는 방향을 따로 조회해 더한다(편도 2배로 갈음하지 않는다).
async function lookupBusFare({ dep = '마산', arr, date = defaultDate(), returnDate, serviceKey }) {
  if (!serviceKey) throw new Error('TAGO_SERVICE_KEY 환경변수가 없습니다')
  if (!arr) throw new Error('도착지(arr)가 필요합니다')
  const backDate = returnDate || date

  const tried = []
  for (const service of SERVICES) {
    const list = await terminals(service, serviceKey)
    const froms = matchTerminals(list, dep)
    const tos   = matchTerminals(list, arr)
    tried.push({ kind: service.kind, terminalCount: list.length,
                 dep: froms.slice(0, 5), arr: tos.slice(0, 5) })
    if (!froms.length || !tos.length) continue

    for (const from of froms.slice(0, 3)) {
      for (const to of tos.slice(0, 3)) {
        const out = await direction(service, from, to, date, serviceKey)
        if (!out) continue
        const back = await direction(service, to, from, backDate, serviceKey)
        const roundMin = out.min + (back ? back.min : out.min)
        const roundMax = out.max + (back ? back.max : out.max)
        return {
          ok: true, kind: service.kind,
          dep: from.name, arr: to.name, depId: from.id, arrId: to.id,
          date, returnDate: backDate,
          outbound: out, inbound: back,
          roundTrip: { min: roundMin, max: roundMax },
          inboundEstimated: !back,
          scope: `조회 기준: 가는 날 ${date} · 오는 날 ${backDate} · ${service.kind} 직행 편성 전체${back ? '' : ' (오는 방향 편성 없음 → 가는 방향 운임으로 갈음)'}`,
        }
      }
    }
  }
  return { ok: false, dep, arr, date, reason: '직행 편성을 찾지 못했습니다', tried }
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  try {
    const data = await lookupBusFare({
      dep: url.searchParams.get('dep') || '마산',
      arr: url.searchParams.get('arr'),
      date: url.searchParams.get('date') || defaultDate(),
      returnDate: url.searchParams.get('returnDate') || undefined,
      serviceKey: process.env.TAGO_SERVICE_KEY,
    })
    res.end(JSON.stringify(data))
  } catch (e) {
    res.statusCode = 502
    res.end(JSON.stringify({ ok: false, error: e.message }))
  }
}

module.exports.lookupBusFare = lookupBusFare
module.exports.matchTerminals = matchTerminals
module.exports.summarize = summarize
module.exports.defaultDate = defaultDate
