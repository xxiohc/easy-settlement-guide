// 역산 경로 계산 검증. 앱 폴더에서 `node --test tools/test_route.js`
// 판정이 바뀌면 안 되는 케이스를 고정해 둔다 — 특히 '가까운 역'과 '총 소요시간이 짧은 역'이
// 엇갈리는 삼성서울병원(수서)·서울지방국세청(서울) 두 반례.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const R = require('../src/route.js')

const APP = path.resolve(__dirname, '..')
const rd = f => JSON.parse(fs.readFileSync(path.join(APP, 'data', f), 'utf8'))
R.initRouteData(rd('ktx_timetable.json'), rd('ktx_stations.json'),
                rd('ktx_fares_masan.json'), rd('destinations.json'))

const THU = 3
function planFor(name, startMin = 14 * 60, extra = {}) {
  const d = R.findDestination(name)
  assert.ok(d, `${name} 이 destinations.json 에 없다`)
  return R.planTrip({ lat: d.lat, lon: d.lon, startMin, dow: THU, isMS: false, destRow: d, ...extra })
}

test('등재 기관을 이름·별칭으로 찾는다', () => {
  assert.equal(R.findDestination('삼성서울병원').name, '삼성서울병원')
  assert.equal(R.findDestination('심평원').name, '건강보험심사평가원')
  assert.equal(R.findDestination('국민건강보험공단 원주 본부').name, '국민건강보험공단')
  assert.equal(R.findDestination('없는기관이름입니다'), null)
})

test('삼성서울병원은 서울역이 아니라 수서역으로 간다', () => {
  const p = planFor('삼성서울병원')
  assert.ok(p.ok)
  assert.equal(p.best.station, '수서')
  // 서울역보다 현장 도착이 이르기 때문에 이긴 것이어야 한다(운임·거리 때문이 아니라)
  const seoul = p.alternatives.find(a => a.station === '서울')
  assert.ok(seoul, '서울역이 차선으로 함께 보여야 한다')
  assert.ok(p.best.arr + p.best.access <= seoul.arr + seoul.access)
})

test('서울지방국세청은 수서역이 아니라 서울역으로 간다', () => {
  const p = planFor('서울지방국세청')
  assert.ok(p.ok)
  assert.equal(p.best.station, '서울')
  assert.equal(p.best.transfers, 0)
})

test('접근시간이 확인값이면 추정으로 표시하지 않는다', () => {
  assert.equal(planFor('삼성서울병원').best.accessSrc, 'known')
  assert.equal(planFor('서울지방국세청').best.accessSrc, 'est')
})

test('접근시간이 과도하게 먼 역은 추천하지 않는다', () => {
  // 전주 국민연금공단을 대전역에서 내려 2시간 넘게 버스로 가는 조합이 나오면 안 된다
  const p = planFor('국민연금공단')
  assert.ok(p.ok)
  assert.equal(p.best.station, '전주')
  assert.ok(p.best.access <= 60)
})

test('세종 기관은 BRT 확인값으로 계산한다', () => {
  const p = planFor('보건복지부')
  assert.ok(p.ok)
  assert.ok(['오송', '대전'].includes(p.best.station))
  assert.equal(p.best.accessSrc, 'known')
})

test('추천편은 시작시각 전에 현장에 닿는다', () => {
  for (const n of ['삼성서울병원', '서울지방국세청', '보건복지부', '질병관리청', '국민연금공단']) {
    const p = planFor(n)
    assert.ok(p.ok, n)
    assert.ok(p.best.arr + p.best.access <= 14 * 60, `${n}: 시작시각을 넘겨 도착`)
    assert.ok(p.best.margin >= 0, n)
  }
})

test('직통이 있어도 환승편을 함께 본다', () => {
  // 마산→수서 직통은 하루 5편뿐이라, 환승을 보지 않으면 수서는 후보에서 사라진다
  const its = R.findItineraries('수서', 14 * 60 - 25, THU)
  assert.ok(its.some(i => i.transfers === 1), '환승편이 후보에 없다')
  assert.ok(its.some(i => i.transfers === 0), '직통편이 후보에 없다')
  assert.ok(its[0].dep >= its[its.length - 1].dep, '출발 늦은 순 정렬이 아니다')
})

test('사용자가 역과 이동시간을 직접 넣으면 그 역으로 계산한다', () => {
  const p = planFor('서울지방국세청', 14 * 60, { only: '광명', access: { 광명: 45 } })
  assert.ok(p.ok)
  assert.equal(p.best.station, '광명')
  assert.equal(p.best.access, 45)
  assert.equal(p.best.accessSrc, 'user')
})

test('사용자 입력이 등재 확인값보다 우선한다', () => {
  const p = planFor('삼성서울병원', 14 * 60, { access: { 수서: 10 } })
  assert.equal(p.best.station, '수서')
  assert.equal(p.best.access, 10)
  assert.equal(p.best.accessSrc, 'user')
})

test('차선안은 같은 열차를 역 이름만 바꿔 되풀이하지 않는다', () => {
  const p = planFor('삼성서울병원')
  const keys = [p.best, ...p.alternatives].map(x => `${x.station}|${x.dep}`)
  assert.equal(new Set(keys).size, keys.length)
})

test('마산 인근은 기차 대상이 아니다', () => {
  const p = planFor('삼성창원병원')
  assert.equal(p.ok, false)
  assert.equal(p.reason, 'near')
})

test('귀가편은 종료시각 이후 편으로 잡는다', () => {
  const p = planFor('서울지방국세청', 14 * 60, { endMin: 17 * 60 })
  assert.ok(p.ret && p.ret.leg)
  assert.ok(p.ret.leg.dep >= 17 * 60 + p.best.access)
})

// ── 정산서 교통비 연동 ───────────────────────────────────────────────────────
// 역산이 수서역을 고르는데 정산서에는 서울역 운임이 적히면 가장 큰 사고다.
// settlementFare 가 화면 안내와 같은 역·같은 금액을 내는지 고정한다.
const RATES = rd('rates.json')
const regionFare = kw => RATES.fareTable.find(r => r.keywords.some(k => kw.includes(k)))

test('정산 교통비는 역산이 고른 역의 운임을 쓴다 (삼성서울병원 → 수서)', () => {
  const f = R.settlementFare(planFor('삼성서울병원'))
  assert.ok(f)
  assert.equal(f.station, '수서')
  assert.equal(f.oneWay, 47200)
  assert.equal(f.roundTrip, 94400)
  assert.equal(f.roundTrip, f.oneWay * 2)
  // 지역 운임표만 보던 기존 방식은 '서울'로 잡혀 97,200원이 나왔다 — 2,800원 과다.
  assert.equal(regionFare('서울').ktxNormal, 97200)
  assert.ok(f.roundTrip < regionFare('서울').ktxNormal)
})

test('정산 교통비는 서울역 건에서 서울역 운임 그대로다 (서울지방국세청)', () => {
  const f = R.settlementFare(planFor('서울지방국세청'))
  assert.ok(f)
  assert.equal(f.station, '서울')
  assert.equal(f.roundTrip, 97200)
  assert.equal(f.roundTrip, regionFare('서울').ktxNormal)
  assert.equal(f.transfers, 0)
})

test('특실(의료원장 동행) 지정 시 특실 운임으로 정산된다', () => {
  const f = R.settlementFare(planFor('서울지방국세청', 14 * 60, { isMS: true }))
  assert.equal(f.grade, '특실')
  assert.equal(f.roundTrip, 141000)
})

test('환승편이 잡히면 경유역이 정산 경로에 남는다', () => {
  const f = R.settlementFare(planFor('삼성서울병원'))
  if (f.transfers > 0) assert.ok(f.via.length > 0, '환승인데 경유역이 비어 있다')
})

test('역산이 실패하면 정산 교통비는 null이다 (기존 운임표로 되돌아간다)', () => {
  assert.equal(R.settlementFare(null), null)
  assert.equal(R.settlementFare({ ok: false, reason: 'no-train' }), null)
})

test('rates.json 동대구 왕복은 76,000원이 아니라 21,400원이다', () => {
  assert.equal(regionFare('대구').ktxNormal, 21400)
  assert.equal(regionFare('대구').oneWayNormal, 10700)
})

// ── 전날 이동 판정 고정 케이스 ────────────────────────────────────────────────
// 판정 기준은 하나다: 마산역 역산 출발이 정상 출근시각(08:30)보다 이른가.
// 실제 목적지 6곳 × 4갈래(자동 인정·자동 미인정·당일열차 없음·경계)를 고정해 둔다.
const WORK_START_MIN = 8 * 60 + 30
const prevDayCases = [
  // [목적지, 시작시각(분), 기대 판정]  judged: 'yes' | 'no' | 'forced'
  ['삼성서울병원',        13 * 60, 'yes'],    // 수서 07:33 — 12시 기준이면 미인정이던 구간
  ['삼성서울병원',        14 * 60, 'no'],     // 수서 09:21
  ['서울지방국세청',       9 * 60, 'yes'],    // 서울 04:59
  ['서울지방국세청',      13 * 60, 'no'],     // 서울 09:21 — 서울인데도 미인정
  ['건강보험심사평가원',   9 * 60, 'forced'], // 원주 — 당일 도착 열차 없음
  ['국민건강보험공단',    10 * 60, 'forced'], // 원주 — 당일 도착 열차 없음
  ['대한병원협회',        13 * 60, 'yes'],    // 용산 07:33
  ['한국보건복지인재원',  13 * 60, 'no'],     // 오송 09:21
]

for (const [name, startMin, judged] of prevDayCases) {
  test(`전날 이동 판정: ${name} ${R.fmtTime(startMin)} 시작 → ${judged}`, () => {
    const p = planFor(name, startMin)
    if (judged === 'forced') {
      assert.equal(p.ok, false)
      assert.equal(p.reason, 'no-train')
      return
    }
    assert.ok(p.ok, `${name} 역산이 성립해야 한다`)
    assert.equal(p.best.dep < WORK_START_MIN, judged === 'yes',
      `마산역 ${R.fmtTime(p.best.dep)} 출발 — 08:30 기준 판정이 바뀌었다`)
  })
}

test('08:30 경계에 걸치는 마산역 상행편은 없다 (판정이 흔들릴 여지 없음)', () => {
  const deps = new Set()
  for (const [name, startMin] of prevDayCases) {
    const p = planFor(name, startMin)
    if (p.ok) deps.add(p.best.dep)
  }
  for (const d of deps) {
    assert.ok(Math.abs(d - WORK_START_MIN) > 30,
      `마산역 ${R.fmtTime(d)} 출발이 08:30 경계 30분 안에 들어왔다 — 판정 근거를 다시 봐야 한다`)
  }
})

// ── 우회 경로 차단 ───────────────────────────────────────────────────────────
// 마산에서 호남·전남권은 철도로 가려면 오송까지 올라갔다 되내려와야 한다. 직선의 두 배를
// 넘게 도는 이런 구간은 추천하지 않고 시외버스로 돌린다(2026-09-25 지석초이 지시).
const AT = { 여수시청: [34.760, 127.662], 순천시청: [34.950, 127.487], 광주시청: [35.160, 126.851] }
function planAt(name, startMin = 14 * 60, extra = {}) {
  const [lat, lon] = AT[name]
  return R.planTrip({ lat, lon, startMin, dow: THU, isMS: false, ...extra })
}

test('오송까지 올라갔다 내려오는 경로는 우회로 판정한다', () => {
  const d = R.detourOf('오송', '여수엑스포')
  assert.ok(d)
  assert.ok(d.ratio >= 4)
  assert.ok(d.northKm > 200)
})

test('정상 환승(동대구→경주·밀양→부산)은 우회로 보지 않는다', () => {
  assert.equal(R.detourOf('동대구', '경주'), null)
  assert.equal(R.detourOf('밀양', '부산'), null)
  assert.equal(R.detourOf('오송', '익산'), null)
})

test('여수·순천은 기차를 추천하지 않고 우회 사유를 돌려준다', () => {
  for (const name of ['여수시청', '순천시청']) {
    const p = planAt(name)
    assert.equal(p.ok, false, `${name} 에 기차편이 추천됐다`)
    assert.equal(p.reason, 'detour')
    assert.equal(p.detour.hub, '오송')
    assert.ok(p.detour.railKm > p.detour.directKm * 2)
  }
})

test('우회 구간이어도 사용자가 도착역을 직접 고르면 그 역으로 계산한다', () => {
  const p = planAt('여수시청', 14 * 60, { only: '여수엑스포', access: { 여수엑스포: 20 } })
  assert.ok(p.ok)
  assert.equal(p.best.station, '여수엑스포')
  assert.ok(p.best.detour, '직접 지정한 우회 경로에는 경고용 detour 정보가 붙어야 한다')
})

test('우회 판정이 기존 추천을 건드리지 않는다 (수서·서울·포항)', () => {
  assert.equal(planFor('삼성서울병원').best.station, '수서')
  assert.equal(planFor('서울지방국세청').best.station, '서울')
})
