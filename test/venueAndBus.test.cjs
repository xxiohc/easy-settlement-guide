// 2026-09-29 지석초이 제보 묶음: 공문 장소 세부위치 제거·해운대 지역 오판·시외버스 안내(병원 출발·소요시간)·식사비 한도.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadApp() {
  const els = new Map()
  const fakeEl = id => {
    const classes = new Set(['hidden'])
    return { id, innerHTML: '', textContent: '', value: '',
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
        toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : on ? classes.add(c) : classes.delete(c)) },
      querySelectorAll: () => [], querySelector: () => null }
  }
  const getEl = id => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id) }
  const document = { getElementById: getEl, querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {} }
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : stub), apply: () => stub, set: () => true })
  const context = vm.createContext({ document, window: stub, navigator: { userAgent: '' }, location: { href: '' },
    localStorage: stub, sessionStorage: stub, fetch: () => Promise.resolve(stub),
    setTimeout, clearTimeout, setInterval, clearInterval, console })
  for (const f of ['../src/route.js', '../src/app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), context)
  return { evalIn: code => vm.runInContext(code, context), context }
}

test('공문 장소에서 층·강의실·괄호 안내를 떼고 검색할 이름만 남긴다', () => {
  const { evalIn, context } = loadApp()
  const cases = {
    'CFO 아카데미4층2강의실 (2 호선 역삼역1번출구 도곡동방향 도보3분)∎': 'CFO 아카데미',
    '센텀종합병원 14층 강당 (부산광역시 수영구 수영로 679번길': '센텀종합병원',
    '부산 해운대구 해운대해변로298번길 24, 팔레드시즈': '팔레드시즈',
    '한국보건복지인재원 대강당': '한국보건복지인재원',
  }
  for (const [raw, want] of Object.entries(cases)) {
    context.__v = raw
    assert.equal(evalIn('venueSearchName(__v)'), want, raw)
  }
})

test('해운대구는 "대구"가 들어 있어도 부산으로 판정한다', () => {
  const { evalIn, context } = loadApp()
  context.__v = '부산 해운대구 해운대해변로298번길 24, 팔레드시즈'
  assert.equal(evalIn('matchRegion(__v)'), '부산')
  context.__v = '대구광역시 중구'
  assert.equal(evalIn('matchRegion(__v)'), '동대구')
})

test('시작시각이 날짜와 종료일 사이에 낀 기간도 1박2일로 읽는다', () => {
  const { evalIn, context } = loadApp()
  context.__t = '제 목 2026 전국대학병원 재무부서장협의회 추계세미나 개최의 건 - 다 음 - '
    + '가. 기 간 : 2026.11.05.(목), 14시~11.06.(금) 나. 장 소 : 부산 해운대구 해운대해변로298번길 24, 팔레드시즈 다. 참가회비 : 200,000원'
  const m = evalIn('parseDocMeta("재협.pdf", __t)')
  assert.equal(m.startDate, '2026-11-05')
  assert.equal(m.endDate, '2026-11-06')
  assert.equal(m.nights, 1)
})

test('식사비 한도 문구는 rates.json 금액을 따른다', () => {
  const { evalIn } = loadApp()
  assert.equal(evalIn('mealCapText()'), '1만원 이내')
  assert.equal(evalIn('MEAL_CAP = 12000, mealCapText()'), '12,000원 이내')
})

test('시외버스 안내는 병원 출발 시각과 편별 소요시간을 함께 보인다', () => {
  const { evalIn, context } = loadApp()
  context.__plan = {
    originMin: 10, dest: null,
    best: { dep: 12 * 60 + 10, access: 20, deps: [11 * 60 + 49, 12 * 60 + 10],
      r: { terminal: '부산서부터미널(사상)', durationMin: 50, fare: 4300, fareNote: '', lat: 35.16, lon: 128.98 } },
  }
  evalIn('state.startTime = "14:00"; state.startDate = "2026-09-29"')
  const html = evalIn('busVerdictHtml(__plan, 14 * 60)')
  assert.match(html, /삼성창원병원 출발/)
  assert.match(html, /12:00/)                     // 12:10 버스 - 병원→터미널 10분
  assert.match(html, /<th>소요<\/th>/)             // 시간표에 소요 칸
  assert.match(html, /50분/)
  assert.match(html, /전날 이동이 아니에요/)
})
