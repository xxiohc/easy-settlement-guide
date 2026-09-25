// 전날 이동 판정 4갈래를 화면 로직까지 포함해 검증한다.
// 기준은 '마산역 역산 출발 < 출근시각 08:30' 하나다(2026-09-25 서울·12시 기준 폐기).
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function fakeEl(id) {
  const classes = new Set(['hidden'])
  return {
    id,
    innerHTML: '',
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
      toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : on ? classes.add(c) : classes.delete(c)),
    },
    querySelectorAll: () => [],
    querySelector: () => null,
  }
}

function loadApp() {
  const els = new Map()
  const getEl = id => {
    if (!els.has(id)) els.set(id, fakeEl(id))
    return els.get(id)
  }
  const document = {
    getElementById: getEl,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
  }
  const stub = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : stub),
    apply: () => stub,
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
  const evalIn = code => vm.runInContext(code, context)
  return {
    state: evalIn('state'),
    stubPlan: plan => { context.__plan = plan; evalIn('computeRoutePlan = () => __plan') },
    prepare: () => evalIn('prepareCard8()'),
    setYN: (f, v) => { context.__f = f; context.__v = v; evalIn('setYN(__f, __v)') },
    el: getEl,
  }
}

function run(plan, over = {}) {
  const app = loadApp()
  Object.assign(app.state, {
    startTime: '13:00', endTime: '17:00', region: '서울', place: '삼성서울병원',
    days: 1, nights: 0, prevDayMove: null, isShortDayTrip: null, ...over,
  })
  app.stubPlan(plan)
  app.prepare()
  return app
}

const planAt = dep => ({ manual: false, dow: 3, dest: {}, plan: { ok: true, best: { dep, station: '수서' }, alternatives: [], ret: null } })

test('① 역산 출발이 08:30보다 이르면 전날 이동을 자동 인정한다', () => {
  const app = run(planAt(7 * 60 + 33))
  assert.equal(app.state.prevDayMove, true)
  assert.equal(app.el('field-daytrip').classList.contains('hidden'), false)
  assert.match(app.el('daytrip-auto').innerHTML, /07:33/)
})

test('② 역산 출발이 08:30 이후면 자동 미인정한다', () => {
  const app = run(planAt(9 * 60 + 21))
  assert.equal(app.state.prevDayMove, false)
  assert.equal(app.el('field-daytrip').classList.contains('hidden'), false)
  assert.match(app.el('daytrip-auto').innerHTML, /09:21/)
})

test('③ 당일 도착 열차가 없으면 묻지 않고 전날 이동으로 확정한다', () => {
  const app = run({ manual: false, dow: 3, dest: {}, plan: { ok: false, reason: 'no-train' } },
                  { region: '원주', place: '건강보험심사평가원' })
  assert.equal(app.state.prevDayMove, true)
  assert.equal(app.el('field-daytrip').classList.contains('hidden'), true)
})

test('④ 역산이 안 되는 구간(시외버스·제주)은 08:30 기준으로 직접 묻는다', () => {
  const app = run({ skip: 'bus', busFare: { label: '부산', bus: 20000 } },
                  { region: '부산', place: '부산시청' })
  assert.equal(app.state.prevDayMove, null)
  assert.equal(app.el('field-daytrip').classList.contains('hidden'), false)
  assert.match(app.el('daytrip-auto').innerHTML, /08:30/)
})

test('마산역 인근 구간은 전날 이동이 성립하지 않아 질문을 숨긴다', () => {
  const app = run({ manual: false, dow: 3, dest: {}, plan: { ok: false, reason: 'near', originKm: 12 } },
                  { region: '창원', place: '창원시청' })
  assert.equal(app.state.prevDayMove, false)
  assert.equal(app.el('field-daytrip').classList.contains('hidden'), true)
})

test('비서울 출장도 판정 대상이다 — 지역 게이트가 남아 있지 않다', () => {
  const app = run(planAt(6 * 60 + 35), { region: '원주', place: '건강보험심사평가원' })
  assert.equal(app.state.isSeoul, false)
  assert.equal(app.state.prevDayMove, true)
  assert.equal(app.el('field-daytrip').classList.contains('hidden'), false)
})

test('전날 이동이 인정되면 8시간 이하 당일 출장 질문은 뜨지 않는다', () => {
  const app = run(planAt(4 * 60 + 59), { region: '부산', place: '부산시청', nights: 0 })
  assert.equal(app.state.prevDayMove, true)
  assert.equal(app.el('field-shortdaytrip').classList.contains('hidden'), true)
  assert.equal(app.state.isShortDayTrip, null)
})

test('수동 답이 전날 이동으로 바뀌면 8시간 질문과 답을 걷어낸다', () => {
  const app = run({ skip: 'bus', busFare: { label: '부산', bus: 20000 } }, { region: '부산', place: '부산시청' })
  app.el('field-shortdaytrip').classList.remove('hidden')
  app.setYN('isShortDayTrip', false)
  app.setYN('prevDayMove', true)
  assert.equal(app.el('field-shortdaytrip').classList.contains('hidden'), true)
  assert.equal(app.state.isShortDayTrip, null)
})
