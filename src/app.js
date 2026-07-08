// ── 카카오 장소 검색 API 키 ────────────────────────────────────────────────────
// developers.kakao.com → 내 애플리케이션 → REST API 키
const KAKAO_API_KEY = (typeof window !== 'undefined' && window.KAKAO_API_KEY) || ''

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
  fareOverride: null,   // 교통비 수동 입력 (null이면 자동 계산)
  formEditMode: false,  // 출장신청서 수정 패널 열림 여부
}

// ── KTX / 버스 운임표 (마산역 출발 왕복) — data/rates.json 에서 로드됨 ────────
let FARE_TABLE = [
  { keywords: ['서울'],          label: '서울역',    ktxNormal: 106600, ktxFirst: 149600 },
  { keywords: ['수서'],          label: '수서역',    ktxNormal: 102000, ktxFirst: 143000 },
  { keywords: ['천안', '아산'],  label: '천안아산역', ktxNormal: 90000,  ktxFirst: 126000 },
  { keywords: ['오송'],          label: '오송역',    ktxNormal: 84000,  ktxFirst: 118000 },
  { keywords: ['대전'],          label: '대전역',    ktxNormal: 68000,  ktxFirst: 95000  },
  { keywords: ['부산', '해운대'], label: '부산',     bus: 19600 },
  { keywords: ['대구'],          label: '동대구역',  ktxNormal: 76000,  ktxFirst: 106000 },
  { keywords: ['울산'],          label: '울산',      bus: 29000 },
  { keywords: ['경주'],          label: '신경주역',   ktxNormal: 34200,  ktxFirst: 48200  },
  { keywords: ['전주'],          label: '전주',      bus: 46000 },
  { keywords: ['제주'],          label: '제주',      jeju: true },
]

let DAILY_RATE     = 35000
let DAILY_RATE_25P = 8750   // 25% (숙소·식사 제공 중간날)
let LODGING_RATE   = 100000

async function loadRates() {
  try {
    const r = await fetch('./data/rates.json?t=' + Date.now())
    if (!r.ok) return
    const d = await r.json()
    if (Array.isArray(d.fareTable) && d.fareTable.length) FARE_TABLE = d.fareTable
    if (d.dailyRate)    DAILY_RATE     = d.dailyRate
    if (d.dailyRate25p) DAILY_RATE_25P = d.dailyRate25p
    if (d.lodgingRate)  LODGING_RATE   = d.lodgingRate
  } catch {}
}

// ── 카드 내비게이션 ───────────────────────────────────────────────────────────
function goToCard(n) {
  const current = document.getElementById(`card-${state.currentCard}`)
  const next    = document.getElementById(`card-${n}`)
  if (!next) return

  // 진입 전 준비
  if (n === 4) {
    selectOnlineMode(state.isOnline)              // 토글 UI 동기화
    // fee Q 박스: meta 있으면 다시 노출 (뒤로가기 재진입 시)
    const feeQ = document.getElementById('c4-fee-q')
    if (feeQ && state.parsedMeta?.registration && state.hasFee !== true) {
      feeQ.classList.remove('hidden')
    }
  }
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
    // ── 뒤로가기 (다중 스텝 점프 포함) ──
    // 목적지 카드를 제외한 '모든' 카드를 transition 없이 즉시 화면 밖으로 초기화.
    // exit-left 상태로 잔류하는 카드가 목적지 카드 위에 겹쳐 보이는 버그 방지.
    const allCards = document.querySelectorAll('.flow-card')
    allCards.forEach(el => {
      if (el === next) return              // 목적지 카드는 건드리지 않음
      el.style.transition = 'none'        // 애니메이션 즉시 비활성화
      el.classList.remove('active', 'exit-left')
      el.style.transform = 'translateX(100%)'  // 화면 오른쪽으로 명시 이동
    })
    // 목적지 카드 즉시 중앙에 표시
    next.style.transition = 'none'
    next.classList.remove('exit-left')
    next.classList.add('active')
    next.style.transform = 'translateX(0)'

    // 2프레임 후 모든 카드의 inline 스타일 제거 → CSS 제어로 복귀
    // (이후 앞으로 이동 시 애니메이션이 정상 동작)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      allCards.forEach(el => {
        el.style.transition = ''
        el.style.transform = ''
      })
    }))
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
// ── Card 4 유효성 검사 ────────────────────────────────────────────────────────
function validateCard4() {
  // 최신 state 반영
  state.title  = document.getElementById('input-title')?.value.trim()  || state.title
  state.region = document.getElementById('input-region')?.value.trim() || state.region
  state.place  = document.getElementById('input-place')?.value.trim()  || state.place
  state.fee    = parseInt((document.getElementById('input-fee')?.value || '').replace(/,/g,'')) || state.fee

  const errs = []

  // 1. 출장/교육명
  const titleEl = document.getElementById('input-title')
  if (!titleEl?.value.trim()) {
    errs.push({ id: 'input-title', label: '출장 / 교육명' })
    titleEl?.classList.add('input-error')
  } else {
    titleEl?.classList.remove('input-error')
  }

  // 2. 출장 기간 (시작일)
  const startEl = document.getElementById('input-start')
  if (!startEl?.value) {
    errs.push({ id: 'start-box', label: '출장 시작일' })
    document.getElementById('start-box')?.classList.add('input-error')
  } else {
    document.getElementById('start-box')?.classList.remove('input-error')
  }

  // 3. 출장 기간 (종료일)
  const endEl = document.getElementById('input-end')
  if (!endEl?.value) {
    errs.push({ id: 'end-box', label: '출장 종료일' })
    document.getElementById('end-box')?.classList.add('input-error')
  } else {
    document.getElementById('end-box')?.classList.remove('input-error')
  }

  // 4. 출장 지역 (오프라인만 필수)
  if (!state.isOnline) {
    const regionEl = document.getElementById('input-region')
    if (!regionEl?.value.trim()) {
      errs.push({ id: 'input-region', label: '출장 지역' })
      regionEl?.classList.add('input-error')
    } else {
      regionEl?.classList.remove('input-error')
    }
  }

  // 5. 교육/등록비 선택 여부
  if (state.hasFee === null) {
    errs.push({ id: 'field-fee', label: '교육 / 등록비 유무 선택' })
    document.getElementById('field-fee')?.classList.add('field-error')
  } else {
    document.getElementById('field-fee')?.classList.remove('field-error')

    // 6. 등록비 금액 (있어요 선택 시)
    if (state.hasFee === true) {
      const feeEl = document.getElementById('input-fee')
      const feeVal = parseInt((feeEl?.value || '').replace(/,/g,'')) || 0
      if (feeVal <= 0) {
        errs.push({ id: 'input-fee', label: '등록비 금액' })
        feeEl?.classList.add('input-error')
      } else {
        feeEl?.classList.remove('input-error')
      }
    }
  }

  return errs
}

// ── Card 4 에러 배너 렌더 ──────────────────────────────────────────────────────
function renderCard4Errors(errs) {
  let banner = document.getElementById('c4-err-banner')
  if (!banner) {
    banner = document.createElement('div')
    banner.id = 'c4-err-banner'
    banner.className = 'c4-err-banner'
    // card-footer 바로 앞에 삽입
    const footer = document.querySelector('#card-4 .card-footer')
    footer?.parentNode.insertBefore(banner, footer)
  }

  if (errs.length === 0) {
    banner.classList.add('hidden')
    return
  }

  banner.classList.remove('hidden')
  banner.innerHTML = `
    <div class="c4-err-icon">⚠️</div>
    <div class="c4-err-body">
      <strong>아래 항목을 채워주세요</strong>
      <ul class="c4-err-list">
        ${errs.map(e => `<li>${e.label}</li>`).join('')}
      </ul>
    </div>`

  // 첫 번째 오류 필드로 스크롤
  const firstId = errs[0].id
  const firstEl = document.getElementById(firstId)
  if (firstEl) {
    firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // 포커스 (input인 경우)
    if (firstEl.tagName === 'INPUT') firstEl.focus()
  }
}

// ── Card 4 입력 변경 시 에러 실시간 해제 ──────────────────────────────────────
function clearCard4Error(id) {
  document.getElementById(id)?.classList.remove('input-error', 'field-error')
  const banner = document.getElementById('c4-err-banner')
  if (banner && !document.querySelector('#card-4 .input-error, #card-4 .field-error')) {
    banner.classList.add('hidden')
  }
}

function goFromCard4() {
  const errs = validateCard4()
  if (errs.length > 0) {
    renderCard4Errors(errs)
    // CTA 버튼 흔들기
    const btn = document.getElementById('ctaNext4')
    btn?.classList.add('shake')
    setTimeout(() => btn?.classList.remove('shake'), 600)
    return
  }
  // 에러 없음 → 배너 숨기기 + 다음 카드로
  document.getElementById('c4-err-banner')?.classList.add('hidden')
  if (state.hasFee === true) {
    goToCard(6)
  } else if (state.isOnline) {
    goToCard(9)
  } else {
    goToCard(8)
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

  // 현재 단계 정보 텍스트
  const currentIdx = visibleSteps.findIndex(s => s.card === state.currentCard)
  const currentLabel = currentIdx >= 0 ? visibleSteps[currentIdx].label : ''
  // 모바일: "3 / 9단계  정보 확인" (텍스트만)
  // 데스크톱: "3 / 9단계 · 정보 확인"
  const stepText = currentIdx >= 0
    ? `${currentIdx + 1} / ${visibleSteps.length}단계 · ${currentLabel}`
    : ''
  const isMobile = window.innerWidth <= 480

  STEPS.forEach(({ card }) => {
    if (card === 11) return  // 완료 화면은 trail 없음
    const trailEl = document.getElementById(`trail-${card}`)
    if (!trailEl) return

    // 라벨은 trail 외부(trail-current-info)에 표시 — overflow clipping 방지
    let html = ''

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
        </button>`
    })

    trailEl.innerHTML = html

    // 현재 단계 텍스트를 trail 바깥 형제 요소(trail-current-info)에 표시
    // → overflow-x:auto 컨테이너 밖이므로 클리핑 없음
    let infoEl = trailEl.nextElementSibling
    if (!infoEl || !infoEl.classList.contains('trail-current-info')) {
      infoEl = document.createElement('div')
      infoEl.className = 'trail-current-info'
      trailEl.after(infoEl)
    }
    // 모바일: 배지 형태 HTML, 데스크톱: 텍스트
    if (isMobile && stepText) {
      const [stepNum, labelPart] = stepText.split(' · ')
      infoEl.innerHTML = `<span class="trail-mob-badge">${stepNum}</span><span class="trail-mob-label">${labelPart || ''}</span>`
    } else {
      infoEl.textContent = stepText
    }

    // 현재 단계 점을 trail 수평 스크롤 내에서 center로 위치
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
  state.isOnline = false   // 온라인/오프라인은 Card 4에서 결정
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
const RING_CIRCUMFERENCE = 2 * Math.PI * 60  // r=60 → 376.99

function setParseProgress(pct, label) {
  pct = Math.min(100, Math.max(0, Math.round(pct)))
  const arc   = document.getElementById('ringProgress')
  const pctEl = document.getElementById('parseProgressPct')
  const lblEl = document.getElementById('parseProgressLabel')
  if (arc) {
    const offset = RING_CIRCUMFERENCE * (1 - pct / 100)
    arc.style.strokeDashoffset = offset
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

  try {
    if (ext === 'pdf') {
      setParseProgress(3, 'PDF 라이브러리 로딩 중')
      try {
        await ensurePdfJs()  // 로드 대기
      } catch (_) { /* ignore */ }
      setParseProgress(5, 'PDF 읽는 중')
      try {
        text = await extractPdfText(file)
        console.log('PDF 텍스트 추출 성공, 길이:', text.replace(/\s/g, '').length)
      } catch (e) {
        console.warn('PDF 텍스트 추출 실패:', e.message, '→ OCR 시도')
        text = ''
      }
      // 텍스트가 거의 없으면 이미지 기반 PDF → OCR
      if (text.replace(/\s/g, '').length < 50) {
        setParseProgress(10, 'OCR 처리 중 (이미지 PDF)')
        console.log('텍스트 부족 → OCR 시작')
        try {
          text = await ocrPdfPages(file)
          console.log('OCR 결과 길이:', text.replace(/\s/g, '').length)
        } catch (e) {
          console.warn('OCR 실패:', e.message)
          text = ''
        }
      }
    } else if (['jpg','jpeg','png'].includes(ext)) {
      try {
        text = await ocrImage(file)
      } catch (e) {
        console.warn('이미지 OCR 실패:', e)
        text = ''
      }
    }
  } catch (e) {
    console.error('파일 처리 오류:', e)
    setParseProgress(0, '오류 발생')
    document.getElementById('parseLoading').classList.add('hidden')
    showUploadError('파일을 읽는 중 오류가 발생했어요. 다른 파일을 시도해주세요.')
    return
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

function showUploadError(msg) {
  const grid = document.getElementById('resultGrid')
  const resultEl = document.getElementById('parseResult')
  if (!grid || !resultEl) return
  grid.innerHTML = `
    <div class="result-warn full">
      <span>⚠️</span>
      <div><strong>파일을 읽지 못했어요</strong><p>${escapeHtml(msg)}</p></div>
    </div>`
  resultEl.classList.remove('hidden')
  const cta = document.getElementById('ctaNext3')
  if (cta) { cta.disabled = false; cta.classList.remove('disabled') }
}

// pdfjs-dist CDN 로드 보장 (미로드 시 동적 재시도)
let _pdfJsPromise = null
async function ensurePdfJs() {
  if (typeof pdfjsLib !== 'undefined') return true
  if (_pdfJsPromise) return _pdfJsPromise
  _pdfJsPromise = new Promise(resolve => {
    // 이미 <script> 태그가 있으면 로드 완료 대기 (최대 10초)
    const existing = document.querySelector('script[src*="pdfjs-dist"]')
    if (existing) {
      const t0 = Date.now()
      const check = setInterval(() => {
        if (typeof pdfjsLib !== 'undefined') { clearInterval(check); resolve(true) }
        else if (Date.now() - t0 > 10000) { clearInterval(check); resolve(false) }
      }, 200)
      return
    }
    // 스크립트 태그 자체가 없으면 동적으로 삽입
    const urls = [
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
      'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
    ]
    let idx = 0
    const tryLoad = () => {
      if (idx >= urls.length) { resolve(false); return }
      const s = document.createElement('script')
      s.src = urls[idx++]
      s.onload = () => resolve(typeof pdfjsLib !== 'undefined')
      s.onerror = tryLoad
      document.head.appendChild(s)
    }
    tryLoad()
    setTimeout(() => resolve(typeof pdfjsLib !== 'undefined'), 15000)
  })
  return _pdfJsPromise
}

// PDF 텍스트 레이어 추출 (페이지별 진행률, 15초 타임아웃)
async function extractPdfText(file) {
  const ok = await ensurePdfJs()
  if (!ok) throw new Error('pdfjs 로드 실패 — 네트워크를 확인해주세요')
  // 워커 소스 설정
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
  } catch (_) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = ''
  }
  const ab = await file.arrayBuffer()

  const loadingTask = pdfjsLib.getDocument({ data: ab })
  loadingTask.onPassword = (_, onError) => onError(new Error('암호화된 PDF'))

  // 20초 타임아웃: 무한 대기 방지
  const pdf = await Promise.race([
    loadingTask.promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('PDF_TIMEOUT')), 20000))
  ])

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
  const ok = await ensurePdfJs()
  if (!ok) return ''
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
  const ab = await file.arrayBuffer()

  const pdf = await Promise.race([
    pdfjsLib.getDocument({ data: ab }).promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('PDF_TIMEOUT')), 20000))
  ])

  const parts = []
  const maxPages = Math.min(pdf.numPages, 3)
  for (let i = 1; i <= maxPages; i++) {
    setParseProgress(10 + Math.round(((i - 1) / maxPages) * 75), `OCR ${i}/${maxPages} 페이지`)
    try {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 2.0 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'))
      const pageBase = 10 + Math.round(((i - 1) / maxPages) * 75)
      const pageEnd  = 10 + Math.round((i / maxPages) * 75)
      const result = await ocrBlob(blob, pageBase, pageEnd)
      parts.push(result)
    } catch (pageErr) {
      console.warn(`페이지 ${i} OCR 실패:`, pageErr)
    }
  }
  return parts.join('\n')
}

// 이미지 파일 OCR
async function ocrImage(file) {
  return ocrBlob(file, 5, 90)
}

// Tesseract CDN 로드 보장
let _tessPromise = null
async function ensureTesseract() {
  if (typeof Tesseract !== 'undefined') return true
  if (_tessPromise) return _tessPromise
  _tessPromise = new Promise(resolve => {
    const existing = document.querySelector('script[src*="tesseract"]')
    if (existing) {
      const t0 = Date.now()
      const check = setInterval(() => {
        if (typeof Tesseract !== 'undefined') { clearInterval(check); resolve(true) }
        else if (Date.now() - t0 > 15000) { clearInterval(check); resolve(false) }
      }, 200)
      return
    }
    const urls = [
      'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
      'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js',
    ]
    let idx = 0
    const tryLoad = () => {
      if (idx >= urls.length) { resolve(false); return }
      const s = document.createElement('script')
      s.src = urls[idx++]
      s.onload = () => resolve(typeof Tesseract !== 'undefined')
      s.onerror = tryLoad
      document.head.appendChild(s)
    }
    tryLoad()
    setTimeout(() => resolve(typeof Tesseract !== 'undefined'), 20000)
  })
  return _tessPromise
}

// Tesseract OCR (Tesseract logger로 실제 진행률 반영, 90초 타임아웃)
async function ocrBlob(blob, pctStart = 5, pctEnd = 90) {
  setParseProgress(pctStart, 'OCR 엔진 로딩 중')
  const ok = await ensureTesseract()
  if (!ok) {
    console.warn('Tesseract 로드 실패 — OCR 건너뜀')
    return ''
  }
  try {
    const ocrPromise = Tesseract.recognize(blob, 'kor+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          const p = pctStart + Math.round(m.progress * (pctEnd - pctStart))
          setParseProgress(p, 'OCR 인식 중')
        } else if (m.status === 'loading tesseract core') {
          setParseProgress(pctStart, '엔진 로딩 중')
        } else if (m.status === 'initializing api') {
          setParseProgress(pctStart + 5, '초기화 중')
        } else if (m.status === 'loading language traineddata') {
          setParseProgress(pctStart + 10, '한국어 데이터 로딩 중')
        }
      }
    })
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('OCR_TIMEOUT')), 90000))
    const { data: { text } } = await Promise.race([ocrPromise, timeout])
    return text
  } catch (e) {
    if (e.message === 'OCR_TIMEOUT') {
      console.warn('OCR 시간 초과 (90초)')
    } else {
      console.warn('OCR 오류:', e)
    }
    return ''
  }
}

function parseDocMeta(filename, text) {
  const norm = s => s.replace(/\s+/g, '')
  const col  = s => s.replace(/\s+/g, ' ').trim()
  // 전각/이형 문자 정규화: ～〜→~ (PDF 추출 시 range 표시자가 달라질 수 있음)
  const normalized = text.replace(/[～〜]/g, '~')
  const tc   = col(normalized)
  const tn   = norm(normalized)
  const curY = new Date().getFullYear()

  // ── 제목 ──
  let title = ''
  // normalized text에서 개행 기준으로 제목 줄만 추출 (가장 정확)
  const titleLineM = normalized.match(/(?:제\s*목|건\s*명|행\s*사\s*명|연수\s*명|강\s*의\s*명|과\s*정\s*명|세\s*미\s*나\s*명|학\s*술\s*대\s*회\s*명)[^\S\n]*[：:。]?[^\S\n]*([가-힣\d][^\n]{3,79})/)
  if (titleLineM) {
    title = titleLineM[1].trim().replace(/\s+/g, ' ')
    // 목록 기호 혼입 제거 (끝에 붙은 " 나." " 다." 등)
    title = title.replace(/\s+[가나다라마바사아자차카타파하]\s*\.?\s*$/, '').trim()
  }
  // 공백 정규화 버전(tc)에서 재시도 — 개행이 없는 PDF OCR 결과에도 대응
  if (!title) {
    const titleM = tc.match(/(?:제\s*목|건\s*명|행\s*사\s*명|연수\s*명|강\s*의\s*명|과\s*정\s*명|세\s*미\s*나\s*명|학\s*술\s*대\s*회\s*명)\s*[：:。]?\s+([가-힣\d].{3,79})/)
    if (titleM) {
      title = titleM[1].trim().replace(/\s+/g, ' ')
      // 본문 항목 구분자(숫자. / 가.나.다. / 수신 / 붙임) 이후 잘라냄
      title = title.replace(/\s*(?:\d+\s*\.|[가나다라마바사아자차카타파하]\s*\.|수\s*신|경\s*유|붙\s*임).*$/, '').trim()
    }
  }
  // 파일명에서 추출 (숫자+언더스코어로만 구성된 파일명은 제외)
  if (!title) {
    const fnBase = filename.replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ').trim()
    // 파일명에 한글이 있고 너무 짧거나 길지 않으면 사용
    if (fnBase.length > 4 && fnBase.length < 80 && /[가-힣]/.test(fnBase)) title = fnBase
    else if (fnBase.length > 4 && fnBase.length < 80 && !/^\d/.test(fnBase)) title = fnBase
  }
  // 본문 첫 의미있는 줄에서 추출
  if (!title) {
    const kwRe = /교육|출장|세미나|연수|워크숍|학술대회|심포지엄|컨퍼런스|포럼|훈련|안내|개최/
    for (const line of normalized.split('\n')) {
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
    periodDisplay = nights > 0 ? `${sm}월 ${sd}일 ~ ${em}월 ${ed}일` : `${sm}월 ${sd}일`
  }
  const setSingle = (sy, sm, sd) => {
    startDate = `${sy}-${pad(sm)}-${pad(sd)}`
    endDate   = startDate
    nights = 0; days = 1
    periodDisplay = `${+sm}월 ${+sd}일`
  }

  // 패턴0: 차수 목록 "1차:" / "○ 1차" 뒤 날짜 — 복수 차시 공문에서 1차 우선 추출
  {
    const firstM = tc.match(/1\s*차\s*[：:,、]\s*(\d{4}[. ]+\d{1,2}[. ]+\d{1,2}(?:\.?\s*\([가-힣]{1,3}\))?)/)
    if (firstM) {
      const dm = firstM[1].match(/(\d{4})[. ]+(\d{1,2})[. ]+(\d{1,2})/)
      if (dm) {
        // 2차가 있으면 범위로 설정
        const secondM = tc.match(/2\s*차\s*[：:,、]\s*(\d{4}[. ]+\d{1,2}[. ]+\d{1,2})/)
        if (secondM) {
          const dm2 = secondM[1].match(/(\d{4})[. ]+(\d{1,2})[. ]+(\d{1,2})/)
          if (dm2) setRange(+dm[1],+dm[2],+dm[3], +dm2[1],+dm2[2],+dm2[3])
          else setSingle(+dm[1],+dm[2],+dm[3])
        } else {
          setSingle(+dm[1],+dm[2],+dm[3])
        }
      }
    }
  }

  // 패턴1: YYYY-MM-DD ~ YYYY-MM-DD
  if (!startDate) {
    const m = tc.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*~\s*(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) setRange(+m[1],+m[2],+m[3],+m[4],+m[5],+m[6])
  }

  // 패턴1.5: 공백제거 텍스트(tn)에서 날짜 범위 탐색
  // pdfjs 폰트 이슈로 tc에서 숫자 사이 공백이 끼어 패턴2가 실패할 때 대비
  // 형식: YYYY.M.D비숫자*~비숫자*(YYYY.)M.D
  if (!startDate) {
    const m = tn.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})[^\d~]*~[^\d]*(?:(\d{4})\.)?(\d{1,2})\.(\d{1,2})/)
    if (m && +m[1] >= 2020) {
      const ey = m[4] ? +m[4] : +m[1]
      setRange(+m[1], +m[2], +m[3], ey, +m[5], +m[6])
    }
  }

  // 패턴2: YYYY.M.D ~ M.D 또는 YYYY.M.D~YYYY.M.D
  // 일자 뒤에 .(수) 같은 점+요일 괄호가 붙는 공문 형식 지원 (예: 2025. 5. 21.(수) ~ 5. 23.(금))
  if (!startDate) {
    const m = tc.match(/(\d{4})[. ]+(\d{1,2})[. ]+(\d{1,2})(?:\.?\s*\([가-힣]{1,3}\))?\.?\s*~\s*(?:(\d{4})[. ]+)?(\d{1,2})[. ]+(\d{1,2})/)
    if (m) {
      const ey = m[4] ? +m[4] : +m[1]
      setRange(+m[1],+m[2],+m[3], ey,+m[5],+m[6])
    }
  }

  // 패턴3: 한글 날짜 — YYYY년 M월 D일 ~ M월 D일
  if (!startDate) {
    const m = tc.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*~\s*(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
    if (m) {
      const ey = m[4] ? +m[4] : +m[1]
      setRange(+m[1],+m[2],+m[3], ey,+m[5],+m[6])
    }
  }

  // 패턴4: MM.DD(요일) ~ MM.DD(요일) — 연도 없는 경우 올해로 설정
  if (!startDate) {
    const m = tc.match(/(\d{1,2})\.(\d{1,2})(?:\s*\([^)]{1,3}\))?\s*~\s*(\d{1,2})\.(\d{1,2})/)
    if (m) setRange(curY,+m[1],+m[2], curY,+m[3],+m[4])
  }

  // 패턴5: 일시·기간·개최기간 라벨 근방에서 날짜 탐색 (대괄호 형식 "[일 시]" 포함)
  if (!startDate) {
    const labelM = tc.match(/(?:\[\s*)?(?:일\s*시|기\s*간|개\s*최\s*기\s*간|개\s*최\s*일\s*시)(?:\s*\])?\s*[：:\s]\s*(.{5,80})/)
    if (labelM) {
      const snip = labelM[1]
      let sm = snip.match(/(\d{4})[. ]+(\d{1,2})[. ]+(\d{1,2})(?:\.?\s*\([가-힣]{1,3}\))?\.?\s*~\s*(?:(\d{4})[. ]+)?(\d{1,2})[. ]+(\d{1,2})/)
      if (sm) { const ey = sm[4] ? +sm[4] : +sm[1]; setRange(+sm[1],+sm[2],+sm[3], ey,+sm[5],+sm[6]) }
      if (!startDate) {
        sm = snip.match(/(\d{1,2})[. ]+(\d{1,2})(?:\s*\([가-힣]{1,3}\))?\s*~\s*(\d{1,2})[. ]+(\d{1,2})/)
        if (sm) setRange(curY,+sm[1],+sm[2], curY,+sm[3],+sm[4])
      }
    }
  }

  // 패턴6: "교육일시" 테이블 컬럼에서 ISO 날짜 — 납부 안내서·신청 명단 형식
  // 시행일자보다 먼저 체크해서 올바른 교육일 추출
  if (!startDate) {
    const eduDateM = tc.match(/교\s*육\s*일\s*시\s+(\d{4}-\d{2}-\d{2})/)
    if (eduDateM) {
      const [y,mo,d] = eduDateM[1].split('-').map(Number)
      setSingle(y, mo, d)
    }
  }

  // 패턴7: 단일 ISO 날짜 — YYYY-MM-DD (시행일자 제외)
  if (!startDate) {
    // 시행일자·접수일자 등 행정 처리일 제외를 위해 해당 패턴 마스킹 후 탐색
    const tcNoAdmin = tc.replace(/(?:시행|접수|발행|발급|작성)\s*일\s*자?\s*\d{4}-\d{2}-\d{2}/g, '')
                       .replace(/\(\s*시행일자\s*\d{4}-\d{2}-\d{2}\s*\)/g, '')
    const m = tcNoAdmin.match(/(\d{4})-(\d{2})-(\d{2})(?!\s*[\-~～]\s*\d{4}-\d{2}-\d{2})/)
    if (m && +m[1] >= 2020) setSingle(+m[1],+m[2],+m[3])
  }

  // 패턴8: 단일 일자 — YYYY. M.D 또는 YYYY.M.D (뒤에 ~ 없음)
  if (!startDate) {
    const m = tc.match(/(\d{4})[. ]+(\d{1,2})[. ]+(\d{1,2})(?:\s*\([^)]{1,3}\))?(?!\s*[~～])/)
    if (m && +m[1] >= 2020) setSingle(+m[1],+m[2],+m[3])
  }

  // ── 장소 → 지역 ──
  const REGION_MAP = [
    ['제주특별자치도|제주도|제주시|서귀포|제주', '제주'],
    // 서울 자치구
    ['강남구|강서구|마포구|종로구|용산구|성동구|송파구|강동구|노원구|도봉구|은평구|서대문구|동대문구|성북구|강북구|관악구|동작구|금천구|영등포구|구로구|양천구|서초구|광진구|중랑구', '서울'],
    // 서울 주요 병원 (병원명으로 장소 특정되는 경우)
    ['삼성서울병원|세브란스병원|신촌세브란스|강남세브란스|서울대학교병원|서울아산병원|서울성모병원|가톨릭대.*서울|한양대.*서울|이화.*서울|고대.*서울|고려대.*서울|건국대.*병원|경희대.*서울|중앙대.*서울|인하대.*서울', '서울'],
    // 서울 랜드마크
    ['서울특별시|여의도|여의나루|서울역|수서역|코엑스|COEX|삼성동|잠실|홍대|명동|광화문|시청|강남역', '서울'],
    // 경기·인천 (서울 출장 처리) — 성균관대는 자연과학캠퍼스(수원)와 인문캠(서울) 구분 필요, 삼성창원병원 제외
    ['경기도|인천광역시|수원시?|성남시?|용인시?|고양시?|안양시?|부천시?|평택시?|화성시?|파주시?|김포시?|의정부|자연과학캠퍼스|성균관대학교\s*(?!삼성창원|창원)', '서울'],
    ['천안시?|아산시?|천안아산역', '천안'],
    ['오송|청주시?', '오송'],
    ['대전광역시|대전시?|을지대.*대전|유성구|서구.*대전|대전.*서구', '대전'],
    ['동대구|대구광역시|대구시?', '동대구'],
    ['경주시?|신경주', '경주'],
    ['울산광역시|울산시?', '울산'],
    // 부산 (해운대구에 "대구" 포함되어 반드시 동대구보다 앞에 있어야 함)
    ['부산광역시|부산시?|부산교육원|해운대|동래|사하|금정', '부산'],
    ['전주시?|전라북도|전북', '전주'],
    ['순천시?|광양시?|여수시?', '순천'],
    ['창원시?|마산|진해|창원특례시|삼성창원병원|성균관대.*창원|경상국립대.*창원', '창원'],
    ['진주시?', '진주'],
  ]

  // 장소 → 지역 탐색 (발신자 주소 오인 방지 강화)
  let destination = ''

  const matchRegion = (text) => {
    if (!text) return ''
    for (const [keywords, region] of REGION_MAP) {
      if (new RegExp(keywords, 'i').test(text)) return region
    }
    return ''
  }

  // 형식1: "장소 : XXX" 또는 "개최지 : XXX"
  const placeColonM = tc.match(/(?:장\s*소|개최\s*지|행사\s*장소|개최\s*장소)\s*[：:]\s*([^.0-9]{2,60})/)
  if (placeColonM) destination = matchRegion(placeColonM[1])

  // 형식2: "장 소 XXX 숫자." (번호 목록 형식) — 번호 나오기 전까지
  if (!destination) {
    const placeListM = tc.match(/장\s*소\s+([가-힣][^0-9]{2,50})(?:\s*\d+\s*[.:]|$)/)
    if (placeListM) destination = matchRegion(placeListM[1])
  }

  // 형식3: "1차: 날짜, 장소" 목록 형식 (강의 협조 요청 등)
  if (!destination) {
    const firstPlaceM = tc.match(/1\s*차\s*[：:,、].*?,\s*([가-힣].{3,40})/)
    if (firstPlaceM) destination = matchRegion(firstPlaceM[1])
  }

  // 형식4: "교육장소" 키워드 이후 텍스트에서 REGION_MAP 직접 검색 (테이블 형식)
  if (!destination) {
    const eduIdx = tc.indexOf('교육장소')
    if (eduIdx >= 0) destination = matchRegion(tc.slice(eduIdx, eduIdx + 120))
  }

  // 장소 라벨 탐색 실패 시 본문 스캔 — 발신처 주소(우편번호 기준) 이전만 탐색
  if (!destination) {
    // "우 XXXXX" 우편번호, 전화번호, 팩스번호, 시행 이후 제외
    const bodyText = tc.split(/우\s*\d{3}[-\d]*\s*[가-힣]|전화\s*번호|팩스\s*번호/)[0]
    // 수신자 정보(병원명 등)가 포함된 앞부분은 제외하고 본문 핵심만 검색
    // "수신" 이후 첫 가-힣로 시작하는 의미 있는 본문부터 탐색
    const bodyCore = bodyText.replace(/^.*?(?=\d+\.\s)/s, '')  // "1. 귀 기관..." 이후부터
    destination = matchRegion(bodyCore) || matchRegion(bodyText)
  }

  // ── 등록비 ──
  let registration = null

  // 금액 문자열 파싱 헬퍼 (만원 단위 지원: "18만" → 180000, "180,000" → 180000)
  const parseAmt = s => {
    if (!s) return null
    const manM = s.replace(/,/g,'').match(/^(\d+)\s*만$/)
    if (manM) return parseInt(manM[1]) * 10000
    const n = parseInt(s.replace(/,/g,''))
    return (n >= 1000 && n <= 99000000) ? n : null
  }

  // 대괄호 안 숫자 추출 전처리: [25,000] → 25,000
  const tcFee = tc.replace(/\[(\d[\d,]*)\]/g, '$1')
  const tnFee = tn.replace(/\[(\d[\d,]*)\]/g, '$1')

  // 금액 추출 regex: 만원 단위(18만) + 일반 숫자(180,000) 모두 지원
  const amtPat = /([\d,]+)\s*만\s*원|([\d,]{4,})\s*원/

  // 우선순위1: 회원병원 / 정회원 기준 (학술대회 공문의 "정회원" = 병원 직원 할인가)
  const memberM = tnFee.match(/(?:회원병원|정회원)[:\-：\s]*([\d,]+)\s*만?\s*원?/)
  if (memberM) {
    const snipMember = tnFee.slice(tnFee.search(/(?:회원병원|정회원)/))
    const amtM = snipMember.match(amtPat)
    if (amtM) {
      registration = amtM[1]
        ? parseInt(amtM[1].replace(/,/g,'')) * 10000
        : parseAmt(amtM[2])
    } else {
      registration = parseAmt(memberM[1])
    }
  }

  // 우선순위2: 사전납입 기준
  if (!registration) {
    const i = tnFee.indexOf('사전납입')
    if (i >= 0) {
      const amtM = tnFee.slice(i, i+30).match(amtPat)
      if (amtM) registration = amtM[1] ? parseInt(amtM[1].replace(/,/g,''))*10000 : parseAmt(amtM[2])
    }
  }

  // 우선순위3: "금 XXX원" 형식 — 납부 안내서, 고지서 (예: "금 25,000 원 / 1 명")
  // ※ \b는 한글 앞뒤에서 동작하지 않으므로 사용하지 않음
  if (!registration) {
    const kinM = tcFee.match(/금\s+([\d,]+)\s*원(?:\s|\/|$)/)
    if (kinM) registration = parseAmt(kinM[1])
  }

  // 우선순위4: 교육비·등록비·참가비·참가회비 등 키워드 뒤 금액 (만원 단위 포함)
  // "1인당", "1인" 같은 중간 수식어 허용 (예: 참가회비 1인당 450,000원)
  if (!registration) {
    const kwRegex = /(?:사전\s*등록비|사전\s*등록|참\s*가\s*회\s*비|등록\s*비|참\s*가\s*비|교육\s*비|수강\s*료)\s*[：:\-]?\s*(?:1\s*인\s*당\s*)?(?:([\d,]+)\s*만\s*원|([\d,]+)\s*원)/
    const kwM = tcFee.match(kwRegex)
    if (kwM) {
      registration = kwM[1]
        ? parseInt(kwM[1].replace(/,/g,'')) * 10000
        : parseAmt(kwM[2])
    }
  }

  // 우선순위5: 정규화 텍스트에서 키워드+금액 슬라이딩 검색 (만원 포함)
  if (!registration) {
    const kwPats = ['사전등록비','사전등록','참가회비','등록비','참가비','교육비','수강료']
    for (const kw of kwPats) {
      const ki = tnFee.indexOf(kw)
      if (ki >= 0) {
        const snip = tnFee.slice(ki, ki + kw.length + 50)
        const amtM = snip.match(amtPat)
        if (amtM) {
          registration = amtM[1]
            ? parseInt(amtM[1].replace(/,/g,'')) * 10000
            : parseAmt(amtM[2])
          if (registration) break
        }
      }
    }
  }

  // ── 온라인 여부 (제목에 "온라인" 명시된 경우만 true, 없으면 false=오프라인)
  const isOnline = /온라인/.test(title) || /온라인/.test(tc.slice(0, 300))

  return { title, periodDisplay, startDate, endDate, nights, days, destination, registration, isOnline }
}

function renderParseResult(filename, meta, hasText) {
  const grid = document.getElementById('resultGrid')
  const resultEl = document.getElementById('parseResult')

  const fmt = v => v ? `<span>${escapeHtml(String(v))}</span>` : `<span class="empty">확인 안 됨</span>`
  const feeStr = meta.registration ? `${meta.registration.toLocaleString()}원` : ''

  // 파일명/텍스트에서 뭔가 읽혔는지 확인
  const hasMeta = !!(meta.title || meta.periodDisplay || meta.destination || meta.registration)

  let warnHtml = ''
  if (!hasText) {
    // OCR/텍스트 추출 실패 → 파일명 기반 파싱만 됨
    warnHtml = `
      <div class="result-warn full">
        <span>⚠️</span>
        <div>
          <strong>내용을 자동으로 읽지 못했어요</strong>
          <p>PDF가 이미지 형식이거나 보안 설정이 있을 수 있어요.<br>아래 정보가 맞지 않으면 다음 단계에서 직접 수정해주세요.</p>
        </div>
      </div>`
  }

  grid.innerHTML = `
    <div class="result-item full"><label>파일명</label><span>${escapeHtml(filename)}</span></div>
    <div class="result-item full"><label>출장/교육명</label>${fmt(meta.title)}</div>
    <div class="result-item"><label>기간</label>${fmt(meta.periodDisplay)}</div>
    <div class="result-item"><label>장소</label>${fmt(meta.destination)}</div>
    <div class="result-item full"><label>등록비 (회원·사전납입 기준)</label>${fmt(feeStr)}</div>
    ${warnHtml}
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

// ── CARD 4: 등록비 자동인식 확인 (예/아니요) ──────────────────────────────────
function confirmFeeYes() {
  // '있어요' 자동 선택 + fee 금액 활성화 (input-fee는 이미 자동채워짐)
  selectFeePresence(true)
  document.getElementById('c4-fee-q').classList.add('hidden')
}

function confirmFeeNo() {
  // 잘못 인식된 것 → 확인 박스 닫고 금액 초기화, 사용자가 직접 선택
  document.getElementById('c4-fee-q').classList.add('hidden')
  const feeEl = document.getElementById('input-fee')
  if (feeEl) feeEl.value = ''
  state.fee = 0
}

// ── CARD 4: 온라인 / 오프라인 토글 ───────────────────────────────────────────
function selectOnlineMode(isOnline) {
  state.isOnline = isOnline
  const btnOnline  = document.getElementById('modeBtn-online')
  const btnOffline = document.getElementById('modeBtn-offline')
  const hint       = document.getElementById('online-mode-hint')

  // 선택된 버튼: 파란 채움 / 미선택 버튼: 기본 회색
  if (btnOnline) {
    btnOnline.classList.toggle('selected', isOnline)
    btnOnline.classList.toggle('selected-no', !isOnline)
  }
  if (btnOffline) {
    btnOffline.classList.toggle('selected', !isOnline)
    btnOffline.classList.toggle('selected-no', isOnline)
  }
  if (hint) hint.classList.toggle('hidden', !isOnline)

  // 온라인이면 장소·지역 필드 숨김, 오프라인이면 다시 표시
  const fieldPlace  = document.getElementById('field-place')
  const fieldRegion = document.getElementById('field-region')
  if (fieldPlace)  fieldPlace.classList.toggle('hidden', isOnline)
  if (fieldRegion) fieldRegion.classList.toggle('hidden', isOnline)

  // 교육비 버튼 / 없어요 연동
  prepareCard4Online()
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

  // 온라인/오프라인 자동 설정 (공문 제목에 "온라인" 있으면 온라인, 없으면 오프라인)
  selectOnlineMode(meta.isOnline === true)

  document.getElementById('c4-confirm-view').classList.remove('hidden')
  document.getElementById('c4-input-view').classList.add('hidden')
}

function showCard4InputMode() {
  document.getElementById('c4-confirm-view').classList.add('hidden')
  document.getElementById('c4-input-view').classList.remove('hidden')
  document.getElementById('c4-fee-q').classList.add('hidden')
  // 직접 입력 시 기본값: 오프라인
  selectOnlineMode(false)
}

function onDateChange() {
  const start = document.getElementById('input-start').value
  const end   = document.getElementById('input-end').value
  state.startDate = start
  state.endDate   = end

  // 날짜 박스 UI 업데이트
  updateDateBox('input-start', 'start-placeholder')
  updateDateBox('input-end',   'end-placeholder')

  // 에러 실시간 해제
  if (start) clearCard4Error('start-box')
  if (end)   clearCard4Error('end-box')

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
  clearCard4Error('field-fee')
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
  state.isOnline ? goToCard(9) : goToCard(8)
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

// 2단계: 최종 영수증 종류 확정 → card 8 (또는 온라인이면 card 9)로
function select7(val) {
  state.receiptType = val
  updateDocStrip()
  setTimeout(() => state.isOnline ? goToCard(9) : goToCard(8), 150)
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
  // 제주 출장이면 KTX를 타지 않으므로 직급(특실 여부) 질문 불필요
  // 당일 출장(nights=0)이면 숙소 질문도 숨김
  document.getElementById('field-rank').classList.toggle('hidden', isShort || state.isJeju)
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
    document.getElementById('field-rank').classList.toggle('hidden', isShort || state.isJeju)
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
  } else if (state.fareOverride !== null) {
    fareTotal = state.fareOverride
    const half = fareTotal / 2
    fareRows = `
      <tr>
        <th class="tf-th tf-th-multi" rowspan="2">교통비</th>
        <td class="tf-td">왕복 교통비 (수동 입력)&nbsp;&nbsp;@ ${half.toLocaleString()} × 2회 × 1명 = ₩ ${fareTotal.toLocaleString()}</td>
      </tr>
      <tr>
        <td class="tf-td" style="color:#8b95a1;font-size:12px">수정 패널에서 직접 입력한 금액</td>
      </tr>`
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
    // 교통비: fareOverride 있으면 우선
    totalAmt += (state.fareOverride !== null && !isJeju) ? state.fareOverride : fareTotal
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

  // ── 수정 패널 ──
  const editPanel = state.formEditMode ? `
    <div class="tf-edit-panel">
      <div class="tf-edit-title">✏️ 항목 수정</div>
      <div class="tf-edit-grid">
        <div class="tf-edit-field">
          <label class="tf-edit-label">일수</label>
          <div class="tf-edit-input-wrap">
            <input class="tf-edit-input" type="number" min="1" max="30" id="edit-days"
              value="${state.days || 1}" oninput="onTripFormEdit()" />
            <span class="tf-edit-unit">일</span>
          </div>
        </div>
        <div class="tf-edit-field">
          <label class="tf-edit-label">숙박</label>
          <div class="tf-edit-input-wrap">
            <input class="tf-edit-input" type="number" min="0" max="30" id="edit-nights"
              value="${state.nights || 0}" oninput="onTripFormEdit()" />
            <span class="tf-edit-unit">박</span>
          </div>
        </div>
        <div class="tf-edit-field">
          <label class="tf-edit-label">교통비 (왕복)</label>
          <div class="tf-edit-input-wrap">
            <input class="tf-edit-input" type="number" min="0" step="100" id="edit-fare"
              value="${state.fareOverride !== null ? state.fareOverride : (fareTotal || '')}"
              placeholder="자동"
              oninput="onTripFormEdit()" />
            <span class="tf-edit-unit">원</span>
          </div>
        </div>
        <div class="tf-edit-field">
          <label class="tf-edit-label">등록비</label>
          <div class="tf-edit-input-wrap">
            <input class="tf-edit-input" type="number" min="0" step="1000" id="edit-fee"
              value="${state.fee || ''}"
              placeholder="없음"
              oninput="onTripFormEdit()" />
            <span class="tf-edit-unit">원</span>
          </div>
        </div>
      </div>
      <button class="tf-edit-reset" onclick="resetTripFormEdit()">자동 계산으로 되돌리기</button>
    </div>` : ''

  el.innerHTML = `
    <div class="trip-form-section-label">
      📋 출장신청서 작성 참고
      <button class="tf-edit-toggle ${state.formEditMode ? 'active' : ''}" onclick="toggleFormEdit()">
        ${state.formEditMode ? '✔ 수정 완료' : '✏ 수정'}
      </button>
    </div>
    <p class="trip-form-section-note">S-Portal 전자결재 작성 시 아래 내용을 참고하세요 · 성명·결재선은 직접 입력</p>

    ${editPanel}

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

// ── 출장신청서 수정 패널 토글 ──────────────────────────────────────────────────
function toggleFormEdit() {
  state.formEditMode = !state.formEditMode
  renderTripFormPreview()
}

// ── 수정 패널 값 변경 → state 업데이트 → 재계산 ──────────────────────────────
function onTripFormEdit() {
  const daysEl  = document.getElementById('edit-days')
  const nightsEl = document.getElementById('edit-nights')
  const fareEl  = document.getElementById('edit-fare')
  const feeEl   = document.getElementById('edit-fee')

  if (daysEl)   state.days   = Math.max(1, parseInt(daysEl.value)  || 1)
  if (nightsEl) state.nights = Math.max(0, parseInt(nightsEl.value) || 0)

  if (fareEl) {
    const v = fareEl.value.trim()
    state.fareOverride = v === '' ? null : Math.max(0, parseInt(v) || 0)
  }
  if (feeEl) {
    const v = feeEl.value.trim()
    state.fee = v === '' ? 0 : Math.max(0, parseInt(v) || 0)
  }

  // 재계산 — innerHTML 재생성 (편집 중 focus 유지를 위해 active element id 기억)
  const focusId = document.activeElement?.id
  renderTripFormPreview()
  if (focusId) {
    const el = document.getElementById(focusId)
    if (el) {
      el.focus()
      // 커서를 끝으로 이동
      const len = el.value?.length || 0
      el.setSelectionRange(len, len)
    }
  }
}

// ── 자동 계산으로 리셋 ─────────────────────────────────────────────────────────
function resetTripFormEdit() {
  // fareOverride 해제, days/nights/fee는 parsedMeta 또는 원래 상태로 복원
  state.fareOverride = null
  // days, nights는 공문 파싱 결과로 복원
  if (state.parsedMeta) {
    if (state.parsedMeta.days)   state.days   = state.parsedMeta.days
    if (state.parsedMeta.nights !== undefined) state.nights = state.parsedMeta.nights
    if (state.parsedMeta.registration) state.fee = state.parsedMeta.registration
  }
  renderTripFormPreview()
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
  'transfer':     '송금증(계좌이체내역서) + 이수증',
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
      ? '송금증(계좌이체내역서)·이수증 등 대체 증빙 — 세법상 비용 인정을 위한 적격증빙 수취 여부 확인'
      : '카드 매출전표·세금계산서·현금영수증 등 — 세법상 비용으로 인정받기 위한 적격증빙 수취 여부 확인'
    items.push({ icon: '🧾', title: rLabel, desc: rDesc })
  } else if (state.feeStatus === 'not-paid') {
    items.push({ icon: '🧾', title: '교육비 / 등록비 영수증', desc: '카드 매출전표·세금계산서·현금영수증·송금증(계좌이체내역서) 등 — 적격증빙 수취 여부 확인', pending: true })
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
  'transfer':     '🏦 송금증(계좌이체)+이수증',
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

// ── 자동 테스트 (콘솔에서 runTests() 호출) ────────────────────────────────────
const TEST_DOCS = [
  { label: '학술사업 공문 (88,000원 / 서울 / 2025-12-11)',  url: '/test-docs/학술사업_공문.pdf' },
  { label: '삼일아카데미 (510,000원 / 08.08~09)',           url: '/test-docs/삼일아카데미_교육.pdf' },
  { label: '세무조정 공문 (등록비 없음 / 서울 / 5.15~16)',  url: '/test-docs/세무조정_공문.pdf' },
]

async function runTests() {
  console.clear()
  console.log('%c🧪 공문 파싱 자동 테스트', 'font-size:16px;font-weight:bold;color:#3182f6')
  console.log('─'.repeat(60))

  // 기존 테스트 오버레이 제거
  document.getElementById('testOverlay')?.remove()

  // 결과 오버레이 생성
  const overlay = document.createElement('div')
  overlay.id = 'testOverlay'
  overlay.style.cssText = `
    position:fixed; top:16px; right:16px; z-index:9999;
    background:#fff; border:1.5px solid #e0e9f4; border-radius:16px;
    box-shadow:0 8px 32px rgba(0,0,0,0.12); padding:20px 24px;
    min-width:360px; max-width:480px; font-family:inherit;
  `
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <strong style="font-size:14px;color:#191f28">🧪 공문 파싱 테스트</strong>
      <button onclick="document.getElementById('testOverlay').remove()"
        style="border:none;background:none;font-size:18px;cursor:pointer;color:#8b95a1;padding:0">×</button>
    </div>
    <div id="testResults"></div>
  `
  document.body.appendChild(overlay)
  const resultsEl = document.getElementById('testResults')

  const addRow = (label, status, details) => {
    const icon = status === 'ok' ? '✅' : status === 'warn' ? '⚠️' : '❌'
    const row = document.createElement('div')
    row.style.cssText = 'padding:10px 0;border-bottom:1px solid #f2f4f6;font-size:13px'
    row.innerHTML = `
      <div style="font-weight:600;color:#191f28;margin-bottom:4px">${icon} ${escapeHtml(label)}</div>
      <div style="color:#6b7684;line-height:1.6">${details}</div>
    `
    resultsEl.appendChild(row)
  }

  for (const doc of TEST_DOCS) {
    const loadingRow = document.createElement('div')
    loadingRow.style.cssText = 'padding:10px 0;border-bottom:1px solid #f2f4f6;font-size:13px;color:#8b95a1'
    loadingRow.textContent = `⏳ ${doc.label} 처리 중...`
    resultsEl.appendChild(loadingRow)

    try {
      // PDF fetch
      const resp = await fetch(doc.url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const ab = await resp.arrayBuffer()
      const file = new File([ab], doc.url.split('/').pop(), { type: 'application/pdf' })

      // 텍스트 추출
      let text = ''
      try { text = await extractPdfText(file) } catch(e) { console.warn(e) }
      if (text.replace(/\s/g,'').length < 50) {
        try { text = await ocrPdfPages(file) } catch(e) {}
      }

      // 파싱
      const meta = parseDocMeta(file.name, text)
      console.log(`[${doc.label}]`, meta)

      // 결과 표시
      const checks = []
      if (meta.title)        checks.push(`📋 제목: ${meta.title.slice(0,30)}`)
      if (meta.periodDisplay) checks.push(`📅 기간: ${meta.periodDisplay}`)
      if (meta.destination)   checks.push(`📍 지역: ${meta.destination}`)
      if (meta.registration)  checks.push(`💳 등록비: ${meta.registration.toLocaleString()}원`)
      if (!meta.registration) checks.push(`💳 등록비: 없음`)

      const status = (meta.title || meta.periodDisplay) ? 'ok' : 'warn'
      loadingRow.remove()
      addRow(doc.label, status, checks.join('<br>'))

    } catch(e) {
      loadingRow.remove()
      addRow(doc.label, 'error', `오류: ${e.message}`)
      console.error(doc.label, e)
    }
  }

  // 완료 메시지
  const done = document.createElement('div')
  done.style.cssText = 'padding-top:12px;font-size:12px;color:#8b95a1;text-align:center'
  done.textContent = '콘솔(F12)에서 상세 결과 확인 가능'
  resultsEl.appendChild(done)

  console.log('%c✅ 테스트 완료', 'font-weight:bold;color:#00a661')
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadRates()
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
