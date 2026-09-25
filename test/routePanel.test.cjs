// 다녀온 출장(tripStatus='done')에서는 탈 기차 추천을 빼고 정산 기준 운임만 남기는지 검증한다.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadApp() {
  const panel = { className: '', innerHTML: '' }
  const form  = { className: '', innerHTML: '' }
  const stub = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : stub),
    apply: () => stub,
    set: () => true,
  })
  const els = { routePanel: panel, tripFormWrap: form }
  const document = new Proxy({ getElementById: id => els[id] || null }, {
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
  const renderForm = () => evalIn('renderTripFormPreview()')
  return { state, stubPlan, render, renderForm, panel, form, evalIn }
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

// ── 시외버스 구간의 출발지 (2026-09-25) ──────────────────────────────────────
// 부산·울산·전주처럼 버스로 가는 구간은 마산역이 아니라 마산시외버스터미널에서 탄다.
test('시외버스 구간 안내는 마산시외버스터미널에서 출발한다고 적는다', () => {
  const app = loadApp()
  Object.assign(app.state, { tripStatus: 'planned', startTime: '10:00', endTime: '17:00',
                             place: '부산교육원', region: '부산' })
  app.stubPlan({ skip: 'bus', busFare: { label: '부산', bus: 19600 } })
  app.render()
  assert.ok(app.panel.innerHTML.includes('마산시외버스터미널'), '출발 터미널이 안내에 없다')
  assert.ok(!app.panel.innerHTML.includes('마산역'), '버스 구간에 마산역이 남아 있다')
})

test('버스 우세 배너의 출발지도 마산시외버스터미널이다', () => {
  assert.ok(renderBusFaster('planned', '국민연금공단').includes('마산시외버스터미널'))
})

test('신청서 교통비 행은 버스 구간이면 마산시외버스터미널 ↔ 목적지로 적는다', () => {
  const app = loadApp()
  Object.assign(app.state, { tripStatus: 'planned', startTime: '10:00', endTime: '17:00',
                             place: '부산교육원', region: '부산', days: 1, nights: 0 })
  app.stubPlan({ skip: 'bus', busFare: { label: '부산', bus: 19600 } })
  app.renderForm()
  const html = app.form.innerHTML
  assert.ok(html.includes('마산시외버스터미널 → 부산'), '가는 편 출발지가 터미널이 아니다')
  assert.ok(html.includes('부산 → 마산시외버스터미널'), '오는 편 도착지가 터미널이 아니다')
})

test('KTX 구간 신청서 행은 그대로 마산 기준을 쓴다', () => {
  const app = loadApp()
  Object.assign(app.state, { tripStatus: 'planned', startTime: '10:00', endTime: '17:00',
                             place: '대구시청', region: '대구', days: 1, nights: 0 })
  app.stubPlan({ skip: 'online' })
  app.renderForm()
  assert.ok(app.form.innerHTML.includes('마산 → 동대구역'), 'KTX 구간 표기가 바뀌었다')
  assert.ok(!app.form.innerHTML.includes('마산시외버스터미널'))
})


// ── 시외버스 고정 구간: 목포·여수·순천 (2026-09-25 지석초이 지시) ─────────────
// 철도가 오송까지 올라갔다 되내려오는 구간이라 기차 역산을 아예 하지 않는다.
function busOnlyApp(place, region, fares) {
  const app = loadApp()
  Object.assign(app.state, { tripStatus: 'planned', startTime: '10:00', endTime: '17:00',
                             place, region: region || '', days: 1, nights: 0 })
  if (fares) { app.evalIn('KtxRoute').fares = fares }
  return app
}

test('목포·여수·순천은 computeRoutePlan 단계에서 시외버스로 고정된다', () => {
  for (const [place, label] of [['목포시청', '목포'], ['여수시청', '여수'], ['순천대학교', '순천'], ['광양보건소', '순천']]) {
    const app = busOnlyApp(place)
    const r = app.evalIn('computeRoutePlan()')
    assert.strictEqual(r.skip, 'busonly', `${place} 가 버스 고정으로 잡히지 않았다`)
    assert.strictEqual(r.busOnly.label, label)
  }
})

test('시외버스 고정 구간 안내는 기차를 왜 뺐는지 밝힌다', () => {
  const app = busOnlyApp('목포시청', '목포',
    { 목포: { station: '목포', path: ['마산', '오송', '목포'], transfers: 1, roundTrip: 127600 } })
  app.render()
  const html = app.panel.innerHTML
  assert.ok(html.includes('시외버스로 갑니다'), '버스 고정 안내가 없다')
  assert.ok(html.includes('기차는 돌아가는 경로라 제외'), '제외 사유가 없다')
  assert.ok(html.includes('마산 → 오송 → 목포'), '운임표 철도 경로가 없다')
  assert.ok(html.includes('127,600원'), '철도 왕복 운임이 없다')
  assert.ok(html.includes('마산시외버스터미널'), '출발 터미널이 없다')
  assert.ok(!html.includes('이 기차를 타세요'), '기차편 추천이 남아 있다')
})

test('시외버스 고정 구간은 요금이 운임표에 없다고 밝힌다', () => {
  const app = busOnlyApp('여수시청', '여수')
  app.render()
  assert.ok(app.panel.innerHTML.includes('아직 운임표에 없어'))
})

test('시외버스 고정 구간 신청서는 터미널 ↔ 목적지 왕복 2행으로 적는다', () => {
  const app = busOnlyApp('순천대학교', '순천')
  app.renderForm()
  const html = app.form.innerHTML
  assert.ok(html.includes('마산시외버스터미널 → 순천'), '가는 편 행이 없다')
  assert.ok(html.includes('순천 → 마산시외버스터미널'), '오는 편 행이 없다')
})

test('부산·울산·전주 등 기존 버스 구간과 KTX 구간은 그대로다', () => {
  const app = loadApp()
  Object.assign(app.state, { tripStatus: 'planned', startTime: '10:00', place: '부산교육원', region: '부산' })
  const r = app.evalIn('computeRoutePlan()')
  assert.strictEqual(r.skip, 'bus', '부산이 운임표 버스 구간에서 벗어났다')
  const app2 = loadApp()
  Object.assign(app2.state, { tripStatus: 'planned', startTime: '10:00', place: '대구시청', region: '대구' })
  assert.strictEqual(app2.evalIn('computeRoutePlan()').skip, 'data', 'KTX 구간이 버스로 새어 나갔다')
})
