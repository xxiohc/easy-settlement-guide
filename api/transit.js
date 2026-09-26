// 역→현장 대중교통 경로 — 서울특별시 대중교통환승경로 조회 서비스(공공데이터포털, 무료).
// 개발계정 하루 1,000건·자동승인, 운영계정은 활용사례 등록으로 늘릴 수 있다(2026-09-26 확인).
// 이 API는 http 뿐이라 https 화면에서 직접 부를 수 없어 이 함수가 중계한다.
// 키는 TAGO_SERVICE_KEY(같은 공공데이터포털 계정 키 — 이 API도 '활용신청'이 돼 있어야 한다).
const ENDPOINT = 'http://ws.bus.go.kr/api/rest/pathinfo/getPathInfoByBusNSub'
const WALK_M_PER_MIN = 67

function haversineM(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

const asList = x => (Array.isArray(x) ? x : x ? [x] : [])

// 응답(itemList)에서 소요시간이 가장 짧은 경로 하나를 화면용으로 줄인다.
// time 에 걷는 시간이 들어 있는지 명세에 없어, 역→첫 탑승지·마지막 하차지→현장 도보를 따로 더한다.
function summarize(items, from, to) {
  const best = asList(items)
    .map(it => ({ it, min: Number(it.time) }))
    .filter(x => Number.isFinite(x.min))
    .sort((a, b) => a.min - b.min)[0]
  if (!best) return null
  const legs = asList(best.it.pathList)
  if (!legs.length) return null
  const first = legs[0], last = legs[legs.length - 1]
  const walkIn = Math.ceil(haversineM(from.lat, from.lon, Number(first.fy), Number(first.fx)) / WALK_M_PER_MIN)
  const walkOut = Math.ceil(haversineM(Number(last.ty), Number(last.tx), to.lat, to.lon) / WALK_M_PER_MIN)
  const steps = []
  if (walkIn >= 1) steps.push({ kind: '도보', text: `도보 약 ${walkIn}분 → ${first.fname}` })
  for (const l of legs) {
    const subway = /호선|선$|경의|공항|신분당|경춘|수인|우이|서해/.test(l.routeNm || '')
    steps.push({ kind: subway ? '지하철' : '버스', text: `${subway ? l.routeNm : `${l.routeNm}번 버스`} ${l.fname} → ${l.tname}` })
  }
  if (walkOut >= 1) steps.push({ kind: '도보', text: `${last.tname} → 도보 약 ${walkOut}분` })
  return { min: best.min + walkIn + walkOut, rideMin: best.min, walkMin: walkIn + walkOut, steps, source: 'seoul' }
}

async function lookup({ sx, sy, ex, ey }, serviceKey, fetchImpl = fetch) {
  const qs = new URLSearchParams({ serviceKey, startX: sx, startY: sy, endX: ex, endY: ey, resultType: 'json' })
  const res = await fetchImpl(`${ENDPOINT}?${qs}`)
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { throw new Error('서울시 경로 응답을 읽지 못했습니다') }
  if (body.error || body.status === 401) throw new Error(body.message || '서비스키 오류')
  const head = body.msgHeader || {}
  if (head.headerCd && String(head.headerCd) !== '0') {
    // 4: 결과 없음 — 서울 밖이거나 너무 가까운 구간
    if (String(head.headerCd) === '4') return null
    throw new Error(head.headerMsg || `서울시 경로 오류 ${head.headerCd}`)
  }
  return summarize(body.msgBody && body.msgBody.itemList,
    { lat: Number(sy), lon: Number(sx) }, { lat: Number(ey), lon: Number(ex) })
}

module.exports = async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)) }
  const u = new URL(req.url, 'http://localhost')
  const p = Object.fromEntries(['sx', 'sy', 'ex', 'ey'].map(k => [k, u.searchParams.get(k)]))
  if (Object.values(p).some(v => v === null || v === '' || !Number.isFinite(Number(v)))) return send(400, { ok: false, error: '좌표가 필요합니다' })
  const key = process.env.TAGO_SERVICE_KEY
  if (!key) return send(503, { ok: false, error: '공공데이터포털 키가 설정되지 않았습니다' })
  try {
    const route = await lookup(p, key)
    send(200, route ? { ok: true, ...route } : { ok: false, error: '경로 없음' })
  } catch (e) {
    send(502, { ok: false, error: e.message })
  }
}

module.exports.lookup = lookup
module.exports.summarize = summarize
