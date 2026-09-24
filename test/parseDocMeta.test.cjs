// 공문 파싱 회귀 테스트. src/app.js는 브라우저용 클래식 스크립트라
// DOM을 흉내 낸 vm 컨텍스트에 통째로 올린 뒤 parseDocMeta만 꺼내 쓴다.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadApp() {
  const stub = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : stub),
    apply: () => stub,
    set: () => true,
  })
  const context = vm.createContext({
    document: stub, window: stub, navigator: { userAgent: '' }, location: { href: '' },
    localStorage: stub, sessionStorage: stub, fetch: () => Promise.resolve(stub),
    setTimeout, clearTimeout, setInterval, clearInterval, console,
  })
  const src = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8')
  vm.runInContext(src, context)
  return context
}

const app = loadApp()

// 대한간호협회 온라인 보수교육 안내 공문(테스트공문_업로드함/대한간호협회 교육 공문.png)의
// 표를 OCR이 읽어낸 모양 — 교육비 헤더 아래 등록,NE회원 / 미등록회원으로 갈리고
// 금액은 프로그램 행마다 따로 있다.
const 간호협회공문 = `대한간호협회 100주년
수 신 수신자 참조
경 유
제 목 대한간호협회 온라인 보수교육 프로그램 안내
1. 대한간호협회는 의료법 시행규칙 제20조에 따른 보수교육을 실시하고 있으며, 의료법
제30조 제2항에 의거 의료인은 보수교육(오프라인 또는 온라인)을 연간 8시간 이상
이수하여야 함을 알려드립니다.
2. 대한간호협회는 간호사의 자질향상을 위하여 다음과 같이 온라인 보수교육을 운영하오니
많은 활용 바랍니다.
<2025. 6. 12. 기준>
대분류 순번 프로그램명 이수시간 교육비
등록,NE회원 미등록회원
기초 1 간호사를 위한 임상해부생리 I 4시간 20,000원 88,000원
간호 2 간호사를 위한 임상해부생리 II 4시간 20,000원 88,000원
과학 3 간호실무를 위한 최신 임상약리학 8시간 40,000원 108,000원
4 간호사가 알아야 할 감염관리 8시간 40,000원 108,000원
5 감염관리 전담간호사 대상 교육 8시간 40,000원 108,000원
6 갑상선 질환의 이해와 간호 8시간 40,000원 108,000원
7 노인요양시설 간호관리 8시간 40,000원 108,000원
8 복부중재시술과 환자간호 8시간 40,000원 108,000원`

test('표 형식 교육비 — 간호협회 보수교육 공문에서 회원가 40,000원을 읽는다', () => {
  const meta = app.parseDocMeta('대한간호협회 교육 공문.png', 간호협회공문)
  assert.equal(meta.registration, 40000)
  assert.match(meta.registrationNote, /8시간/)
})

test('4시간 프로그램 금액(20,000원)이나 미등록회원가(108,000원)를 집지 않는다', () => {
  const meta = app.parseDocMeta('x.png', 간호협회공문)
  assert.notEqual(meta.registration, 20000)
  assert.notEqual(meta.registration, 108000)
  assert.notEqual(meta.registration, 88000)
})

test('이수시간 의무가 없는 회원/비회원 표는 첫 행 회원가를 쓴다', () => {
  const meta = app.parseDocMeta('x.pdf', `제 목 연수교육 개최 안내
등록비
정회원 비회원
사전등록 150,000원 200,000원`)
  assert.equal(meta.registration, 150000)
})

test('금액을 못 읽은 간호사 보수교육 공문은 기본값 40,000원을 채운다', () => {
  const meta = app.parseDocMeta('x.pdf', `제 목 간호사 보수교육 이수 안내
연간 8시간 이상 보수교육을 이수하시기 바랍니다.`)
  assert.equal(meta.registration, 40000)
  assert.match(meta.registrationNote, /기본값/)
})

test('회귀 — 기존 키워드 형식 공문은 그대로 읽는다', () => {
  const cases = [
    ['참가회비 1인당 450,000원', 450000],
    ['등록비: 25,000원', 25000],
    ['정회원 18만원 비회원 25만원', 180000],
    ['금 25,000 원 / 1 명', 25000],
    ['사전납입 300,000원', 300000],
  ]
  for (const [text, want] of cases) {
    assert.equal(app.parseDocMeta('x.pdf', `제 목 교육 안내\n${text}`).registration, want, text)
  }
})

test('등록비가 없는 공문은 null 그대로다', () => {
  const meta = app.parseDocMeta('x.pdf', '제 목 회의 개최 안내\n장소: 서울특별시')
  assert.equal(meta.registration, null)
})
