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
