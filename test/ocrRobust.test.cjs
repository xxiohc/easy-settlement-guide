// 2026-09-29 지석초이 제보: "각종 공문을 제대로 못 읽는 사례가 발생한다".
// 스캔 공문 OCR(흑백 2치화·오독 보정·라벨 뒤 시각 읽기)의 회귀 검사.
// 문장은 테스트공문_업로드함 4건의 실제 OCR 결과에서 따왔다(개인정보 부분 제외).
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadApp() {
  const stub = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : stub),
    apply: () => stub, set: () => true,
  })
  const context = vm.createContext({
    document: stub, window: stub, navigator: { userAgent: '' }, location: { href: '' },
    localStorage: stub, sessionStorage: stub, fetch: () => Promise.resolve(stub),
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Blob, Response, DecompressionStream, TextDecoder, TextEncoder, URL,
  })
  for (const f of ['../src/route.js', '../src/app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), context)
  }
  return { evalIn: code => vm.runInContext(code, context), context }
}

test('OCR이 "14시"를 "14A1"로 읽어도 시작시각을 찾아낸다 (재협 추계세미나)', () => {
  const { evalIn, context } = loadApp()
  context.__t = '제 목 2026 전국대학병원 재무부서장협의회 추계세미나 개최의 건 - 다 음 - '
    + '가. 기 2: 2026.11.05.(), 14A1~11.06.(2) 나. 장 _ 소 : 부산 해운대구 해운대해변로298번길 24, 팔레드시즈 '
    + '다. 참가회비 : 200,000원(1인당/교통비 별도)'
  const m = evalIn('parseDocMeta("재협추계세미나.pdf", __t)')
  assert.equal(m.startDate, '2026-11-05')
  assert.equal(m.endDate, '2026-11-06')
  assert.equal(m.startTime, '14:00')
  assert.equal(m.destination, '부산')
})

test('기간 줄에 날짜와 시각이 섞여 있어도 시각만 뽑는다 (2치화로 제대로 읽힌 원문)', () => {
  const { evalIn, context } = loadApp()
  context.__t = '제 목 추계세미나 개최의 건 가. 기   간 : 2026.11.05.(목), 14시~11.06.(금) 나. 장 _ 소 : 부산 팔레드시즈'
  assert.equal(evalIn('parseDocMeta("x.pdf", __t)').startTime, '14:00')
})

test('교육시간 표의 "8시간"을 시작시각으로 읽지 않는다 (방사선안전교육 공문)', () => {
  const { evalIn, context } = loadApp()
  context.__t = '제 목 방 사 선안전 교 육 신 청 안내 가 . 과정 별 교 육 시 간 및 교 육 비 '
    + '교 육 과정 교 육 시 간 교 육 비 신 규 일 반분야 8시 간 65,000 N DT 분야 12시 간 80,000 '
    + '정 기 일 반분야 3시 간 25,000 N DT 분야 5시 간 40,000 나 . 교 육 비 : 금 [25,000] 원 / [1] 명 '
    + '붙 임 방 사 선안전 교 육 신 청 자 명 단 No 교 육 과정명 교 육 일 시 성명 교 육 장소 '
    + '1 기 본교 육 2026-06-01 (10:00 ~ 13:00) 부 산 - 부 산교 육 원'
  const m = evalIn('parseDocMeta("방사선안전교육.pdf", __t)')
  assert.equal(m.startTime, '10:00')
  assert.equal(m.registration, 25000)
})

test('OCR이 항목기호 "라."를 "gt."로 읽어도 장소에 다음 항목이 딸려오지 않는다', () => {
  const { evalIn, context } = loadApp()
  context.__t = '제 _ 목 : 제31차 OO학회 학술대회와 연수교육 개최 안내 나. 일   자 : 2026년 5월 28일(목) ~ 29일(금) '
    + '다. 장 _ 소 : 스위스 그랜드 호텔 (서울 서대문구 연희로 353) gt. 사전등록 안내 - 등 록 비 : 정회원 18만원'
  assert.equal(evalIn('parseDocMeta("x.pdf", __t)').venue, '스위스 그랜드 호텔 (서울 서대문구 연희로 353)')
})

test('OCR 오독 보정은 숫자 옆에서만 바꾼다 — 본문 낱말은 건드리지 않는다', () => {
  const { evalIn } = loadApp()
  assert.equal(evalIn('normalizeOcrArtifacts("04윌30일까지")'), '04월30일까지')
  assert.equal(evalIn('normalizeOcrArtifacts("１４시")'), '14시')
  assert.equal(evalIn('normalizeOcrArtifacts("기 2: 2026")'), '기간 : 2026')
  assert.equal(evalIn('normalizeOcrArtifacts("기 간 ;: 2025")'), '기 간 : 2025')
  assert.equal(evalIn('normalizeOcrArtifacts("제 = 2026 정기세미나 개최의 건")'), '제 목 2026 정기세미나 개최의 건')
  assert.equal(evalIn('normalizeOcrArtifacts("제   2 2026 정기세미나 개최의 건")'), '제 목 2026 정기세미나 개최의 건')
  assert.equal(evalIn('normalizeOcrArtifacts("의료법 시행규칙 제 20 조")'), '의료법 시행규칙 제 20 조')
  assert.equal(evalIn('normalizeOcrArtifacts("제 2 회 학술대회")'), '제 2 회 학술대회')
  // 사람 이름·낱말에 든 A1/윌은 그대로 둔다
  assert.equal(evalIn('normalizeOcrArtifacts("윌리엄 A1 등급")'), '윌리엄 A1 등급')
})

test('두 판독 중 공문 서식 라벨과 채워진 칸이 많은 쪽을 고른다', () => {
  const { evalIn, context } = loadApp()
  context.__plain  = '제 = 대한간호협회 안내 8시간 이상'                       // 라벨이 뭉개진 판독
  context.__binary = '제 목 대한간호협회 온라인 보수교육 프로그램 안내 교 육 비 40,000원'
  const pick = evalIn('pickOcrCandidate("공문.png", [{ mode: "plain", text: __plain, confidence: 86 }, { mode: "binary", text: __binary, confidence: 85 }])')
  assert.equal(pick.mode, 'binary')
})

test('신뢰도가 크게 낮은 판독은 라벨이 많아도 쓰지 않는다', () => {
  const { evalIn, context } = loadApp()
  context.__plain  = '제 목 대한간호협회 온라인 보수교육 프로그램 안내 교 육 비 40,000원'
  context.__binary = '제 목 일 시 장 소 참가회비 뭉개진 글자 뭉개진 글자 뭉개진 글자'
  const pick = evalIn('pickOcrCandidate("공문.png", [{ mode: "plain", text: __plain, confidence: 86 }, { mode: "binary", text: __binary, confidence: 70 }])')
  assert.equal(pick.mode, 'plain')
})

test('글자를 거의 못 읽은 판독은 후보에서 뺀다', () => {
  const { evalIn, context } = loadApp()
  context.__good = '제 목 교육 안내 일 시 : 2026.06.10. 장 소 : 서울 등 록 비 : 100,000원'
  const pick = evalIn('pickOcrCandidate("공문.pdf", [{ mode: "binary", text: "ㅁㅁ", confidence: 99 }, { mode: "plain", text: __good, confidence: 80 }])')
  assert.equal(pick.mode, 'plain')
})

test('흑백 2치화는 임계값을 스스로 정하고, 글자가 너무 많으면(어두운 사진) 회색조까지만 남긴다', () => {
  const { evalIn, context } = loadApp()
  // 밝은 종이 + 검은 글자: 임계값이 두 봉우리 사이(검은 쪽 끝 12 ~ 흰 쪽 시작 240)에 잡힌다
  const thr = evalIn('otsuThreshold(new Uint8Array([10,12,240,245,250,248,11,242]))')
  assert.ok(thr >= 12 && thr < 240, `임계값 ${thr}`)
  // 화면 렌더 대신 가짜 캔버스 컨텍스트로 어두운 그림 판정을 확인한다
  context.__ctx = {
    getImageData: () => ({ data: new Uint8ClampedArray(Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? 255 : 20))) }),
    putImageData: () => {},
  }
  const r = evalIn('binarizeCanvas(__ctx, 2, 2)')
  assert.equal(r.binarized, false)   // 검은 픽셀이 45%를 넘으면 2치화하지 않는다
})

test('OCR 렌더 배율은 작은 페이지를 키우고 큰 페이지는 지나치게 키우지 않는다', () => {
  const { evalIn } = loadApp()
  assert.equal(evalIn('ocrRenderScale(595)'), 3.5)     // A4 72dpi → 상한 3.5배
  assert.equal(evalIn('ocrRenderScale(1400)') > 1.5, true)
  assert.equal(evalIn('ocrRenderScale(2400)'), 2)      // 이미 크면 최소 2배
})

// ── 한글(.hwpx)·워드(.docx) 공문 본문 추출 ───────────────────────────────────
// zip 안의 XML을 꺼내 쓴다. 저장(무압축) 항목만으로 만든 zip으로 스캐너를 검사한다
// (실제 파일 검증은 tools/zip_doc_check.mjs — 진짜 한글·워드 파일로 확인했다).
function storedZip(entries) {
  const enc = new TextEncoder()
  const parts = []
  for (const [name, body] of entries) {
    const n = enc.encode(name), b = enc.encode(body)
    const h = new Uint8Array(30 + n.length)
    const dv = new DataView(h.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(8, 0, true)            // 저장(무압축)
    dv.setUint32(18, b.length, true)    // 압축 크기
    dv.setUint32(22, b.length, true)    // 원본 크기
    dv.setUint16(26, n.length, true)
    h.set(n, 30)
    parts.push(h, b)
  }
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

test('한글(.hwpx) 공문은 Contents/section*.xml 본문만 읽는다', async () => {
  const { evalIn, context } = loadApp()
  context.__zip = storedZip([
    ['mimetype', 'application/hwp+zip'],
    ['Contents/header.xml', '<hh:fontfaces>맑은 고딕 굴림</hh:fontfaces>'],
    ['Contents/section0.xml', '<hp:p><hp:t>제 목 : 2026년 회계실무 교육 안내</hp:t></hp:p>'
      + '<hp:p><hp:t>가. 일 시 : 2026. 6. 10.(수) 14:00</hp:t></hp:p>'
      + '<hp:p><hp:t>나. 장 소 : 서울 여의도 태영빌딩</hp:t></hp:p>'
      + '<hp:p><hp:t>다. 교육비 : 150,000원</hp:t></hp:p>'],
  ])
  context.__file = { name: '교육안내.hwpx', arrayBuffer: async () => context.__zip.buffer }
  const text = await evalIn('extractZipDocText(__file, "hwpx")')
  assert.match(text, /2026년 회계실무 교육 안내/)
  assert.doesNotMatch(text, /맑은 고딕/)          // 글꼴 정의는 본문이 아니다
  context.__text = text
  const m = evalIn('parseDocMeta("교육안내.hwpx", __text)')
  assert.equal(m.startDate, '2026-06-10')
  assert.equal(m.startTime, '14:00')
  assert.equal(m.destination, '서울')
  assert.equal(m.registration, 150000)
})

test('워드(.docx) 공문은 word/document.xml 본문을 읽는다', async () => {
  const { evalIn, context } = loadApp()
  context.__zip = storedZip([
    ['word/styles.xml', '<w:style>제 목 없는 스타일 정의</w:style>'],
    ['word/document.xml', '<w:p><w:r><w:t>제 목 : 병원 원가관리 실무 교육</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>일 시 : 2026. 7. 2.(목) 09:30</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>장 소 : 부산 센텀종합병원</w:t></w:r></w:p>'],
  ])
  context.__file = { name: '교육.docx', arrayBuffer: async () => context.__zip.buffer }
  const text = await evalIn('extractZipDocText(__file, "docx")')
  context.__text = text
  const m = evalIn('parseDocMeta("교육.docx", __text)')
  assert.equal(m.title, '병원 원가관리 실무 교육')
  assert.equal(m.startDate, '2026-07-02')
  assert.equal(m.startTime, '09:30')
  assert.equal(m.destination, '부산')
})

test('XML 문단 태그는 줄바꿈으로, 나머지 태그는 지운다', () => {
  const { evalIn } = loadApp()
  assert.equal(evalIn('xmlToText("<w:p><w:t>가</w:t></w:p><w:p><w:t>나 &amp; 다</w:t></w:p>")'), '가\n나 & 다')
})

// ── 옛 한글(.hwp, HWP 5.0 이진) 공문 ────────────────────────────────────────
// 실제 파일 검증은 tools/hwp_check.mjs + tools/parse_sweep.mjs(보험심사 관리자워크숍 공문)로 한다.
// 여기서는 브라우저가 대신해 주지 않는 부분 — 압축 꼬리 무시, 레코드 해석, 제어문자 건너뛰기 —
// 를 바이트 단위로 고정한다.

// 문단 텍스트 레코드 한 개를 만든다: 헤더 4바이트(tag 67 + level + size) + UTF-16LE 본문.
function paraTextRecord(codes) {
  const body = new Uint8Array(codes.length * 2)
  const bd = new DataView(body.buffer)
  codes.forEach((c, i) => bd.setUint16(i * 2, c, true))
  const out = new Uint8Array(4 + body.length)
  new DataView(out.buffer).setUint32(0, (67 & 0x3ff) | (0 << 10) | (body.length << 20), true)
  out.set(body, 4)
  return out
}
const codesOf = s => [...s].map(ch => ch.charCodeAt(0))

test('.hwp 문단 레코드에서 글자만 뽑고 인라인 제어문자 16바이트는 건너뛴다', () => {
  const { evalIn, context } = loadApp()
  // 표 시작 제어문자(11) 뒤에는 14바이트가 더 붙는다 — 그 안의 글자처럼 보이는 값에 속으면 안 된다.
  const codes = [...codesOf('일 시'), 11, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47,
    ...codesOf('2026년 10월 13일'), 13, ...codesOf('장 소')]
  context.__bytes = paraTextRecord(codes)
  const paras = evalIn('hwpSectionText(__bytes)')
  assert.equal(paras.length, 1)
  assert.equal(paras[0], '일 시2026년 10월 13일\n장 소')   // ABCDEFG(제어 데이터)는 안 섞인다
})

test('.hwp 본문 스트림 뒤에 패딩이 붙어도 압축을 푼 만큼 쓴다', async () => {
  const { evalIn, context } = loadApp()
  const zlib = require('node:zlib')
  const record = paraTextRecord(codesOf('제 목 2026 관리자 워크숍 개최 안내'))
  const packed = zlib.deflateRawSync(Buffer.from(record))
  context.__padded = new Uint8Array(Buffer.concat([packed, Buffer.alloc(64, 0)]))   // 꼬리 패딩
  const bytes = await evalIn('inflateRawPartial(__padded)')
  context.__bytes = bytes
  assert.equal(evalIn('hwpSectionText(__bytes)')[0], '제 목 2026 관리자 워크숍 개최 안내')
})

test('.hwp FileHeader 속성에서 압축·암호 여부를 읽는다', () => {
  const { evalIn, context } = loadApp()
  const mk = flags => {
    const b = new Uint8Array(64)
    new DataView(b.buffer).setUint32(36, flags, true)
    return b
  }
  context.__plain = mk(0); context.__zipped = mk(1); context.__locked = mk(3)
  assert.deepEqual(evalIn('hwpFileHeaderFlags(__plain)'), { compressed: false, encrypted: false, distributed: false })
  assert.equal(evalIn('hwpFileHeaderFlags(__zipped)').compressed, true)
  assert.equal(evalIn('hwpFileHeaderFlags(__locked)').encrypted, true)
})

test('.hwp가 아닌 파일을 올리면 사유별 안내 문구가 있다', () => {
  const { evalIn } = loadApp()
  for (const key of ['HWP3', 'NOT_CFB', 'HWP_ENCRYPTED', 'HWP_DISTRIBUTED', 'NO_BODYTEXT']) {
    assert.equal(typeof evalIn(`HWP_ERROR_MESSAGES[${JSON.stringify(key)}]`), 'string',
      `${key} 안내 문구가 없다`)
  }
})

test('장소 칸의 시·도 이름만으로도 지역을 잡고, 본문 발신처 주소로는 잡지 않는다', () => {
  const { evalIn } = loadApp()
  // 로카우스 호텔 서울 용산 — '용산구'가 아니라 '용산'이라 기존 규칙으로는 못 잡았다.
  assert.equal(evalIn('matchRegionInVenue("로카우스 호텔 서울 용산 6층 플로리스홀")'), '서울')
  assert.equal(evalIn('matchRegion("로카우스 호텔 서울 용산 6층 플로리스홀")'), '')
  // 장소가 창원이면 발신처가 서울이어도 창원이다(장소 칸을 먼저 본다).
  assert.equal(evalIn('matchRegionInVenue("삼성창원병원 본관 대강당")'), '창원')
})
