// 다녀온 출장(tripStatus='done')에서는 탈 기차 추천을 빼고 정산 기준 운임만 남기는지 검증한다.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadApp() {
  const panel = { className: '', innerHTML: '' }
  const stub = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : stub),
    apply: () => stub,
    set: () => true,
  })
  const document = new Proxy({ getElementById: id => (id === 'routePanel' ? panel : null) }, {
    get: (t, k) => (k in t ? t[k] : stub),
    set: () => true,
  })
  const context = vm.createContext({
    document, window: stub, navigator: { userAgent: '' }, location: { href: '' },
    localStorage: stub, sessionStorage: stub, fetch: () => Promise.resolve(stub),
    setTimeout, clearTimeout, setInterval, clearInterval, console,
  })
  for (const f of ['../src/route.js', '../src/app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), context)
  }
  // state·함수는 const/function 선언이라 global 객체 프로퍼티가 아니다 — 스크립트 스코프에서 꺼낸다.
  const evalIn = code => vm.runInContext(code, context)
  const state = evalIn('state')
  const stubPlan = plan => { context.__plan = plan; evalIn('computeRoutePlan = () => __plan') }
  const render = () => evalIn('renderRoutePanel()')
  return { state, stubPlan, render, panel }
}

const PLAN = {
  ok: true,
  best: {
    station: '동대구', dep: 420, arr: 500, access: 25, accessSrc: 'known',
    margin: 35, tight: false, totalMin: 145, transfers: 0, via: [], wait: null,
    legs: [{ no: 'KTX 102', type: 'KTX', from: '마산', to: '동대구', dep: 420, arr: 500, note: '매일' }],
    fare: { oneWay: 21500, roundTrip: 43000, grade: '일반실' },
  },
  alternatives: [{ station: '동대구', dep: 450, arr: 530, access: 25, margin: 5, tight: true, transfers: 0, via: [] }],
  ret: { leg: { dep: 1080, arr: 1160, no: 'KTX 175' }, next: null },
  noBuffer: false,
}

function render(tripStatus) {
  const app = loadApp()
  Object.assign(app.state, { tripStatus, startTime: '10:00', endTime: '17:00', place: '대구시청' })
  app.stubPlan({ manual: false, dow: 1, dest: { label: '대구시청', proxy: false, row: null }, plan: PLAN })
  app.render()
  return app.panel.innerHTML
}

test('다녀온 출장은 탈 기차·귀가편·대안 추천을 보여주지 않는다', () => {
  const html = render('done')
  assert.ok(!html.includes('이 기차를 타세요'))
  assert.ok(!html.includes('다른 후보'))
  assert.ok(!html.includes('귀가편'))
  assert.ok(!html.includes('KTX 102'))
})

test('다녀온 출장도 도착역과 정산 기준 운임은 그대로 보여준다', () => {
  const html = render('done')
  assert.ok(html.includes('정산 기준'))
  assert.ok(html.includes('동대구'))
  assert.ok(html.includes('43,000'))
  assert.ok(html.includes('역→목적지 이동시간을 직접 넣기'))
})

test('갈 예정 출장은 탈 기차와 귀가편 추천을 그대로 보여준다', () => {
  const html = render('planned')
  assert.ok(html.includes('이 기차를 타세요'))
  assert.ok(html.includes('귀가편'))
  assert.ok(html.includes('다른 후보'))
})

test('다녀온 출장에서 당일 열차가 없으면 전날 후보 열차 대신 정산 안내만 뜬다', () => {
  const app = loadApp()
  Object.assign(app.state, { tripStatus: 'done', startTime: '09:00' })
  app.stubPlan({ manual: false, dow: 1, dest: { label: '서울시청', proxy: false, row: null }, plan: { ok: false, reason: 'late', alternatives: [] } })
  app.render()
  assert.ok(app.panel.innerHTML.includes('전날 이동'))
  assert.ok(!app.panel.innerHTML.includes('전날 이동 후보'))
})

// ── 우회 구간 안내 ───────────────────────────────────────────────────────────
const DETOUR_PLAN = {
  ok: false,
  reason: 'detour',
  detour: { hub: '오송', dest: '여수엑스포', ratio: 4.3, railKm: 398, directKm: 92, northKm: 208 },
}

function renderDetour(place, region) {
  const app = loadApp()
  Object.assign(app.state, { tripStatus: 'planned', startTime: '14:00', place, region: region || '' })
  app.stubPlan({ manual: false, dow: 1, dest: { label: place, proxy: false, row: null }, plan: DETOUR_PLAN })
  app.render()
  return app.panel.innerHTML
}

test('우회 구간은 기차편 대신 시외버스를 안내한다', () => {
  const html = renderDetour('여수시청')
  assert.ok(html.includes('시외버스를 타세요'))
  assert.ok(html.includes('오송'))
  assert.ok(html.includes('4.3배'))
  assert.ok(!html.includes('이 기차를 타세요'))
})

test('우회 구간 요금이 운임표에 없으면 없다고 밝힌다', () => {
  assert.ok(renderDetour('여수시청').includes('아직 운임표에 없어'))
})

test('우회 구간 요금이 운임표에 있으면 그 금액을 보여준다', () => {
  const html = renderDetour('부산진구청', '부산')
  assert.ok(html.includes('19,600원'))
  assert.ok(!html.includes('아직 운임표에 없어'))
})

// ── 시외버스가 빠른 구간 배너 ────────────────────────────────────────────────
const BUS_FASTER = {
  ...PLAN,
  busFaster: { totalMin: 205, railMin: 282, savedMin: 77, directKm: 145, roadKm: 181,
               waitMin: 20, localMin: 30, railStation: '전주', railVia: ['오송'] },
}

function renderBusFaster(tripStatus, place) {
  const app = loadApp()
  Object.assign(app.state, { tripStatus, startTime: '14:00', endTime: '17:00', place, region: '' })
  app.stubPlan({ manual: false, dow: 1, dest: { label: place, proxy: false, row: null }, plan: BUS_FASTER })
  app.render()
  return app.panel.innerHTML
}

test('시외버스가 빠른 구간은 배너로 먼저 알린다', () => {
  const html = renderBusFaster('planned', '국민연금공단')
  assert.ok(html.includes('시외버스가 빠릅니다'))
  assert.ok(html.includes('1시간 17분'), '단축시간이 표시되지 않았다')
  assert.ok(html.indexOf('시외버스가 빠릅니다') < html.indexOf('이 기차를 타세요'), '버스 안내가 기차 안내보다 위에 와야 한다')
})

test('버스가 빨라도 기차 안내와 기준 운임은 지우지 않는다', () => {
  const html = renderBusFaster('planned', '국민연금공단')
  assert.ok(html.includes('이 기차를 타세요'))
  assert.ok(html.includes('43,000원'), '기차 기준 운임이 사라졌다')
  assert.ok(html.includes('기차로 가실 경우'))
})

test('다녀온 출장에서도 버스가 빨랐다는 사실은 알린다', () => {
  const html = renderBusFaster('done', '국민연금공단')
  assert.ok(html.includes('시외버스가 빠릅니다'))
  assert.ok(html.includes('43,000원'))
  assert.ok(!html.includes('이 기차를 타세요'))
})

test('버스 요금이 운임표에 없으면 기차 기준 금액임을 밝힌다', () => {
  assert.ok(renderBusFaster('planned', '국민연금공단').includes('아래 금액은 기차 기준입니다'))
})
