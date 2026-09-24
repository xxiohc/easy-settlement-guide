// ── KTX 역산 경로 계산 ────────────────────────────────────────────────────────
// 시간표·운임·역 좌표를 앱 내부 정적 JSON에서만 읽는다. 외부 길찾기 API를 쓰지 않으므로
// 페이지를 공유받은 사람도 같은 결과를 본다.
// 모든 시각은 00:00부터의 '분'이다. 1440 이상은 익일.

const ORIGIN_STATION = '마산'
const TRANSFER_MIN   = 20   // 환승 최소 여유 (같은 역 승강장 이동)
const ARRIVE_BUFFER  = 10   // 도착역→목적지 이동 뒤 남겨 두는 여유
const ACCESS_FIXED   = 12   // 역 밖 도보·대기·환승 고정 시간
const ACCESS_KMH     = 20   // 직선거리 기준 도심 대중교통 실효속도
const ACCESS_FAR_KMH = 30   // 15km를 넘는 구간(시외버스·광역철도) 실효속도
const TIGHT_SLACK    = 20   // 이보다 여유가 적으면 '빠듯함'으로 표시
const MIN_SLACK      = 5    // 추천편이 지켜야 할 최소 여유 (ARRIVE_BUFFER와 별도)
const NO_TRAIN_KM    = 25   // 마산역에서 이 거리 안이면 기차가 필요 없다

const KtxRoute = {
  timetable: null,
  stations: null,
  fares: null,
  ready: false,
}

async function loadRouteData() {
  try {
    const [tt, st, fa] = await Promise.all([
      fetch('./data/ktx_timetable.json').then(r => r.json()),
      fetch('./data/ktx_stations.json').then(r => r.json()),
      fetch('./data/ktx_fares_masan.json').then(r => r.json()),
    ])
    KtxRoute.timetable = tt
    KtxRoute.stations  = st.stations
    KtxRoute.fares     = Object.fromEntries((fa.fares || []).map(f => [f.station, f]))
    KtxRoute.ready = true
  } catch {
    KtxRoute.ready = false
  }
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
  return KtxRoute.timetable.trains.filter(t => t.stops.some(s => s.s === station))
}

function legOf(train, from, to) {
  const i = train.stops.findIndex(s => s.s === from)
  const j = train.stops.findIndex(s => s.s === to)
  if (i < 0 || j < 0 || j <= i) return null
  return {
    no: train.no, type: train.type, days: train.days, note: train.note,
    from, to, dep: train.stops[i].t, arr: train.stops[j].t,
  }
}

function runsOn(train, dow) {
  return dow == null || train.days.includes(dow)
}

// 마산 → dest, deadline 이전 도착. 직통 우선, 없으면 1회 환승.
function findItineraries(dest, deadline, dow) {
  const out = []
  const fromOrigin = trainsAt(ORIGIN_STATION).filter(t => runsOn(t, dow))

  for (const t of fromOrigin) {
    const leg = legOf(t, ORIGIN_STATION, dest)
    if (leg && leg.arr <= deadline) {
      out.push({ legs: [leg], transfers: 0, dep: leg.dep, arr: leg.arr, via: [] })
    }
  }
  if (out.length) return out.sort((a, b) => b.dep - a.dep)

  const toDest = trainsAt(dest).filter(t => runsOn(t, dow))
  for (const a of fromOrigin) {
    const aStops = a.stops
    const oi = aStops.findIndex(s => s.s === ORIGIN_STATION)
    for (let i = oi + 1; i < aStops.length; i++) {
      const hub = aStops[i].s
      if (hub === dest) continue
      for (const b of toDest) {
        const leg2 = legOf(b, hub, dest)
        if (!leg2 || leg2.arr > deadline) continue
        if (leg2.dep < aStops[i].t + TRANSFER_MIN) continue
        const leg1 = legOf(a, ORIGIN_STATION, hub)
        out.push({
          legs: [leg1, leg2], transfers: 1, via: [hub],
          dep: leg1.dep, arr: leg2.arr,
          wait: leg2.dep - leg1.arr,
        })
      }
    }
  }
  // 같은 출발편·같은 환승역이면 가장 빨리 도착하는 조합만 남긴다
  const best = new Map()
  for (const it of out) {
    const key = `${it.legs[0].no}|${it.via[0]}`
    const cur = best.get(key)
    if (!cur || it.arr < cur.arr) best.set(key, it)
  }
  return [...best.values()].sort((a, b) => b.dep - a.dep || a.transfers - b.transfers)
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

function candidateStations(lat, lon, limit = 8) {
  return Object.entries(KtxRoute.stations)
    .map(([name, s]) => ({ name, km: haversineKm(lat, lon, s.lat, s.lon), ...s }))
    .filter(s => s.name !== ORIGIN_STATION && KtxRoute.fares[s.name])
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
}

// 출장 시작시각(startMin)에 목적지에 도착하도록 마산역 출발편을 역산한다.
function planTrip({ lat, lon, startMin, dow, isMS, endMin }) {
  if (!KtxRoute.ready) return { ok: false, reason: 'data' }

  const origin = KtxRoute.stations[ORIGIN_STATION]
  const originKm = haversineKm(lat, lon, origin.lat, origin.lon)
  if (originKm <= NO_TRAIN_KM) {
    return { ok: false, reason: 'near', originKm: Math.round(originKm) }
  }

  const collect = buffer => {
    const acc = []
    for (const st of candidateStations(lat, lon)) {
      const access = accessMinutes(st.km)
      const deadline = startMin - access - buffer
      const its = findItineraries(st.name, deadline, dow)
      if (!its.length) continue
      const fare = fareOf(st.name, isMS)
      for (const it of its.slice(0, 3)) {
        const margin = startMin - access - it.arr
        acc.push({
          station: st.name, stationKm: Math.round(st.km * 10) / 10,
          stationAddr: st.addr, access, deadline, fare,
          margin,
          slack: margin - ARRIVE_BUFFER,
          tight: margin < TIGHT_SLACK + ARRIVE_BUFFER,
          totalMin: startMin - it.dep,
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
    return { ok: false, reason: 'no-train', candidates: candidateStations(lat, lon).map(s => s.name) }
  }

  // 문 앞 총 소요시간이 짧은 순. 단 여유가 MIN_SLACK 미만인 편은 추천에서 뺀다.
  const byTotal = (a, b) =>
    a.totalMin - b.totalMin || a.transfers - b.transfers || a.access - b.access
  plans.sort(byTotal)
  const safe = plans.filter(p => p.margin >= MIN_SLACK + ARRIVE_BUFFER)
  const best = (safe.length ? safe : plans)[0]
  const sameAsBest = p => p.station === best.station && p.legs[0].no === best.legs[0].no
  const latest = plans.filter(p => !sameAsBest(p)).sort((a, b) => a.totalMin - b.totalMin)[0]
  const rest = plans
    .filter(p => !sameAsBest(p) && p !== latest)
    .sort((a, b) => b.slack - a.slack)
  const alternatives = [latest, ...rest].filter(Boolean).slice(0, 3)

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

  return { ok: true, best, alternatives, ret, noBuffer }
}

// 같은 목적지로 '전날 이동'이 필요한 경우, 전날 막차 기준 후보를 뽑는다.
function planPreviousDay({ lat, lon, dow }) {
  if (!KtxRoute.ready) return null
  const prevDow = dow == null ? null : (dow + 6) % 7
  const st = candidateStations(lat, lon)[0]
  if (!st) return null
  const its = findItineraries(st.name, 1440 + 360, prevDow)
  if (!its.length) return null
  return { station: st.name, access: accessMinutes(st.km), options: its.slice(0, 3) }
}

if (typeof module !== 'undefined') {
  module.exports = { KtxRoute, loadRouteData, planTrip, planPreviousDay, accessMinutes,
                     haversineKm, fmtTime, fmtDur, findItineraries, candidateStations, fareOf }
}
