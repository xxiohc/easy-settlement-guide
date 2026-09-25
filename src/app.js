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
  // Card 7 (납부 형태)은 Card 6으로 통합 — STEPS에서 제외
  { card: 6,  label: '등록비 납부' },
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
  prevDayMove: null,
  lodgingProvided: null,
  mealProvided: null,
  hasPlane: null,
  hasShuttle: null,
  startTime: '',        // 출장(교육) 시작시각 HH:MM
  endTime: '',          // 출장(교육) 종료시각 HH:MM
  placeLat: null,       // 카카오 장소 검색으로 받은 목적지 좌표
  placeLon: null,
  accessOverride: {},   // 도착역→목적지 이동시간 수동 입력 {역명: 분}
  pinStation: null,     // 도착역 직접 지정(마스터에 없는 기관용 폴백)
  fareOverride: null,   // 교통비 수동 입력 (null이면 자동 계산)
  formEditMode: false,  // 출장신청서 수정 패널 열림 여부
}

// 출발지 이름. 기차는 마산역에서, 시외버스는 마산시외버스터미널에서 탄다 — 부산·울산·전주처럼
// 버스로 가는 구간에 '마산역 출발'이라고 적으면 실제로 갈 곳과 다른 장소를 안내하게 된다.
const ORIGIN_RAIL = '마산역'
const ORIGIN_BUS  = '마산시외버스터미널'

// 시외버스 고정 구간(전남 서·남부). 운임표상 철도 경로가 마산 → 오송(충북 청주) → 목포·순천·
// 여수엑스포다 — 종착지보다 한참 북쪽까지 거슬러 올라갔다 되내려오고 환승까지 붙는다.
// 비효율이 분명하므로 기차 역산을 아예 돌리지 않고 시외버스로 고정한다(2026-09-25 지석초이 지시).
// railStation 은 '왜 뺐는지'를 운임표 경로·금액으로 밝히는 데만 쓴다.
const BUS_ONLY_REGIONS = [
  { keywords: ['목포'], label: '목포', railStation: '목포' },
  { keywords: ['여수'], label: '여수', railStation: '여수엑스포' },
  { keywords: ['순천', '광양'], label: '순천', railStation: '순천' },
]

function busOnlyRegion(place) {
  if (!place) return null
  return BUS_ONLY_REGIONS.find(r => r.keywords.some(k => place.includes(k))) || null
}

// ── KTX / 버스 운임표 (마산역·마산시외버스터미널 출발 왕복) ───────────────────
// 금액·경로는 tools/build_fares.py 가 data/source 의 KORAIL 운임표에서 생성한다.
// 직접 고치지 말 것 — 고치면 다음 생성 때 되돌아간다. 실제 값은 data/rates.json
// 에서 덮어쓰며, 아래 배열은 로드 실패 시 쓰는 같은 값의 사본이다.
let FARE_TABLE = [
// <fare-table:auto>
  { keywords: ['서울'], label: '서울역', station: '서울', ktxNormal: 97200, ktxFirst: 141000, oneWayNormal: 48600, oneWayFirst: 70500, transfers: 0, path: ['마산', '서울'] },
  { keywords: ['수서'], label: '수서역', station: '수서', ktxNormal: 94400, ktxFirst: 136800, oneWayNormal: 47200, oneWayFirst: 68400, transfers: 0, path: ['마산', '수서'] },
  { keywords: ['천안', '아산'], label: '천안아산역', station: '천안아산', ktxNormal: 72200, ktxFirst: 104600, oneWayNormal: 36100, oneWayFirst: 52300, transfers: 0, path: ['마산', '천안아산'] },
  { keywords: ['오송'], label: '오송역', station: '오송', ktxNormal: 64200, ktxFirst: 93000, oneWayNormal: 32100, oneWayFirst: 46500, transfers: 0, path: ['마산', '오송'] },
  { keywords: ['대전'], label: '대전역', station: '대전', ktxNormal: 54800, ktxFirst: 79400, oneWayNormal: 27400, oneWayFirst: 39700, transfers: 0, path: ['마산', '대전'] },
  { keywords: ['부산', '해운대'], label: '부산', bus: 19600 },
  { keywords: ['대구'], label: '동대구역', station: '동대구', ktxNormal: 21400, ktxFirst: 31000, oneWayNormal: 10700, oneWayFirst: 15500, transfers: 0, path: ['마산', '동대구'] },
  { keywords: ['울산'], label: '울산', bus: 29000 },
  { keywords: ['경주'], label: '경주역', station: '경주', ktxNormal: 36400, ktxFirst: 52800, oneWayNormal: 18200, oneWayFirst: 26400, transfers: 1, path: ['마산', '동대구', '경주'] },
  { keywords: ['전주'], label: '전주', bus: 46000 },
  { keywords: ['제주'], label: '제주', jeju: true },
// </fare-table:auto>
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
// 브라우저 뒤로가기(안드로이드 뒤로, 사파리 스와이프)로 앱을 벗어나 입력이 통째로
// 날아가던 문제 때문에, 카드 이동마다 history 항목을 하나씩 쌓는다.
// popstate 로 되돌아올 때는 다시 push 하지 않는다(무한 루프 방지).
let navigatingByHistory = false

function goToCard(n) {
  const current = document.getElementById(`card-${state.currentCard}`)
  const next    = document.getElementById(`card-${n}`)
  if (!next) return

  if (!navigatingByHistory && n !== state.currentCard) {
    history.pushState({ card: n }, '')
  }

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
  // Card 6에서 뒤로 → Card 4 (Card 5·7은 인라인 통합됨)
  if (cardNum === 6) return goToCard(4)
  // Card 8에서 뒤로 → 등록비 없으면 Card 4, 있으면 Card 6
  if (cardNum === 8) return goToCard(state.hasFee === false ? 4 : 6)
  // Card 9에서 뒤로 (온라인) → 등록비 없으면 Card 4, 있으면 Card 6
  if (cardNum === 9 && state.isOnline) return goToCard(state.hasFee === false ? 4 : 6)
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

  // 3-1. 기간 역전 (시작일 > 종료일)
  if (startEl?.value && endEl?.value && new Date(endEl.value) < new Date(startEl.value)) {
    errs.push({ id: 'end-box', label: '출장 종료일 — 시작일보다 앞설 수 없어요' })
    document.getElementById('end-box')?.classList.add('input-error')
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

// ── 에러 배너 렌더 (카드 4·8 공용) ───────────────────────────────────────────
// 배너는 질문·입력 '위'에 넣는다. 카드 푸터 앞에 두면 첫 오류 필드로 스크롤한 순간
// 배너가 화면 밖으로 밀려 무엇이 잘못됐는지 보이지 않았다.
function renderFlowErrors(cardNum, errs, title) {
  const bannerId = `c${cardNum}-err-banner`
  let banner = document.getElementById(bannerId)
  if (!banner) {
    banner = document.createElement('div')
    banner.id = bannerId
    banner.className = 'c4-err-banner'
    const body = document.querySelector(`#card-${cardNum} .card-body`)
    const anchor = body?.querySelector('.info-fields-wrap, .extra-field')
    if (anchor) body.insertBefore(banner, anchor)
    else document.querySelector(`#card-${cardNum} .card-footer`)
      ?.parentNode.insertBefore(banner, document.querySelector(`#card-${cardNum} .card-footer`))
  }

  if (errs.length === 0) {
    banner.classList.add('hidden')
    return
  }

  banner.classList.remove('hidden')
  banner.innerHTML = `
    <div class="c4-err-icon">⚠️</div>
    <div class="c4-err-body">
      <strong>${title}</strong>
      <ul class="c4-err-list">
        ${errs.map(e => `<li>${e.label}</li>`).join('')}
      </ul>
    </div>`

  // 배너를 먼저 보여준 뒤 첫 번째 오류 필드로 스크롤
  banner.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const firstEl = document.getElementById(errs[0].id)
  if (firstEl && firstEl.tagName === 'INPUT') firstEl.focus({ preventScroll: true })
}

function renderCard4Errors(errs) {
  renderFlowErrors(4, errs, '아래 항목을 채워주세요')
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

  // 등록비 없으면 Card 6(등록비 납부) 제외
  if (state.hasFee === false) return steps.filter(s => s.card !== 6)

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
      const isUpcoming = state.hasFee === true && c > state.currentCard && c === 6
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

// 같은 값이 가장 많이 나온 금액을 고른다(같으면 작은 값 — 회원가는 보통 낮은 쪽이다).
function mostCommon(nums) {
  if (!nums.length) return null
  const count = new Map()
  for (const n of nums) count.set(n, (count.get(n) || 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
}

// 자간을 벌려 인쇄한 공문은 PDF 텍스트가 "방 사 선안전 교 육"처럼 낱글자로 쪼개져
// 나온다. 낱글자 비중이 절반을 넘을 때만 낱글자 사이 공백을 지운다
// (두 글자 이상 덩어리끼리의 공백은 실제 띄어쓰기이므로 남긴다).
function fixLetterSpacing(str) {
  const toks = String(str || '').split(/\s+/).filter(Boolean)
  if (toks.length < 4) return String(str || '').trim()
  const singles = toks.filter(t => t.length === 1).length
  if (singles / toks.length < 0.5) return toks.join(' ')
  let out = ''
  toks.forEach((tok, i) => {
    if (i > 0 && toks[i - 1].length > 1 && tok.length > 1) out += ' '
    out += tok
  })
  return out
}

// 제목 칸에 본문이 통째로 딸려오는 것을 막는다. 공문 본문은 "1." "가." "수신"
// "붙임" 같은 항목 구분자로 시작하므로 그 앞에서 자른다.
const TITLE_BODY_CUT = /\s*(?:\d+\s*\.|[가나다라마바사아자차카타파하]\s*\.|수\s*신|경\s*유|붙\s*임).*$/

function cleanTitle(raw) {
  return fixLetterSpacing(String(raw || '').replace(TITLE_BODY_CUT, '')).trim()
}

function parseDocMeta(filename, text) {
  const norm = s => s.replace(/\s+/g, '')
  const col  = s => s.replace(/\s+/g, ' ').trim()
  // 전각/이형 문자 정규화: ～〜→~ (PDF 추출 시 range 표시자가 달라질 수 있음)
  const normalized = text.replace(/[～〜]/g, '~')
  const tc   = col(normalized)
  const tn   = norm(normalized)
  const curY = new Date().getFullYear()
  let yearGuessed = false

  // ── 제목 ──
  let title = ''
  // normalized text에서 개행 기준으로 제목 줄만 추출 (가장 정확)
  const titleLineM = normalized.match(/(?:제\s*목|건\s*명|행\s*사\s*명|연수\s*명|강\s*의\s*명|과\s*정\s*명|세\s*미\s*나\s*명|학\s*술\s*대\s*회\s*명)[^\S\n]*[：:。]?[^\S\n]*([가-힣\d][^\n]{3,79})/)
  if (titleLineM) {
    title = cleanTitle(titleLineM[1])
    // 목록 기호 혼입 제거 (끝에 붙은 " 나." " 다." 등)
    title = title.replace(/\s+[가나다라마바사아자차카타파하]\s*\.?\s*$/, '').trim()
  }
  // 공백 정규화 버전(tc)에서 재시도 — 개행이 없는 PDF OCR 결과에도 대응
  if (!title) {
    const titleM = tc.match(/(?:제\s*목|건\s*명|행\s*사\s*명|연수\s*명|강\s*의\s*명|과\s*정\s*명|세\s*미\s*나\s*명|학\s*술\s*대\s*회\s*명)\s*[：:。]?\s+([가-힣\d].{3,79})/)
    if (titleM) {
      // 본문 항목 구분자(숫자. / 가.나.다. / 수신 / 붙임) 이후 잘라냄
      title = cleanTitle(titleM[1])
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
        title = cleanTitle(l); break
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
    if (m) { yearGuessed = true; setRange(curY,+m[1],+m[2], curY,+m[3],+m[4]) }
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
        if (sm) { yearGuessed = true; setRange(curY,+sm[1],+sm[2], curY,+sm[3],+sm[4]) }
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
    // 시외버스 고정 구간 — 지역명을 합치지 않고 따로 잡는다(안내에 그 지명이 그대로 나온다)
    ['순천시?|광양시?', '순천'],
    ['여수시?', '여수'],
    ['목포시?', '목포'],
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
  let registrationNote = null

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

  // 우선순위2.5: 표 형식 교육비 — 헤더가 교육비·등록비이고 하위 칸이 회원/비회원으로 갈리는 공문.
  // 금액이 프로그램 행마다 따로 있어 키워드와 같은 줄에 없다(대한간호협회 보수교육 안내가 대표).
  if (!registration) {
    const headIdx = tnFee.search(/(교육비|등록비|수강료|참가비)/)
    const feeTable = headIdx >= 0 ? tnFee.slice(headIdx) : ''
    const hasMemberCols = /(등록[,·․、\/]?NE회원|정회원|회원병원|회원)/.test(feeTable)
                       && /(미등록회원|미등록|비회원)/.test(feeTable)
    if (hasMemberCols) {
      // 행 = 이수시간 + 회원가 + 비회원가 순서. 앞 금액이 회원가다.
      const rows = [...feeTable.matchAll(/(\d+)시간([\d,]{4,})원([\d,]{4,})원/g)]
        .map(m => ({ hours: parseInt(m[1]), member: parseAmt(m[2]) }))
        .filter(r => r.member)
      const requiredM = tnFee.match(/연간(\d+)시간이상/)
      const requiredHours = requiredM ? parseInt(requiredM[1]) : null
      const target = requiredHours ? rows.filter(r => r.hours === requiredHours) : rows
      const pick = mostCommon(target.map(r => r.member))
      if (pick) {
        registration = pick
        registrationNote = requiredHours
          ? `연간 ${requiredHours}시간 이수 의무 기준이고 회원 가격이에요. 맞나요?`
          : '공문 표의 회원 기준 금액이에요. 맞나요?'
      } else {
        // 이수시간 칸이 없는 표 — 첫 행 회원가를 쓴다.
        const pairM = feeTable.match(/([\d,]{4,})원([\d,]{4,})원/)
        const first = pairM ? parseAmt(pairM[1]) : null
        if (first) {
          registration = first
          registrationNote = '공문 표의 회원 기준 금액이에요. 맞나요?'
        }
      }
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

  // 간호사 보수교육 공문은 금액을 못 읽어도 기본값을 채운다.
  // 의료법 시행규칙 제20조에 따라 연간 8시간 이상 이수 의무이고, 8시간 프로그램 회원가는 40,000원으로 같다.
  if (!registration && /보수교육/.test(tnFee) && /간호/.test(tnFee)) {
    registration = 40000
    registrationNote = '간호사 보수교육 8시간·회원 기준 기본값이에요. 다르면 고쳐주세요.'
  }

  // ── 온라인 여부 (제목에 "온라인" 명시된 경우만 true, 없으면 false=오프라인)
  const isOnline = /온라인/.test(title) || /온라인/.test(tc.slice(0, 300))

  const { startTime, endTime } = extractTimes(tc)

  // 출장·교육 공문이 맞는지 — 아니면 화면에서 "못 찾았다"고 말한다.
  const isTripDoc = /교육|출장|세미나|연수|워크숍|워크샵|학술대회|심포지엄|컨퍼런스|포럼|보수교육|학회|훈련/.test(tn)

  return { title, periodDisplay, startDate, endDate, nights, days, destination, registration,
           registrationNote, isOnline, startTime, endTime, venue: extractVenue(tc),
           yearGuessed, isTripDoc, guessedYear: yearGuessed ? curY : null }
}

// 공문 본문에서 교육 시작·종료 시각을 뽑는다. "14:00~17:00", "오후 2시", "14시 30분" 모두 대응.
function extractTimes(tc) {
  const toHM = (h, m, ampm) => {
    let hh = parseInt(h, 10)
    if (ampm === '오후' && hh < 12) hh += 12
    if (ampm === '오전' && hh === 12) hh = 0
    if (hh > 23) return ''
    return `${String(hh).padStart(2, '0')}:${String(parseInt(m || 0, 10)).padStart(2, '0')}`
  }
  const AMPM = '(오전|오후)?\\s*'
  const T = '(\\d{1,2})\\s*[:시]\\s*(\\d{1,2})?\\s*분?'
  const rangeRe = new RegExp(AMPM + T + '\\s*(?:~|-|–|부터)\\s*' + AMPM + T)
  const range = tc.match(rangeRe)
  if (range) {
    const start = toHM(range[2], range[3], range[1])
    const end   = toHM(range[5], range[6], range[4] || range[1])
    if (start) return { startTime: start, endTime: end && end > start ? end : '' }
  }
  const kwRe = new RegExp('(?:일\\s*시|시\\s*간|교육시간|시작)[^\\d오전후]{0,12}?' + AMPM + T)
  const kw = tc.match(kwRe)
  if (kw) {
    const start = toHM(kw[2], kw[3], kw[1])
    if (start) return { startTime: start, endTime: '' }
  }
  const from = tc.match(new RegExp(AMPM + T + '\\s*부터'))
  if (from) {
    const start = toHM(from[2], from[3], from[1])
    if (start) return { startTime: start, endTime: '' }
  }
  return { startTime: '', endTime: '' }
}

// 공문의 장소 줄에서 기관·건물명을 뽑는다(카카오 장소 검색에 그대로 넣는다).
function extractVenue(tc) {
  const m = tc.match(/(?:장\s*소|위\s*치|개최장소)\s*[:：]?\s*([가-힣A-Za-z0-9()·\s]{2,40})/)
  if (!m) return ''
  const raw = m[1].trim().replace(/\s{2,}.*$/, '').replace(/[,·]\s*$/, '').slice(0, 40)
  return fixLetterSpacing(raw.replace(TITLE_BODY_CUT, '')).trim()
}

function renderParseResult(filename, meta, hasText) {
  const grid = document.getElementById('resultGrid')
  const resultEl = document.getElementById('parseResult')

  const fmt = v => v ? `<span>${escapeHtml(String(v))}</span>` : `<span class="empty">확인 안 됨</span>`
  const feeStr = meta.registration ? `${meta.registration.toLocaleString()}원` : ''

  let warnHtml = ''
  // 출장·교육 공문이 아니면(영수증·매출전표 등) 읽은 척하지 않는다
  if (hasText && meta.isTripDoc === false) {
    warnHtml += `
      <div class="result-warn full">
        <span>❌</span>
        <div>
          <strong>출장·교육 공문으로 보이지 않아요</strong>
          <p>이 파일에서는 교육·출장 관련 내용을 찾지 못했어요.<br>다른 파일을 올리시거나, 다음 단계에서 직접 입력해주세요.</p>
        </div>
      </div>`
  }
  if (!hasText) {
    // OCR/텍스트 추출 실패 → 파일명 기반 파싱만 됨
    warnHtml += `
      <div class="result-warn full">
        <span>⚠️</span>
        <div>
          <strong>내용을 자동으로 읽지 못했어요</strong>
          <p>PDF가 이미지 형식이거나 보안 설정이 있을 수 있어요.<br>아래 정보가 맞지 않으면 다음 단계에서 직접 수정해주세요.</p>
        </div>
      </div>`
  }

  // 공문에 연도가 없어 올해로 채운 경우엔 추정이라고 밝힌다
  const periodStr = meta.periodDisplay && meta.yearGuessed
    ? `${meta.periodDisplay} (${meta.guessedYear}년으로 추정)`
    : meta.periodDisplay

  // 지역은 읽었지만 건물·기관명(장소)은 못 읽는 공문이 많다.
  // 예전에는 그걸 "장소"로 보여줘 다음 화면에서 "출장 지역" 오류로 막혔다.
  const venueHtml = meta.venue
    ? `<div class="result-item full"><label>장소</label><span>${escapeHtml(meta.venue)}</span></div>`
    : `<div class="result-item full"><label>장소</label><span class="empty">확인 안 됨 — 다음 화면에서 직접 넣어주세요</span></div>`

  grid.innerHTML = `
    <div class="result-item full"><label>파일명</label><span>${escapeHtml(filename)}</span></div>
    <div class="result-item full"><label>출장/교육명</label>${fmt(meta.title)}</div>
    <div class="result-item"><label>기간</label>${fmt(periodStr)}</div>
    <div class="result-item"><label>지역</label>${fmt(meta.destination)}</div>
    ${venueHtml}
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

  // 기차 역산 안내는 탈 기차를 추천할 때만 의미가 있다 — 온라인 교육과
  // 이미 다녀온 출장에서는 숨긴다(다녀온 출장은 routePanel도 추천을 빼고 그린다).
  document.getElementById('time-ktx-hint')
    ?.classList.toggle('hidden', isOnline || state.tripStatus === 'done')

  // 교육비 버튼 / 없어요 연동
  prepareCard4Online()

  // 온라인 여부로 단계 수가 바뀐다 — 헤더 진행률·진행바까지 같이 갱신한다
  updateProgress()
}

// ── CARD 4: 교육비 유무 버튼 노출 ────────────────────────────────────────────
// 온라인 교육에도 무료 과정이 있으므로 "없어요"를 숨기지 않는다. 예전에는 온라인을
// 고르면 "없어요"가 사라지면서 hasFee가 true로 덮어써졌고, 오프라인으로 되돌려도
// 사용자가 고른 적 없는 "있어요"가 선택된 채 남아 그대로 계산에 들어갔다.
function prepareCard4Online() {
  document.getElementById('feeBtn-no')?.classList.remove('hidden')
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
    // 금액을 인식했으면 "있어요"까지 미리 골라 둔다. 예전에는 위쪽 확인 배너만 보고
    // 넘어가면 아래 토글이 비어 있어 "교육/등록비 유무 선택" 오류로 막혔다.
    selectFeePresence(true)
  }
  if (meta.startTime) setAutofilled('input-starttime', meta.startTime)
  if (meta.endTime)   setAutofilled('input-endtime', meta.endTime)
  if (meta.startTime || meta.endTime) onTimeChange()
  if (meta.venue && !state.place) setAutofilled('input-place', meta.venue)

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
    document.getElementById('c4-fee-sub').textContent =
      meta.registrationNote || '사전납입·회원병원 기준 금액이에요. 맞나요?'
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

  // 종료일 달력에서 시작일 이전을 고를 수 없게 막는다.
  // 시작일 쪽에는 max 를 걸지 않는다 — 일정을 통째로 뒤로 옮길 때 막혀버린다.
  const endEl = document.getElementById('input-end')
  if (endEl) endEl.min = start || ''

  const tag = document.getElementById('duration-tag')
  if (start && end) {
    const ms = new Date(end) - new Date(start)
    if (ms < 0) {
      // 종료일이 시작일보다 앞서면 예전에는 조용히 '1일 (당일)'로 계산됐다 — 금액이 틀린다
      state.nights = 0
      state.days   = 0
      tag.textContent = '종료일이 시작일보다 앞서요'
      tag.classList.remove('hidden')
      tag.classList.add('duration-tag-error')
      document.getElementById('end-box')?.classList.add('input-error')
      return
    }
    tag.classList.remove('duration-tag-error')
    document.getElementById('end-box')?.classList.remove('input-error')
    state.nights = Math.floor(ms / 86400000)
    state.days   = state.nights + 1
    tag.textContent = state.nights === 0 ? `${state.days}일 (당일)` : `${state.nights}박 ${state.days}일`
    tag.classList.remove('hidden')
  }
}

// 달력 열기 — showPicker() 우선, 미지원 브라우저는 focus() 폴백
// 날짜 피커는 네이티브 input 이 직접 연다 (styles.css .date-native).
// showPicker() 경유 방식은 WebKit(사파리·iOS)에서 예외 없이 무시돼
// 공문 없이 날짜를 고를 방법이 사라졌었다 — 되살리지 말 것.

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
  '전주', '순천', '여수', '목포', '창원', '진주', '천안', '제주',
]

// 카카오 장소 검색 디바운스 타이머
let _placeDebounce = null

function onPlaceInput() {
  const val = document.getElementById('input-place').value.trim()
  state.place = val
  state.placeLat = null
  state.placeLon = null
  state.accessOverride = {}
  state.pinStation = null

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
            onclick="selectPlace('${nameRaw.replace(/'/g,"\\'")}', '${addrRaw.replace(/'/g,"\\'")}', ${d.y}, ${d.x})">
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

function selectPlace(name, addr, lat, lon) {
  document.getElementById('input-place').value = name
  document.getElementById('placeSuggest').classList.add('hidden')
  state.place = name
  state.placeLat = Number(lat) || null
  state.placeLon = Number(lon) || null
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
    ['부산', '부산'], ['전주', '전주'],
    ['순천', '순천'], ['광양', '순천'], ['여수', '여수'], ['목포', '목포'],
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

  // 등록비 유무로 단계 수가 바뀐다 — 트레일·헤더 진행률·진행바를 함께 갱신한다
  updateProgress()
  updateDocStrip()
}

function formatFeeInput(input) {
  const raw = input.value.replace(/[^0-9]/g, '')
  state.fee = parseInt(raw) || 0
  input.value = raw ? Number(raw).toLocaleString() : ''
}

// ── CARD 6: 등록비 납부 (납부 여부 + 납부 형태 통합) ────────────────────────
// 예전에는 "납부했나요"(Card 6) → "어떻게 납부했나요"(Card 7)로 갈라 두 화면에서
// 선택지를 두 개씩만 물었다. 같은 주제를 두 번 넘기게 되어 한 화면으로 합쳤다.
function resetCard6() {
  ;['c6-card-note', 'c6-bank-opts', 'c6-pending-sub', 'c6-pend-card-note', 'c6-pend-bank-note']
    .forEach(id => document.getElementById(id)?.classList.add('hidden'))
  ;['c6-btn-card', 'c6-btn-bank', 'c6-btn-pending', 'c6-pend-card', 'c6-pend-bank']
    .forEach(id => document.getElementById(id)?.classList.remove('selected'))
  const q = document.getElementById('card6-q')
  if (q) q.innerHTML = state.tripStatus === 'planned'
    ? '교육비 / 등록비를<br>어떻게 납부하실 건가요?'
    : '교육비 / 등록비를<br>어떻게 납부하셨나요?'
}

function select6Method(method) {
  state.feeStatus   = method === 'pending' ? 'not-paid' : 'paid'
  state.receiptType = null
  ;['card', 'bank', 'pending'].forEach(m =>
    document.getElementById(`c6-btn-${m}`)?.classList.toggle('selected', m === method))
  document.getElementById('c6-card-note')?.classList.toggle('hidden', method !== 'card')
  document.getElementById('c6-bank-opts')?.classList.toggle('hidden', method !== 'bank')
  document.getElementById('c6-pending-sub')?.classList.toggle('hidden', method !== 'pending')
  if (method === 'pending') {
    document.getElementById('c6-pend-card')?.classList.remove('selected')
    document.getElementById('c6-pend-bank')?.classList.remove('selected')
    document.getElementById('c6-pend-card-note')?.classList.add('hidden')
    document.getElementById('c6-pend-bank-note')?.classList.add('hidden')
  }
  updateDocStrip()
  const panelId = method === 'card' ? 'c6-card-note' : method === 'bank' ? 'c6-bank-opts' : 'c6-pending-sub'
  document.getElementById(panelId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function select6PendingMethod(method) {
  document.getElementById('c6-pend-card')?.classList.toggle('selected', method === 'card')
  document.getElementById('c6-pend-bank')?.classList.toggle('selected', method === 'bank')
  document.getElementById('c6-pend-card-note')?.classList.toggle('hidden', method !== 'card')
  document.getElementById('c6-pend-bank-note')?.classList.toggle('hidden', method !== 'bank')
}

function select6Receipt(val) {
  state.feeStatus   = 'paid'
  state.receiptType = val
  updateDocStrip()
  setTimeout(() => state.isOnline ? goToCard(9) : goToCard(8), 150)
}

function confirmCard6NotPaid() {
  state.feeStatus   = 'not-paid'
  state.receiptType = null
  state.isOnline ? goToCard(9) : goToCard(8)
}

// ── 전날 이동 판정 ───────────────────────────────────────────────────────────
// 기준은 하나다: 교육 시작에 닿으려면 정상 출근시각(08:30)보다 먼저 마산역을 떠나야
// 하는가. 예전 기준이던 '서울 + 12시 이전 시작'은 이 판정의 옛 근사치라 버렸다
// (2026-09-25 지석초이 승인). 역산이 되는 구간은 앱이 자동으로 답을 정한다.
const WORK_START_MIN = 8 * 60 + 30

function applyPrevDayMove() {
  const autoEl = document.getElementById('daytrip-auto')
  const setNote = html => {
    if (!autoEl) return
    autoEl.innerHTML = html
    autoEl.classList.remove('hidden')
  }
  if (autoEl) autoEl.classList.add('hidden')

  const r = computeRoutePlan()
  const plan = r && !r.skip ? r.plan : null

  if (plan && plan.ok && plan.best) {
    const early = plan.best.dep < WORK_START_MIN
    if (state.prevDayMove === null) setYN('prevDayMove', early)
    setNote(early
      ? `역산하면 마산역 <strong>${fmtTime(plan.best.dep)}</strong> 출발이라 출근시각 08:30보다 일러요. 전날 이동으로 골라 뒀어요 — 다르면 아래에서 바꾸세요.`
      : `역산하면 마산역 <strong>${fmtTime(plan.best.dep)}</strong> 출발이라 출근시각 08:30 이후예요. 당일 이동으로 골라 뒀어요 — 다르면 아래에서 바꾸세요.`)
    return { mode: 'ask' }
  }

  // 당일 도착할 열차가 아예 없으면 선택지가 없다 — 묻지 않고 확정한다.
  if (plan && !plan.ok && plan.reason === 'no-train') {
    state.prevDayMove = true
    return { mode: 'forced' }
  }
  // 마산역 인근이라 기차를 타지 않는 구간은 전날 이동이 성립하지 않는다.
  if (plan && !plan.ok && plan.reason === 'near') {
    state.prevDayMove = false
    return { mode: 'skip' }
  }

  // 시외버스·제주·좌표 미상: 역산이 안 되니 직접 묻는다.
  const startMin = toMinutes(state.startTime)
  if (startMin != null) {
    setNote(`입력하신 교육 시작시각은 <strong>${escapeHtml(state.startTime)}</strong>이에요. 여기에 맞추려면 08:30 전에 나서야 했는지 골라주세요.`)
  }
  return { mode: 'ask' }
}

// ── CARD 8: 추가 확인 준비 ───────────────────────────────────────────────────
function prepareCard8() {
  // 재진입 시 지난 에러 표시는 지우고 시작한다
  document.getElementById('c8-err-banner')?.classList.add('hidden')
  document.querySelectorAll('#card-8 .field-error').forEach(el => el.classList.remove('field-error'))
  // 당일치기 → 항상 숙박으로 간주 (isDayTrip = false)
  state.isDayTrip = false

  // 8시간 이하 당일 출장 질문 표시 조건:
  // - 비수도권 + 당일(nights===0) + KTX 목적지가 아닌 경우
  // → KTX 등재 지역(대전·대구 등): 마산역 기준 이동시간만으로 8시간 초과 → 숨김
  // → 시외버스 지역(부산·울산·경주 등): 애매하므로 표시
  // → 운임표 없는 인근 지역(창원·진주 등): 표시
  const fare = getFare(state.region || state.place)
  const prevDay = applyPrevDayMove()
  const showShortDay = !state.isSeoul && (state.nights || 0) === 0
    && !(fare && fare.ktxNormal) && state.prevDayMove !== true
  document.getElementById('field-shortdaytrip').classList.toggle('hidden', !showShortDay)
  if (!showShortDay) {
    state.isShortDayTrip = null
    document.querySelectorAll('#field-shortdaytrip .yn-btn').forEach(b => b.classList.remove('selected'))
  }

  const isShort   = state.isShortDayTrip === true
  const isDayTrip = (state.nights || 0) === 0

  // 8시간 이하 당일 출장이면 직급·전날이동·숙소·식사 질문 숨김
  // 제주 출장이면 KTX를 타지 않으므로 직급(특실 여부) 질문 불필요
  // 당일 출장(nights=0)이면 숙소 질문도 숨김
  document.getElementById('field-rank').classList.toggle('hidden', isShort || state.isJeju)
  document.getElementById('field-daytrip').classList.toggle('hidden', isShort || prevDay.mode !== 'ask')
  document.getElementById('field-lodging').classList.toggle('hidden', isShort || isDayTrip)
  const showMeal = !isShort && (state.nights || 0) >= 2
  document.getElementById('field-meal').classList.toggle('hidden', !showMeal)

  const startMin = toMinutes(state.startTime)

  // 8시간 판정은 자동으로 못 한다 — 시외버스 구간(부산·울산·전주 등)은 소요시간
  // 자료가 없어 왕복 이동시간을 더할 수 없다. 대신 앱이 아는 교육시간을 보여준다.
  const shortAutoEl = document.getElementById('shortday-auto')
  if (shortAutoEl) {
    const endMin = toMinutes(state.endTime)
    const known  = (startMin != null && endMin != null && endMin > startMin)
      ? `입력하신 교육 시간은 <strong>${fmtDur(endMin - startMin)}</strong>이에요. `
      : ''
    shortAutoEl.innerHTML = known +
      ((fare && fare.bus) || busOnlyRegion(state.region || state.place)
        ? '시외버스 구간은 소요시간 자료가 없어 왕복 이동시간까지 자동으로 더하지 못해요 — 직접 골라주세요.'
        : '여기에 왕복 이동시간을 더해 8시간을 넘는지 골라주세요.')
    shortAutoEl.classList.toggle('hidden', !showShortDay)
  }

  // 제주: 항공 안내 표시, 셔틀은 항상 이용 가정 → 질문 숨기고 자동 true
  document.getElementById('field-plane').classList.toggle('hidden', !state.isJeju)
  document.getElementById('field-shuttle').classList.add('hidden') // 항상 숨김 (제주도 자동 true)
  if (state.isJeju) {
    state.hasPlane = true
    state.hasShuttle = true // 제주 공항 셔틀 항상 이용 가정 (법인카드 영수증 제출)
  }
}

// ── Card 8 유효성 검사 ────────────────────────────────────────────────────────
// 화면에 보이는 Y/N 질문 중 답하지 않은 것이 있으면 금액을 계산하지 않는다.
// 예전에는 무검증으로 Card 9 로 넘어가, 숙소 제공 질문을 못 보고 지나치면
// 숙박비 10만원이 그대로 붙은 금액이 '예상 정산 총액'으로 나왔다.
const CARD8_QUESTIONS = [
  { field: 'isShortDayTrip',  id: 'field-shortdaytrip', label: '교육+이동 8시간 이하 당일 출장인지' },
  { field: 'isMS',            id: 'field-rank',         label: '직급이 MS 이상인지' },
  { field: 'prevDayMove',     id: 'field-daytrip',      label: '출근시각(08:30) 전에 출발해야 했는지' },
  { field: 'lodgingProvided', id: 'field-lodging',      label: '숙소가 제공되는지' },
  { field: 'mealProvided',    id: 'field-meal',         label: '식사가 제공되는지' },
  { field: 'hasShuttle',      id: 'field-shuttle',      label: '공항 셔틀버스를 이용했는지' },
]

function validateCard8() {
  const errs = []
  for (const q of CARD8_QUESTIONS) {
    const el = document.getElementById(q.id)
    if (!el || el.classList.contains('hidden')) {
      el?.classList.remove('field-error')
      continue
    }
    if (state[q.field] === null || state[q.field] === undefined) {
      errs.push({ id: q.id, label: q.label })
      el.classList.add('field-error')
    } else {
      el.classList.remove('field-error')
    }
  }
  return errs
}

function goFromCard8() {
  const errs = validateCard8()
  if (errs.length > 0) {
    renderFlowErrors(8, errs, '아래 질문에 답해주세요 — 금액이 달라져요')
    const btn = document.getElementById('ctaNext8')
    btn?.classList.add('shake')
    setTimeout(() => btn?.classList.remove('shake'), 600)
    return
  }
  document.getElementById('c8-err-banner')?.classList.add('hidden')
  goToCard(9)
}

// Y/N 버튼 선택 + 조건부 필드 show/hide
function setYN(field, val) {
  state[field] = val

  // 전날 이동이 붙으면 당일 출장이 아니다 — 8시간 질문을 숨기고 답을 비운다.
  if (field === 'prevDayMove') {
    const hideShort = val === true
    const shortEl = document.getElementById('field-shortdaytrip')
    if (hideShort && shortEl && !shortEl.classList.contains('hidden')) {
      state.isShortDayTrip = null
      shortEl.querySelectorAll('.yn-btn').forEach(b => b.classList.remove('selected'))
      shortEl.classList.add('hidden')
    }
  }

  // 답한 질문은 에러 표시 해제 + 남은 오류가 없으면 배너도 닫는다
  const q = CARD8_QUESTIONS.find(x => x.field === field)
  if (q) {
    document.getElementById(q.id)?.classList.remove('field-error')
    if (!document.querySelector('#card-8 .field-error')) {
      document.getElementById('c8-err-banner')?.classList.add('hidden')
    }
  }

  // 버튼 선택 표시
  const fieldMap = {
    isShortDayTrip:  'field-shortdaytrip',
    isMS:            'field-rank',
    prevDayMove:     'field-daytrip',
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
    document.getElementById('field-daytrip').classList.toggle('hidden', isShort || applyPrevDayMove().mode !== 'ask')
    document.getElementById('field-lodging').classList.toggle('hidden', isShort || isDayTrip)
    const showMeal = !isShort && (state.nights || 0) >= 2
    document.getElementById('field-meal').classList.toggle('hidden', !showMeal)
    // 8시간 이하 당일이면 관련 state도 초기화
    if (isShort) {
      state.isMS = null; state.prevDayMove = null
      state.lodgingProvided = null; state.mealProvided = null
      document.querySelectorAll('#field-rank .yn-btn, #field-daytrip .yn-btn, #field-lodging .yn-btn, #field-meal .yn-btn')
        .forEach(b => b.classList.remove('selected'))
    }
  }
  // prevDayMove 노트는 Card 9 예상 금액에서 표시 (Card 8에선 숨김)
}

// ── CARD 9: 예상 금액 계산 ───────────────────────────────────────────────────
function prepareCard9() {
  // 입력값 최신화
  state.place  = document.getElementById('input-place')?.value?.trim()  || state.place
  state.region = document.getElementById('input-region')?.value?.trim() || state.region
  state.fee    = parseInt((document.getElementById('input-fee')?.value || '').replace(/,/g, '')) || state.fee
  onTimeChange()

  // 온라인 교육: 다음 버튼 텍스트 변경
  const nextBtn = document.getElementById('card9-next-btn')
  if (nextBtn) nextBtn.textContent = state.isOnline ? '구비서류 확인하기'
    : state.tripStatus === 'done' ? '출장신청서 내용 확인하기' : '출장신청서 작성하기'

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
    document.getElementById('prevDayHint')?.classList.add('hidden')
    document.getElementById('routePanel')?.classList.add('hidden')
    return
  }

  const isJeju  = state.isJeju
  const breakdown = []
  let total = 0

  // 1. 교통비 — 역산으로 도착역이 정해지면 그 역 운임을 쓴다.
  // (예: 삼성서울병원은 서울역이 아니라 수서역이 나오므로 금액도 수서역 기준이어야 한다)
  const fare = getFare(state.region || state.place)
  const rf   = isJeju ? null : routeFare()
  if (isJeju) {
    breakdown.push({ label: '항공료 (제주)', amount: '실비', note: '법인카드 결제 · 신용카드 매출전표 제출 필수' })
    if (state.hasShuttle === true) {
      breakdown.push({ label: '공항 셔틀버스', amount: '실비', note: '법인카드 결제 · 신용카드 매출전표 제출 필수' })
    }
  } else if (rf) {
    const kind = rf.transfers ? `${rf.via.join('·')} 환승 ${rf.transfers}회` : '직통'
    const bf = routeBusFaster()
    const busNote = bf
      ? ` · 시외버스가 약 ${fmtDur(bf.savedMin)} 빠른 구간 — 버스로 다녀오셨다면 실제 버스 요금으로 정산`
      : ''
    breakdown.push({
      label: `KTX ${rf.grade} (${rf.station}역)`,
      amount: rf.roundTrip,
      note: `마산역 ${fmtTime(rf.dep)} 출발 · ${kind} · 편도 ${rf.oneWay.toLocaleString()}원 × 2회${busNote}`,
    })
    total += rf.roundTrip
  } else if (fare) {
    const useFirst = state.isMS && fare.ktxFirst
    const fareAmt = useFirst ? fare.ktxFirst : (fare.ktxNormal ?? fare.bus ?? 0)
    const route = fareRouteText(fare)
    const oneWay = fareAmt / 2
    const origin = fare.bus ? ORIGIN_BUS : ORIGIN_RAIL
    const routeNote = route
      ? `${origin} → ${fare.label} · ${route} · 편도 ${oneWay.toLocaleString()}원 × 2회`
      : `왕복 기준 · ${origin} → ${fare.label}`
    const fareLabel = fare.bus
      ? `시외버스 (${fare.label})`
      : `KTX ${useFirst ? '특실' : '일반실'} (${fare.label})`
    breakdown.push({ label: fareLabel, amount: fareAmt, note: routeNote })
    total += fareAmt
  } else if (state.region || state.place) {
    const detour  = routeDetour()
    const busOnly = busOnlyRegion(state.region || state.place)
    if (busOnly) {
      breakdown.push({ label: '교통비 (시외버스)', amount: '직접 확인 필요',
        note: `${busOnly.label}은 시외버스 고정 구간 · 철도는 오송 경유로 돌아가 제외 · ${ORIGIN_BUS} 왕복 요금 확인 필요` })
    } else {
      breakdown.push(detour
        ? { label: '교통비 (시외버스)', amount: '직접 확인 필요',
            note: `철도는 ${detour.hub}까지 올라갔다 되내려오는 우회 구간 · 시외버스 왕복 요금 확인 필요` }
        : { label: '교통비', amount: '직접 확인 필요', note: '운임표에 없는 지역' })
    }
  }

  // 2. 일당 / 식사비 계산
  if (state.isShortDayTrip === true) {
    // ── 8시간 이하 당일 출장 예외 ──
    breakdown.push({ label: '일당', amount: 0, note: '교육+이동 8시간 이하 당일 출장 → 해당없음' })
    breakdown.push({ label: '식사비', amount: '1만원 이내', note: '법인카드 결제 필수 · 영수증 제출' })
    // 숙박비 없음 (당일)
  } else {
    let baseDays = Math.max(1, state.days || 1)
    const prevDayBonus = state.prevDayMove ? 1 : 0  // 전날 +1일
    const totalDays  = baseDays + prevDayBonus
    const tripNights = Math.max(0, state.nights || 0)

    let dailyTotal = 0
    if (state.mealProvided && !state.isDayTrip && tripNights >= 2) {
      // 식사 지원: 출장 중간날만 25% 적용
      const middleDays    = Math.max(0, baseDays - 2)
      const tripNormDays  = baseDays - middleDays
      dailyTotal = prevDayBonus * DAILY_RATE
                 + tripNormDays * DAILY_RATE
                 + middleDays * DAILY_RATE_25P
      const parts = []
      if (prevDayBonus) parts.push(`전날 1일 × ${DAILY_RATE.toLocaleString()}원`)
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
        if (prevDayBonus > 0) {
          const bonusLodging = prevDayBonus * LODGING_RATE
          breakdown.push({ label: `숙박비 전날 (${prevDayBonus}박)`, amount: bonusLodging, note: '출근시각 전 출발 — 전날 이동 · 본인 부담' })
          total += bonusLodging
        }
        if (tripNights > 0) {
          breakdown.push({ label: `숙박비 (${tripNights}박)`, amount: 0, note: '숙소 제공으로 미지급' })
        }
      } else {
        const baseNights = tripNights + prevDayBonus
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

  renderRoutePanel()

  // 전날 이동 인정 시 → 추가된 금액 강조 표시
  const prevDayHintEl = document.getElementById('prevDayHint')
  if (prevDayHintEl) {
    const show = state.prevDayMove === true
    prevDayHintEl.classList.toggle('hidden', !show)
    if (show) {
      prevDayHintEl.innerHTML = `
        <div class="seoul-hint-title">✅ 전날 이동 적용됨</div>
        <div class="seoul-hint-body">
          전날 이동 기준으로 아래 금액이 <strong>추가</strong>됐어요
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

function onTimeChange() {
  state.startTime = document.getElementById('input-starttime')?.value || ''
  state.endTime   = document.getElementById('input-endtime')?.value   || ''
}

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '')
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null
}

function tripDow() {
  if (!state.startDate) return null
  const d = new Date(state.startDate + 'T00:00:00')
  return isNaN(d) ? null : (d.getDay() + 6) % 7
}

// 목적지 좌표. 앱에 등재된 출장 빈발 기관이 1순위(역→기관 이동시간이 확인된 값이라
// 도착역 판정이 정확해진다), 그다음이 장소 검색 결과, 마지막이 지역 대표역이다.
function routeDestination() {
  const known = findDestination(state.place) || findDestination(state.region)
  if (known) {
    return { lat: known.lat, lon: known.lon, label: known.name, proxy: false, row: known }
  }
  if (state.placeLat && state.placeLon) {
    return { lat: state.placeLat, lon: state.placeLon, label: state.place, proxy: false }
  }
  const fare = getFare(state.region || state.place)
  const st = fare && fare.station && KtxRoute.stations && KtxRoute.stations[fare.station]
  if (st) return { lat: st.lat, lon: st.lon, label: fare.label, proxy: true }
  return null
}

function legLine(leg) {
  return `<div class="route-leg">
    <span class="route-leg-train">${escapeHtml(leg.no)} ${escapeHtml(leg.type)}</span>
    <span class="route-leg-time">${leg.from} ${fmtTime(leg.dep)} → ${leg.to} ${fmtTime(leg.arr)}</span>
    <span class="route-leg-note">${escapeHtml(leg.note)} 운행 · ${fmtDur(leg.arr - leg.dep)}</span>
  </div>`
}

const ACCESS_SRC_LABEL = { known: '확인값', user: '직접 입력', est: '추정' }
function accessSrcLabel(src) { return ACCESS_SRC_LABEL[src] || '추정' }

// 마스터에 없는 기관이거나 추정값이 실제와 다를 때, 도착역과 이동시간을 직접 넣는 폼.
// 넣은 값은 그 역의 접근시간으로 바로 반영되고, 도착역 판정도 그 값으로 다시 계산한다.
function accessFormHtml(best, plan) {
  const opts = [best, ...plan.alternatives]
    .map(p => p.station)
    .filter((v, i, a) => a.indexOf(v) === i)
  const cur = state.pinStation || best.station
  const sel = opts.map(n =>
    `<option value="${escapeHtml(n)}"${n === cur ? ' selected' : ''}>${escapeHtml(n)}역</option>`).join('')
  const curMin = state.accessOverride[cur]
  return `<details class="route-fix"${state.pinStation ? ' open' : ''}>
    <summary>역→목적지 이동시간을 직접 넣기</summary>
    <div class="route-fix-body">
      <div class="route-fix-row">
        <select id="routeFixStation" aria-label="도착역">${sel}</select>
        <input id="routeFixMin" type="number" min="0" max="240" step="5" inputmode="numeric"
               placeholder="분" value="${Number.isFinite(curMin) ? curMin : ''}" aria-label="이동시간(분)">
        <button type="button" class="route-fix-btn" onclick="applyAccessOverride()">적용</button>
      </div>
      <div class="route-fix-help">실제 대중교통 소요시간을 아시면 넣어 주세요. 넣은 역으로 도착역이 고정됩니다.
        ${state.pinStation ? `<button type="button" class="route-fix-clear" onclick="clearAccessOverride()">자동 판정으로 되돌리기</button>` : ''}</div>
    </div>
  </details>`
}

// 좌표를 모를 때 쓰는 폼 — 운임표에 있는 역 전체에서 내릴 역을 고르고 이동시간을 넣는다.
function manualPickHtml() {
  const names = fareStationNames()
  if (!names.length) return ''
  const cur = state.pinStation
  const sel = ['<option value="">내릴 역 선택</option>']
    .concat(names.map(n => `<option value="${escapeHtml(n)}"${n === cur ? ' selected' : ''}>${escapeHtml(n)}역</option>`))
    .join('')
  return `<div class="route-fix route-fix-open">
    <div class="route-fix-row">
      <select id="routeFixStation" aria-label="내릴 역">${sel}</select>
      <input id="routeFixMin" type="number" min="0" max="240" step="5" inputmode="numeric"
             placeholder="분" aria-label="역에서 목적지까지 이동시간(분)">
      <button type="button" class="route-fix-btn" onclick="applyAccessOverride()">계산</button>
    </div>
    <div class="route-fix-help">역에서 교육장까지 대중교통으로 걸리는 시간을 분으로 넣어 주세요.</div>
  </div>`
}

// 도착역·이동시간을 바꾸면 안내 패널뿐 아니라 예상금액 교통비도 같이 바뀌어야 한다.
function refreshAmountAndRoute() {
  if (typeof prepareCard9 === 'function' && document.getElementById('amountBreakdown')) prepareCard9()
  else renderRoutePanel()
}

function applyAccessOverride() {
  const st = document.getElementById('routeFixStation')?.value
  const raw = document.getElementById('routeFixMin')?.value
  if (!st) return
  const min = Number(raw)
  if (!raw || !Number.isFinite(min) || min < 0) return
  state.accessOverride = { ...state.accessOverride, [st]: Math.round(min) }
  state.pinStation = st
  refreshAmountAndRoute()
}

function clearAccessOverride() {
  state.accessOverride = {}
  state.pinStation = null
  refreshAmountAndRoute()
}

// 역산 계산만 떼어낸 함수. 화면 안내(renderRoutePanel)와 정산 교통비가 서로 다른 역을
// 가리키지 않도록, 두 곳이 모두 이 함수 하나를 부른다.
function computeRoutePlan() {
  if (state.isOnline) return { skip: 'online' }
  if (state.isJeju)   return { skip: 'jeju' }
  const busFare = getFare(state.region || state.place)
  if (busFare && busFare.bus) return { skip: 'bus', busFare }
  const busOnly = busOnlyRegion(state.region || state.place)
  if (busOnly) return { skip: 'busonly', busOnly }
  if (!KtxRoute.ready) return { skip: 'data' }

  const startMin = toMinutes(state.startTime)
  if (startMin == null) return { skip: 'notime' }
  const dow  = tripDow()
  const dest = routeDestination()

  // 좌표를 모르는 기관(앱에 등재도 안 됐고 장소 검색도 안 한 경우)은
  // 도착역과 역→목적지 이동시간을 직접 받아 같은 역산을 돌린다.
  if (!dest) {
    const pin  = state.pinStation
    const mins = pin ? state.accessOverride[pin] : null
    if (!pin || !Number.isFinite(mins)) return { skip: 'needmanual' }
    return { manual: true, dest: null, dow, plan: planFromStation({
      station: pin, accessMin: mins, startMin, dow,
      isMS: state.isMS === true, endMin: toMinutes(state.endTime),
    }) }
  }
  return { manual: false, dest, dow, plan: planTrip({
    lat: dest.lat, lon: dest.lon, startMin, dow,
    isMS: state.isMS === true, endMin: toMinutes(state.endTime),
    destRow: dest.row || null, access: state.accessOverride, only: state.pinStation,
  }) }
}

// 정산 교통비에 그대로 넣을 금액·경로. 역산이 성립할 때만 값을 주고, 안 되면 null을
// 돌려 기존 지역 운임표(getFare)로 되돌아간다.
function routeFare() {
  const r = computeRoutePlan()
  if (!r || r.skip) return null
  return settlementFare(r.plan)
}

// 철도 우회로 시외버스를 권한 구간인지. 예상 금액 문구가 화면 안내와 같은 말을 하도록 쓴다.
function routeDetour() {
  const r = computeRoutePlan()
  if (!r || r.skip || !r.plan || r.plan.ok) return null
  return r.plan.reason === 'detour' ? r.plan.detour : null
}

// 철도가 성립하지만 시외버스가 확실히 빠른 구간. 화면 안내와 정산 비고가 같은 말을 하도록 쓴다.
function routeBusFaster() {
  const r = computeRoutePlan()
  if (!r || r.skip || !r.plan || !r.plan.ok) return null
  return r.plan.busFaster || null
}

function renderRoutePanel() {
  const el = document.getElementById('routePanel')
  if (!el) return
  const hide = msg => {
    el.className = msg ? 'route-panel route-panel-bare' : 'route-panel hidden'
    el.innerHTML = msg ? `<div class="route-empty">${msg}</div>` : ''
  }
  const show = html => {
    el.className = 'route-panel'
    el.innerHTML = html
  }

  // 다녀온 출장은 몇 시 기차를 탈지 추천받을 필요가 없다. 도착역·운임은 정산 금액의
  // 근거이므로 그대로 두고, 탈 열차·귀가편·대안 추천만 뺀다.
  const isDone = state.tripStatus === 'done'

  const r = computeRoutePlan()
  if (r.skip === 'online') return hide('')
  if (r.skip === 'jeju')   return hide('✈️ 제주는 항공 이용 구간이라 기차 역산 안내를 하지 않아요.')
  if (r.skip === 'bus') {
    return hide(`🚌 ${escapeHtml(r.busFare.label)}은 시외버스 구간이라 기차 시간표 역산 대상이 아니에요. ${ORIGIN_BUS}에서 출발합니다. (왕복 ${r.busFare.bus.toLocaleString()}원)`)
  }
  if (r.skip === 'busonly') return show(busOnlyHtml(r.busOnly))
  if (r.skip === 'data')   return hide('🚄 시간표 데이터를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.')
  if (r.skip === 'notime') {
    return hide(isDone
      ? '🚄 교육 시작시각을 넣으면 도착역과 정산 기준 운임을 계산해 드려요. (정보 확인 화면 → 교육 시각)'
      : '🚄 교육 시작시각을 넣으면 마산역에서 몇 시 기차를 타야 하는지 역산해 드려요. (정보 확인 화면 → 교육 시각)')
  }
  if (r.skip === 'needmanual') {
    el.className = 'route-panel route-panel-bare'
    el.innerHTML = `<div class="route-empty">🚄 출장 장소를 검색해서 고르면 도착역과 ${isDone ? '정산 기준 운임' : '기차편'}을 자동으로 계산해 드려요.
      검색이 안 되는 곳이면 아래에서 내릴 역과 이동시간을 직접 넣어 주세요.</div>
      ${manualPickHtml()}`
    return
  }
  const { plan, dest, manual, dow } = r
  if (!plan.ok && manual) {
    return hide(`🚄 ${escapeHtml(state.pinStation)}역으로는 시작시각 ${state.startTime} 전에 닿는 당일 열차가 없어요. 다른 역을 골라 보세요.`)
  }
  if (!plan.ok && plan.reason === 'near') {
    return hide(`🚗 목적지가 마산역에서 직선 ${plan.originKm}km 거리라 기차를 탈 구간이 아니에요.`)
  }
  if (!plan.ok && plan.reason === 'detour') return show(detourBusHtml(plan.detour, dest, plan.bus))
  if (!plan.ok) {
    if (isDone) {
      return show(`<div class="route-head"><span class="route-head-title">🚄 당일 출발로는 시작시각을 못 맞추는 구간이에요</span></div>
        <div class="route-warn">시작시각 ${state.startTime}에 닿는 당일 열차가 없는 구간입니다. 전날 이동했다면 추가 일당·숙박비가 정산 대상이에요.</div>`)
    }
    const prev = dest ? planPreviousDay({ lat: dest.lat, lon: dest.lon, dow,
      destRow: dest.row || null, access: state.accessOverride }) : null
    const prevHtml = prev && prev.options.length
      ? `<div class="route-alt-title">전날 이동 후보 (${prev.station}역 도착)</div>` +
        prev.options.map(o => `<div class="route-alt">마산 ${fmtTime(o.dep)} → ${prev.station} ${fmtTime(o.arr)} · ${o.legs[0].no}${o.transfers ? ` · ${o.via.join('·')} 환승` : ' · 직통'}</div>`).join('')
      : ''
    show(`<div class="route-head"><span class="route-head-title">🚄 당일 출발로는 시작시각을 못 맞춰요</span></div>
      <div class="route-warn">시작시각 ${state.startTime} 기준으로 도착 가능한 당일 열차가 없습니다. 전날 이동이 필요합니다.</div>${prevHtml}`)
    return
  }

  const b = plan.best
  const busTop = plan.busFaster ? busFasterHtml(plan.busFaster) : ''
  const railHead = plan.busFaster ? '기차로 가실 경우 — ' : ''
  const arriveVenue = b.arr + b.access
  const fareLine = b.fare
    ? `편도 ${b.fare.oneWay.toLocaleString()}원 (${b.fare.grade}) · 왕복 ${b.fare.roundTrip.toLocaleString()}원`
    : '운임표에 없는 역'
  const routeKind = b.transfers ? `${b.via.join('·')} 환승 ${b.transfers}회` : '직통'
  // 도착역을 기관 행에서 고정한 곳(원주 등)은 역에서 목적지까지가 시내 이동이 아니라
  // 또 한 번의 시외 이동이다. 그 135분이 무엇인지 화면에 그대로 밝힌다.
  const accessNote = dest && dest.row && dest.row.accessNote
    ? `<div class="route-note">${escapeHtml(dest.row.accessNote)}</div>`
    : ''
  // 사용자가 도착역을 직접 고른 경우에만 우회 경로가 여기까지 온다(자동 추천에서는 걸러진다).
  const detourWarn = b.detour
    ? `<div class="route-warn">직접 고르신 ${escapeHtml(b.station)}역은 ${escapeHtml(b.detour.hub)}까지 올라갔다 되내려오는 경로예요 — 직선 ${b.detour.directKm}km를 ${b.detour.railKm}km로 돕니다. 시외버스가 빠를 수 있습니다.</div>`
    : ''
  const waitLine = b.transfers && b.wait != null
    ? `<div class="route-transfer">🔁 ${b.via.join('·')}역 환승 대기 ${b.wait}분</div>` : ''

  const altHtml = plan.alternatives.length
    ? `<div class="route-alt-title">다른 후보</div>` + plan.alternatives.map(a =>
        `<div class="route-alt">마산 ${fmtTime(a.dep)} → ${a.station}역 ${fmtTime(a.arr)} · ${a.transfers ? `${a.via.join('·')} 환승` : '직통'} · 역에서 ${a.access}분 · 현장 ${fmtTime(a.arr + a.access)} 도착(여유 ${a.margin}분)${a.tight ? ' <span class="route-tight">빠듯</span>' : ''}</div>`
      ).join('')
    : ''

  const retHtml = plan.ret
    ? (plan.ret.leg
        ? `<div class="route-alt-title">귀가편 (종료 ${state.endTime} 기준)</div>
           <div class="route-alt">${b.station}역 ${fmtTime(plan.ret.leg.dep)} 출발 → 마산 ${fmtTime(plan.ret.leg.arr)} 도착 · ${plan.ret.leg.no}${plan.ret.next ? ` (다음 편 ${fmtTime(plan.ret.next.dep)})` : ''}</div>`
        : `<div class="route-alt-title">귀가편</div><div class="route-alt">종료시각 이후 마산 직통 편이 없어요 — 숙박 또는 환승 확인이 필요합니다.</div>`)
    : ''

  if (isDone) {
    return show(`
      ${busTop}
      <div class="route-head">
        <span class="route-head-title">🚄 ${railHead}정산 기준 — 마산역 → ${escapeHtml(b.station)}역 · ${routeKind}</span>
        <span class="route-head-sub">${escapeHtml((dest && dest.label) || state.place || '')}${dest && dest.proxy ? ' (역 기준 계산)' : ''}${manual ? ' (역·이동시간 직접 지정)' : ''} 기준 운임</span>
      </div>
      ${detourWarn}
      <div class="route-step">💳 ${fareLine}</div>
      <div class="route-step">🚶 ${escapeHtml(b.station)}역에서 목적지까지 대중교통 약 ${b.access}분(${accessSrcLabel(b.accessSrc)})</div>
      ${accessNote}
      ${accessFormHtml(b, plan)}
      <div class="route-note">운임표 2026년 9월 기준. 실제 탑승 편과 무관하게 이 구간 운임으로 정산합니다. 도착역이 다르면 위에서 바꿔 주세요.</div>`)
  }

  show(`
    ${busTop}
    <div class="route-head">
      <span class="route-head-title">🚄 ${railHead}마산역 → ${escapeHtml(b.station)}역 · ${routeKind}</span>
      <span class="route-head-sub">${escapeHtml((dest && dest.label) || state.place || '')}${dest && dest.proxy ? ' (역 기준 계산)' : ''}${manual ? ' (역·이동시간 직접 지정)' : ''} ${state.startTime} 시작 기준 역산</span>
    </div>
    <div class="route-pick">
      <span class="route-pick-label">이 기차를 타세요</span>
      <span class="route-pick-time">마산역 ${fmtTime(b.dep)} 출발</span>
    </div>
    ${detourWarn}
    ${b.legs.map(legLine).join(waitLine)}
    <div class="route-step">🚶 ${escapeHtml(b.station)}역 ${fmtTime(b.arr)} 도착 → 목적지까지 대중교통 약 ${b.access}분(${accessSrcLabel(b.accessSrc)}) → 현장 ${fmtTime(arriveVenue)} 도착</div>
    ${accessNote}
    <div class="route-step">⏱ 시작 ${state.startTime}까지 여유 ${b.margin}분${b.tight ? ' <span class="route-tight">빠듯</span>' : ''} · 문 앞 총 소요 ${fmtDur(b.totalMin)}</div>
    ${plan.noBuffer ? '<div class="route-warn">권장 여유(10분)를 지키는 편이 없어 도착 직전에 닿는 편을 표시했습니다. 전날 이동도 함께 검토하세요.</div>' : ''}
    <div class="route-step">💳 ${fareLine}</div>
    ${altHtml}
    ${retHtml}
    ${accessFormHtml(b, plan)}
    <div class="route-note">시간표 2026년 10월 기준 · 운임표 2026년 9월 기준. ${b.accessSrc === 'est' ? '역→목적지 이동시간은 직선거리 기반 <strong>추정치</strong>이고 실제 대중교통 조회 결과가 아닙니다. ' : ''}좌석 잔여는 반영되지 않습니다.</div>`)
}

// 철도가 종착지보다 북쪽으로 올라갔다 되내려오는 구간(여수·순천·목포 등)에서 띄우는 안내.
// KTX 편을 추천하는 대신 시외버스로 돌린다. 요금은 운임표에 등록된 값만 쓰고, 없으면
// 없다고 밝힌다 — 근거 없는 금액을 정산서에 올리지 않기 위해서다.
function detourBusHtml(d, dest, busEst) {
  const where = (dest && dest.label) || state.place || '목적지'
  const bus   = getFare(state.region || state.place)
  const fareLine = bus && bus.bus
    ? `<div class="route-step">💳 시외버스 왕복 ${bus.bus.toLocaleString()}원 (${escapeHtml(bus.label)})</div>`
    : `<div class="route-warn">이 구간 시외버스 요금은 아직 운임표에 없어 자동 계산되지 않습니다. 관리자 화면에서 등록해야 예상 금액에 잡힙니다.</div>`
  return `
    <div class="route-head">
      <span class="route-head-title">🚌 이 구간은 시외버스를 타세요</span>
      <span class="route-head-sub">${escapeHtml(where)} · 철도는 우회 구간</span>
    </div>
    <div class="route-step">기차로 가려면 <strong>${escapeHtml(d.hub)}역</strong>까지 올라갔다가 ${escapeHtml(d.dest)}역으로 다시 내려와야 합니다. ${escapeHtml(d.hub)}역은 도착역보다 ${d.northKm}km 북쪽입니다.</div>
    <div class="route-step">📏 직선 ${d.directKm}km를 ${d.railKm}km로 도는 경로(${d.ratio}배)라 추천에서 뺐습니다.</div>
    ${busEst ? `<div class="route-step">⏱ 시외버스 문 앞 소요 약 ${fmtDur(busEst.totalMin)} <strong>추정</strong> · 도로 ${busEst.roadKm}km · 터미널 대기 ${busEst.waitMin}분 + 도착지 시내 ${busEst.localMin}분 포함</div>` : ''}
    ${fareLine}
    <div class="route-note">시외버스는 시간표 자료가 없어 몇 시 차를 탈지는 역산하지 않습니다. 터미널 시간표를 직접 확인해 주세요.</div>`
}

// 시외버스 고정 구간(목포·여수·순천)에서 기차 역산 대신 띄우는 안내.
// 철도 경로를 숨기지 않고 '왜 뺐는지'를 운임표 경로·금액으로 밝힌다 — 기차를 탄 경우의
// 정산 근거를 사용자가 직접 확인할 수 있어야 하기 때문이다.
function busOnlyHtml(b) {
  const where = state.place || b.label
  const bus   = getFare(state.region || state.place)
  const rail  = (KtxRoute.fares && KtxRoute.fares[b.railStation]) || null
  const via   = rail && rail.path ? rail.path.slice(1, -1) : []
  const railLine = rail
    ? `<div class="route-step">🚄 기차는 운임표 기준 <strong>마산 → ${escapeHtml(via.join(' → '))} → ${escapeHtml(b.railStation)}</strong> 경로입니다. ${escapeHtml(via[0] || '환승역')}은 ${escapeHtml(b.label)}보다 한참 북쪽이라, 올라갔다 되내려오는 만큼 시간이 더 걸립니다${rail.roundTrip ? ` (왕복 ${rail.roundTrip.toLocaleString()}원 · 환승 ${rail.transfers || 0}회)` : ''}.</div>`
    : `<div class="route-step">🚄 기차는 오송까지 올라갔다 되내려오는 환승 경로라 추천에서 뺐습니다.</div>`
  const fareLine = bus && bus.bus
    ? `<div class="route-step">💳 시외버스 왕복 ${bus.bus.toLocaleString()}원 (${escapeHtml(bus.label)})</div>`
    : `<div class="route-warn">이 구간 시외버스 요금은 아직 운임표에 없어 자동 계산되지 않습니다 — 실제 탑승 요금으로 정산하고, 관리자 화면에 등록하면 예상 금액에 잡힙니다.</div>`
  return `
    <div class="route-head">
      <span class="route-head-title">🚌 이 구간은 시외버스로 갑니다</span>
      <span class="route-head-sub">${escapeHtml(where)} · 기차는 돌아가는 경로라 제외</span>
    </div>
    <div class="route-step">${escapeHtml(b.label)}은 ${ORIGIN_BUS}에서 시외버스로 가는 구간이라 기차 시간표 역산을 하지 않습니다.</div>
    ${railLine}
    ${fareLine}
    <div class="route-note">시외버스는 시간표 자료가 없어 몇 시 차를 탈지는 역산하지 않습니다. 터미널 시간표를 직접 확인해 주세요.</div>`
}

// 철도로도 갈 수 있지만 시외버스가 확실히 빠른 구간(마산 → 전라도·원주 등)에서
// 철도 안내 위에 얹는 배너. 철도 안내와 기준 운임은 아래에 그대로 남긴다 —
// 실제로 기차를 탄 경우의 정산 근거를 없애지 않기 위해서다.
function busFasterHtml(b) {
  const fare = getFare(state.region || state.place)
  const fareLine = fare && fare.bus
    ? `<div class="route-step">💳 시외버스 왕복 ${fare.bus.toLocaleString()}원 (${escapeHtml(fare.label)})</div>`
    : `<div class="route-warn">이 구간 시외버스 요금은 운임표에 없어 자동 계산되지 않습니다 — 버스로 다녀오셨다면 실제 요금으로 정산하세요. 아래 금액은 기차 기준입니다.</div>`
  return `
    <div class="route-head">
      <span class="route-head-title">🚌 이 구간은 시외버스가 빠릅니다</span>
      <span class="route-head-sub">버스 약 ${fmtDur(b.totalMin)} 추정 · 기차 약 ${fmtDur(b.railMin)} — 약 ${fmtDur(b.savedMin)} 단축</span>
    </div>
    <div class="route-step">🚌 ${ORIGIN_BUS} → 목적지 도로 ${b.roadKm}km · 터미널 대기 ${b.waitMin}분 + 도착지 시내 ${b.localMin}분 포함</div>
    <div class="route-step">🚄 기차는 ${b.railVia && b.railVia.length ? `${escapeHtml(b.railVia.join('·'))} 환승 ` : '직통 '}${escapeHtml(b.railStation)}역 경유라 문 앞까지 약 ${fmtDur(b.railMin)} 걸립니다.</div>
    ${fareLine}
    <div class="route-note">버스 소요시간은 직선 ${b.directKm}km에 도로 보정을 적용한 <strong>추정치</strong>이고 시간표 조회 결과가 아닙니다. 터미널 시간표를 직접 확인해 주세요. 기차로 가실 경우의 안내는 아래에 그대로 있습니다.</div>`
}

function getFare(place) {
  if (!place) return null
  for (const row of FARE_TABLE) {
    if (row.keywords.some(k => place.includes(k))) return row
  }
  return null
}

// 운임 행 → "직통" / "동대구 환승 1회" 같은 경로 한 줄. 버스·항공 행은 빈 문자열.
function fareRouteText(fare) {
  if (!fare || !Array.isArray(fare.path) || fare.path.length < 2) return ''
  if (!fare.transfers) return '직통'
  const via = fare.path.slice(1, -1).join('·')
  return `${via} 환승 ${fare.transfers}회`
}

// ── 출장신청서 미리보기 ────────────────────────────────────────────────────────
function renderTripFormPreview() {
  const el = document.getElementById('tripFormWrap')
  if (!el) return

  const isJeju  = state.isJeju
  const prevDayBonus  = state.prevDayMove ? 1 : 0
  const baseDays    = Math.max(1, state.days || 1)
  const totalDays   = baseDays + prevDayBonus
  const tripNights  = Math.max(0, state.nights || 0)
  const baseNights  = tripNights + prevDayBonus
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
      dailyAmt   = prevDayBonus * DAILY_RATE + norm * DAILY_RATE + mid * DAILY_RATE_25P
      const parts = []
      if (prevDayBonus) parts.push(`@ 35,000 × ${prevDayBonus}일(전날) × 1명 = ₩ ${(prevDayBonus*DAILY_RATE).toLocaleString()}`)
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
    const bonusAmt = prevDayBonus * LODGING_RATE
    const bonusPart = prevDayBonus > 0
      ? `@ 100,000 × ${prevDayBonus}박(전날) × 1명 = ₩ ${bonusAmt.toLocaleString()}<br>`
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
  // 역산으로 도착역이 정해졌으면 그 역 운임으로 적는다(화면 안내와 같은 역·같은 금액).
  let fareRows = ''
  let fareTotal = 0
  const sheetRouteFare = isJeju ? null : routeFare()
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
  } else if (sheetRouteFare) {
    const rfs      = sheetRouteFare
    const half     = rfs.oneWay
    const viaGo    = rfs.transfers ? ` [${rfs.via.join(' → ')} 환승]` : ''
    const viaBack  = rfs.transfers ? ` [${[...rfs.via].reverse().join(' → ')} 환승]` : ''
    const modeLabel = `KTX(${rfs.grade === '특실' ? '특실' : '일반'})`
    fareTotal = rfs.roundTrip
    fareRows = `
      <tr>
        <th class="tf-th tf-th-multi" rowspan="2">교통비</th>
        <td class="tf-td">마산 → ${rfs.station}역${viaGo}&nbsp;&nbsp;@ ${half.toLocaleString()} × 1회 × 1명 = ₩ ${half.toLocaleString()} (${modeLabel} 편)</td>
      </tr>
      <tr>
        <td class="tf-td">${rfs.station}역 → 마산${viaBack}&nbsp;&nbsp;@ ${half.toLocaleString()} × 1회 × 1명 = ₩ ${half.toLocaleString()} (${modeLabel} 편)</td>
      </tr>`
  } else {
    const fare = getFare(state.region || state.place)
    if (fare) {
      const useFirst  = state.isMS && fare.ktxFirst
      const fareAmt   = useFirst ? fare.ktxFirst : (fare.ktxNormal ?? fare.bus ?? 0)
      const half      = fareAmt / 2
      const modeLabel = fare.bus ? '시외버스' : `KTX(${useFirst ? '특실' : '일반'})`
      const origin    = fare.bus ? ORIGIN_BUS : '마산'
      const dest      = fare.label
      const route     = fareRouteText(fare)
      const viaGo     = fare.transfers ? ` [${fare.path.slice(1, -1).join(' → ')} 환승]` : ''
      const viaBack   = fare.transfers ? ` [${fare.path.slice(1, -1).reverse().join(' → ')} 환승]` : ''
      fareTotal = fareAmt
      fareRows = `
        <tr>
          <th class="tf-th tf-th-multi" rowspan="2">교통비</th>
          <td class="tf-td">${origin} → ${dest}${viaGo}&nbsp;&nbsp;@ ${half.toLocaleString()} × 1회 × 1명 = ₩ ${half.toLocaleString()} (${modeLabel} 편)</td>
        </tr>
        <tr>
          <td class="tf-td">${dest} → ${origin}${viaBack}&nbsp;&nbsp;@ ${half.toLocaleString()} × 1회 × 1명 = ₩ ${half.toLocaleString()} (${modeLabel} 편)</td>
        </tr>`
    } else if (busOnlyRegion(state.region || state.place)) {
      const b = busOnlyRegion(state.region || state.place)
      fareRows = `
        <tr>
          <th class="tf-th tf-th-multi" rowspan="2">교통비</th>
          <td class="tf-td">${ORIGIN_BUS} → ${b.label}&nbsp;&nbsp;직접 확인 후 입력 (시외버스 편)</td>
        </tr>
        <tr>
          <td class="tf-td">${b.label} → ${ORIGIN_BUS}&nbsp;&nbsp;직접 확인 후 입력 (시외버스 편)</td>
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
      totalAmt += prevDayBonus * DAILY_RATE + (baseDays - mid) * DAILY_RATE + mid * DAILY_RATE_25P
    } else {
      totalAmt += totalDays * DAILY_RATE
    }
    // 숙박비 (제주 포함 동일 기준)
    if (state.lodgingProvided) totalAmt += prevDayBonus * LODGING_RATE
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
    if (prevDayBonus > 0) tokgiItems.push('출근시각 전 출발 — 전날 이동 적용 (+1일 +1박)')
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
      <span class="tf-label-actions">
        <button class="tf-edit-toggle" id="tfCopyBtn" onclick="copyTripForm()">📋 복사</button>
        <button class="tf-edit-toggle ${state.formEditMode ? 'active' : ''}" onclick="toggleFormEdit()">
          ${state.formEditMode ? '✔ 수정 완료' : '✏ 수정'}
        </button>
      </span>
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

// ── 출장신청서 내용 복사 ──────────────────────────────────────────────────────
// S-Portal 전자결재에 옮겨 적어야 해서, 화면에 그려진 표를 그대로 텍스트로 만든다.
// 금액을 다시 계산하지 않고 렌더된 DOM 을 읽는다 — 화면과 복사본이 어긋나지 않게.
function tripFormText() {
  const box = document.querySelector('#tripFormWrap .tf-box')
  if (!box) return ''
  const lines = ['[출장신청서]']
  box.querySelectorAll('tr').forEach(tr => {
    const kids = [...tr.children]
    const txt  = el => el.innerText.trim().replace(/\s+/g, ' ')
    // 항목명(th) 없이 값만 있는 줄(교통비 왕복 둘째 줄 등)은 그대로 이어 붙인다
    if (!kids.some(el => el.tagName === 'TH')) {
      const v = kids.map(txt).filter(Boolean).join(' ')
      if (v) lines.push(`  ${v}`)
      return
    }
    for (let i = 0; i < kids.length; i += 2) {
      const label = txt(kids[i])
      if (!label) continue
      lines.push(`${label}: ${kids[i + 1] ? txt(kids[i + 1]) : ''}`)
    }
  })
  const total = box.querySelector('.tf-total-row')
  if (total) lines.push(total.innerText.trim().replace(/\s+/g, ' '))
  return lines.join('\n')
}

async function copyTripForm() {
  const text = tripFormText()
  if (!text) return
  const btn = document.getElementById('tfCopyBtn')
  let ok = false
  try {
    await navigator.clipboard.writeText(text)
    ok = true
  } catch (e) {
    // http·구형 사파리 폴백
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { ok = document.execCommand('copy') } catch (_) { ok = false }
    ta.remove()
  }
  if (btn) {
    btn.textContent = ok ? '✔ 복사됨' : '복사 실패'
    setTimeout(() => { btn.textContent = '📋 복사' }, 1600)
  }
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
  // 이미 다녀온 출장은 신청서를 '미리' 쓰는 게 아니라 결재된 신청서와 대조하는 단계다
  const isDone = state.tripStatus === 'done'
  const titleEl = document.getElementById('card10-title')
  const descEl  = document.getElementById('card10-desc')
  if (titleEl) titleEl.innerHTML = isDone
    ? '결재된 출장신청서와<br>내용을 맞춰볼게요'
    : '출장신청서를<br>미리 작성해볼게요'
  if (descEl) descEl.textContent = isDone
    ? '이미 결재된 신청서와 아래 내용이 같은지 확인하세요'
    : 'S-Portal 전자결재 작성 시 참고하세요'
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
  const isDone = state.tripStatus === 'done'
  items.push({ icon: '📋', title: '출장신청서',
    desc: isDone
      ? '출발 전 결재 완료된 신청서 — 내부 승인 절차가 적법하게 이루어졌는지 확인'
      : '출발 전에 결재를 완료해야 해요 — 사후 결재는 내부 승인 절차 위반이에요' })
  // 공문 없이 직접 입력한 경우엔 없는 서류를 요구하지 않는다
  if (state.hasDoc) {
    items.push({ icon: '📄', title: '출장 관련 공문', desc: '출장 장소·일정·등록비 등이 신청서 내용과 일치하는지 한 번 더 확인' })
  }

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
  // 안내문은 위 체크리스트에 실제로 올라온 서류만 부른다
  const docNames = items.map(item => item.title)
  const lastChar = docNames.at(-1).charCodeAt(docNames.at(-1).length - 1)
  const hasJong  = lastChar >= 0xac00 && lastChar <= 0xd7a3 && (lastChar - 0xac00) % 28 !== 0
  const phrase   = docNames.length > 1
    ? `${docNames.join(' · ')}${hasJong ? '을' : '를'} 묶어 `
    : `${docNames[0]}${hasJong ? '을' : '를'} `
  document.getElementById('voucherItems').innerHTML = `
    <div class="voucher-step">
      <span class="voucher-step-num">1</span>
      <span>${escapeHtml(phrase)}<strong>전표 처리자에게 제출</strong></span>
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
    isMS: null, isShortDayTrip: null, isDayTrip: null, prevDayMove: null,
    lodgingProvided: null, mealProvided: null, hasPlane: null, hasShuttle: null,
    startTime: '', endTime: '', placeLat: null, placeLon: null,
    accessOverride: {}, pinStation: null, fareOverride: null,
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
  if (!navigatingByHistory) history.pushState({ card: 1 }, '')
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
  await Promise.all([loadRates(), loadRouteData()])
  updateProgress()

  // 첫 화면을 history 에 고정해 두고, 뒤로가기는 이전 카드로 되돌린다.
  history.replaceState({ card: state.currentCard }, '')
  window.addEventListener('popstate', e => {
    const card = e.state?.card
    if (!card || card === state.currentCard) return
    navigatingByHistory = true
    try { goToCard(card) } finally { navigatingByHistory = false }
  })

  // overflow:clip 미지원 브라우저(사파리 15 이하) 폴백 — 카드 뷰포트는 절대 스크롤되지 않는다
  const cardViewport = document.getElementById('cardViewport')
  cardViewport.addEventListener('scroll', () => {
    if (cardViewport.scrollLeft !== 0) cardViewport.scrollLeft = 0
    if (cardViewport.scrollTop !== 0) cardViewport.scrollTop = 0
  })

  // Esc 로 자동완성 드롭다운 닫기 (키보드만 쓰는 담당자용)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    document.getElementById('placeSuggest')?.classList.add('hidden')
    document.getElementById('regionSuggest')?.classList.add('hidden')
  })

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
