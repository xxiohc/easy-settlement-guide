// ── 카카오 장소 검색 API 키 ────────────────────────────────────────────────────
// developers.kakao.com → 내 애플리케이션 → REST API 키
const KAKAO_API_KEY = '995bceb54093798d160d753693a9c98e'

// ── 단계 정의 ────────────────────────────────────────────────────────────────
const STEPS = [
  { card: 1,  label: '출장 여부' },
  { card: 2,  label: '공문 여부' },
  { card: 3,  label: '공문 업로드' },
  { card: 4,  label: '정보 확인' },
  // Card 5 (등록비 기준)은 Card 4 인라인으로 통합 — STEPS에서 제외
  { card: 6,  label: '납부 여부' },
  { card: 7,  label: '납부 형태' },
  { card: 8,  label: '추가 확인' },
  { card: 9,  label: '예상 금액' },
  { card: 10, label: '신청서' },
  { card: 11, label: '완료' },
]

// ── 상태 ─────────────────────────────────────────────────────────────────────
const state = {
  currentCard: 1,
  tripStatus: null,     // 'done' | 'planned' | 'online'
  isOnline: false,      // 온라인 교육 여부 (true면 출장비 계산 제외)
  hasDoc: null,         // true | false
  parsedMeta: null,     // 공문 파싱 결과
  title: '',
  startDate: '',
  endDate: '',
  nights: 0,
  days: 0,
  place: '',
  isJeju: false,
  isSeoul: false,
  fee: 0,
  hasFee: null,         // true | false (Card 4에서 선택)
  feeStatus: null,      // 'paid' | 'not-paid' | 'no-fee'
  receiptType: null,    // 'card-receipt' | 'tax-invoice' | 'cash-receipt' | 'transfer'
  dept: '',             // 소속 (Card 10 입력)
  name: '',             // 성명 (Card 10 입력)
  isMS: null,           // true | false  (MS 이상 직급)
  isShortDayTrip: null, // true | false  (교육+이동 8h 이하 당일 출장)
  isDayTrip: null,
  before12: null,
  lodgingProvided: null,
  mealProvided: null,
  hasPlane: null,
  hasShuttle: null,
}

// ── KTX / 버스 운임표 (마산역 출발 왕복) ─────────────────────────────────────
const FARE_TABLE = [
  { keywords: ['서울'],          label: '서울역',    ktxNormal: 106600, ktxFirst: 149600 },
  { keywords: ['수서'],          label: '수서역',    ktxNormal: 102000, ktxFirst: 143000 },
  { keywords: ['천안', '아산'],  label: '천안아산역', ktxNormal: 90000,  ktxFirst: 126000 },
  { keywords: ['오송'],          label: '오송역',    ktxNormal: 84000,  ktxFirst: 118000 },
  { keywords: ['대전'],          label: '대전역',    ktxNormal: 68000,  ktxFirst: 95000  },
  { keywords: ['부산', '해운대'], label: '부산',     bus: 19600 },
  { keywords: ['대구'],          label: '동대구역',  ktxNormal: 76000,  ktxFirst: 106000 },
  { keywords: ['울산'],          label: '울산',      bus: 29000 },
  { keywords: ['경주'],          label: '경주',      bus: 38000 },
  { keywords: ['전주'],          label: '전주',      bus: 46000 },
  { keywords: ['제주'],          label: '제주',      jeju: true },
]

const DAILY_RATE     = 35000
const DAILY_RATE_25P = 8750   // 25% (숙소·식사 제공 중간날)
const LODGING_RATE   = 100000

// ── 카드 내비게이션 ───────────────────────────────────────────────────────────
function goToCard(n) {
  const current = document.getElementById(`card-${state.currentCard}`)
  const next    = document.getElementById(`card-${n}`)
  if (!next) return

  // 진입 전 준비
  if (n === 4)  prepareCard4Online()
  if (n === 6)  resetCard6()
  if (n === 7)  resetCard7()
  if (n === 8)  prepareCard8()
  if (n === 9)  prepareCard9()
  if (n === 10) prepareCard10()
  if (n === 11) prepareCard11()

  if (n > state.currentCard) {
    current.classList.add('exit-left')
    current.classList.remove('active')
    next.style.transform = 'translateX(100%)'
    requestAnimationFrame(() => {
      next.style.transition = 'transform 0.35s cubic-bezier(0.4,0,0.2,1)'
      next.classList.add('active')
      next.style.transform = ''
    })
  } else {
    current.classList.remove('active', 'exit-left')
    current.style.transform = 'translateX(100%)'
    next.classList.remove('exit-left')
    next.classList.add('active')
    next.style.transform = ''
  }

  state.currentCard = n
  updateProgress()
}

function goBack(cardNum) {
  // 공문 없이 왔을 때 Card 4에서 뒤로 → Card 2로
  if (cardNum === 4 && !state.hasDoc) return goToCard(2)
  // Card 6에서 뒤로 → Card 4 (Card 5는 인라인 통합됨)
  if (cardNum === 6) return goToCard(4)
  // Card 8에서 뒤로 → 등록비 없으면 Card 4, 납부 안했으면 Card 6, 납부했으면 Card 7
  if (cardNum === 8) {
    if (state.hasFee === false) return goToCard(4)
    if (state.feeStatus === 'not-paid') return goToCard(6)
    return goToCard(7)
  }
  // Card 9에서 뒤로 (온라인) → 등록비 없으면 Card 4, 납부 안했으면 Card 6, 납부했으면 Card 7
  if (cardNum === 9 && state.isOnline) {
    if (state.hasFee === false) return goToCard(4)
    if (state.feeStatus === 'not-paid') return goToCard(6)
    return goToCard(7)
  }
  // Card 11에서 뒤로 (온라인) → Card 9
  if (cardNum === 11 && state.isOnline) return goToCard(9)
  goToCard(cardNum - 1)
}

// Card 4 다음으로 — 등록비 유무에 따라 분기
function goFromCard4() {
  if (state.hasFee === true) {
    goToCard(6)   // 납부 여부 확인
  } else {
    goToCard(8)   // 등록비 없음 → 추가 확인으로 바로
  }
}

function updateProgress() {
  const visibleSteps = getVisibleSteps()
  const idx = visibleSteps.findIndex(s => s.card === state.currentCard)
  const pct = visibleSteps.length <= 1 ? 0 : (idx / (visibleSteps.length - 1)) * 100
  document.getElementById('progressFill').style.width = `${pct}%`
  // 헤더 우측 진행률 텍스트
  const ptEl = document.getElementById('headerProgressText')
  if (ptEl) {
    ptEl.textContent = idx >= 0 && state.currentCard > 1
      ? `${idx + 1} / ${visibleSteps.length} 단계`
      : ''
  }
  renderTrails()
}

// 공문 없는 경우 Card 3 제외한 단계 목록
function getVisibleSteps() {
  let steps = STEPS

  // 공문 없으면 Card 3 제외
  if (!state.hasDoc) steps = steps.filter(s => s.card !== 3)

  // 온라인 교육이면 Card 8(추가 확인), Card 10(출장신청서) 제외
  if (state.isOnline) steps = steps.filter(s => s.card !== 8 && s.card !== 10)

  // 등록비 없으면 Card 6(납부 여부), Card 7(납부 형태) 모두 제외
  if (state.hasFee === false) return steps.filter(s => s.card !== 6 && s.card !== 7)

  // 등록비 있지만 납부 안했으면 Card 7 제외
  if (state.feeStatus === 'not-paid') return steps.filter(s => s.card !== 7)

  return steps
}

// ── 단계 트레일 렌더 ──────────────────────────────────────────────────────────
function renderTrails() {
  const visibleSteps = getVisibleSteps()
  const isMobile = window.innerWidth <= 480

  // 현재 단계 정보 (모바일 텍스트용)
  const currentIdx = visibleSteps.findIndex(s => s.card === state.currentCard)
  const currentLabel = currentIdx >= 0 ? visibleSteps[currentIdx].label : ''
  const stepText = currentIdx >= 0
    ? `${currentIdx + 1} / ${visibleSteps.length}단계 · ${currentLabel}`
    : ''

  STEPS.forEach(({ card }) => {
    if (card === 11) return  // 완료 화면은 trail 없음
    const trailEl = document.getElementById(`trail-${card}`)
    if (!trailEl) return

    // 모바일: 첫 아이템으로 단계 텍스트 삽입 (flex item으로 자연스럽게 배치)
    let html = isMobile && stepText
      ? `<span class="trail-step-text">${stepText}</span>`
      : ''

    visibleSteps.forEach(({ card: c, label }, idx) => {
      const clickable = c < state.currentCard
      const isUpcoming = state.hasFee === true && c > state.currentCard && (c === 6 || c === 7)
      const status = c < state.currentCard ? 'done'
        : c === state.currentCard ? 'current'
        : isUpcoming ? 'upcoming'
        : 'future'

      if (idx > 0) {
        const connDone = visibleSteps[idx - 1].card < state.currentCard
        const connUpcoming = isUpcoming && visibleSteps[idx - 1].card === state.currentCard
        html += `<div class="trail-connector${connDone ? ' done' : connUpcoming ? ' upcoming' : ''}"></div>`
      }

      const icon = status === 'done'
        ? `<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#3182f6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        : idx + 1

      html += `
        <button class="trail-item ${status}"
          ${clickable ? `onclick="goToCard(${c})"` : 'disabled'}
          aria-label="${label}">
          <div class="trail-dot">${icon}</div>
          <span class="trail-label">${label}</span>
        </button>`
    })

    trailEl.innerHTML = html

    // 현재 단계 점을 trail 수평 스크롤 내에서 center로 위치
    // scrollIntoView 대신 trailEl.scrollLeft 직접 제어 (페이지 전체 스크롤 방지)
    const currentDot = trailEl.querySelector('.trail-item.current')
    if (currentDot) {
      const dotOffset = currentDot.offsetLeft
      const dotWidth = currentDot.offsetWidth
      const trailWidth = trailEl.offsetWidth
      trailEl.scrollLeft = dotOffset - trailWidth / 2 + dotWidth / 2
    }
  })
}

// ── CARD 1: 출장 여부 ─────────────────────────────────────────────────────────
function select1(val) {
  state.tripStatus = val
  state.isOnline = (val === 'online')
  highlight(val)
  setTimeout(() => goToCard(2), 150)
}

// ── CARD 2: 공문 여부 ─────────────────────────────────────────────────────────
function select2(val) {
  state.hasDoc = val === 'yes'
  highlight(val === 'yes' ? 'has-doc' : 'no-doc')
  updateDocStrip()
  setTimeout(() => {
    if (state.hasDoc) {
      goToCard(3)
    } else {
      showCard4InputMode()
      goToCard(4)
    }
  }, 150)
}

// Card 3에서 "공문 없음 → 직접 입력" 스킵 (벤치마킹 등 공문 없는 출장)
function skipToDirectInput() {
  state.hasDoc = false
  updateDocStrip()
  showCard4InputMode()
  goToCard(4)
}

// ── CARD 3: 공문 업로드 ───────────────────────────────────────────────────────

// ── 원형 진행률 업데이트 ────────────────────────────────────────────────────
function setParseProgress(pct, label) {
  pct = Math.min(100, Math.max(0, Math.round(pct)))
  const ring  = document.getElementById('parseProgressRing')
  const pctEl = document.getElementById('parseProgressPct')
  const lblEl = document.getElementById('parseProgressLabel')
  if (ring) {
    // conic-gradient: 0도(위)에서 시작, 파란색→연한파랑 그라데이션
    const deg = pct * 3.6
    ring.style.background = pct === 0
      ? 'conic-gradient(from -90deg, #e8edf2 0%, #e8edf2 100%)'
      : `conic-gradient(from -90deg, #3182f6 0deg, #7ab8ff ${deg}deg, #e8edf2 ${deg}deg)`
  }
  if (pctEl) pctEl.textContent = `${pct}%`
  if (lblEl && label !== undefined) lblEl.textContent = label
}

// 드래그앤드롭 핸들러
function onDragOver(e) {
  e.preventDefault()
  document.getElementById('uploadZone').classList.add('drag-over')
}
function onDragLeave(e) {
  document.getElementById('uploadZone').classList.remove('drag-over')
}
function onDrop(e) {
  e.preventDefault()
  document.getElementById('uploadZone').classList.remove('drag-over')
  const file = e.dataTransfer.files[0]
  if (file) processUploadedFile(file)
}

async function handleFileUpload(event) {
  const file = event.target.files[0]
  if (!file) return
  processUploadedFile(file)
}

async function processUploadedFile(file) {
  document.getElementById('parseResult').classList.add('hidden')
  document.getElementById('parseLoading').classList.remove('hidden')
  setParseProgress(0, '준비 중')

  const ext = file.name.toLowerCase().split('.').pop()
  let text = ''

  if (ext === 'pdf') {
    setParseProgress(5, 'PDF 읽는 중')
    text = await extractPdfText(file)
    // 텍스트가 거의 없으면 이미지 기반 PDF → OCR
    if (text.replace(/\s/g, '').length < 50) {
      text = await ocrPdfPages(file)
    }
  } else if (['jpg','jpeg','png'].includes(ext)) {
    text = await ocrImage(file)
  }

  setParseProgress(95, '정보 추출 중')
  const meta = parseDocMeta(file.name, text)
  state.parsedMeta = meta

  setParseProgress(100, '완료!')
  await new Promise(r => setTimeout(r, 400)) // 완료 잠깐 표시
  document.getElementById('parseLoading').classList.add('hidden')
  renderParseResult(file.name, meta, !!text.trim())

  const cta = document.getElementById('ctaNext3')
  cta.disabled = false
  cta.classList.remove('disabled')
  updateDocStrip()
}

// PDF 텍스트 레이어 추출 (페이지별 진행률)
async function extractPdfText(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.worker.min.js'
  const ab = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise
  const parts = []
  for (let i = 1; i <= pdf.numPages; i++) {
    setParseProgress(5 + Math.round((i / pdf.numPages) * 75), `${i}/${pdf.numPages} 페이지`)
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    parts.push(tc.items.map(it => it.str).join(' '))
  }
  return parts.join('\n')
}

// 이미지 기반 PDF → 각 페이지 렌더 후 OCR
async function ocrPdfPages(file) {
  if (typeof pdfjsLib === 'undefined') return ''
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.worker.min.js'
  const ab = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise
  const parts = []
  const maxPages = Math.min(pdf.numPages, 3)
  for (let i = 1; i <= maxPages; i++) {
    setParseProgress(5 + Math.round(((i - 1) / maxPages) * 85), `OCR ${i}/${maxPages} 페이지`)
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'))
    const pageBase = 5 + Math.round(((i - 1) / maxPages) * 85)
    const pageEnd  = 5 + Math.round((i / maxPages) * 85)
    const result = await ocrBlob(blob, pageBase, pageEnd)
    parts.push(result)
  }
  return parts.join('\n')
}

// 이미지 파일 OCR
async function ocrImage(file) {
  return ocrBlob(file, 5, 90)
}

// Tesseract OCR (Tesseract logger로 실제 진행률 반영)
async function ocrBlob(blob, pctStart = 5, pctEnd = 90) {
  if (typeof Tesseract === 'undefined') return ''
  try {
    const { data: { text } } = await Tesseract.recognize(blob, 'kor+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          const p = pctStart + Math.round(m.progress * (pctEnd - pctStart))
          setParseProgress(p, 'OCR 인식 중')
        } else if (m.status === 'loading tesseract core') {
          setParseProgress(pctStart, '엔진 로딩 중')
        } else if (m.status === 'initializing api') {
          setParseProgress(pctStart + 5, '초기화 중')
        }
      }
    })
    return text
  } catch (e) {
    console.warn('OCR 오류:', e)
    return ''
  }
}

function parseDocMeta(filename, text) {
  const norm = s => s.replace(/\s+/g, '')
  const col  = s => s.replace(/\s+/g, ' ').trim()
  const tc   = col(text)
  const tn   = norm(text)
  const curY = new Date().getFullYear()

  // ── 제목 ──
  let title = ''
  // 공문 레이블(제목/건명/연수명 등) 뒤 텍스트
  const titleM = tc.match(/(?:제\s*목|건\s*명|행\s*사\s*명|연수\s*명|강\s*의\s*명|과\s*정\s*명|세\s*미\s*나\s*명|학\s*술\s*대\s*회\s*명)\s*[：:]\s*([^.]{4,80})/)
  if (titleM) {
    title = titleM[1].trim().replace(/\s+/g, ' ')
    // 목록기호 혼입 제거: 끝에 붙은 " 나" " 다" 등 (가~하 한글 자음 목록 기호)
    title = title.replace(/\s+[가나다라마바사아자차카타파하]\s*\.?\s*$/, '').trim()
  }
  // 파일명에서 추출
  if (!title) {
    const fnBase = filename.replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ').trim()
    if (fnBase.length > 4 && fnBase.length < 80) title = fnBase
  }
  // 본문 첫 의미있는 줄에서 추출
  if (!title) {
    const kwRe = /교육|출장|세미나|연수|워크숍|학술대회|심포지엄|컨퍼런스|포럼|훈련|안내|개최/
    for (const line of text.split('\n')) {
      const l = line.trim()
      if (l.length > 5 && l.length < 80 && kwRe.test(l)) {
        title = l; break
      }
    }
  }

  // ── 기간 ──
  let periodDisplay = '', nights = 0, days = 0, startDate = '', endDate = ''

  const pad = n => String(n).padStart(2, '0')
  const setRange = (sy, sm, sd, ey, em, ed) => {
    startDate = `${sy}-${pad(sm)}-${pad(sd)}`
    endDate   = `${ey}-${pad(em)}-${pad(ed)}`
    nights = Math.max(0, Math.round((new Date(endDate) - new Date(startDate)) / 86400000))
    days = nights + 1
    periodDisplay = `${sm}월 ${sd}일 ~ ${em}월 ${ed}일`
  }

  // 패턴1: YYYY-MM-DD ~ YYYY-MM-DD
  let m = tc.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*~\s*(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) { setRange(+m[1],+m[2],+m[3],+m[4],+m[5],+m[6]) }

  // 패턴2: YYYY.M.D ~ M.D 또는 YYYY.M.D~YYYY.M.D
  if (!startDate) {
    m = tc.match(/(\d{4})[. ]+(\d{1,2})[. ]+(\d{1,2})\s*~\s*(?:(\d{4})[. ]+)?(\d{1,2})[. ]+(\d{1,2})/)
    if (m) {
      const ey = m[4] ? +m[4] : +m[1]
      setRange(+m[1],+m[2],+m[3], ey,+m[5],+m[6])
    }
  }

  // 패턴3: MM.DD(요일) ~ MM.DD(요일) — 연도 없는 경우 올해로 설정
  if (!startDate) {
    m = tc.match(/(\d{1,2})\.(\d{1,2})(?:\s*\([^)]{1,3}\))?\s*~\s*(\d{1,2})\.(\d{1,2})/)
    if (m) {
      setRange(curY,+m[1],+m[2], curY,+m[3],+m[4])
    }
  }

  // 패턴4: 단일 일자 — YYYY. M.D 또는 YYYY.M.D (뒤에 ~ 없음)
  if (!startDate) {
    m = tc.match(/(\d{4})[. ]+(\d{1,2})[. ]+(\d{1,2})(?:\s*\([^)]{1,3}\))?(?!\s*[~～])/)
    if (m && +m[1] >= 2020) {
      startDate = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`
      endDate   = startDate
      nights = 0; days = 1
      periodDisplay = `${+m[2]}월 ${+m[3]}일`
    }
  }

  // ── 장소 → 지역 ──
  const REGION_MAP = [
    ['제주특별자치도|제주도|제주시|서귀포', '제주'],
    ['서울특별시|여의도|여의나루|서울역|수서역', '서울'],
    ['강남구|강서구|마포구|종로구|용산구|성동구|송파구|강동구|노원구|도봉구|은평구|서대문구|동대문구|성북구|강북구|관악구|동작구|금천구|영등포구|구로구|양천구|서초구|광진구|중랑구', '서울'],
    ['경기도|인천광역시|수원시|성남시|용인시|고양시|안양시|부천시|평택시|화성시|파주시|김포시', '서울'],
    ['천안시|아산시|천안아산역', '천안'],
    ['오송|청주시', '오송'],
    ['대전광역시|대전시', '대전'],
    ['동대구|대구광역시|대구시', '동대구'],
    ['경주시|경주', '경주'],
    ['울산광역시|울산시', '울산'],
    ['부산광역시|부산시|해운대|동래|사하|금정', '부산'],
    ['전주시|전라북도', '전주'],
    ['순천시|광양시|여수시', '순천'],
    ['창원시|마산|진해|창원특례시', '창원'],
    ['진주시', '진주'],
  ]

  // 장소 라벨 근방의 텍스트에서 우선 탐색 (발신자 주소 오인 방지)
  let destination = ''
  const placeSection = tc.match(/(?:장\s*소|개최\s*지|행사\s*장소)\s*[：:]\s*([^.]{2,60})/)
  const placeText = placeSection ? placeSection[1] : tc

  for (const [keywords, region] of REGION_MAP) {
    if (new RegExp(keywords).test(placeText)) { destination = region; break }
  }
  // 장소 라벨 탐색 실패 시 전체 텍스트 스캔 (단, 발신처 주소 제외)
  if (!destination) {
    // 발신 주소 ('시행' 이후 텍스트 제거)
    const bodyText = tc.split(/시\s*행\s*:|발\s*신\s*처\s*:/)[0]
    for (const [keywords, region] of REGION_MAP) {
      if (new RegExp(keywords).test(bodyText)) { destination = region; break }
    }
  }

  // ── 등록비 (회원병원 기준 우선) ──
  let registration = null
  // 회원병원 금액
  const memberM = tn.match(/회원병원[:\-：\s]*([\d,]{4,})원?/)
  if (memberM) {
    const n = parseInt(memberM[1].replace(/,/g, ''))
    registration = n < 1000 ? n * 1000 : n
  }
  // 사전등록/등록비/교육비 등 키워드 이후 금액
  if (!registration) {
    const kwPats = ['사전등록비', '사전등록', '등록비', '참가비', '교육비', '수강료']
    for (const kw of kwPats) {
      const ki = tn.indexOf(norm(kw))
      if (ki >= 0) {
        const snip = tn.slice(ki, ki + norm(kw).length + 40)
        const m2 = snip.match(/(\d[\d,]{2,})원?/)
        if (m2) {
          const n2 = parseInt(m2[1].replace(/,/g, ''))
          if (n2 >= 1000) { registration = n2; break }
        }
      }
    }
  }

  return { title, periodDisplay, startDate, endDate, nights, days, destination, registration }
}

function renderParseResult(filename, meta, hasText) {
  const grid = document.getElementById('resultGrid')
  const resultEl = document.getElementById('parseResult')

  if (!hasText) {
    grid.innerHTML = `
      <div class="result-item full"><label>파일명</label><span>${escapeHtml(filename)}</span></div>
      <div class="result-warn full">
        <span>📷</span>
        <div><strong>스캔 이미지 PDF라 자동 인식이 어려워요</strong><p>다음 단계에서 직접 입력해주세요</p></div>
      </div>`
    resultEl.classList.remove('hidden')
    return
  }

  const fmt = v => v ? `<span>${escapeHtml(String(v))}</span>` : `<span class="empty">확인 안 됨</span>`
  const feeStr = meta.registration ? `${meta.registration.toLocaleString()}원` : ''

  grid.innerHTML = `
    <div class="result-item full"><label>파일명</label><span>${escapeHtml(filename)}</span></div>
    <div class="result-item full"><label>출장/교육명</label>${fmt(meta.title)}</div>
    <div class="result-item"><label>기간</label>${fmt(meta.periodDisplay)}</div>
    <div class="result-item"><label>장소</label>${fmt(meta.destination)}</div>
    <div class="result-item full"><label>등록비 (회원·사전납입 기준)</label>${fmt(feeStr)}</div>
  `
  resultEl.classList.remove('hidden')
}

function clearUpload() {
  document.getElementById('fileInput').value = ''
  document.getElementById('parseResult').classList.add('hidden')
  state.parsedMeta = null
  const cta = document.getElementById('ctaNext3')
  cta.disabled = true
  cta.classList.add('disabled')
}

function goFromCard3() {
  prepareCard4WithMeta()
  goToCard(4)
}

// ── CARD 4: 온라인 교육 시 "없어요" 숨기고 교육비 자동 설정 ────────────────────
function prepareCard4Online() {
  const btnNo  = document.getElementById('feeBtn-no')
  const noneMsg = document.getElementById('feeNoneMsg')
  if (state.isOnline) {
    // 온라인: 교육비 항상 있음 → 없어요 버튼 숨김, hasFee 자동 true
    if (btnNo) btnNo.classList.add('hidden')
    if (noneMsg) noneMsg.classList.add('hidden')
    if (state.hasFee !== true) selectFeePresence(true)
  } else {
    // 출장: 없어요 버튼 다시 표시
    if (btnNo) btnNo.classList.remove('hidden')
  }
}

// 자동채우기 하이라이트 helper
function setAutofilled(id, value) {
  const el = document.getElementById(id)
  if (!el || !value) return
  el.value = value
  el.classList.add('input-autofilled')
  // 사용자가 수정하면 하이라이트 제거
  el.addEventListener('input', () => el.classList.remove('input-autofilled'), { once: true })
}

// ── CARD 4: 출장 정보 확인 ────────────────────────────────────────────────────
function prepareCard4WithMeta() {
  const meta = state.parsedMeta
  if (!meta) return

  // 자동 채우기 (음영 하이라이트 포함)
  if (meta.title)     setAutofilled('input-title', meta.title)
  if (meta.startDate) setAutofilled('input-start', meta.startDate)
  if (meta.endDate)   setAutofilled('input-end', meta.endDate)
  if (meta.startDate && meta.endDate) onDateChange()
  if (meta.destination) {
    setAutofilled('input-region', meta.destination)
    onRegionInput()
  }
  if (meta.registration) {
    setAutofilled('input-fee', meta.registration.toLocaleString())
    state.fee = meta.registration
  }

  // 확인 뷰 메시지
  if (meta.periodDisplay && meta.days) {
    const durStr = meta.nights === 0 ? `${meta.days}일 (당일치기)` : `${meta.nights}박 ${meta.days}일`
    document.getElementById('c4-period-msg').textContent = `${meta.periodDisplay} — ${durStr} 출장이시군요!`
  }
  if (meta.destination) {
    document.getElementById('c4-place-msg').textContent = `지역: ${meta.destination}`
  }

  // 교육비 질문
  const feeQ = document.getElementById('c4-fee-q')
  if (meta.registration) {
    document.getElementById('c4-fee-label').textContent =
      `등록비가 ${meta.registration.toLocaleString()}원인 것 같아요`
    document.getElementById('c4-fee-sub').textContent = '사전납입·회원병원 기준 금액이에요. 맞나요?'
    feeQ.classList.remove('hidden')
  } else {
    feeQ.classList.add('hidden')
  }

  document.getElementById('c4-confirm-view').classList.remove('hidden')
  document.getElementById('c4-input-view').classList.add('hidden')
}

function showCard4InputMode() {
  document.getElementById('c4-confirm-view').classList.add('hidden')
  document.getElementById('c4-input-view').classList.remove('hidden')
  document.getElementById('c4-fee-q').classList.add('hidden')
}

function onDateChange() {
  const start = document.getElementById('input-start').value
  const end   = document.getElementById('input-end').value
  state.startDate = start
  state.endDate   = end

  // 날짜 박스 UI 업데이트
  updateDateBox('input-start', 'start-placeholder')
  updateDateBox('input-end',   'end-placeholder')

  if (start && end) {
    const ms = new Date(end) - new Date(start)
    state.nights = Math.max(0, Math.floor(ms / 86400000))
    state.days   = state.nights + 1
    const tag = document.getElementById('duration-tag')
    tag.textContent = state.nights === 0 ? `${state.days}일 (당일)` : `${state.nights}박 ${state.days}일`
    tag.classList.remove('hidden')
  }
}

// 달력 열기 — showPicker() 우선, 미지원 브라우저는 focus() 폴백
function openDatePicker(inputId) {
  const input = document.getElementById(inputId)
  if (!input) return
  try {
    input.showPicker()
  } catch {
    input.focus()
  }
}

function updateDateBox(inputId, placeholderId) {
  const input = document.getElementById(inputId)
  const ph    = document.getElementById(placeholderId)
  const box   = input?.closest('.date-input-box')
  if (!input || !ph || !box) return

  if (input.value) {
    const d = new Date(input.value)
    const m = d.getMonth() + 1
    const day = d.getDate()
    const dayNames = ['일','월','화','수','목','금','토']
    const dow = dayNames[d.getDay()]
    ph.textContent = `${m}월 ${day}일 (${dow})`
    box.classList.add('has-value')
  } else {
    ph.textContent = inputId === 'input-start' ? '시작' : '종료'
    box.classList.remove('has-value')
  }
}

// 출장 지역 자동완성 목록 (교통비 계산 기준 도시)
const REGION_HINTS = [
  '서울', '오송', '대전', '동대구', '경주', '울산', '부산',
  '전주', '순천', '창원', '진주', '천안', '제주',
]

// 카카오 장소 검색 디바운스 타이머
let _placeDebounce = null

function onPlaceInput() {
  const val = document.getElementById('input-place').value.trim()
  state.place = val

  const suggest = document.getElementById('placeSuggest')

  // 2글자 미만이면 드롭다운 닫기
  if (val.length < 2) {
    suggest.classList.add('hidden')
    suggest.innerHTML = ''
    return
  }

  // API 키 미입력 시 안내
  if (!KAKAO_API_KEY || KAKAO_API_KEY === 'YOUR_KAKAO_REST_API_KEY') {
    suggest.innerHTML = `<div class="suggest-notice">⚙️ app.js 상단에 KAKAO_API_KEY를 입력해주세요</div>`
    suggest.classList.remove('hidden')
    return
  }

  // 300ms 디바운스
  clearTimeout(_placeDebounce)
  suggest.innerHTML = `<div class="suggest-loading">검색 중…</div>`
  suggest.classList.remove('hidden')

  _placeDebounce = setTimeout(async () => {
    try {
      const res = await fetch(
        `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(val)}&size=7`,
        { headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` } }
      )
      if (!res.ok) throw new Error(res.status)
      const data = await res.json()
      const docs = data.documents || []

      if (!docs.length) {
        suggest.innerHTML = `<div class="suggest-notice">검색 결과가 없어요</div>`
        return
      }

      suggest.innerHTML = docs.map(d => {
        const name    = escapeHtml(d.place_name)
        const addr    = escapeHtml(d.road_address_name || d.address_name || '')
        const cat     = escapeHtml(d.category_name?.split(' > ').pop() || '')
        const nameRaw = d.place_name
        const addrRaw = d.road_address_name || d.address_name || ''
        return `
          <button class="suggest-item suggest-place-item"
            onclick="selectPlace('${nameRaw.replace(/'/g,"\\'")}', '${addrRaw.replace(/'/g,"\\'")}')">
            <span class="suggest-place-name">${name}</span>
            ${cat ? `<span class="suggest-place-cat">${cat}</span>` : ''}
            ${addr ? `<span class="suggest-place-addr">${addr}</span>` : ''}
          </button>`
      }).join('')
      suggest.classList.remove('hidden')

    } catch (e) {
      suggest.innerHTML = `<div class="suggest-notice">검색 오류 (API 키 확인)</div>`
    }
  }, 300)
}

function selectPlace(name, addr) {
  document.getElementById('input-place').value = name
  document.getElementById('placeSuggest').classList.add('hidden')
  state.place = name
  // 주소에서 지역 자동 채우기 (장소 선택 시 항상 덮어씀)
  if (addr) {
    const regionGuess = guessRegionFromAddress(addr)
    if (regionGuess) {
      document.getElementById('input-region').value = regionGuess
      state.region  = regionGuess
      state.isJeju  = regionGuess.includes('제주')
      state.isSeoul = regionGuess.includes('서울')
      document.getElementById('jeju-hint').classList.toggle('hidden', !state.isJeju)
      document.getElementById('regionSuggest').classList.add('hidden')
    }
  }
  updateDocStrip()
}

// 주소 문자열에서 운임표 기준 지역명 추출
function guessRegionFromAddress(addr) {
  const pairs = [
    // 수도권(서울·경기·인천) → '서울'
    ['서울', '서울'], ['경기', '서울'], ['인천', '서울'],
    // 제주
    ['제주', '제주'],
    // KTX 목적지
    ['대전', '대전'], ['오송', '오송'], ['천안', '천안'],
    ['울산', '울산'], ['경주', '경주'],
    ['대구', '동대구'],
    // 시외버스 목적지
    ['부산', '부산'], ['전주', '전주'], ['순천', '순천'],
    // 인근 지역
    ['창원', '창원'], ['진주', '진주'],
  ]
  for (const [keyword, region] of pairs) {
    if (addr.includes(keyword)) return region
  }
  return ''
}

function onRegionInput() {
  const val = document.getElementById('input-region').value.trim()
  state.region  = val
  state.isJeju  = val.includes('제주')
  state.isSeoul = val.includes('서울') || val.includes('여의도')

  document.getElementById('jeju-hint').classList.toggle('hidden', !state.isJeju)
  updateDocStrip()

  // 자동완성
  const suggest = document.getElementById('regionSuggest')
  if (val.length >= 1) {
    const matches = REGION_HINTS.filter(r =>
      r.startsWith(val) || val.startsWith(r.slice(0, 2))
    )
    if (matches.length && !matches.includes(val)) {
      suggest.innerHTML = matches.slice(0, 6).map(r =>
        `<button class="suggest-item" onclick="selectRegion('${r}')">${r}</button>`
      ).join('')
      suggest.classList.remove('hidden')
    } else {
      suggest.classList.add('hidden')
    }
  } else {
    suggest.classList.add('hidden')
  }
}

function selectRegion(region) {
  document.getElementById('input-region').value = region
  document.getElementById('regionSuggest').classList.add('hidden')
  state.region  = region
  state.isJeju  = region.includes('제주')
  state.isSeoul = region.includes('서울') || region.includes('여의도')
  document.getElementById('jeju-hint').classList.toggle('hidden', !state.isJeju)
  updateDocStrip()
}

// 교육비 유무 선택
function selectFeePresence(hasIt) {
  state.hasFee = hasIt
  state.fee = hasIt ? (state.fee || 0) : 0

  const btnYes = document.getElementById('feeBtn-yes')
  const btnNo  = document.getElementById('feeBtn-no')
  const amtWrap = document.getElementById('feeAmountWrap')
  const noneMsg = document.getElementById('feeNoneMsg')

  if (btnYes) btnYes.classList.toggle('selected-yes', hasIt)
  if (btnNo)  btnNo.classList.toggle('selected-no', !hasIt)

  amtWrap?.classList.toggle('hidden', !hasIt)
  noneMsg?.classList.toggle('hidden', hasIt)

  // 없어요 선택 시 fee 초기화
  if (!hasIt) {
    const feeEl = document.getElementById('input-fee')
    if (feeEl) feeEl.value = ''
    state.fee = 0
    state.feeStatus = 'no-fee'
    state.receiptType = null
  } else {
    state.feeStatus = null
  }

  // 트레일 다시 렌더 (5·6번 upcoming 표시)
  renderTrails()
  updateDocStrip()
}

function formatFeeInput(input) {
  const raw = input.value.replace(/[^0-9]/g, '')
  state.fee = parseInt(raw) || 0
  input.value = raw ? Number(raw).toLocaleString() : ''
}

// ── CARD 5: 등록비 기준 안내 준비 ────────────────────────────────────────────
// (prepareCard5는 goToCard(5) 전에 필요하면 호출, 현재는 HTML 고정)

// ── CARD 6: 납부 여부 ─────────────────────────────────────────────────────────
function select6(val) {
  state.feeStatus = val
  highlight(val)
  updateDocStrip()
  if (val === 'paid') {
    setTimeout(() => goToCard(7), 150)
  } else {
    // 납부 전 → 예정 방식 안내 패널 표시
    const sub = document.getElementById('c6-not-paid-sub')
    sub.classList.remove('hidden')
    document.getElementById('c6-btn-card')?.classList.remove('selected')
    document.getElementById('c6-btn-bank')?.classList.remove('selected')
    document.getElementById('c6-card-note')?.classList.add('hidden')
    document.getElementById('c6-bank-note')?.classList.add('hidden')
    // 패널로 스크롤
    sub.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

function select6NotPaidMethod(method) {
  document.getElementById('c6-btn-card').classList.toggle('selected', method === 'card')
  document.getElementById('c6-btn-bank').classList.toggle('selected', method === 'bank')
  document.getElementById('c6-card-note').classList.toggle('hidden', method !== 'card')
  document.getElementById('c6-bank-note').classList.toggle('hidden', method !== 'bank')
}

function confirmCard6NotPaid() {
  state.receiptType = null
  goToCard(8)
}

function resetCard6() {
  document.getElementById('c6-not-paid-sub')?.classList.add('hidden')
  document.getElementById('c6-btn-card')?.classList.remove('selected')
  document.getElementById('c6-btn-bank')?.classList.remove('selected')
  document.getElementById('c6-card-note')?.classList.add('hidden')
  document.getElementById('c6-bank-note')?.classList.add('hidden')
}

// ── CARD 7: 납부 형태 ─────────────────────────────────────────────────────────
// Card 7 진입 시 초기화
function resetCard7() {
  document.getElementById('c7CardNote')?.classList.add('hidden')
  document.getElementById('c7BankOpts')?.classList.add('hidden')
  document.getElementById('c7-btn-card')?.classList.remove('selected')
  document.getElementById('c7-btn-bank')?.classList.remove('selected')
}

// 1단계: 카드 / 계좌이체 선택
function select7PayMethod(method) {
  // 버튼 선택 표시
  document.getElementById('c7-btn-card').classList.toggle('selected', method === 'card')
  document.getElementById('c7-btn-bank').classList.toggle('selected', method === 'bank')

  if (method === 'card') {
    document.getElementById('c7CardNote').classList.remove('hidden')
    document.getElementById('c7BankOpts').classList.add('hidden')
  } else {
    document.getElementById('c7BankOpts').classList.remove('hidden')
    document.getElementById('c7CardNote').classList.add('hidden')
  }
}

// 2단계: 최종 영수증 종류 확정 → card 8로
function select7(val) {
  state.receiptType = val
  updateDocStrip()
  setTimeout(() => goToCard(8), 150)
}

// ── CARD 8: 추가 확인 준비 ───────────────────────────────────────────────────
function prepareCard8() {
  // field-before12는 항상 숨김
  document.getElementById('field-before12').classList.add('hidden')
  // 당일치기 → 항상 숙박으로 간주 (isDayTrip = false)
  state.isDayTrip = false

  // 8시간 이하 당일 출장 질문 표시 조건:
  // - 비수도권 + 당일(nights===0) + KTX 목적지가 아닌 경우
  // → KTX 등재 지역(대전·대구 등): 마산역 기준 이동시간만으로 8시간 초과 → 숨김
  // → 시외버스 지역(부산·울산·경주 등): 애매하므로 표시
  // → 운임표 없는 인근 지역(창원·진주 등): 표시
  const fare = getFare(state.region || state.place)
  const showShortDay = !state.isSeoul && (state.nights || 0) === 0 && !(fare && fare.ktxNormal)
  document.getElementById('field-shortdaytrip').classList.toggle('hidden', !showShortDay)
  if (!showShortDay) {
    state.isShortDayTrip = null
    document.querySelectorAll('#field-shortdaytrip .yn-btn').forEach(b => b.classList.remove('selected'))
  }

  const isShort   = state.isShortDayTrip === true
  const isDayTrip = (state.nights || 0) === 0

  // 8시간 이하 당일 출장이면 직급·서울12시·숙소·식사 질문 숨김
  // 당일 출장(nights=0)이면 숙소 질문도 숨김
  document.getElementById('field-rank').classList.toggle('hidden', isShort)
  document.getElementById('field-daytrip').classList.toggle('hidden', isShort || !state.isSeoul)
  document.getElementById('field-lodging').classList.toggle('hidden', isShort || isDayTrip)
  const showMeal = !isShort && (state.nights || 0) >= 2
  document.getElementById('field-meal').classList.toggle('hidden', !showMeal)

  // 제주: 항공 안내 표시, 셔틀은 항상 이용 가정 → 질문 숨기고 자동 true
  document.getElementById('field-plane').classList.toggle('hidden', !state.isJeju)
  document.getElementById('field-shuttle').classList.add('hidden') // 항상 숨김 (제주도 자동 true)
  if (state.isJeju) {
    state.hasPlane = true
    state.hasShuttle = true // 제주 공항 셔틀 항상 이용 가정 (법인카드 영수증 제출)
  }
}

// Y/N 버튼 선택 + 조건부 필드 show/hide
function setYN(field, val) {
  state[field] = val

  // 버튼 선택 표시
  const fieldMap = {
    isShortDayTrip:  'field-shortdaytrip',
    isMS:            'field-rank',
    before12:        'field-daytrip',   // field-daytrip에 통합됨
    lodgingProvided: 'field-lodging',
    mealProvided:    'field-meal',
    hasShuttle:      'field-shuttle',
  }
  const fieldEl = document.getElementById(fieldMap[field])
  if (fieldEl) {
    fieldEl.querySelectorAll('.yn-btn').forEach((btn, i) => {
      btn.classList.toggle('selected', (val === true && i === 0) || (val === false && i === 1))
    })
  }

  // isShortDayTrip 변경 시 → 다른 질문 연쇄 show/hide
  if (field === 'isShortDayTrip') {
    const isShort   = val === true
    const isDayTrip = (state.nights || 0) === 0
    document.getElementById('field-rank').classList.toggle('hidden', isShort)
    document.getElementById('field-daytrip').classList.toggle('hidden', isShort || !state.isSeoul)
    document.getElementById('field-lodging').classList.toggle('hidden', isShort || isDayTrip)
    const showMeal = !isShort && (state.nights || 0) >= 2
    document.getElementById('field-meal').classList.toggle('hidden', !showMeal)
    // 8시간 이하 당일이면 관련 state도 초기화
    if (isShort) {
      state.isMS = null; state.before12 = null
      state.lodgingProvided = null; state.mealProvided = null
      document.querySelectorAll('#field-rank .yn-btn, #field-daytrip .yn-btn, #field-lodging .yn-btn, #field-meal .yn-btn')
        .forEach(b => b.classList.remove('selected'))
    }
  }
  // before12 노트는 Card 9 예상 금액에서 표시 (Card 8에선 숨김)
}

// ── CARD 9: 예상 금액 계산 ───────────────────────────────────────────────────
function prepareCard9() {
  // 입력값 최신화
  state.place  = document.getElementById('input-place')?.value?.trim()  || state.place
  state.region = document.getElementById('input-region')?.value?.trim() || state.region
  state.fee    = parseInt((document.getElementById('input-fee')?.value || '').replace(/,/g, '')) || state.fee

  // 온라인 교육: 다음 버튼 텍스트 변경
  const nextBtn = document.getElementById('card9-next-btn')
  if (nextBtn) nextBtn.textContent = state.isOnline ? '구비서류 확인하기' : '출장신청서 작성하기'

  // 온라인 교육: 교통비·일당·숙박 없음 → 교육비만 계산
  if (state.isOnline) {
    const breakdown = []
    let total = 0
    if (state.fee > 0) {
      breakdown.push({ label: '교육비 / 등록비', amount: state.fee, note: '사전납입·회원병원 기준' })
      total += state.fee
    }
    const breakdownEl = document.getElementById('amountBreakdown')
    breakdownEl.innerHTML = breakdown.length
      ? breakdown.map(item => `
          <div class="breakdown-item">
            <div class="breakdown-left">
              <span class="breakdown-label">${item.label}</span>
              ${item.note ? `<span class="breakdown-note">${item.note}</span>` : ''}
            </div>
            <span class="breakdown-amount">${item.amount.toLocaleString()}원</span>
          </div>`).join('')
      : `<div class="breakdown-item"><span class="breakdown-label" style="color:#8b95a1">교육비 없음</span></div>`
    document.getElementById('totalAmount').textContent = `${total.toLocaleString()}원`
    document.getElementById('seoulBefore12Hint')?.classList.add('hidden')
    return
  }

  const isJeju  = state.isJeju
  const isSeoul = state.isSeoul
  const breakdown = []
  let total = 0

  // 1. 교통비 (지역 기준으로 운임 조회)
  const fare = getFare(state.region || state.place)
  if (isJeju) {
    breakdown.push({ label: '항공료 (제주)', amount: '실비', note: '법인카드 결제 · 신용카드 매출전표 제출 필수' })
    if (state.hasShuttle === true) {
      breakdown.push({ label: '공항 셔틀버스', amount: '실비', note: '법인카드 결제 · 신용카드 매출전표 제출 필수' })
    }
  } else if (fare) {
    const useFirst = state.isMS && fare.ktxFirst
    const fareAmt = useFirst ? fare.ktxFirst : (fare.ktxNormal ?? fare.bus ?? 0)
    const routeNote = `왕복 기준 · 마산역 → ${fare.label}`
    const fareLabel = fare.bus
      ? `시외버스 (${fare.label})`
      : `KTX ${useFirst ? '특실' : '일반실'} (${fare.label})`
    breakdown.push({ label: fareLabel, amount: fareAmt, note: routeNote })
    total += fareAmt
  } else if (state.region || state.place) {
    breakdown.push({ label: '교통비', amount: '직접 확인 필요', note: '운임표에 없는 지역' })
  }

  // 2. 일당 / 식사비 계산
  if (state.isShortDayTrip === true) {
    // ── 8시간 이하 당일 출장 예외 ──
    breakdown.push({ label: '일당', amount: 0, note: '교육+이동 8시간 이하 당일 출장 → 해당없음' })
    breakdown.push({ label: '식사비', amount: '1만원 이내', note: '법인카드 결제 필수 · 영수증 제출' })
    // 숙박비 없음 (당일)
  } else {
    let baseDays = Math.max(1, state.days || 1)
    const seoulBonus = isSeoul && state.before12 ? 1 : 0  // 전날 +1일
    const totalDays  = baseDays + seoulBonus
    const tripNights = Math.max(0, state.nights || 0)

    let dailyTotal = 0
    if (state.mealProvided && !state.isDayTrip && tripNights >= 2) {
      // 식사 지원: 출장 중간날만 25% 적용
      const middleDays    = Math.max(0, baseDays - 2)
      const tripNormDays  = baseDays - middleDays
      dailyTotal = seoulBonus * DAILY_RATE
                 + tripNormDays * DAILY_RATE
                 + middleDays * DAILY_RATE_25P
      const parts = []
      if (seoulBonus) parts.push(`전날 1일 × ${DAILY_RATE.toLocaleString()}원`)
      parts.push(`출장 ${tripNormDays}일 × ${DAILY_RATE.toLocaleString()}원`)
      if (middleDays > 0) parts.push(`중간 ${middleDays}일 × ${DAILY_RATE_25P.toLocaleString()}원 (25%)`)
      breakdown.push({ label: `일당 (${totalDays}일)`, amount: dailyTotal, note: parts.join(' + ') })
    } else {
      dailyTotal = totalDays * DAILY_RATE
      breakdown.push({ label: `일당 (${totalDays}일)`, amount: dailyTotal, note: `${totalDays}일 × ${DAILY_RATE.toLocaleString()}원` })
    }
    total += dailyTotal

    // 3. 숙박비 (제주 포함 동일 기준: 100,000원/박, 숙박제공시 0원)
    if (!state.isDayTrip) {
      if (state.lodgingProvided) {
        if (seoulBonus > 0) {
          const bonusLodging = seoulBonus * LODGING_RATE
          breakdown.push({ label: `숙박비 전날 (${seoulBonus}박)`, amount: bonusLodging, note: '12시 이전 출발 전날 · 본인 부담' })
          total += bonusLodging
        }
        if (tripNights > 0) {
          breakdown.push({ label: `숙박비 (${tripNights}박)`, amount: 0, note: '숙소 제공으로 미지급' })
        }
      } else {
        const baseNights = tripNights + seoulBonus
        if (baseNights > 0) {
          const lodgingTotal = baseNights * LODGING_RATE
          breakdown.push({ label: `숙박비 (${baseNights}박)`, amount: lodgingTotal, note: `${baseNights}박 × ${LODGING_RATE.toLocaleString()}원` })
          total += lodgingTotal
        }
      }
    }
  }

  // 4. 등록비
  if (state.fee > 0 && state.feeStatus === 'paid') {
    breakdown.push({ label: '교육비 / 등록비', amount: state.fee, note: '사전납입·회원병원 기준' })
    total += state.fee
  }

  // 렌더
  const breakdownEl = document.getElementById('amountBreakdown')
  breakdownEl.innerHTML = breakdown.map(item => {
    const isNum = typeof item.amount === 'number'
    const amtStr = isNum
      ? (item.amount === 0 ? '0원 (미지급)' : `${item.amount.toLocaleString()}원`)
      : item.amount
    return `
      <div class="breakdown-item">
        <div class="breakdown-left">
          <span class="breakdown-label">${item.label}</span>
          ${item.note ? `<span class="breakdown-note">${item.note}</span>` : ''}
        </div>
        <span class="breakdown-amount ${!isNum ? 'breakdown-amount-text' : ''}">${amtStr}</span>
      </div>`
  }).join('')

  const hasNonNum = breakdown.some(i => typeof i.amount !== 'number')
  document.getElementById('totalAmount').textContent = hasNonNum
    ? `${total.toLocaleString()}원 + 실비`
    : `${total.toLocaleString()}원`

  // 서울 12시 이전 선택 시 → 추가된 금액 강조 표시
  const seoulHintEl = document.getElementById('seoulBefore12Hint')
  if (seoulHintEl) {
    const show = isSeoul && state.before12 === true
    seoulHintEl.classList.toggle('hidden', !show)
    if (show) {
      seoulHintEl.innerHTML = `
        <div class="seoul-hint-title">✅ 12시 이전 출발 적용됨</div>
        <div class="seoul-hint-body">
          전날 출발 기준으로 아래 금액이 <strong>추가</strong>됐어요
          <div class="seoul-hint-items">
            <span>📅 일당 +1일</span><span class="seoul-hint-amt">+35,000원</span>
          </div>
          <div class="seoul-hint-items">
            <span>🏨 숙박비 +1박</span><span class="seoul-hint-amt">+100,000원</span>
          </div>
        </div>`
    }
  }
}

function getFare(place) {
  if (!place) return null
  for (const row of FARE_TABLE) {
    if (row.keywords.some(k => place.includes(k))) return row
  }
  return null
}

// ── 출장신청서 미리보기 ────────────────────────────────────────────────────────
function renderTripFormPreview() {
  const el = document.getElementById('tripFormWrap')
  if (!el) return

  const isJeju  = state.isJeju
  const isSeoul = state.isSeoul
  const seoulBonus  = isSeoul && state.before12 ? 1 : 0
  const baseDays    = Math.max(1, state.days || 1)
  const totalDays   = baseDays + seoulBonus
  const tripNights  = Math.max(0, state.nights || 0)
  const baseNights  = tripNights + seoulBonus
  const isShort     = state.isShortDayTrip === true

  // ── 일당 행 ──
  let dailyRow = ''
  if (isShort) {
    dailyRow = `<tr>
      <th class="tf-th">일당</th>
      <td class="tf-td">해당없음 (교육+이동 8시간 이하 당일 출장)</td>
    </tr>`
  } else {
    let dailyAmt = 0
    let dailyDesc = ''
    if (state.mealProvided && tripNights >= 2) {
      const mid  = Math.max(0, baseDays - 2)
      const norm = baseDays - mid
      dailyAmt   = seoulBonus * DAILY_RATE + norm * DAILY_RATE + mid * DAILY_RATE_25P
      const parts = []
      if (seoulBonus) parts.push(`@ 35,000 × ${seoulBonus}일(전날) × 1명 = ₩ ${(seoulBonus*DAILY_RATE).toLocaleString()}`)
      parts.push(`@ 35,000 × ${norm}일 × 1명 = ₩ ${(norm*DAILY_RATE).toLocaleString()}`)
      if (mid > 0) parts.push(`@ 8,750 × ${mid}일(중간·식사지원) × 1명 = ₩ ${(mid*DAILY_RATE_25P).toLocaleString()}`)
      dailyDesc = parts.join('<br>')
    } else {
      dailyAmt  = totalDays * DAILY_RATE
      dailyDesc = `@ 35,000 × ${totalDays}일 × 1명 = ₩ ${dailyAmt.toLocaleString()}`
    }
    dailyRow = `<tr>
      <th class="tf-th">일당</th>
      <td class="tf-td">${dailyDesc}</td>
    </tr>`
  }

  // ── 숙박비 행 (제주 포함 동일 기준: 100,000원/박, 숙박제공시 0원) ──
  let lodgingRow = ''
  if (isShort) {
    lodgingRow = `<tr>
      <th class="tf-th">숙박비</th>
      <td class="tf-td">해당없음</td>
    </tr>`
  } else if (state.lodgingProvided) {
    const bonusAmt = seoulBonus * LODGING_RATE
    const bonusPart = seoulBonus > 0
      ? `@ 100,000 × ${seoulBonus}박(전날) × 1명 = ₩ ${bonusAmt.toLocaleString()}<br>`
      : ''
    const tripPart = tripNights > 0
      ? `@ 100,000 × ${tripNights}박 × 1명 = ₩ 0 (숙소 제공 — 미지급)`
      : ''
    lodgingRow = `<tr>
      <th class="tf-th">숙박비</th>
      <td class="tf-td">${bonusPart}${tripPart}</td>
    </tr>`
  } else {
    if (baseNights > 0) {
      const lodgAmt = baseNights * LODGING_RATE
      lodgingRow = `<tr>
        <th class="tf-th">숙박비</th>
        <td class="tf-td">@ 100,000 × ${baseNights}박 × 1명 = ₩ ${lodgAmt.toLocaleString()}</td>
      </tr>`
    }
  }

  // ── 교통비 행 ──
  let fareRows = ''
  let fareTotal = 0
  if (isJeju) {
    fareRows = `
      <tr>
        <th class="tf-th tf-th-multi" rowspan="${state.hasShuttle === true ? 3 : 2}">교통비</th>
        <td class="tf-td tf-td-post">마산 → 제주&nbsp;&nbsp;사후정산 <span class="tf-post-badge">법인카드 결제 후 매출전표 제출</span></td>
      </tr>
      <tr>
        <td class="tf-td tf-td-post">제주 → 마산&nbsp;&nbsp;사후정산 <span class="tf-post-badge">법인카드 결제 후 매출전표 제출</span></td>
      </tr>
      ${state.hasShuttle === true ? `<tr>
        <td class="tf-td tf-td-post">공항 셔틀버스&nbsp;&nbsp;사후정산 <span class="tf-post-badge">법인카드 결제 후 매출전표 제출</span></td>
      </tr>` : ''}`
  } else {
    const fare = getFare(state.region || state.place)
    if (fare) {
      const useFirst  = state.isMS && fare.ktxFirst
      const fareAmt   = useFirst ? fare.ktxFirst : (fare.ktxNormal ?? fare.bus ?? 0)
      const half      = fareAmt / 2
      const modeLabel = fare.bus ? '시외버스' : `KTX(${useFirst ? '특실' : '일반'})`
      const dest      = fare.label
      fareTotal = fareAmt
      fareRows = `
        <tr>
          <th class="tf-th tf-th-multi" rowspan="2">교통비</th>
          <td class="tf-td">마산 → ${dest}&nbsp;&nbsp;@ ${half.toLocaleString()} × 1회 × 1명 = ₩ ${half.toLocaleString()} (${modeLabel} 편)</td>
        </tr>
        <tr>
          <td class="tf-td">${dest} → 마산&nbsp;&nbsp;@ ${half.toLocaleString()} × 1회 × 1명 = ₩ ${half.toLocaleString()} (${modeLabel} 편)</td>
        </tr>`
    } else if (state.region || state.place) {
      fareRows = `<tr>
        <th class="tf-th">교통비</th>
        <td class="tf-td">직접 확인 후 입력</td>
      </tr>`
    }
  }

  // ── 등록비 행 ──
  let feeRow = ''
  if (state.fee > 0 && (state.feeStatus === 'paid' || state.feeStatus === 'not-paid')) {
    feeRow = `<tr>
      <th class="tf-th">등록비</th>
      <td class="tf-td">@ ${state.fee.toLocaleString()} × 1명 = ₩ ${state.fee.toLocaleString()}</td>
    </tr>`
  }

  // ── 합계 ──
  let totalAmt = 0
  if (!isShort) {
    // 일당
    if (state.mealProvided && tripNights >= 2) {
      const mid = Math.max(0, baseDays - 2)
      totalAmt += seoulBonus * DAILY_RATE + (baseDays - mid) * DAILY_RATE + mid * DAILY_RATE_25P
    } else {
      totalAmt += totalDays * DAILY_RATE
    }
    // 숙박비 (제주 포함 동일 기준)
    if (state.lodgingProvided) totalAmt += seoulBonus * LODGING_RATE
    else totalAmt += baseNights * LODGING_RATE
    totalAmt += fareTotal
    if (state.fee > 0 && (state.feeStatus === 'paid' || state.feeStatus === 'not-paid')) {
      totalAmt += state.fee
    }
  }
  // 제주: 항공료는 실비(별도)이므로 합계에 "+ 항공료 실비" 표기
  const totalStr = isJeju
    ? `₩ ${totalAmt.toLocaleString()} + 항공료 실비`
    : `₩ ${totalAmt.toLocaleString()}`

  // ── 출장기간 텍스트 ──
  const DOW = ['일','월','화','수','목','금','토']
  const fmtDate = d => {
    if (!d) return ''
    const dt = new Date(d + 'T00:00:00')
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}(${DOW[dt.getDay()]})`
  }
  const periodStr = state.startDate && state.endDate
    ? `${fmtDate(state.startDate)} ~ ${fmtDate(state.endDate)}  (${tripNights}박 ${baseDays}일)`
    : '(출장 기간 미입력)'

  // ── 장소 ──
  const regionStr = state.region || ''
  const placeStr  = state.place  || ''
  const locStr = regionStr && placeStr
    ? `${regionStr} (${placeStr})`
    : (regionStr || placeStr || '(미입력)')

  // ── 특기사항 ──
  const tokgiItems = []
  if (isShort) {
    tokgiItems.push('교육+이동 8시간 이하 당일 출장 — 식사비 1만원 이내 법인카드 결제')
  } else {
    if (state.isMS === true)  tokgiItems.push('&lt;교통비&gt; MS 적용')
    if (state.isMS === false) tokgiItems.push('&lt;교통비&gt; MS 미적용')
    if (seoulBonus > 0) tokgiItems.push('서울 12시 이전 시작 — 전날 출발 적용 (+1일 +1박)')
  }
  if (isJeju) tokgiItems.push('제주 항공료·셔틀버스: 사후정산 (법인카드 결제 후 매출전표 제출)')
  const tokgiStr = tokgiItems.length
    ? tokgiItems.map(t => `• ${t}`).join('<br>')
    : '—'

  el.innerHTML = `
    <div class="trip-form-section-label">📋 출장신청서 작성 참고</div>
    <p class="trip-form-section-note">S-Portal 전자결재 작성 시 아래 내용을 참고하세요 · 성명·결재선은 직접 입력</p>

    <div class="tf-box">
      <div class="tf-title">출 장 신 청 서</div>
      <table class="tf-table">
        <tbody>
          <tr>
            <th class="tf-th">소 속</th>
            <td class="tf-td">${state.dept || '<span class="tf-blank">소속 입력</span>'}</td>
            <th class="tf-th">성 명</th>
            <td class="tf-td">${state.name || '<span class="tf-blank">성명 입력</span>'}</td>
          </tr>
          <tr>
            <th class="tf-th">사 유</th>
            <td class="tf-td" colspan="3">${state.title || '(미입력)'}</td>
          </tr>
          <tr>
            <th class="tf-th">출장지역</th>
            <td class="tf-td" colspan="3">${locStr}</td>
          </tr>
          <tr>
            <th class="tf-th">출장기간</th>
            <td class="tf-td" colspan="3">${periodStr}</td>
          </tr>
          <tr>
            <th class="tf-th">특기사항</th>
            <td class="tf-td" colspan="3">${tokgiStr}</td>
          </tr>
        </tbody>
      </table>

      <div class="tf-settle-header">※ 출장여비 정산내역</div>
      <table class="tf-table">
        <tbody>
          ${dailyRow}
          ${lodgingRow}
          ${fareRows}
          ${feeRow}
        </tbody>
      </table>

      <div class="tf-total-row">
        <span class="tf-total-label">출장비 합계</span>
        <span class="tf-total-amount">${totalStr}</span>
      </div>
    </div>`
}

// ── CARD 10: 출장신청서 미리보기 ─────────────────────────────────────────────
function prepareCard10() {
  const deptEl = document.getElementById('input-dept')
  const nameEl = document.getElementById('input-name')
  if (deptEl) state.dept = deptEl.value
  if (nameEl) state.name = nameEl.value
  renderTripFormPreview()
}

// 소속/성명 입력 시 실시간 반영
function onPersonInput() {
  state.dept = document.getElementById('input-dept')?.value || ''
  state.name = document.getElementById('input-name')?.value || ''
  renderTripFormPreview()
}

// ── CARD 11: 구비서류 + 완료 ─────────────────────────────────────────────────
const RECEIPT_LABELS = {
  'card-receipt': '신용카드 매출전표',
  'tax-invoice':  '세금계산서',
  'cash-receipt': '현금영수증',
  'transfer':     '계좌이체내역서 + 학회 수료·이수증',
}

function prepareCard11() {
  // ── 구비서류 체크리스트 ──
  const items = []
  items.push({ icon: '📋', title: '출장신청서', desc: '출발 전 결재 완료된 신청서 — 내부 승인 절차가 적법하게 이루어졌는지 확인' })
  items.push({ icon: '📄', title: '출장 관련 공문', desc: '출장 장소·일정·등록비 등이 신청서 내용과 일치하는지 한 번 더 확인' })

  // 8시간 이하 당일 출장: 식사비 법인카드 영수증
  if (state.isShortDayTrip === true) {
    items.push({ icon: '🍽️', title: '식사비 신용카드 매출전표', desc: '법인카드로 결제 · 1만원 이내', shortday: true })
  }

  if (state.feeStatus === 'paid' && state.receiptType) {
    const rLabel = RECEIPT_LABELS[state.receiptType] || '영수증'
    const rDesc  = state.receiptType === 'transfer'
      ? '계좌이체내역서·카드영수증·세금계산서·이수증 등 — 세법상 비용으로 인정받기 위한 적격증빙 수취 여부 확인'
      : '계좌이체내역서·카드영수증·세금계산서·이수증 등 — 세법상 비용으로 인정받기 위한 적격증빙 수취 여부 확인'
    items.push({ icon: '🧾', title: rLabel, desc: rDesc })
  } else if (state.feeStatus === 'not-paid') {
    items.push({ icon: '🧾', title: '교육비 / 등록비 영수증', desc: '계좌이체내역서·카드영수증·세금계산서·이수증 등 — 세법상 비용으로 인정받기 위한 적격증빙 수취 여부 확인', pending: true })
  }

  if (state.isJeju) {
    // 항공료: 제주 출장 시 항상 필수
    items.push({ icon: '✈️', title: '항공료 신용카드 매출전표', desc: '법인카드로 결제 · 왕복 모두 제출', jeju: true })
    // 셔틀버스: 이용 여부에 따라 조건부
    if (state.hasShuttle === true) {
      items.push({ icon: '🚌', title: '공항 셔틀버스 신용카드 매출전표', desc: '법인카드로 결제 · 영수증 제출', jeju: true })
    }
  }

  document.getElementById('finalChecklist').innerHTML = items.map(item => `
    <label class="final-check-item ${item.pending ? 'pending' : ''} ${item.jeju ? 'jeju' : ''} ${item.shortday ? 'shortday' : ''}">
      <input type="checkbox" class="doc-checkbox" />
      <span class="doc-checkmark">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5l2.5 2.5 4.5-5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <div class="final-check-text">
        <strong>${item.icon} ${item.title}</strong>
        <span>${item.desc}</span>
        ${item.pending ? '<span class="pending-badge">교육 및 학회 이수 후 수령 필요</span>' : ''}
        ${item.jeju ? '<span class="doc-badge-jeju">제주 한정</span>' : ''}
        ${item.shortday ? '<span class="doc-badge-shortday">법인카드 필수</span>' : ''}
      </div>
    </label>`).join('')

  // ── 전표 처리 안내: 피출장인이 할 일 1가지만 ──
  document.getElementById('voucherItems').innerHTML = `
    <div class="voucher-step">
      <span class="voucher-step-num">1</span>
      <span>출장신청서 · 공문 · 영수증을 묶어 <strong>전표 처리자에게 제출</strong></span>
    </div>`

  // ── 세금계산서 수령 시 긴급 안내 ──
  const taxWarnEl = document.getElementById('taxInvoiceWarn')
  if (taxWarnEl) {
    const isTax = state.receiptType === 'tax-invoice'
    taxWarnEl.classList.toggle('hidden', !isTax)
  }
}

// ── 구비서류 스트립 ───────────────────────────────────────────────────────────
const RECEIPT_CHIP_LABELS = {
  'card-receipt': '💳 신용카드전표',
  'tax-invoice':  '🧾 세금계산서',
  'cash-receipt': '🏧 현금영수증',
  'transfer':     '🏦 계좌이체+이수증',
}

function updateDocStrip() {
  // 3번: 영수증 칩 라벨 업데이트
  const chip3Label = document.getElementById('chip3-label')
  if (chip3Label) {
    chip3Label.textContent = state.receiptType
      ? RECEIPT_CHIP_LABELS[state.receiptType]
      : '🧾 교육비 영수증'
  }

  // 3번: 납부 형태 선택됐으면 자동 체크
  const chip3 = document.getElementById('chip3')
  const chip3Wrap = document.getElementById('chip-wrap-3')
  if (chip3 && chip3Wrap) {
    const autoCheck = !!(state.feeStatus === 'paid' && state.receiptType)
    if (autoCheck) {
      chip3.checked = true
      chip3Wrap.classList.add('auto-checked')
    } else if (state.feeStatus === 'no-fee') {
      // 등록비 없는 경우: 3번 칩 흐리게 (해당 없음)
      chip3Wrap.style.opacity = '0.4'
      chip3Wrap.style.pointerEvents = 'none'
    } else {
      chip3Wrap.style.opacity = ''
      chip3Wrap.style.pointerEvents = ''
      chip3Wrap.classList.remove('auto-checked')
    }
  }

  // 4번: 제주 여부에 따라 표시/숨김
  const chip4Wrap = document.getElementById('chip-wrap-4')
  if (chip4Wrap) {
    chip4Wrap.classList.toggle('hidden', !state.isJeju)
  }

  // 2번: 공문 업로드 완료 시 자동 체크
  const chip2 = document.getElementById('chip2')
  const chip2Wrap = document.getElementById('chip-wrap-2')
  if (chip2 && chip2Wrap) {
    const autoCheck2 = !!(state.hasDoc && state.parsedMeta)
    if (autoCheck2) {
      chip2.checked = true
      chip2Wrap.classList.add('auto-checked')
    } else {
      chip2Wrap.classList.remove('auto-checked')
    }
  }

  // 카운터 업데이트
  updateStripCounter()
}

function onChipChange(chipNum, checked) {
  // 수동 체크 → auto-checked 클래스 제거
  const wrap = document.getElementById(`chip-wrap-${chipNum}`)
  if (wrap) wrap.classList.remove('auto-checked')
  updateStripCounter()
}

function updateStripCounter() {
  const isJeju = state.isJeju
  const totalEl = document.getElementById('docTotalCount')
  const checkedEl = document.getElementById('docCheckedCount')
  if (!totalEl || !checkedEl) return

  const total = isJeju ? 4 : (state.feeStatus === 'no-fee' ? 2 : 3)
  totalEl.textContent = total

  let checked = 0
  for (let i = 1; i <= (isJeju ? 4 : 3); i++) {
    if (i === 4 && !isJeju) continue
    const cb = document.getElementById(`chip${i}`)
    if (cb?.checked) checked++
  }
  checkedEl.textContent = checked
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function highlight(choice) {
  document.querySelectorAll(`[data-choice="${choice}"]`).forEach(btn => {
    btn.classList.add('selected')
    setTimeout(() => btn.classList.remove('selected'), 300)
  })
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function restartFlow() {
  Object.assign(state, {
    currentCard: 1, tripStatus: null, isOnline: false, hasDoc: null, parsedMeta: null,
    title: '', startDate: '', endDate: '', nights: 0, days: 0,
    place: '', region: '', isJeju: false, isSeoul: false, fee: 0,
    hasFee: null, feeStatus: null, receiptType: null,
    dept: '', name: '',
    isMS: null, isShortDayTrip: null, isDayTrip: null, before12: null,
    lodgingProvided: null, mealProvided: null, hasPlane: null, hasShuttle: null,
  })
  // 폼 초기화
  ;['input-title','input-start','input-end','input-place','input-region','input-fee','input-dept','input-name'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.value = ''
  })
  document.getElementById('duration-tag')?.classList.add('hidden')
  document.getElementById('jeju-hint')?.classList.add('hidden')
  document.getElementById('parseResult')?.classList.add('hidden')
  document.querySelectorAll('.yn-btn').forEach(b => b.classList.remove('selected'))
  document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'))

  // 카드 전체 리셋
  document.querySelectorAll('.flow-card').forEach(card => {
    card.classList.remove('active','exit-left')
    card.style.transform = 'translateX(100%)'
    card.style.transition = 'none'
  })
  const card1 = document.getElementById('card-1')
  card1.classList.add('active')
  card1.style.transform = ''
  updateProgress()
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateProgress()

  // 장소 검색 드롭다운 외부 클릭 시 닫기
  document.addEventListener('click', e => {
    const placeWrap = document.getElementById('input-place')?.closest('.place-input-wrap')
    if (placeWrap && !placeWrap.contains(e.target)) {
      document.getElementById('placeSuggest')?.classList.add('hidden')
    }
    const regionWrap = document.getElementById('input-region')?.closest('.place-input-wrap')
    if (regionWrap && !regionWrap.contains(e.target)) {
      document.getElementById('regionSuggest')?.classList.add('hidden')
    }
  })
})
