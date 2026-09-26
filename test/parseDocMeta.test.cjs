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

// ── 성균관대 세무조정 협조요청 공문 (2026-09-26 지석초이 제보) ───────────────
// PDF 텍스트 추출이 글자를 흩뜨리는 실제 모양 그대로다. 장소는 수원(자연과학캠퍼스)인데
// 발신처 주소가 '서울 종로구'라 지역이 서울로 잡히던 건.
const 성균관대세무조정공문 = `학교법인 성균관대학법인 학교 부속병원 포함의 회계연도 법인세 세무조정 업무를( , , ) 2024
다음과 같이 진행하고자 하오니 협조 부탁드립니다.
다         음
내        용 회계연도 법인세 세무조정학교법인 성균관대학1. : 2024 ( )
기        간 일간2. : 2025.5.15~5.16(2 )
장        소 성균관대학교 자연과학캠퍼스3. :
담당회계법인 한울회계법인4. :
성 균 관 대 학 교
제    목  회계연도 법인세 세무조정 진행 협조요청2024
우03063서울 종로구 성균관로 25-2 / http://www.skku.edu
전화02-760-1164전송02-3673-1240`

test('성균관대 자연과학캠퍼스는 서울이 아니라 수원이다', () => {
  const meta = app.parseDocMeta('세무조정_공문.pdf', 성균관대세무조정공문)
  assert.equal(meta.destination, '수원')
})

test('장소 뒤에 붙은 다음 항목 번호(자연과학캠퍼스3)를 장소로 읽지 않는다', () => {
  const meta = app.parseDocMeta('세무조정_공문.pdf', 성균관대세무조정공문)
  assert.equal(meta.venue, '성균관대학교 자연과학캠퍼스')
})

test('교육이라는 말이 없는 출장 공문도 출장 공문으로 본다', () => {
  const meta = app.parseDocMeta('세무조정_공문.pdf', 성균관대세무조정공문)
  assert.equal(meta.isTripDoc, true)
})

test('발신처가 서울인 공문이어도 장소가 수원이면 수원으로 잡는다 — 기간도 그대로', () => {
  const meta = app.parseDocMeta('세무조정_공문.pdf', 성균관대세무조정공문)
  assert.equal(meta.startDate, '2025-05-15')
  assert.equal(meta.endDate, '2025-05-16')
})

test('성균관대학교만 적힌 공문은 종전대로 서울(인문사회과학캠퍼스)이다', () => {
  const meta = app.parseDocMeta('x.pdf', '제 목 교육 안내\n장 소 : 성균관대학교 600주년기념관')
  assert.equal(meta.destination, '서울')
})

test('삼성창원병원은 수원·서울 어느 쪽에도 걸리지 않는다', () => {
  const meta = app.parseDocMeta('x.pdf', '제 목 교육 안내\n장 소 : 성균관대학교 삼성창원병원')
  assert.equal(meta.destination, '창원')
})

test('영수증·매출전표는 여전히 출장 공문이 아니다', () => {
  const meta = app.parseDocMeta('x.pdf', '신용카드 매출전표\n승인번호 12345678\n합계 33,000원')
  assert.equal(meta.isTripDoc, false)
})

// ── 2026-09-26 테스트공문 13건 전수점검에서 잡힌 오인식 (합성 문장 — 원문 개인정보 제외) ──
const P = (t, f = '공문.pdf') => app.parseDocMeta(f, t)

test('시행일자는 교육일이 아니다 — 라벨 "일 자" 뒤 날짜와 끝날만 적힌 범위', () => {
  const m = P(`제 _ 목 : 제31차 OO학회 학술대회와 연수교육 개최 안내
가. 행 사 명 : 제31차 OO학회 학술대회
나. 일   자 : 2026년 5월 28일(목) ~ 29일(금) / 2일간
다. 장 _ 소 : 스위스 그랜드 호텔 (서울 서대문구 연희로 353)
- 사전등록 : 2026년 4월 1일(수) 10:00 ~ 5월 18일(월) 17:00
- 등 록 비 : 정회원 18만원, 비회원 20만원
시행 대의감관 2026-053 (2026.03.27) 접수`)
  assert.equal(m.startDate, '2026-05-28')
  assert.equal(m.endDate, '2026-05-29')
  assert.equal(m.startTime, '')
  assert.equal(m.title, '제31차 OO학회 학술대회와 연수교육 개최 안내')
  assert.equal(m.venue, '스위스 그랜드 호텔 (서울 서대문구 연희로 353)')
  assert.equal(m.destination, '서울')
})

test('접수기간은 교육일이 아니다 — "일시" 라벨이 이긴다', () => {
  const m = P(`제 목 의료기관 교육담당자 역량강화 연수교육 개최 안내
나. 일시 : 2025. 12.11.(목)
다. 장소 : 여의도 태영빌딩 T-아트홀 (여의나루역 1번 출구 도보 10분)
라. 접수인원 : 150명
교육비 및 접수기간 회원병원 : 88,000원 2025.11.20.(목) ~ 12.5.(금)`)
  assert.equal(m.startDate, '2025-12-11')
  assert.equal(m.endDate, '2025-12-11')
  assert.equal(m.venue, '여의도 태영빌딩 T-아트홀')
})

test('목록 기준일(<2025. 6. 12. 기준>)은 교육일이 아니다 — 모르면 비운다', () => {
  const m = P(`제 목 OO협회 온라인 보수교육 프로그램 안내
운영하오니 많은 활용 바랍니다.
<2025. 6. 12. 기준>
8 복부중재시술과 환자간호 8시간 40,000원 108,000원`)
  assert.equal(m.startDate, '')
})

test('1차·2차 차수는 한 기간으로 묶지 않고 1차로 채운 뒤 차수 공문이라고 알린다', () => {
  const m = P(`제목 2026 년 OO 교육 강의 협조 요청
나 . 일시 및 장소 ○ 1 차 : 2026. 6. 9.( 화 ), 삼성서울병원 암병원 지하 1 층 강당 ○ 2 차 : 2026. 6. 16.( 화 ), 대전을지대학교병원 범석홀 다 . 교육대상`)
  assert.equal(m.startDate, '2026-06-09')
  assert.equal(m.endDate, '2026-06-09')
  assert.equal(m.multiSession, true)
  assert.equal(m.destination, '서울')
  assert.equal(m.title, '2026년 OO 교육 강의 협조 요청')
})

test('연도 없는 날짜는 요일이 맞는 해로 채운다', () => {
  const m = P(`OO 실무 교육 과정일정 08.08(목) ~ 08.09(금) / 총 2일 과정시간 09:00 ~ 18:00 교육비 510,000원`)
  assert.equal(m.startDate, '2024-08-08')
  assert.equal(m.yearGuessed, true)
})

test('발신 명의가 제목 뒤에 붙고 연도가 끝으로 밀린 제목을 바로잡는다', () => {
  const m = P(`제   목   회계연도   법인세   세무조정   진행   협조요청 2024  학교법인   성균관대학   이사장
기 간 : 2025.5.15~5.16`)
  assert.equal(m.title, '2024 회계연도 법인세 세무조정 진행 협조요청')
})

test('결재된 출장신청서를 올리면 기안일을 출장일로 채우지 않는다', () => {
  const m = P(`출 장 신 청 서 기 안 자 홍길동 기 안 일 2025-12-01(월) 사 유 OO 연수교육 출장기간 2025-12-10(수) ~ 2025-12-11(목)`)
  assert.equal(m.docKind, 'trip-form')
  assert.equal(m.startDate, '')
  assert.equal(m.isTripDoc, false)
})

test('영수증처럼 공문이 아닌 파일은 아무 칸도 채우지 않는다', () => {
  const m = P(`카드매출전표 거래일자 2026.05.13 12:16:59 매출금액 62,000 원 가맹점주소 부산 해운대구`)
  assert.equal(m.docKind, 'other')
  assert.equal(m.startDate, '')
  assert.equal(m.destination, '')
  assert.equal(m.title, '')
})
