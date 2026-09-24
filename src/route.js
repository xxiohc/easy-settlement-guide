// ── KTX 역산 경로 계산 ────────────────────────────────────────────────────────
// 시간표·운임·역 좌표·기관 좌표를 앱 내부 정적 JSON에서만 읽는다. 외부 길찾기 API를 쓰지
// 않으므로 페이지를 공유받은 사람도 같은 결과를 본다.
// 모든 시각은 00:00부터의 '분'이다. 1440 이상은 익일.
//
// 도착역은 '가까운 역'이 아니라 '문 앞까지 총 소요시간이 가장 짧은 역'으로 고른다.
// 후보역을 여러 개 잡고, 각 후보마다 마산역 출발편(직통·1회 환승)과 역→목적지 접근시간을
// 더해 비교한다. 그래서 목적지에 따라 서울역이 아니라 수서역이 뽑힐 수 있다.

const ORIGIN_STATION = '마산'
const TRANSFER_MIN   = 20   // 환승 최소 여유 (같은 역 승강장 이동)
const ARRIVE_BUFFER  = 10   // 도착역→목적지 이동 뒤 남겨 두는 여유
const ACCESS_FIXED   = 12   // 역 밖 도보·대기·환승 고정 시간
const ACCESS_KMH     = 20   // 직선거리 기준 도심 대중교통 실효속도
const ACCESS_FAR_KMH = 30   // 15km를 넘는 구간(시외버스·광역철도) 실효속도
const TIGHT_SLACK    = 20   // 이보다 여유가 적으면 '빠듯함'으로 표시
const MIN_SLACK      = 5    // 추천편이 지켜야 할 최소 여유 (ARRIVE_BUFFER와 별도)
const NO_TRAIN_KM    = 25   // 마산역에서 이 거리 안이면 기차가 필요 없다
const CAND_LIMIT     = 10   // 비교할 도착역 후보 수
const CAND_MAX_KM    = 80   // 목적지에서 이보다 먼 역은 후보로 보지 않는다
const ACCESS_TOL     = 30   // 가장 가까운 역보다 접근시간이 이만큼 더 걸리는 역은 버린다
const TRANSFER_BACK  = 180  // 최적 직통보다 이만큼 이른 출발편까지만 환승을 탐색한다

const KtxRoute = {
  timetable: null,
  stations: null,
  fares: null,
  destinations: null,
  byStation: null,   // 역명 → 그 역에 서는 열차 목록
  ready: false,
}

async function loadRouteData() {
  try {
    const [tt, st, fa, de] = await Promise.all([
      fetch('./data/ktx_timetable.json').then(r => r.json()),
      fetch('./data/ktx_stations.json').then(r => r.json()),
      fetch('./data/ktx_fares_masan.json').then(r => r.json()),
      fetch('./data/destinations.json').then(r => r.json()).catch(() => ({ destinations: [] })),
    ])
    initRouteData(tt, st, fa, de)
  } catch {
    KtxRoute.ready = false
  }
  return KtxRoute.ready
}

// 브라우저(fetch)·테스트(파일 읽기) 어느 쪽에서 불러와도 같은 초기화를 쓴다.
function initRouteData(tt, st, fa, de) {
  KtxRoute.timetable    = tt
  KtxRoute.stations     = st.stations
  KtxRoute.fares        = Object.fromEntries((fa.fares || []).map(f => [f.station, f]))
  KtxRoute.destinations = (de && de.destinations) || []
  KtxRoute.byStation    = new Map()
  for (const t of tt.trains) {
    t._idx = new Map()
    t.stops.forEach((s, i) => {
      t._idx.set(s.s, i)
      if (!KtxRoute.byStation.has(s.s)) KtxRoute.byStation.set(s.s, [])
      KtxRoute.byStation.get(s.s).push(t)
    })
  }
  KtxRoute.ready = true
  return KtxRoute.ready
}

function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371
  const rad = d => d * Math.PI / 180
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// 직선거리 → 대중교통 소요시간 추정. 실측이 아니라 거리 기반 추정값이다.
function accessMinutes(km) {
  const near = Math.min(km, 15)
  const far  = Math.max(0, km - 15)
  const raw  = ACCESS_FIXED + near / ACCESS_KMH * 60 + far / ACCESS_FAR_KMH * 60
  return Math.max(10, Math.ceil(raw / 5) * 5)
}

// 공문에 적힌 기관명으로 등재된 출장지를 찾는다. 이름·별칭 양방향 부분일치.
function findDestination(text) {
  if (!text || !KtxRoute.destinations) return null
  const q = String(text).replace(/\s+/g, '')
  let hit = null
  for (const d of KtxRoute.destinations) {
    for (const a of [d.name, ...(d.aliases || [])]) {
      const key = a.replace(/\s+/g, '')
      if (!key) continue
      if (q === key) return d
      if ((q.includes(key) || key.includes(q)) && q.length >= 3) {
        if (!hit || key.length > hit._klen) hit = Object.assign({ _klen: key.length }, d)
      }
    }
  }
  return hit
}

// 역 → 목적지 접근시간. 사람이 확인한 값(사용자 입력 > 마스터 등재)이 있으면 그것을 쓰고,
// 없으면 거리 기반 추정을 쓴다. 어느 쪽인지 src로 함께 돌려줘 화면에 그대로 밝힌다.
function accessInfo(stationName, km, destRow, overrides) {
  const user = overrides && overrides[stationName]
  if (Number.isFinite(user)) return { min: Math.max(0, Math.round(user)), src: 'user' }
  const fixed = destRow && destRow.accessOverride && destRow.accessOverride[stationName]
  if (Number.isFinite(fixed)) return { min: Math.max(0, Math.round(fixed)), src: 'known' }
  return { min: accessMinutes(km), src: 'est' }
}

function fmtTime(t) {
  const d = Math.floor(t / 1440)
  const m = ((t % 1440) + 1440) % 1440
  const s = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return d > 0 ? `${s}(익일)` : d < 0 ? `${s}(전일)` : s
}

function fmtDur(min) {
  const h = Math.floor(min / 60), m = min % 60
  return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`
}

function trainsAt(station) {
  return KtxRoute.byStation.get(station) || []
}

function stopIndex(train, station) {
  return train._idx ? (train._idx.has(station) ? train._idx.get(station) : -1)
                    : train.stops.findIndex(s => s.s === station)
}

function legOf(train, from, to) {
  const i = stopIndex(train, from)
  const j = stopIndex(train, to)
  if (i < 0 || j < 0 || j <= i) return null
  return {
    no: train.no, type: train.type, days: train.days, note: train.note,
    from, to, dep: train.stops[i].t, arr: train.stops[j].t,
  }
}

function runsOn(train, dow) {
  return dow == null || train.days.includes(dow)
}

// 마산 → dest, deadline 이전 도착. 직통과 1회 환승을 '함께' 모은다.
// 직통이 있다고 환승을 버리지 않는다 — 환승편이 더 늦게 출발해도 되거나 더 빨리 닿는
// 경우가 있고, 특히 수서행처럼 직통 편수가 적은 역은 환승을 봐야 후보로 살아남는다.
function findItineraries(dest, deadline, dow) {
  const direct = []
  const fromOrigin = trainsAt(ORIGIN_STATION).filter(t => runsOn(t, dow))

  for (const t of fromOrigin) {
    const leg = legOf(t, ORIGIN_STATION, dest)
    if (leg && leg.arr <= deadline) {
      direct.push({ legs: [leg], transfers: 0, dep: leg.dep, arr: leg.arr, via: [], wait: null })
    }
  }

  // 환승 탐색 범위: 가장 늦은 직통보다 TRANSFER_BACK 이상 이른 출발편은 볼 필요가 없다.
  const latestDirect = direct.length ? Math.max(...direct.map(d => d.dep)) : null
  const minDep = latestDirect == null ? -Infinity : latestDirect - TRANSFER_BACK

  const trans = []
  for (const a of fromOrigin) {
    const oi = stopIndex(a, ORIGIN_STATION)
    if (oi < 0) continue
    const aDep = a.stops[oi].t
    if (aDep < minDep) continue
    if (stopIndex(a, dest) > oi) continue   // 직통으로 이미 잡은 열차
    for (let i = oi + 1; i < a.stops.length; i++) {
      const hub = a.stops[i].s
      const hubT = a.stops[i].t
      if (hub === dest || hubT + TRANSFER_MIN > deadline) continue
      for (const b of trainsAt(hub)) {
        if (!runsOn(b, dow)) continue
        const leg2 = legOf(b, hub, dest)
        if (!leg2 || leg2.arr > deadline || leg2.dep < hubT + TRANSFER_MIN) continue
        const leg1 = legOf(a, ORIGIN_STATION, hub)
        trans.push({
          legs: [leg1, leg2], transfers: 1, via: [hub],
          dep: leg1.dep, arr: leg2.arr, wait: leg2.dep - leg1.arr,
        })
      }
    }
  }

  // 같은 출발편·같은 환승역이면 가장 빨리 도착하는 조합만 남긴다.
  const best = new Map()
  for (const it of trans) {
    const key = `${it.legs[0].no}|${it.via[0]}`
    const cur = best.get(key)
    if (!cur || it.arr < cur.arr) best.set(key, it)
  }
  // 출발편이 같으면 환승역이 달라도 가장 빨리 닿는 하나만 남긴다(화면 중복 방지).
  const byDep = new Map()
  for (const it of best.values()) {
    const cur = byDep.get(it.dep)
    if (!cur || it.arr < cur.arr) byDep.set(it.dep, it)
  }

  return [...direct, ...byDep.values()].sort((a, b) => b.dep - a.dep || a.arr - b.arr)
}

function fareOf(station, isMS) {
  const f = KtxRoute.fares[station]
  if (!f) return null
  const first = isMS && f.oneWayFirst
  return {
    oneWay: first ? f.oneWayFirst : f.oneWay,
    roundTrip: first ? f.roundTripFirst : f.roundTrip,
    grade: first ? '특실' : '일반실',
    farePath: f.path,
    fareTransfers: f.transfers,
  }
}

function candidateStations(lat, lon, limit = CAND_LIMIT) {
  return Object.entries(KtxRoute.stations)
    .map(([name, s]) => ({ name, km: haversineKm(lat, lon, s.lat, s.lon), ...s }))
    .filter(s => s.name !== ORIGIN_STATION && KtxRoute.fares[s.name] && s.km <= CAND_MAX_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
}

// 출장 시작시각(startMin)에 목적지에 도착하도록 마산역 출발편을 역산한다.
// destRow: 등재된 기관 정보(있으면 확인된 접근시간 사용), access: 사용자가 직접 넣은 {역명: 분}
// only: 사용자가 도착역을 직접 지정한 경우 그 역으로만 계산한다(폴백 입력).
function planTrip({ lat, lon, startMin, dow, isMS, endMin, destRow, access, only }) {
  if (!KtxRoute.ready) return { ok: false, reason: 'data' }

  const origin = KtxRoute.stations[ORIGIN_STATION]
  const originKm = haversineKm(lat, lon, origin.lat, origin.lon)
  if (originKm <= NO_TRAIN_KM) {
    return { ok: false, reason: 'near', originKm: Math.round(originKm) }
  }

  // 후보역마다 접근시간을 먼저 구하고, 목적지에서 너무 먼 역은 버린다.
  // (예: 전주 국민연금공단을 대전역에서 내려 2시간 넘게 버스로 가는 조합을 추천하지 않는다)
  let scored = candidateStations(lat, lon)
    .map(st => ({ st, ai: accessInfo(st.name, st.km, destRow, access) }))
  if (only) {
    const pinned = scored.filter(x => x.st.name === only)
    if (pinned.length) scored = pinned
    else {
      const s = KtxRoute.stations[only]
      if (s && KtxRoute.fares[only]) {
        const st = { name: only, km: haversineKm(lat, lon, s.lat, s.lon), ...s }
        scored = [{ st, ai: accessInfo(only, st.km, destRow, access) }]
      }
    }
  }
  if (!scored.length) return { ok: false, reason: 'no-train', candidates: [] }
  const minAccess = Math.min(...scored.map(x => x.ai.min))
  const usable = scored.filter(x => x.ai.min <= minAccess + ACCESS_TOL)
  const cands = (usable.length ? usable : scored)

  const collect = buffer => {
    const acc = []
    for (const { st, ai } of cands) {
      const deadline = startMin - ai.min - buffer
      const its = findItineraries(st.name, deadline, dow)
      if (!its.length) continue
      const fare = fareOf(st.name, isMS)
      for (const it of its.slice(0, 4)) {
        const margin = startMin - ai.min - it.arr
        acc.push({
          station: st.name, stationKm: Math.round(st.km * 10) / 10,
          stationAddr: st.addr, access: ai.min, accessSrc: ai.src, deadline, fare,
          margin,
          slack: margin - ARRIVE_BUFFER,
          tight: margin < TIGHT_SLACK + ARRIVE_BUFFER,
          totalMin: startMin - it.dep,              // 마산역 출발 ~ 교육 시작까지 묶이는 시간
          travelMin: it.arr + ai.min - it.dep,      // 마산역 출발 ~ 현장 도착까지 실제 이동시간
          ...it,
        })
      }
    }
    return acc
  }

  // 권장 여유를 지키는 편이 하나도 없으면 여유 없이라도 닿는 편을 찾아 '빠듯함'으로 알린다.
  let plans = collect(ARRIVE_BUFFER)
  let noBuffer = false
  if (!plans.length) {
    plans = collect(0)
    noBuffer = plans.length > 0
  }
  if (!plans.length) {
    return { ok: false, reason: 'no-train', candidates: cands.map(c => c.st.name) }
  }

  // 1순위: 마산역에서 가장 늦게 나서도 되는 편(총 구속시간 최소).
  // 같으면 2순위: 문 앞까지 실제 이동시간이 짧은 역 — 여기서 접근시간이 짧은 역이 이긴다.
  // 그다음 환승 적은 편 → 운임 싼 역.
  const fareVal = p => (p.fare ? p.fare.oneWay : Number.MAX_SAFE_INTEGER)
  const byTotal = (a, b) =>
    a.totalMin - b.totalMin ||
    a.travelMin - b.travelMin ||
    a.transfers - b.transfers ||
    fareVal(a) - fareVal(b)
  plans.sort(byTotal)
  const safe = plans.filter(p => p.margin >= MIN_SLACK + ARRIVE_BUFFER)
  const best = (safe.length ? safe : plans)[0]

  // 차선은 '다른 도착역'을 우선 보여준다. 같은 열차를 역 이름만 바꿔 되풀이하면 쓸모가 없다.
  const pool = (safe.length ? safe : plans).filter(p => p !== best)
  const otherStations = []
  const seen = new Set([best.station])
  for (const p of pool) {
    if (seen.has(p.station)) continue
    seen.add(p.station)
    otherStations.push(p)
  }
  const sameStationLater = pool
    .filter(p => p.station === best.station && p.dep !== best.dep)
    .sort((a, b) => a.totalMin - b.totalMin)[0]
  const alternatives = [...otherStations.slice(0, 2), sameStationLater]
    .filter(Boolean)
    .sort(byTotal)
    .slice(0, 3)

  let ret = null
  if (endMin != null) {
    const readyAt = endMin + best.access + ARRIVE_BUFFER
    const backs = []
    for (const t of trainsAt(best.station).filter(t => runsOn(t, dow))) {
      const leg = legOf(t, best.station, ORIGIN_STATION)
      if (leg && leg.dep >= readyAt) backs.push(leg)
    }
    backs.sort((a, b) => a.dep - b.dep)
    if (backs.length) ret = { leg: backs[0], readyAt, next: backs[1] || null }
    else ret = { leg: null, readyAt, next: null }
  }

  return { ok: true, best, alternatives, ret, noBuffer, destRow: destRow || null }
}

// 역산 결과 → 정산서에 그대로 적는 교통비. 화면 안내와 정산 금액이 서로 다른 역을
// 가리키지 않도록, 금액·경로를 여기 한 곳에서만 만든다.
// 운임표에 없는 역이면 null을 돌려 앱이 기존 지역 운임표로 되돌아가게 한다.
function settlementFare(plan) {
  if (!plan || !plan.ok || !plan.best) return null
  const b = plan.best
  if (!b.fare || !Number.isFinite(b.fare.roundTrip) || !Number.isFinite(b.fare.oneWay)) return null
  return {
    station: b.station,
    grade: b.fare.grade,
    oneWay: b.fare.oneWay,
    roundTrip: b.fare.roundTrip,
    transfers: b.transfers,
    via: b.via || [],
    dep: b.dep,
    arr: b.arr,
    access: b.access,
  }
}

// 목적지 좌표가 없을 때(등재 기관도 아니고 장소 검색도 하지 않은 경우) 쓰는 폴백.
// 사용자가 고른 도착역과 역→목적지 이동시간만으로 같은 역산을 돌린다.
function planFromStation({ station, accessMin, startMin, dow, isMS, endMin }) {
  if (!KtxRoute.ready) return { ok: false, reason: 'data' }
  const st = KtxRoute.stations[station]
  if (!st || !KtxRoute.fares[station]) return { ok: false, reason: 'station' }
  return planTrip({
    lat: st.lat, lon: st.lon, startMin, dow, isMS, endMin,
    only: station, access: { [station]: accessMin },
  })
}

// 운임표에 있는 도착역 목록(가나다순). 폴백 화면의 선택지로 쓴다.
function fareStationNames() {
  if (!KtxRoute.ready) return []
  return Object.keys(KtxRoute.fares)
    .filter(n => n !== ORIGIN_STATION && KtxRoute.stations[n])
    .sort((a, b) => a.localeCompare(b, 'ko'))
}

// 같은 목적지로 '전날 이동'이 필요한 경우, 전날 막차 기준 후보를 뽑는다.
function planPreviousDay({ lat, lon, dow, destRow, access }) {
  if (!KtxRoute.ready) return null
  const prevDow = dow == null ? null : (dow + 6) % 7
  const scored = candidateStations(lat, lon)
    .map(s => ({ s, ai: accessInfo(s.name, s.km, destRow, access) }))
    .sort((a, b) => a.ai.min - b.ai.min)
  if (!scored.length) return null
  const { s: st, ai } = scored[0]
  const its = findItineraries(st.name, 1440 + 360, prevDow)
  if (!its.length) return null
  return { station: st.name, access: ai.min, accessSrc: ai.src, options: its.slice(0, 3) }
}

if (typeof module !== 'undefined') {
  module.exports = { KtxRoute, loadRouteData, initRouteData, planTrip, planPreviousDay,
                     planFromStation, fareStationNames, settlementFare,
                     accessMinutes, accessInfo, findDestination, haversineKm, fmtTime, fmtDur,
                     findItineraries, candidateStations, fareOf }
}
