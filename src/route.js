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
const DETOUR_RATIO   = 2.0  // 철도 이동거리가 직선거리의 이 배 이상이면 우회로 본다
const DETOUR_NORTH   = 20   // 환승역이 목적지보다 이만큼 북쪽이면 '올라갔다 내려오는' 경로
const BUS_KMH        = 70   // 시외버스 고속도로 실효속도(정차·감속 포함)
const BUS_ROAD       = 1.25 // 직선거리 → 실제 도로거리 보정계수
const BUS_WAIT       = 20   // 터미널 도착·대기
const BUS_LOCAL      = 30   // 도착 터미널 → 목적지 시내 이동
const BUS_ADVANTAGE  = 45   // 철도보다 이만큼 이상 빨라야 시외버스를 먼저 권한다(추정오차 여유)

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

// 마산 → 환승역 → 도착역이 '종착지보다 위로 올라갔다가 다시 내려오는' 경로인지 판정한다.
// 호남·전남권(여수·순천·목포·광주)과 부산·울산은 마산에서 철도로 가려면 오송·밀양·동대구까지
// 거슬러 올라갔다 되내려와야 해서, 직선거리의 두세 배를 돌게 된다. 이런 구간은 시외버스가 빠르다.
// 두 조건을 모두 만족할 때만 우회로 본다 — 멀리 돌지만 아래로만 가는 경로(광명 경유 등)를
// 잘못 잡지 않기 위해서다.
function detourOf(hub, dest) {
  const st = KtxRoute.stations
  const o = st && st[ORIGIN_STATION], h = st && st[hub], d = st && st[dest]
  if (!o || !h || !d) return null
  const directKm = haversineKm(o.lat, o.lon, d.lat, d.lon)
  if (directKm < 1) return null
  const railKm  = haversineKm(o.lat, o.lon, h.lat, h.lon) + haversineKm(h.lat, h.lon, d.lat, d.lon)
  const ratio   = railKm / directKm
  const northKm = haversineKm(d.lat, d.lon, h.lat, d.lon) * (h.lat > d.lat ? 1 : -1)
  if (ratio < DETOUR_RATIO || northKm < DETOUR_NORTH) return null
  return {
    hub, dest,
    ratio:     Math.round(ratio * 10) / 10,
    railKm:    Math.round(railKm),
    directKm:  Math.round(directKm),
    northKm:   Math.round(northKm),
  }
}

// 마산 → 목적지 시외버스 문 앞 소요시간 추정. 시외버스는 시간표·소요시간 자료가 없어
// 직선거리에 도로 보정계수를 곱한 추정값이다(실측 아님). 전라도처럼 철도가 크게 도는
// 구간은 이 추정만으로도 철도보다 한 시간 이상 빠른 것이 드러난다.
function busEstimate(lat, lon) {
  const o = KtxRoute.stations && KtxRoute.stations[ORIGIN_STATION]
  if (!o) return null
  const directKm = haversineKm(o.lat, o.lon, lat, lon)
  const roadKm   = directKm * BUS_ROAD
  const rideMin  = Math.round(roadKm / BUS_KMH * 60)
  return {
    directKm: Math.round(directKm),
    roadKm:   Math.round(roadKm),
    rideMin,
    waitMin:  BUS_WAIT,
    localMin: BUS_LOCAL,
    totalMin: rideMin + BUS_WAIT + BUS_LOCAL,
    est: true,
  }
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
// 역→목적지 이동시간 출처 우선순위: 직접 입력 > 등재 확인값 > ODsay 대중교통 조회 > 직선거리 추정
function accessInfo(stationName, km, destRow, overrides, transit) {
  const user = overrides && overrides[stationName]
  if (Number.isFinite(user)) return { min: Math.max(0, Math.round(user)), src: 'user' }
  const fixed = destRow && destRow.accessOverride && destRow.accessOverride[stationName]
  if (Number.isFinite(fixed)) return { min: Math.max(0, Math.round(fixed)), src: 'known' }
  const t = transit && transit[stationName]
  if (t && Number.isFinite(t.min)) return { min: Math.max(0, Math.round(t.min)), src: 'transit', route: t }
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
          detour: detourOf(hub, dest),
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

// 추천편 고르기(2026-09-26 지석초이 지시). ① 제때 닿는 직통이 있으면 직통만 본다 — 환승이 조금 늦게
// 출발해도 된다고 오송 환승을 권하면 사람이 실제로 타지 않는다(강북삼성병원: 06:35 직통 서울역이 맞다).
// ② 역마다 제때 닿는 가장 늦은 편을 고른다. ③ 그중 마산역→현장 실제 이동시간이 짧은 역.
// 전날 이동 판정(08:30)은 이렇게 고른 편의 출발시각으로 한다.
function pickBest(list, fareVal) {
  const directs = list.filter(p => p.transfers === 0)
  const pool = directs.length ? directs : list
  const latest = new Map()
  for (const p of pool) {
    const cur = latest.get(p.station)
    if (!cur || p.dep > cur.dep || (p.dep === cur.dep && p.travelMin < cur.travelMin)) latest.set(p.station, p)
  }
  return [...latest.values()].sort((a, b) =>
    a.travelMin - b.travelMin || b.dep - a.dep || a.transfers - b.transfers || fareVal(a) - fareVal(b))[0]
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
function planTrip({ lat, lon, startMin, dow, isMS, endMin, destRow, access, transit, only }) {
  if (!KtxRoute.ready) return { ok: false, reason: 'data' }

  const origin = KtxRoute.stations[ORIGIN_STATION]
  const originKm = haversineKm(lat, lon, origin.lat, origin.lon)
  if (originKm <= NO_TRAIN_KM) {
    return { ok: false, reason: 'near', originKm: Math.round(originKm) }
  }

  // 도착역 고정. 사용자가 폴백 화면에서 직접 고른 역(only)이 1순위, 기관 마스터에 적어 둔
  // railStation이 2순위다. 원주처럼 마산발 직행 시외버스가 없고 철도도 서울까지 올라가야 하는
  // 곳은 역 선택을 계산에 맡기지 않고 기관 행에서 고정한다.
  const pin = only || (destRow && destRow.railStation) || null

  // 후보역마다 접근시간을 먼저 구하고, 목적지에서 너무 먼 역은 버린다.
  // (예: 전주 국민연금공단을 대전역에서 내려 2시간 넘게 버스로 가는 조합을 추천하지 않는다)
  let scored = candidateStations(lat, lon)
    .map(st => ({ st, ai: accessInfo(st.name, st.km, destRow, access, transit) }))
  if (pin) {
    const pinned = scored.filter(x => x.st.name === pin)
    if (pinned.length) scored = pinned
    else {
      const s = KtxRoute.stations[pin]
      if (s && KtxRoute.fares[pin]) {
        const st = { name: pin, km: haversineKm(lat, lon, s.lat, s.lon), ...s }
        scored = [{ st, ai: accessInfo(pin, st.km, destRow, access, transit) }]
      }
    }
  }
  if (!scored.length) return { ok: false, reason: 'no-train', candidates: [] }
  const minAccess = Math.min(...scored.map(x => x.ai.min))
  const usable = scored.filter(x => x.ai.min <= minAccess + ACCESS_TOL)
  const cands = (usable.length ? usable : scored)

  // 우회 경로(환승역이 목적지보다 한참 북쪽)는 추천 대상에서 뺀다. 다만 도착역이 고정돼
  // 있으면 그 선택을 존중해 그대로 쓰고, 화면에만 우회 사실을 알린다.
  const dropDetour = !pin
  const detoursSeen = []

  const collect = buffer => {
    const acc = []
    for (const { st, ai } of cands) {
      const deadline = startMin - ai.min - buffer
      let its = findItineraries(st.name, deadline, dow)
      if (dropDetour) {
        for (const it of its) if (it.detour) detoursSeen.push(it.detour)
        its = its.filter(it => !it.detour)
      }
      if (!its.length) continue
      const fare = fareOf(st.name, isMS)
      for (const it of its.slice(0, 4)) {
        const margin = startMin - ai.min - it.arr
        acc.push({
          station: st.name, stationKm: Math.round(st.km * 10) / 10,
          stationAddr: st.addr, access: ai.min, accessSrc: ai.src, accessRoute: ai.route || null, deadline, fare,
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
    if (detoursSeen.length) {
      // 우회가 아닌 철도 경로가 아예 없는 구간 — 시외버스로 안내한다.
      const d = detoursSeen.reduce((a, b) => (b.ratio < a.ratio ? b : a))
      return { ok: false, reason: 'detour', detour: d, bus: busEstimate(lat, lon),
               candidates: cands.map(c => c.st.name) }
    }
    return { ok: false, reason: 'no-train', candidates: cands.map(c => c.st.name) }
  }

  const fareVal = p => (p.fare ? p.fare.oneWay : Number.MAX_SAFE_INTEGER)
  const byTotal = (a, b) =>
    a.totalMin - b.totalMin ||
    a.travelMin - b.travelMin ||
    a.transfers - b.transfers ||
    fareVal(a) - fareVal(b)
  plans.sort(byTotal)
  const safe = plans.filter(p => p.margin >= MIN_SLACK + ARRIVE_BUFFER)
  const best = pickBest(safe.length ? safe : plans, fareVal)

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

  // 철도 경로가 성립해도 시외버스가 확실히 빠른 구간은 버스를 먼저 권한다. 마산에서
  // 전라도는 철도가 오송까지 올라갔다 내려와, 우회 판정(ratio 2배)에 걸리지 않는 구간도
  // 버스가 한 시간 이상 빠르다. 철도 안내와 기준 운임은 그대로 남겨 둔다 —
  // 실제로 기차를 타는 경우의 정산 근거가 사라지면 안 되기 때문이다.
  // busEstimate는 직선거리 추정이라 '직행 편성이 있는지'를 모른다. 그래서 마산발 직행이
  // 없는 것으로 확인된 기관(noDirectBus)은 배너를 만들지 않는다 — 원주가 그 경우다.
  // 2026-09-25 TAGO 실측: 마산 → 원주·목포·여수·순천·대전복합·동대구 직행 0편.
  const bus = destRow && destRow.noDirectBus ? null : busEstimate(lat, lon)
  const busFaster = bus && bus.totalMin + BUS_ADVANTAGE <= best.travelMin
    ? { ...bus, railMin: best.travelMin, railStation: best.station, railVia: best.via || [],
        savedMin: best.travelMin - bus.totalMin }
    : null

  return { ok: true, best, alternatives, ret, noBuffer, busFaster, destRow: destRow || null }
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
function planPreviousDay({ lat, lon, dow, destRow, access, transit }) {
  if (!KtxRoute.ready) return null
  const prevDow = dow == null ? null : (dow + 6) % 7
  const scored = candidateStations(lat, lon)
    .map(s => ({ s, ai: accessInfo(s.name, s.km, destRow, access, transit) }))
    .sort((a, b) => a.ai.min - b.ai.min)
  if (!scored.length) return null
  const { s: st, ai } = scored[0]
  const its = findItineraries(st.name, 1440 + 360, prevDow).filter(it => !it.detour)
  if (!its.length) return null
  return { station: st.name, access: ai.min, accessSrc: ai.src, options: its.slice(0, 3) }
}

if (typeof module !== 'undefined') {
  module.exports = { KtxRoute, loadRouteData, initRouteData, planTrip, planPreviousDay,
                     planFromStation, fareStationNames, settlementFare,
                     accessMinutes, accessInfo, findDestination, haversineKm, fmtTime, fmtDur, detourOf,
                     busEstimate,
                     findItineraries, candidateStations, fareOf }
}
