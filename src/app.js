// ── 카카오 장소 검색 API 키 ────────────────────────────────────────────────────
// developers.kakao.com → 내 애플리케이션 → REST API 키
const KAKAO_API_KEY = (typeof window !== 'undefined' && window.KAKAO_API_KEY) || ''

// ── 단계 정의 ────────────────────────────────────────────────────────────────
// 2026-09-30 지석초이: '갈 예정' 출장만 다룬다 — 첫 질문(다녀왔어요/갈 예정)을 없애고 공문 여부부터 시작한다.
// 다녀온 출장 흐름은 v1(git 태그 v1)에 있다. 안쪽 코드의 tripStatus==='done' 분기는 되돌리기 쉽게 남겨 둔다.
const STEPS = [
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
  currentCard: 2,
  tripStatus: 'planned', // 갈 예정 고정(2026-09-30). 'done'은 v1 흐름
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
  prevDayAuto: false,   // prevDayMove를 역산이 정했는지(사람이 답한 게 아니면 true)
  transitAccess: {},    // 서울시 대중교통 조회로 얻은 역→현장 경로 { 역이름: { min, steps, key } }
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
  { keywords: ['광양'], label: '광양', railStation: '순천' },   // 광양은 철도 운임표에 없어 가장 가까운 순천역 경로로 우회 사유를 보인다
  { keywords: ['순천'], label: '순천', railStation: '순천' },
]

function busOnlyRegion(place) {
  if (!place) return null
  return BUS_ONLY_REGIONS.find(r => r.keywords.some(k => place.includes(k))) || null
}

// ── KTX / 버스 운임표 (마산역·마산시외버스터미널 출발 왕복) ───────────────────
// 금액·경로는 tools/build_fares.py 가 ../KTX 운임표·시간표/ 의 KORAIL 운임표(기준월 최신)에서 생성한다.
// 직접 고치지 말 것 — 고치면 다음 생성 때 되돌아간다. 실제 값은 data/rates.json
// 에서 덮어쓰며, 아래 배열은 로드 실패 시 쓰는 같은 값의 사본이다.
let FARE_TABLE = [
// <fare-table:auto>
  { keywords: ['서울'], label: '서울역', station: '서울', ktxNormal: 97200, ktxFirst: 141000, oneWayNormal: 48600, oneWayFirst: 70500, transfers: 0, path: ['마산', '서울'] },
  { keywords: ['수서'], label: '수서역', station: '수서', ktxNormal: 94400, ktxFirst: 136800, oneWayNormal: 47200, oneWayFirst: 68400, transfers: 0, path: ['마산', '수서'] },
  { keywords: ['수원'], label: '수원역', station: '수원', ktxNormal: 77600, ktxFirst: 112600, oneWayNormal: 38800, oneWayFirst: 56300, transfers: 1, path: ['마산', '김천구미', '수원'] },
  { keywords: ['천안', '아산'], label: '천안아산역', station: '천안아산', ktxNormal: 72200, ktxFirst: 104600, oneWayNormal: 36100, oneWayFirst: 52300, transfers: 0, path: ['마산', '천안아산'] },
  { keywords: ['오송'], label: '오송역', station: '오송', ktxNormal: 64200, ktxFirst: 93000, oneWayNormal: 32100, oneWayFirst: 46500, transfers: 0, path: ['마산', '오송'] },
  { keywords: ['대전'], label: '대전역', station: '대전', ktxNormal: 54800, ktxFirst: 79400, oneWayNormal: 27400, oneWayFirst: 39700, transfers: 0, path: ['마산', '대전'] },
  { keywords: ['부산', '해운대'], label: '부산', bus: 8600 },
  { keywords: ['대구'], label: '동대구역', station: '동대구', ktxNormal: 21400, ktxFirst: 31000, oneWayNormal: 10700, oneWayFirst: 15500, transfers: 0, path: ['마산', '동대구'] },
  { keywords: ['울산'], label: '울산', bus: 18400 },
  { keywords: ['경주'], label: '경주역', station: '경주', ktxNormal: 36400, ktxFirst: 52800, oneWayNormal: 18200, oneWayFirst: 26400, transfers: 1, path: ['마산', '동대구', '경주'] },
  { keywords: ['전주'], label: '전주', bus: 34600 },
  { keywords: ['광양'], label: '광양', bus: 24000 },
  { keywords: ['순천'], label: '순천', bus: 23800 },
  { keywords: ['여수'], label: '여수', bus: 33600 },
  { keywords: ['제주'], label: '제주', jeju: true },
  { keywords: ['창원'], label: '창원', cityBus: 1650 },
// </fare-table:auto>
]

let DAILY_RATE     = 35000
let DAILY_RATE_25P = 8750   // 25% (숙소·식사 제공 중간날)
let LODGING_RATE   = 100000
let MEAL_CAP       = 10000  // 8시간 미만 당일 출장의 식사비 한도(실비) — rates.json 이 원장이다

// "1만원 이내" 처럼 한도 금액을 화면 문구로 만든다. 금액이 바뀌면 문구도 따라 바뀐다.
function mealCapText() {
  return MEAL_CAP % 10000 === 0 ? `${MEAL_CAP / 10000}만원 이내` : `${MEAL_CAP.toLocaleString()}원 이내`
}

async function loadRates() {
  try {
    const r = await fetch('./data/rates.json?t=' + Date.now())
    if (!r.ok) return
    const d = await r.json()
    if (Array.isArray(d.fareTable) && d.fareTable.length) FARE_TABLE = d.fareTable
    if (d.dailyRate)    DAILY_RATE     = d.dailyRate
    if (d.dailyRate25p) DAILY_RATE_25P = d.dailyRate25p
    if (d.lodgingRate)  LODGING_RATE   = d.lodgingRate
    if (d.mealCap)      MEAL_CAP       = d.mealCap
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
  }
  if (n === 6)  resetCard6()
  if (n === 8)  { prepareCard8(); prefillProfileCard8() }
  if (n === 9)  prepareCard9()
  if (n === 10) { prefillProfileCard10(); prepareCard10() }
  if (n === 11) prepareCard11()
  if (n === 2 && typeof renderVoucherResume === 'function') renderVoucherResume()

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
  if (cardNum <= 2) return   // 첫 화면(공문 여부) 앞에는 카드가 없다
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

  // 4-1. 첫날 교육 시작시각 — 전날 이동(1박+1일) 판정의 근거라 오프라인이면 필수. 제주는 항공이라 역산하지 않는다.
  if (!state.isOnline && !state.isJeju) {
    onTimeChange()
    if (!state.startTime) {
      errs.push({ id: 'field-time', label: '첫날 교육 시작시각' })
      document.getElementById('field-time')?.classList.add('field-error')
    } else {
      document.getElementById('field-time')?.classList.remove('field-error')
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
        ${errs.map(e => `<li data-err="${e.id}">${e.label}</li>`).join('')}
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
  banner?.querySelectorAll(`li[data-err="${id}"]`).forEach(li => li.remove())
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
  // 카드12(전표 작성 안내)는 본 단계 밖의 선택 단계 — 진행바는 끝까지 찬 채로 둔다
  const pct = state.currentCard === 12 ? 100 : visibleSteps.length <= 1 ? 0 : (idx / (visibleSteps.length - 1)) * 100
  document.getElementById('progressFill').style.width = `${pct}%`
  // 헤더 우측 진행률 텍스트
  const ptEl = document.getElementById('headerProgressText')
  if (ptEl) {
    ptEl.textContent = idx >= 0
      ? `${idx + 1} / ${visibleSteps.length} 단계`
      : ''
  }
  renderTrails()
}

// 공문 없는 경우 Card 3 제외한 단계 목록
function getVisibleSteps() {
  let steps = STEPS

  // 공문 없으면 Card 3 제외
  if (state.hasDoc === false) steps = steps.filter(s => s.card !== 3)

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
    // 단계 표시·뒤로가기를 한 덩어리로 묶어 카드 상단에 고정한다 — 내용만 스크롤된다
    let sticky = trailEl.parentElement
    if (!sticky.classList.contains('trail-sticky')) {
      sticky = document.createElement('div')
      sticky.className = 'trail-sticky'
      trailEl.before(sticky)
      const back = trailEl.parentElement.querySelector(':scope > .back-btn')
      if (back) sticky.appendChild(back)
      sticky.appendChild(trailEl)
      sticky.appendChild(infoEl)
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

  const ext = await sniffDocExt(file)
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
    } else if (ZIP_TEXT_EXTS.includes(ext)) {
      setParseProgress(20, ext === 'hwpx' ? '한글 문서 읽는 중' : '워드 문서 읽는 중')
      try {
        text = await extractZipDocText(file, ext)
        // 확장자 없이 온 zip 문서는 워드로 먼저 보고, 비면 한글(HWPX)로 다시 연다
        if (!text.trim()) text = await extractZipDocText(file, ext === 'docx' ? 'hwpx' : 'docx')
        console.log(`${ext} 본문 길이:`, text.replace(/\s/g, '').length)
      } catch (e) {
        console.warn(`${ext} 읽기 실패:`, e)
        text = ''
      }
      if (text.replace(/\s/g, '').length < 20) {
        document.getElementById('parseLoading').classList.add('hidden')
        showUploadError(`${ext === 'hwpx' ? '한글' : '워드'} 문서에서 글자를 찾지 못했어요. 한글·워드에서 PDF로 저장해 올려주시면 정확하게 읽어요.`)
        return
      }
    } else if (ext === 'hwp') {
      setParseProgress(20, '한글 문서 읽는 중')
      let reason = 'NO_BODYTEXT'
      try {
        text = await extractHwpText(file)
        console.log('hwp 본문 길이:', text.replace(/\s/g, '').length)
      } catch (e) {
        console.warn('hwp 읽기 실패:', e && e.message)
        reason = (e && e.message) || 'NO_BODYTEXT'
        text = ''
      }
      if (text.replace(/\s/g, '').length < 20) {
        document.getElementById('parseLoading').classList.add('hidden')
        showUploadError(HWP_ERROR_MESSAGES[reason] || HWP_ERROR_MESSAGES.NO_BODYTEXT)
        return
      }
    } else {
      document.getElementById('parseLoading').classList.add('hidden')
      showUploadError('PDF·JPG·PNG·HWP·HWPX·DOCX만 읽을 수 있어요. 공문을 PDF로 저장해 올려주세요.')
      return
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

// 확장자가 내용과 다른 파일이 온다 — 메일 첨부 이미지가 "attach(1).txt"로 저장되는 식이다.
// 파일 머리 바이트로 실제 형식을 가리고, 알 수 없으면 확장자를 그대로 쓴다.
async function sniffDocExt(file) {
  const byName = file.name.toLowerCase().split('.').pop()
  let head
  try { head = new Uint8Array(await file.slice(0, 8).arrayBuffer()) } catch (_) { return byName }
  const starts = (...b) => b.every((v, i) => head[i] === v)
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'pdf'
  if (starts(0x89, 0x50, 0x4E, 0x47)) return 'png'
  if (starts(0xFF, 0xD8, 0xFF)) return 'jpg'
  if (starts(0xD0, 0xCF, 0x11, 0xE0)) return 'hwp'
  if (starts(0x50, 0x4B, 0x03, 0x04)) return ZIP_TEXT_EXTS.includes(byName) ? byName : 'docx'
  return byName
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

// ── 한글(.hwpx)·워드(.docx) 공문 ─────────────────────────────────────────────
// 병원 공문은 한글 파일로 오는 일이 많다. .hwpx·.docx는 XML을 zip으로 묶은 것이라
// 브라우저 기본 DecompressionStream만으로 본문을 꺼낼 수 있다(CDN·라이브러리 없음).
// 옛 이진 형식 .hwp는 못 푼다 — 그건 읽을 수 없다고 분명히 알린다.
const ZIP_TEXT_EXTS = ['hwpx', 'docx']

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('NO_DECOMPRESSION')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// .hwp 본문 스트림은 압축 데이터 뒤에 패딩이 붙어 있어 DecompressionStream이
// 끝에서 "trailing junk"로 거부한다. 오류는 이미 나온 출력 뒤에 오므로,
// 조각을 모아 두고 오류가 나면 모아 둔 만큼을 쓴다(정상 종료면 동일 결과).
async function inflateRawPartial(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('NO_DECOMPRESSION')
  const reader = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
    }
  } catch (e) {
    if (!total) throw e
    console.warn('deflate 꼬리 무시:', e.message, `(${total}바이트 확보)`)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

// zip 지역 헤더를 훑어 이름이 조건에 맞는 항목만 푼다(중앙 디렉터리는 쓰지 않는다 —
// 공문 zip은 항목이 적어 순차 훑기로 충분하다).
async function readZipEntries(buffer, wanted) {
  const u8 = new Uint8Array(buffer)
  const dv = new DataView(buffer)
  const out = []
  for (let i = 0; i + 30 <= u8.length; i++) {
    if (dv.getUint32(i, true) !== 0x04034b50) continue
    const method = dv.getUint16(i + 8, true)
    const compressed = dv.getUint32(i + 18, true)
    const nameLen = dv.getUint16(i + 26, true)
    const extraLen = dv.getUint16(i + 28, true)
    const name = new TextDecoder().decode(u8.subarray(i + 30, i + 30 + nameLen))
    const dataAt = i + 30 + nameLen + extraLen
    if (!compressed || dataAt + compressed > u8.length) continue
    if (wanted(name)) {
      const raw = u8.subarray(dataAt, dataAt + compressed)
      try {
        const bytes = method === 0 ? raw : await inflateRaw(raw)
        out.push({ name, text: new TextDecoder('utf-8').decode(bytes) })
      } catch (e) {
        console.warn(`zip 항목 ${name} 해제 실패:`, e.message)
      }
    }
    i = dataAt + compressed - 1
  }
  return out
}

// 문단 끝은 줄바꿈으로, 나머지 태그는 지운다. 제목·라벨 판독이 줄 단위로 동작한다.
function xmlToText(xml) {
  return String(xml || '')
    .replace(/<\/(?:w:p|hp:p|p)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractZipDocText(file, ext) {
  const buffer = await file.arrayBuffer()
  const wanted = ext === 'docx'
    ? name => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name)
    : name => /^Contents\/section\d+\.xml$/i.test(name)   // header.xml은 글꼴·스타일이라 본문이 아니다
  const entries = await readZipEntries(buffer, wanted)
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return entries.map(e => xmlToText(e.text)).filter(Boolean).join('\n')
}

// ── 옛 한글(.hwp, HWP 5.0 이진) 공문 ────────────────────────────────────────
// 병원 공문 상당수가 아직 .hwp로 온다. .hwp는 zip이 아니라 MS 복합문서(CFB/OLE2)
// 컨테이너이고, 본문 BodyText/Section* 스트림이 raw deflate로 눌려 있다.
// 브라우저 기본 DecompressionStream('deflate-raw')로 풀 수 있으므로
// CFB 디렉터리만 직접 읽으면 CDN·라이브러리 없이 본문을 꺼낼 수 있다.
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const HWP5_TAG_PARA_TEXT = 67   // HWPTAG_BEGIN(16) + 51

// CFB 컨테이너를 열어 경로→스트림(Uint8Array) 맵으로 만든다.
function readCfb(buffer) {
  const dv = new DataView(buffer)
  const u8 = new Uint8Array(buffer)
  for (let i = 0; i < 8; i++) {
    if (u8[i] !== CFB_SIGNATURE[i]) throw new Error('NOT_CFB')
  }
  const sectorSize = 1 << dv.getUint16(30, true)
  const miniSectorSize = 1 << dv.getUint16(32, true)
  const fatCount = dv.getUint32(44, true)
  const dirStart = dv.getUint32(48, true)
  const miniCutoff = dv.getUint32(56, true)
  const miniFatStart = dv.getUint32(60, true)
  const difatStart = dv.getUint32(68, true)
  const difatCount = dv.getUint32(72, true)
  const sectorAt = s => (s + 1) * sectorSize
  const FREE = 0xffffffff, ENDOFCHAIN = 0xfffffffe

  // DIFAT: 헤더에 109개, 넘치면 DIFAT 섹터를 따라간다.
  const fatSectors = []
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) {
    const s = dv.getUint32(76 + i * 4, true)
    if (s === FREE || s === ENDOFCHAIN) break
    fatSectors.push(s)
  }
  let next = difatStart
  const perDifat = sectorSize / 4 - 1
  for (let n = 0; n < difatCount && next !== ENDOFCHAIN && next !== FREE; n++) {
    const base = sectorAt(next)
    if (base + sectorSize > u8.length) break
    for (let i = 0; i < perDifat && fatSectors.length < fatCount; i++) {
      const s = dv.getUint32(base + i * 4, true)
      if (s === FREE || s === ENDOFCHAIN) break
      fatSectors.push(s)
    }
    next = dv.getUint32(base + perDifat * 4, true)
  }

  // FAT(섹터 연결 테이블)을 통째로 펼친다.
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4))
  fatSectors.forEach((s, idx) => {
    const base = sectorAt(s)
    for (let i = 0; i < sectorSize / 4; i++) {
      fat[idx * (sectorSize / 4) + i] =
        base + i * 4 + 4 <= u8.length ? dv.getUint32(base + i * 4, true) : ENDOFCHAIN
    }
  })

  function chain(start) {
    const out = []
    let s = start, guard = 0
    while (s !== ENDOFCHAIN && s !== FREE && s < fat.length && guard++ < 1e6) {
      out.push(s)
      s = fat[s]
    }
    return out
  }
  function readChain(start, size, secSize, getOffset) {
    const out = new Uint8Array(size)
    let filled = 0
    for (const s of start) {
      const from = getOffset(s)
      const len = Math.min(secSize, size - filled)
      if (len <= 0) break
      if (from + len > u8.length) break
      out.set(u8.subarray(from, from + len), filled)
      filled += len
    }
    return filled === size ? out : out.subarray(0, filled)
  }
  const readMain = (start, size) => readChain(chain(start), size, sectorSize, sectorAt)

  // 디렉터리 엔트리(128바이트)를 모두 읽는다.
  const dirBytes = readMain(dirStart, chain(dirStart).length * sectorSize)
  const dirDv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength)
  const entries = []
  for (let off = 0; off + 128 <= dirBytes.byteLength; off += 128) {
    const nameLen = dirDv.getUint16(off + 64, true)
    const type = dirBytes[off + 66]
    if (type === 0) { entries.push(null); continue }
    let name = ''
    for (let i = 0; i + 1 < Math.max(0, nameLen - 2); i += 2) {
      name += String.fromCharCode(dirDv.getUint16(off + i, true))
    }
    entries.push({
      name, type,
      child: dirDv.getUint32(off + 76, true),
      left: dirDv.getUint32(off + 68, true),
      right: dirDv.getUint32(off + 72, true),
      start: dirDv.getUint32(off + 116, true),
      size: dirDv.getUint32(off + 120, true),
    })
  }
  const root = entries[0]
  if (!root) throw new Error('NO_ROOT')

  // 미니 스트림(4096바이트 미만 스트림 저장소)
  let miniStream = null, miniFat = null
  function ensureMini() {
    if (miniStream) return
    miniStream = readMain(root.start, root.size)
    const bytes = readMain(miniFatStart, chain(miniFatStart).length * sectorSize)
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    miniFat = new Uint32Array(Math.floor(bytes.byteLength / 4))
    for (let i = 0; i < miniFat.length; i++) miniFat[i] = d.getUint32(i * 4, true)
  }
  function readEntry(e) {
    if (e.size === 0) return new Uint8Array(0)
    if (e.size >= miniCutoff) return readMain(e.start, e.size)
    ensureMini()
    const out = new Uint8Array(e.size)
    let s = e.start, filled = 0, guard = 0
    while (s !== ENDOFCHAIN && s !== FREE && filled < e.size && guard++ < 1e6) {
      const from = s * miniSectorSize
      const len = Math.min(miniSectorSize, e.size - filled)
      if (from + len > miniStream.byteLength) break
      out.set(miniStream.subarray(from, from + len), filled)
      filled += len
      s = s < miniFat.length ? miniFat[s] : ENDOFCHAIN
    }
    return filled === e.size ? out : out.subarray(0, filled)
  }

  // 디렉터리는 레드블랙 트리다 — 루트의 자식부터 훑어 경로 맵을 만든다.
  const files = new Map()
  const seen = new Set()
  ;(function walk(idx, prefix) {
    if (idx === FREE || idx == null || seen.has(idx)) return
    const e = entries[idx]
    if (!e) return
    seen.add(idx)
    walk(e.left, prefix)
    walk(e.right, prefix)
    const path = prefix ? `${prefix}/${e.name}` : e.name
    if (e.type === 2) files.set(path, e)
    else if (e.type === 1) walk(e.child, path)
  })(root.child, '')

  return { files, read: readEntry }
}

// FileHeader: 32바이트 서명 + 버전 4 + 속성 4(bit0 압축, bit1 암호, bit2 배포용)
function hwpFileHeaderFlags(bytes) {
  if (!bytes || bytes.byteLength < 40) return { compressed: true, encrypted: false, distributed: false }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = dv.getUint32(36, true)
  return { compressed: !!(flags & 1), encrypted: !!(flags & 2), distributed: !!(flags & 4) }
}

// 문단 텍스트 레코드를 글자로 옮긴다. 제어문자 중 1~23(10·13 제외)은
// 8글자(16바이트)를 차지하는 확장·인라인 제어라 통째로 건너뛴다.
const HWP_SKIP16 = new Set([1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])
function hwpDecodeParaText(dv, from, size) {
  let out = ''
  for (let p = from; p + 1 < from + size; p += 2) {
    const code = dv.getUint16(p, true)
    if (code === 9) { out += '\t'; p += 14; continue }        // 탭도 인라인 제어다
    if (HWP_SKIP16.has(code)) { p += 14; continue }
    if (code === 10 || code === 13) { out += '\n'; continue }
    if (code === 24) { out += '-'; continue }
    if (code === 28 || code === 29) { out += ' '; continue }
    if (code < 32) continue
    out += String.fromCharCode(code)
  }
  return out
}

// 레코드 헤더 4바이트: tag(10) + level(10) + size(12), size가 0xFFF면 다음 4바이트가 실제 크기.
function hwpSectionText(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const paras = []
  let p = 0
  while (p + 4 <= bytes.byteLength) {
    const header = dv.getUint32(p, true)
    p += 4
    const tag = header & 0x3ff
    let size = (header >>> 20) & 0xfff
    if (size === 0xfff) {
      if (p + 4 > bytes.byteLength) break
      size = dv.getUint32(p, true)
      p += 4
    }
    if (size < 0 || p + size > bytes.byteLength) break
    if (tag === HWP5_TAG_PARA_TEXT) paras.push(hwpDecodeParaText(dv, p, size))
    p += size
  }
  return paras
}

function hwpCleanText(raw) {
  return String(raw || '')
    .replace(/\u0000/g, '')
    .replace(/[\r\v\f]/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// .hwp 본문 추출. 실패 사유는 코드로 던져 화면 안내 문구를 가른다.
async function extractHwpText(file) {
  const buffer = await file.arrayBuffer()
  const head = new Uint8Array(buffer, 0, Math.min(32, buffer.byteLength))
  if (String.fromCharCode(...head).startsWith('HWP Document File V3')) throw new Error('HWP3')
  const cfb = readCfb(buffer)                       // NOT_CFB면 호출부에서 안내
  const headerEntry = [...cfb.files.keys()].find(k => /(^|\/)FileHeader$/i.test(k))
  const flags = hwpFileHeaderFlags(headerEntry ? cfb.read(cfb.files.get(headerEntry)) : null)
  if (flags.encrypted) throw new Error('HWP_ENCRYPTED')

  const sections = [...cfb.files.keys()]
    .filter(k => /^BodyText\/Section\d+$/i.test(k))
    .sort((a, b) => Number(a.match(/(\d+)$/)[1]) - Number(b.match(/(\d+)$/)[1]))
  if (!sections.length) {
    if ([...cfb.files.keys()].some(k => /^ViewText\//i.test(k))) throw new Error('HWP_DISTRIBUTED')
    throw new Error('NO_BODYTEXT')
  }

  const parts = []
  for (const key of sections) {
    let bytes = cfb.read(cfb.files.get(key))
    if (flags.compressed) {
      try {
        bytes = await inflateRawPartial(bytes)
      } catch (e) {
        console.warn(`${key} 압축 해제 실패:`, e.message)
        continue
      }
    }
    parts.push(hwpSectionText(bytes).join('\n'))
  }
  const text = hwpCleanText(parts.join('\n'))
  if (text.replace(/\s/g, '').length >= 20) return text

  // 본문을 못 읽었으면 미리보기 텍스트(PrvText, UTF-16LE 평문)라도 쓴다.
  const prv = [...cfb.files.keys()].find(k => /(^|\/)PrvText$/i.test(k))
  if (prv) {
    const bytes = cfb.read(cfb.files.get(prv))
    const preview = hwpCleanText(new TextDecoder('utf-16le').decode(bytes))
    if (preview.replace(/\s/g, '').length >= 20) return preview
  }
  return text
}

const HWP_ERROR_MESSAGES = {
  HWP3: '아주 옛 한글 파일(한글 97 이하, .hwp V3)이에요. 한글에서 [다른 이름으로 저장 → PDF]로 올려주세요.',
  NOT_CFB: '한글 파일 형식을 알아볼 수 없어요. 한글에서 [다른 이름으로 저장 → PDF 또는 HWPX]로 올려주세요.',
  HWP_ENCRYPTED: '암호가 걸린 한글 파일이에요. 한글에서 암호를 풀고 저장하거나 PDF로 올려주세요.',
  HWP_DISTRIBUTED: '배포용(읽기 전용 암호화) 한글 파일이에요. 한글에서 PDF로 저장해 올려주세요.',
  NO_BODYTEXT: '한글 파일에서 본문을 찾지 못했어요. 한글에서 PDF로 저장해 올려주세요.',
  NO_DECOMPRESSION: '이 브라우저는 한글 파일 압축을 못 풀어요. 사파리·크롬 최신 버전이나 PDF로 올려주세요.',
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

// 스캔 공문은 글자가 흐려 그대로 OCR에 넣으면 "14시"가 "14A1"로, "월"이 "윌"로 읽힌다.
// 오츠(Otsu) 임계값으로 흑백 2치화하면 같은 공문에서 "14시~11.06.(금)"까지 정확히 읽는다
// (2026-09-29 재협 추계세미나 공문 실측: 배율 2.0 원본 → 14A1 / 배율 3.0 2치화 → 14시).
// 임계값은 페이지마다 다시 구한다 — 스캔 밝기가 공문마다 다르다.
function otsuThreshold(gray) {
  const hist = new Array(256).fill(0)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0, wB = 0, best = -1, thr = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; thr = t }
  }
  return thr
}

// 캔버스를 회색조 → 흑백으로 바꾼다. 글자(검은 픽셀)가 45%를 넘으면 사진·어두운
// 스캔이라 2치화가 오히려 글자를 뭉개므로 회색조까지만 남긴다.
function binarizeCanvas(ctx, width, height) {
  const img = ctx.getImageData(0, 0, width, height)
  const d = img.data
  const gray = new Uint8Array(d.length / 4)
  for (let k = 0, g = 0; k < d.length; k += 4, g++) {
    gray[g] = (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]) | 0
  }
  const thr = otsuThreshold(gray)
  let ink = 0
  for (let g = 0; g < gray.length; g++) if (gray[g] <= thr) ink++
  const tooDark = ink / gray.length > 0.45
  for (let k = 0, g = 0; k < d.length; k += 4, g++) {
    const v = tooDark ? gray[g] : (gray[g] > thr ? 255 : 0)
    d[k] = d[k + 1] = d[k + 2] = v
    d[k + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return { threshold: thr, binarized: !tooDark }
}

// 작은 글자를 OCR이 놓치지 않게 가로 2200px 정도로 맞춘다(최소 2배, 최대 3.5배).
function ocrRenderScale(baseWidth) {
  if (!baseWidth) return 2
  return Math.max(2, Math.min(3.5, 2200 / baseWidth))
}

const OCR_MIN_CHARS = 30   // 이보다 적게 읽히면 판독 실패로 본다

// 공문 서식 라벨이 몇 개 살아남았는지 + 자동으로 채워진 칸이 몇 개인지로 판독 품질을 재고,
// 원본·2치화 두 판독 중 점수가 높은 쪽을 쓴다. 칸 단위로 섞으면 한쪽의 오독(목록 기준일을
// 교육일로 읽는 등)이 그대로 들어와, 공문 하나는 판독 하나로 통째로 고른다.
const OCR_FORM_LABELS = [
  /제\s*_?\s*목|건\s*명|행\s*사\s*명|과\s*정\s*명/,
  /일\s*_?\s*시|일\s*_?\s*자|기\s*간|일\s*정/,
  /장\s*_?\s*소/,
  /참가회비|등\s*록\s*비|교\s*육\s*비|수\s*강\s*료|회\s*비/,
]
function scoreOcrCandidate(filename, text, confidence = 0) {
  const chars = String(text || '').replace(/\s/g, '').length
  if (chars < OCR_MIN_CHARS) return { ok: false, labels: -1, fields: -1, confidence: 0 }
  const labels = OCR_FORM_LABELS.filter(re => re.test(text)).length
  let fields = 0
  try {
    const meta = parseDocMeta(filename, text)
    fields = ['title', 'startDate', 'endDate', 'startTime', 'venue', 'destination']
      .filter(k => meta && meta[k]).length + (meta && meta.registration ? 1 : 0)
  } catch (_) { /* 판독이 깨졌으면 칸 점수 없이 라벨로만 비교한다 */ }
  return { ok: true, labels, fields, confidence: confidence || 0, chars }
}

// 엔진 신뢰도 차가 이 값을 넘으면 신뢰도만으로 정한다. 그 안쪽(비슷하게 읽었을 때)은
// 공문 서식 라벨 → 채워진 칸 수로 가린다. 신뢰도가 크게 낮은 판독은 글자를 뭉갠 것이고,
// 비슷할 때는 라벨·칸을 더 많이 살린 쪽이 실제로 더 정확했다(테스트공문 4건 실측).
const OCR_CONF_MARGIN = 3

function pickOcrCandidate(filename, candidates) {
  const scored = candidates.map(c => ({ ...c, s: scoreOcrCandidate(filename, c.text, c.confidence) }))
  for (const c of scored) {
    console.log(`OCR 후보 ${c.mode}: ${c.s.chars || 0}자 · 신뢰도 ${c.confidence ?? '-'}` +
      ` · 라벨 ${c.s.labels} · 칸 ${c.s.fields}`)
  }
  const usable = scored.filter(c => c.s.ok)
  if (!usable.length) return scored[0] || { mode: 'none', text: '' }
  return usable.reduce((best, c) => {
    const d = c.s.confidence - best.s.confidence
    if (Math.abs(d) > OCR_CONF_MARGIN) return d > 0 ? c : best
    if (c.s.labels !== best.s.labels) return c.s.labels > best.s.labels ? c : best
    if (c.s.fields !== best.s.fields) return c.s.fields > best.s.fields ? c : best
    return best
  })
}

// 이미지 기반 PDF → 각 페이지 렌더 후 OCR. 1페이지에서 전처리 방식을 정하고
// 남은 페이지는 그 방식으로만 읽는다(페이지마다 두 번 읽으면 대기 시간이 두 배가 된다).
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
  let mode = null
  for (let i = 1; i <= maxPages; i++) {
    setParseProgress(10 + Math.round(((i - 1) / maxPages) * 75), `OCR ${i}/${maxPages} 페이지`)
    try {
      const page = await pdf.getPage(i)
      const scale = ocrRenderScale(page.getViewport({ scale: 1 }).width)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      const pageBase = 10 + Math.round(((i - 1) / maxPages) * 75)
      const pageEnd  = 10 + Math.round((i / maxPages) * 75)
      const toBlob = () => new Promise(res => canvas.toBlob(res, 'image/png'))
      if (mode === null) {
        const plain = await ocrBlob(await toBlob(), pageBase, Math.round((pageBase + pageEnd) / 2))
        binarizeCanvas(ctx, canvas.width, canvas.height)
        const binary = await ocrBlob(await toBlob(), Math.round((pageBase + pageEnd) / 2), pageEnd)
        const pick = pickOcrCandidate(file.name,
          [{ mode: 'plain', ...plain }, { mode: 'binary', ...binary }])
        mode = pick.mode === 'binary' ? 'binary' : 'plain'
        parts.push(pick.text)
      } else {
        if (mode === 'binary') binarizeCanvas(ctx, canvas.width, canvas.height)
        const r = await ocrBlob(await toBlob(), pageBase, pageEnd)
        parts.push(r.text)
      }
    } catch (pageErr) {
      console.warn(`페이지 ${i} OCR 실패:`, pageErr)
    }
  }
  return parts.join('\n')
}

// 이미지 파일 OCR — 원본 그대로 읽은 것과 확대·흑백 2치화해 읽은 것 중 잘 읽힌 쪽을 쓴다.
// 확대가 늘 이롭지는 않다(이미 큰 스크린샷은 확대하면 글자가 번져 제목 라벨을 놓쳤다).
async function ocrImage(file) {
  const plain = await ocrBlob(file, 5, 50)
  let canvas = null
  let ctx = null
  try {
    const bitmap = await loadImageBitmap(file)
    const scale = Math.max(1, Math.min(3, 1800 / (bitmap.width || 1800)))
    canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    binarizeCanvas(ctx, canvas.width, canvas.height)
  } catch (e) {
    console.warn('이미지 전처리 실패 → 원본 판독만 쓴다:', e)
    return plain.text
  }
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'))
  const binary = await ocrBlob(blob, 50, 90)
  return pickOcrCandidate(file.name, [{ mode: 'plain', ...plain }, { mode: 'binary', ...binary }]).text
}

// createImageBitmap 이 없는 브라우저(구형 사파리)까지 대응한다.
async function loadImageBitmap(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('이미지 로드 실패'))
      img.src = url
    })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
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

// Tesseract OCR (진행률 반영, 90초 타임아웃) — { text, confidence }를 돌려준다
async function ocrBlob(blob, pctStart = 5, pctEnd = 90) {
  setParseProgress(pctStart, 'OCR 엔진 로딩 중')
  const ok = await ensureTesseract()
  if (!ok) {
    console.warn('Tesseract 로드 실패 — OCR 건너뜀')
    return { text: '', confidence: 0 }
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
    const { data } = await Promise.race([ocrPromise, timeout])
    return { text: data.text || '', confidence: data.confidence || 0 }
  } catch (e) {
    if (e.message === 'OCR_TIMEOUT') {
      console.warn('OCR 시간 초과 (90초)')
    } else {
      console.warn('OCR 오류:', e)
    }
    return { text: '', confidence: 0 }
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
  return fixLetterSpacing(String(raw || '').replace(TITLE_BODY_CUT, ''))
    .replace(/^제\s*_?\s*목\s*[：:]?\s*/, '')
    .replace(/[─━═│┃_]{2,}.*$/, '')
    .replace(/(\S+)(?:\s+\1)+(?=\s|$)/g, '$1')
    .replace(/(\d)\s+(년|회|차|월|일|호)(?=\s|$)/g, '$1$2')
    .replace(/제\s+(\d)/g, '제$1')
    .replace(/\s+(?:(?:학교법인|재단법인|사단법인|의료법인)\s+)?[가-힣A-Za-z]+\s+(?:이사장|병원장|원장|회장|총장)(?:\s.*)?$/, '')
    .replace(/^(.*\S)\s+((?:19|20)\d{2})$/, '$2 $1')
    .replace(/([(「『\[])\s+/g, '$1').replace(/\s+([)」』\]])/g, '$1')
    .trim()
}

// 스캔 공문 OCR은 모양이 닮은 글자를 바꿔 읽는다. 날짜·시각·금액 자리에서 실제로 나온
// 오독만 좁게 되돌린다(테스트공문 4건 실측: 14시→14A1 / 14AI1, 04월→04윌, 기 간→기 2, ':'→';:').
// 글자 모양 추측을 넓히면 본문 낱말을 망치므로 숫자 옆에서만 바꾼다.
function normalizeOcrArtifacts(text) {
  return String(text || '')
    .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
    .replace(/[：]/g, ':')
    .replace(/[～〜]/g, '~')
    .replace(/(\d{1,2})\s*(?:A[1IlL]{1,2}|AI|Al|Ai|人)(?![A-Za-z0-9])/g, '$1시')
    .replace(/(\d)\s*[윌웜웰](?=\s*\d|\s*말|\s*중|\s*까지|\s*초|\s*[(])/g, '$1월')
    .replace(/(?<![가-힣])(기)\s*2\s*(?=[:;])/g, '$1간 ')
    .replace(/\s*;\s*:/g, ' :')
    // 공문 머리의 "제 목"에서 '목'이 '='·'＝'로 읽히는 일이 잦다(크롬 OCR: "제 = 2026 …정기세미나")
    .replace(/(?<![가-힣])제\s*[=＝]+\s*[：:』」]*\s*(?=[가-힣\d])/g, '제 목 ')
    // 크롬 OCR은 같은 자리를 "제   2 2026 …"로 읽는다. '제2조'·'제 2 회'를 망치지 않게
    // 뒤에 연도(네 자리)가 바로 오는 경우만 제목 라벨로 돌린다.
    .replace(/(?<![가-힣])제\s+2\s+(?=(?:19|20)\d{2}\s)/g, '제 목 ')
    // 글자마다 따로 놓인 PDF(메드트로닉 공문)는 숫자가 "20 2 6 년 0 9 월"·"1 6 : 5 0"으로 쪼개져 나온다.
    // 연도·월일·시각 자리에서만 붙인다.
    .replace(/(?<!\d)2\s*0\s*(\d)\s*(\d)(?=\s*(?:년|\.\s*\d))/g, '20$1$2')
    .replace(/(?<![\d.])(\d) (\d)(?= ?[월일])/g, '$1$2')
    .replace(/(?<!\d)(\d)\s(\d)(?=\s*:\s*\d)/g, '$1$2')
    .replace(/(\d)\s*:\s*(\d)\s?(\d)(?!\d)/g, '$1:$2$3')
    // 장소 이름에서 실제로 나온 스캔 오독(2026-09-29 장소 전수 점검): 서울→서물, 신촌→신존, 아카데미→이카데미
    .replace(/서물(?=[가-힣\s])/g, '서울').replace(/신존(?=세브란스)/g, '신촌').replace(/이카데미/g, '아카데미').replace(/(?<=서울)아신(?=병원)/g, '아산')
    // 숫자 사이의 알파벳 O는 0이다("99,0O0원", "13:3O") — 스캔 판독에서 흔한 오독(2026-09-29 변형 평가)
    .replace(/(?<=[\d,:.])[Oo](?![A-Za-z가-힣])|(?<=\d)[Oo](?=\d)/g, '0')
    // 시각의 쌍점이 쌍반점으로 읽힌다("13;00~15:00") — 시작시각을 놓치고 끝 시각을 시작으로 집었다
    .replace(/(?<!\d)(\d{1,2})\s*;\s*(\d{2})(?!\d)/g, '$1:$2')
    // 스캔에서 금액 끝 '원'이 '8'로 읽힌다("회원병원 : 77,0008" — 병원협회 연수교육). 쉼표 뒤 네 자리는 금액이 될 수 없다
    .replace(/(\d{1,3}(?:,\d{3})+)[8B](?![\d,])/g, '$1원')
    // 두 자리 연도 "'26.10. 1." — 스캔에서는 따옴표가 `"·"로도 읽힌다
    .replace(/[’'‘"`＇“”´]+\s*(\d{2})\s*\.\s*(?=\d{1,2}\s*\.)/g, '20$1.')
    // 사진 판독에서 '월'이 '%'로, '년'이 '4'로 읽힌다("2026 10% 14일", "20264 09% 20일")
    .replace(/(?<!\d)(20\d{2})4?\s*년?\s+(\d{1,2})\s*%\s*(\d{1,2})\s*일/g, '$1년 $2월 $3일')
    // '월'이 '9'로 붙어 읽히기도 한다("2026년 109 13일(화)" = 10월 13일). 년·일 사이 세 자리일 때만
    .replace(/(?<!\d)(20\d{2})\s*년\s*(1[0-2]|[1-9])9\s+(\d{1,2})\s*일/g, '$1년 $2월 $3일')
}

// 공문에는 교육일 말고도 날짜가 많다. 시행일자·목록 기준일·신청/접수/납부 기간이 교육일로
// 잡히던 것을 막으려고 날짜 추출 전에 그 자리를 지운다(2026-09-26 테스트공문 13건 전수점검).
const DATE_TOKEN = String.raw`\d{4}\s*[.\-년]\s*\d{1,2}\s*[.\-월]\s*\d{1,2}\s*[.일]?`
const DATE_PART  = String.raw`(?:\d{4}\s*[.\-년]\s*)?(?:\d{1,2}\s*[.\-월]\s*)?\d{1,2}\s*[.일]?(?:\s*\(\s*[가-힣]\s*\))?(?:\s*\d{1,2}:\d{2})?`
function maskNonEventDates(tc) {
  return tc
    .replace(new RegExp(String.raw`(?<![가-힣])시\s*행(?!\s*(?:하|할|합|되|된|중|령|규|에|을|의|계|안내|계획|방법))[\s\S]{0,40}?${DATE_TOKEN}\)?`, 'g'), ' ')
    .replace(new RegExp(String.raw`${DATE_TOKEN}\s*기\s*준`, 'g'), ' ')
    // 관련 문서 번호에 딸린 날짜 "병약 제2026-131호(2026.03.11.)", 문서 머리의 "날 짜: 2026년 09월 01일"
    .replace(new RegExp(String.raw`호\s*\(\s*${DATE_TOKEN}\s*\)`, 'g'), '호 ')
    .replace(new RegExp(String.raw`(?<![가-힣])날\s*짜\s*[:：]?\s*${DATE_TOKEN}`, 'g'), ' ')
    .replace(new RegExp(String.raw`(?:신\s*청|접\s*수|사\s*전\s*등\s*록|등\s*록\s*기\s*간|납\s*부|입\s*금|초\s*록|취\s*소|환\s*불)[^0-9~]{0,20}${DATE_PART}(?:[^~0-9]{0,6}~\s*${DATE_PART})?`, 'g'), ' ')
}

// 연도 없는 날짜는 요일이 맞는 해를 고른다(올해에 가까운 순). 요일이 없으면 올해.
// "08.08(목)"은 2026년이면 토요일이라 올해로 채우면 요일이 틀린 날짜가 됐다.
const DOW_KO = '일월화수목금토'
function yearForDate(month, day, dowChar, curY) {
  const want = dowChar ? DOW_KO.indexOf(dowChar) : -1
  if (want < 0) return curY
  for (const y of [curY, curY - 1, curY + 1, curY - 2]) {
    if (new Date(y, month - 1, day).getDay() === want) return y
  }
  return curY
}

// 라벨(일시·일자·기간) 바로 뒤 토막에서 날짜 하나를 읽는다. 토막 안에서 가장 앞에 나온 날짜를 쓴다 —
// 뒤쪽의 접수기간 범위가 앞의 단일 교육일을 이기면 안 된다. 같은 자리면 범위가 우선.
const SNIPPET_DATE_FORMS = [
  [/(\d{4})-(\d{1,2})-(\d{1,2})\s*~\s*(?:(\d{4})-)?(\d{1,2})-(\d{1,2})/,
    m => ({ s: [+m[1], +m[2], +m[3]], e: [m[4] ? +m[4] : +m[1], +m[5], +m[6]] })],
  [/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\(\s*[가-힣\u4E00-\u9FFF]\s*\))?\s*~\s*(?:(\d{4})\s*년\s*)?(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일/,
    m => ({ s: [+m[1], +m[2], +m[3]], e: [m[4] ? +m[4] : +m[1], m[5] ? +m[5] : +m[2], +m[6]] })],
  [/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\.?(?:\s*\(\s*[가-힣\u4E00-\u9FFF]\s*\))?\s*~\s*(?:(\d{4})\s*\.\s*)?(?:(\d{1,2})\s*\.\s*)?(\d{1,2})/,
    m => ({ s: [+m[1], +m[2], +m[3]], e: [m[4] ? +m[4] : +m[1], m[5] ? +m[5] : +m[2], +m[6]] })],
  [/(?<!\d)(\d{1,2})\s*\.\s*(\d{1,2})(?:\s*\(\s*([가-힣\u4E00-\u9FFF])\s*\))?\s*~\s*(\d{1,2})\s*\.\s*(\d{1,2})/,
    (m, curY) => {
      const y = yearForDate(+m[1], +m[2], m[3], curY)
      return { s: [y, +m[1], +m[2]], e: [+m[4] < +m[1] ? y + 1 : y, +m[4], +m[5]], guessed: true }
    }],
  [/(\d{4})-(\d{2})-(\d{2})/, m => ({ s: [+m[1], +m[2], +m[3]], e: [+m[1], +m[2], +m[3]] })],
  [/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/, m => ({ s: [+m[1], +m[2], +m[3]], e: [+m[1], +m[2], +m[3]] })],
  [/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/, m => ({ s: [+m[1], +m[2], +m[3]], e: [+m[1], +m[2], +m[3]] })],
]
function parseDateSnippet(snip, curY) {
  let best = null
  for (const [re, build] of SNIPPET_DATE_FORMS) {
    const m = snip.match(re)
    if (!m || (best && m.index >= best.index)) continue
    const r = build(m, curY)
    if (r.s[0] < 2020) continue
    best = { index: m.index, r }
  }
  return best ? best.r : null
}

const EVENT_DATE_LABEL = /(?<![가-힣])(?:교\s*육\s*|개\s*최\s*|행\s*사\s*|연\s*수\s*|과\s*정\s*)?(?:일\s*_?\s*시|일\s*_?\s*자|기\s*간|일\s*정)(?![가-힣])/g

// 장소 글자 → 운임표 지역. 규칙 판독과 AI 판독이 같은 표로 지역을 정한다.
const REGION_MAP = [
  ['제주특별자치도|제주도|제주시|서귀포|제주', '제주'],
  // 수원 — 성균관대 자연과학캠퍼스가 여기다. 운임표에 수원역이 있어 왕복 77,600원이고
  // 서울역(97,200원)으로 잡으면 19,600원이 부풀려진다. 발신처 주소가 '서울 종로구'인
  // 공문(성균관대 법인사무국)이 많으므로 서울 규칙보다 반드시 먼저 봐야 한다.
  // '서천연수원'(삼성전자 연수원, 용인)의 '수원'을 잡지 않도록 앞에 한글이 붙은 '수원'은 뺀다
  // 용인·기흥(삼성전자 The UniverSE 등)도 수원역 기준이다 — 서울역(97,200원)보다 가깝고 싸다(2026-09-29 지석초이 지시)
  ['자연과학캠퍼스|성대\\s*수원|성균관대.*수원|(?<![가-힣])수원|용인|기흥', '수원'],
  // 서울 자치구
  ['강남구|강서구|마포구|종로구|용산구|성동구|송파구|강동구|노원구|도봉구|은평구|서대문구|동대문구|성북구|강북구|관악구|동작구|금천구|영등포구|구로구|양천구|서초구|광진구|중랑구', '서울'],
  // 서울 주요 병원 (병원명으로 장소 특정되는 경우)
  ['삼성서울병원|세브란스병원|신촌세브란스|강남세브란스|서울대학교병원|서울아산병원|서울성모병원|가톨릭대.*서울|한양대.*서울|이화.*서울|고대.*서울|고려대.*서울|건국대.*병원|경희대.*서울|중앙대.*서울|인하대.*서울', '서울'],
  // 서울 랜드마크
  ['서울특별시|여의도|여의나루|서울역|수서역|코엑스|COEX|삼성동|잠실|홍대|명동|광화문|서울시청|시청역|강남역', '서울'],
  // 나머지 경기·인천 (서울 출장 처리) — 수원은 위에서 따로 잡는다. 성균관대학교는
  // 인문사회과학캠퍼스(종로)가 기본이고 삼성창원병원·창원은 뺀다
  ['경기도|인천광역시|성남시?|고양시?|안양시?|부천시?|평택시?|화성시?|파주시?|김포시?|의정부|성균관대학교(?!\\s*(?:삼성창원|창원))', '서울'],
  // '서울아산병원'(OCR로 '서물아산병원')의 '아산'을 충남 아산으로 잡지 않는다
  ['천안시?|(?<![가-힣])아산시?|천안아산역', '천안'],
  ['오송|청주시?', '오송'],
  ['대전광역시|대전시?|을지대.*대전|유성구|서구.*대전|대전.*서구', '대전'],
  // 부산 (해운대구에 "대구"가 들어 있어 반드시 동대구보다 앞에 둔다 — 순서를 바꾸면
  // '부산 해운대구'가 동대구로 잡힌다. 재협 추계세미나 공문(팔레드시즈)에서 실제로 났다)
  ['부산광역시|부산시?|부산교육원|해운대|동래|사하|금정|수영구|기장군?|센텀', '부산'],
  ['동대구|대구광역시|대구시?', '동대구'],
  ['경주시?|신경주', '경주'],
  ['울산광역시|울산시?', '울산'],
  ['전주시?|전라북도|전북', '전주'],
  // 시외버스 고정 구간 — 지역명을 합치지 않고 따로 잡는다(안내에 그 지명이 그대로 나온다)
  ['광양시?', '광양'],
  ['순천시?', '순천'],
  ['여수시?', '여수'],
  ['목포시?', '목포'],
  ['창원시?|마산|진해|창원특례시|삼성창원병원|성균관대.*창원|경상국립대.*창원', '창원'],
  ['진주시?', '진주'],
]

function matchRegion(text) {
  if (!text) return ''
  for (const [keywords, region] of REGION_MAP) {
    if (new RegExp(keywords, 'i').test(text)) return region
  }
  return ''
}

// 장소 라벨에서 읽은 글자에는 발신처 주소가 섞이지 않는다 — 그래서 '로카우스 호텔
// 서울 용산'처럼 시·도 이름만 적힌 경우도 지역으로 인정한다. 본문 전체에 같은 규칙을
// 쓰면 공문 아래쪽 발신처 주소("서울특별시 서초구 …")를 행사 지역으로 잡는다.
const BARE_REGION_NAMES = [...new Set(REGION_MAP.map(([, region]) => region))]
function matchRegionInVenue(text) {
  if (!text) return ''
  const hit = matchRegion(text)
  if (hit) return hit
  for (const region of BARE_REGION_NAMES) {
    if (new RegExp(`(?<![가-힣])${region}`).test(text)) return region
  }
  return ''
}

function parseDocMeta(filename, text) {
  const norm = s => s.replace(/\s+/g, '')
  const col  = s => s.replace(/\s+/g, ' ').trim()
  // 전각/이형 문자 정규화 + 스캔 공문 OCR 오독 보정(14A1→14시 등)
  const normalized = normalizeOcrArtifacts(text)
  const tc   = col(normalized)
  const tn   = norm(normalized)
  const curY = new Date().getFullYear()
  let yearGuessed = false

  // ── 제목 ──
  let title = ''
  let titleRule = ''
  // normalized text에서 개행 기준으로 제목 줄만 추출 (가장 정확)
  const titleLineM = normalized.match(/(?:제\s*_?\s*목|건\s*명|행\s*사\s*명|연수\s*명|강\s*의\s*명|과\s*정\s*명|세\s*미\s*나\s*명|학\s*술\s*대\s*회\s*명)[^\S\n_]*[：:。』」_=]*[^\S\n]*([가-힣\dA-Za-z「『\[(][^\n]{3,119})/)
  if (titleLineM) {
    // 긴 제목이 다음 줄로 넘어간 공문("…교육 이수 협조 / 요청(병의원, 보건소용)") — 제목이 끝맺음 말로
    // 끝나지 않았고 다음 줄이 본문 항목(1. 가. 수신…)이 아니면 한 줄 더 붙인다.
    const nextLine = (normalized.slice(titleLineM.index + titleLineM[0].length).match(/^\n([^\n]{2,40})/) || [])[1] || ''
    const ended = /(?:안내|건|개최|요청|알림|공고|모집|초청|계획|신청|회의|세미나|교육|과정|[)」』])\s*$/.test(titleLineM[1])
    const bodyStart = /^\s*(?:\d+\s*\.|[가나다라마바사아자차카타파하]\s*\.|\(?\s*경\s*유|수\s*신|참\s*조|붙\s*임|[-─━═_]{2,})/.test(nextLine)
    title = cleanTitle(titleLineM[1] + (!ended && nextLine && !bodyStart ? ' ' + nextLine : ''))
    // 목록 기호 혼입 제거 (끝에 붙은 " 나." " 다." 등)
    title = title.replace(/\s+[가나다라마바사아자차카타파하]\s*\.?\s*$/, '').trim()
  }
  // 공백 정규화 버전(tc)에서 재시도 — 개행이 없는 PDF OCR 결과에도 대응
  if (!title) {
    const titleM = tc.match(/(?:제\s*_?\s*목|건\s*명|행\s*사\s*명|연수\s*명|강\s*의\s*명|과\s*정\s*명|세\s*미\s*나\s*명|학\s*술\s*대\s*회\s*명)\s*[：:。』」_=]*\s+([가-힣\dA-Za-z「『\[(].{3,119})/)
    if (titleM) {
      // 본문 항목 구분자(숫자. / 가.나.다. / 수신 / 붙임) 이후 잘라냄
      title = cleanTitle(titleM[1])
    }
  }
  if (title) titleRule = 'label'
  // 파일명에서 추출 (숫자+언더스코어로만 구성된 파일명은 제외)
  if (!title) {
    const fnBase = filename.replace(/(?:\.[A-Za-z0-9]{2,4})+$/, '').replace(/[_\-]/g, ' ').trim()
    // 파일명에 한글이 있고 너무 짧거나 길지 않으면 사용
    if (fnBase.length > 4 && fnBase.length < 80 && /[가-힣]/.test(fnBase)) title = fnBase
    else if (fnBase.length > 4 && fnBase.length < 80 && !/^\d/.test(fnBase)) title = fnBase
  }
  if (title && !titleRule) titleRule = 'filename'
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
  let multiSession = false
  const tcD = maskNonEventDates(tc)
  const tnD = norm(tcD)

  const pad = n => String(n).padStart(2, '0')
  // 어느 규칙이 날짜를 정했는지 남긴다 — 라벨 뒤에서 읽은 값과 문서 어딘가에서 추정한 값은 믿을 만한 정도가 다르다
  let curRule = '', dateRule = ''
  const setRange = (sy, sm, sd, ey, em, ed) => {
    dateRule = curRule
    startDate = `${sy}-${pad(sm)}-${pad(sd)}`
    endDate   = `${ey}-${pad(em)}-${pad(ed)}`
    nights = Math.max(0, Math.round((new Date(endDate) - new Date(startDate)) / 86400000))
    days = nights + 1
    periodDisplay = nights > 0 ? `${sm}월 ${sd}일 ~ ${em}월 ${ed}일` : `${sm}월 ${sd}일`
  }
  const setSingle = (sy, sm, sd) => {
    dateRule = curRule
    startDate = `${sy}-${pad(sm)}-${pad(sd)}`
    endDate   = startDate
    nights = 0; days = 1
    periodDisplay = `${+sm}월 ${+sd}일`
  }

  curRule = 'P0'
  // 패턴0: 차수 목록 "1차: 날짜, 장소 / 2차: 날짜, 장소" — 차수는 따로 열리는 같은 교육이라
  // 기간으로 묶으면 안 된다(6/9 서울·6/16 대전이 8일 출장이 됐다). 1차로 채우고 확인을 요청한다.
  {
    const firstM = tcD.match(/1\s*차\s*[：:,、]\s*(\d{4})[. ]+(\d{1,2})[. ]+(\d{1,2})/)
    if (firstM) {
      setSingle(+firstM[1], +firstM[2], +firstM[3])
      multiSession = /2\s*차\s*[：:,、]\s*\d{4}/.test(tcD)
    }
  }

  // 차수 표 "2차 2023.7.4.(화) … 3차 2023.7.6.(목)"(보건산업진흥원 회계기준 교육) — 1차가 없어도 서로 다른
  // 차수가 둘 이상 날짜와 함께 나오면 따로 열리는 교육이다. 첫 차수로 채우고 확인을 요청한다.
  {
    const sessions = new Set([...tcD.matchAll(/(\d{1,2})\s*차\s*[：:,、]?\s*\d{4}\s*[.\-년]/g)].map(m => m[1]))
    if (sessions.size >= 2) multiSession = true
  }

  curRule = 'PL'
  // 패턴L: 라벨(일시·일자·기간·교육일시·과정일정) 바로 뒤 날짜 — 문서 전체에서 날짜 모양을
  // 찾기 전에 먼저 본다. 라벨 앞에 한글이 붙은 '신청기간'·'시행일자'·'거래일자'는 라벨이 아니다.
  if (!startDate) {
    for (const lm of tcD.matchAll(EVENT_DATE_LABEL)) {
      const r = parseDateSnippet(tcD.slice(lm.index + lm[0].length, lm.index + lm[0].length + 160), curY)
      if (!r) continue
      if (r.guessed) yearGuessed = true
      if (r.s.join() === r.e.join()) setSingle(...r.s)
      else setRange(...r.s, ...r.e)
      break
    }
  }

  curRule = 'P1'
  // 패턴1: YYYY-MM-DD ~ YYYY-MM-DD
  if (!startDate) {
    const m = tcD.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*~\s*(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) setRange(+m[1],+m[2],+m[3],+m[4],+m[5],+m[6])
  }

  curRule = 'P1.5'
  // 패턴1.5: 공백제거 텍스트(tn)에서 날짜 범위 탐색
  // pdfjs 폰트 이슈로 tc에서 숫자 사이 공백이 끼어 패턴2가 실패할 때 대비
  // 형식: YYYY.M.D비숫자*~비숫자*(YYYY.)M.D
  if (!startDate) {
    const m = tnD.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})[^\d~]*~[^\d]*(?:(\d{4})\.)?(\d{1,2})\.(\d{1,2})/)
    if (m && +m[1] >= 2020) {
      const ey = m[4] ? +m[4] : +m[1]
      setRange(+m[1], +m[2], +m[3], ey, +m[5], +m[6])
    }
  }

  curRule = 'P2'
  // 패턴2: YYYY.M.D ~ M.D 또는 YYYY.M.D~YYYY.M.D
  // 일자 뒤에 .(수) 같은 점+요일 괄호가 붙는 공문 형식 지원 (예: 2025. 5. 21.(수) ~ 5. 23.(금))
  if (!startDate) {
    const m = tcD.match(/(\d{4})[. ]+(\d{1,2})[. ]+(\d{1,2})(?:\.?\s*\([가-힣]{1,3}\))?\.?\s*~\s*(?:(\d{4})[. ]+)?(\d{1,2})[. ]+(\d{1,2})/)
    if (m) {
      const ey = m[4] ? +m[4] : +m[1]
      setRange(+m[1],+m[2],+m[3], ey,+m[5],+m[6])
    }
  }

  curRule = 'P3'
  // 패턴3: 한글 날짜 — YYYY년 M월 D일 ~ M월 D일
  if (!startDate) {
    const m = tcD.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*~\s*(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
    if (m) {
      const ey = m[4] ? +m[4] : +m[1]
      setRange(+m[1],+m[2],+m[3], ey,+m[5],+m[6])
    }
  }

  curRule = 'P4'
  // 패턴4: MM.DD(요일) ~ MM.DD(요일) — 연도가 없으면 요일이 맞는 해로 추정
  if (!startDate) {
    const r = parseDateSnippet(tcD.match(/(?<!\d)\d{1,2}\s*\.\s*\d{1,2}(?:\s*\([^)]{1,3}\))?\s*~\s*\d{1,2}\s*\.\s*\d{1,2}/)?.[0] || '', curY)
    if (r) { yearGuessed = !!r.guessed; setRange(...r.s, ...r.e) }
  }

  curRule = 'P6'
  // 패턴6: "교육일시" 테이블 컬럼에서 ISO 날짜 — 납부 안내서·신청 명단 형식
  // 시행일자보다 먼저 체크해서 올바른 교육일 추출
  if (!startDate) {
    const eduDateM = tcD.match(/교\s*육\s*일\s*시\s+(\d{4}-\d{2}-\d{2})/)
    if (eduDateM) {
      const [y,mo,d] = eduDateM[1].split('-').map(Number)
      setSingle(y, mo, d)
    }
  }

  curRule = 'P7'
  // 패턴7: 단일 ISO 날짜 — YYYY-MM-DD (시행일자 제외)
  if (!startDate) {
    // 시행일자·접수일자 등 행정 처리일 제외를 위해 해당 패턴 마스킹 후 탐색
    const tcNoAdmin = tc.replace(/(?:시행|접수|발행|발급|작성)\s*일\s*자?\s*\d{4}-\d{2}-\d{2}/g, '')
                       .replace(/\(\s*시행일자\s*\d{4}-\d{2}-\d{2}\s*\)/g, '')
    const m = tcNoAdmin.match(/(\d{4})-(\d{2})-(\d{2})(?!\s*[\-~～]\s*\d{4}-\d{2}-\d{2})/)
    if (m && +m[1] >= 2020) setSingle(+m[1],+m[2],+m[3])
  }

  curRule = 'P8'
  // 패턴8: 단일 일자 — YYYY. M.D 또는 YYYY.M.D (뒤에 ~ 없음)
  if (!startDate) {
    const m = tcD.match(/(\d{4})[. ]+(\d{1,2})[. ]+(\d{1,2})(?:\s*\([^)]{1,3}\))?(?!\s*[~～])/)
    if (m && +m[1] >= 2020) setSingle(+m[1],+m[2],+m[3])
  }

  curRule = 'P9'
  // 패턴9: 라벨 없이 한글 날짜 하나만 있는 안내문(메일·포스터 사진) — "2026년 10월 14일(수) 오후 1시"
  if (!startDate) {
    const m = tcD.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
    if (m && +m[1] >= 2020) setSingle(+m[1], +m[2], +m[3])
  }

  curRule = dateRule  // 기간 늘리기는 앞에서 정한 규칙의 신뢰도를 이어받는다
  // 패턴L-2: "2026.11.05.(목), 14시~11.06.(금)" — 시작시각이 날짜와 종료일 사이에 끼어 있어
  // 앞 패턴들이 당일로 읽었다(재협 추계세미나 공문, 2026-09-29 실측: 1박2일이 당일로 잡혀 135,000원이 빠졌다).
  // 스캔 공문은 OCR 결과가 엔진마다 다르다 — "14시"가 크롬은 "14AI", 사파리는 "14A1", 요일 "(목)"은 "()"로도 읽힌다.
  // 그래서 글자 모양을 고집하지 않고 날짜와 ~ 사이의 짧은 토막을 통째로 건너뛰되,
  // 시작일 일치·끝일이 뒤·30일 이내 세 조건을 모두 만족할 때만 기간을 늘린다.
  if (startDate && startDate === endDate) {
    const m = tcD.match(/(\d{4})[. ]+(\d{1,2})[. ]+(\d{1,2})\.?[^~\n]{0,14}~\s*(?:(\d{4})[. ]+)?(\d{1,2})[. ]+(\d{1,2})(?!\d)/)
    if (m && `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` === startDate) {
      const ey = m[4] ? +m[4] : +m[1]
      const cand = `${ey}-${pad(+m[5])}-${pad(+m[6])}`
      const gap = (new Date(cand) - new Date(startDate)) / 86400000
      if (gap > 0 && gap <= 30) setRange(+m[1], +m[2], +m[3], ey, +m[5], +m[6])
    }
  }

  // ── 장소 → 지역 ──
  // 장소 → 지역 탐색 (발신자 주소 오인 방지 강화)
  let destination = ''


  // 형식0: 장소를 읽었으면 그 장소로 판정한다 — 본문에는 발신처 주소가 섞여 있다
  extractVenue.rule = 'label'
  const venue = repairGarbledVenue(extractVenue(tc), tc)
  const venueRule = venue ? extractVenue.rule : ''
  destination = matchRegionInVenue(venue)
  let destRule = destination ? 'venue' : ''

  // 형식1: "장소 : XXX" 또는 "개최지 : XXX"
  const placeColonM = tc.match(/(?:장\s*소|개최\s*지|행사\s*장소|개최\s*장소)\s*[：:]\s*([^.0-9]{2,60})/)
  if (!destination && placeColonM) { destination = matchRegionInVenue(placeColonM[1]); if (destination) destRule = 'label' }

  // 형식2: "장 소 XXX 숫자." (번호 목록 형식) — 번호 나오기 전까지
  if (!destination) {
    const placeListM = tc.match(/장\s*소\s+([가-힣][^0-9]{2,50})(?:\s*\d+\s*[.:]|$)/)
    if (placeListM) destination = matchRegionInVenue(placeListM[1])
    if (destination && !destRule) destRule = 'label'
  }

  // 형식3: "1차: 날짜, 장소" 목록 형식 (강의 협조 요청 등)
  if (!destination) {
    const firstPlaceM = tc.match(/1\s*차\s*[：:,、].*?,\s*([가-힣].{3,40})/)
    if (firstPlaceM) destination = matchRegionInVenue(firstPlaceM[1])
    if (destination && !destRule) destRule = 'label'
  }

  // 형식4: "교육장소" 키워드 이후 텍스트에서 REGION_MAP 직접 검색 (테이블 형식)
  if (!destination) {
    const eduM = tc.match(/교\s*육\s*장\s*소/)
    if (eduM) destination = matchRegionInVenue(tc.slice(eduM.index, eduM.index + 240))
    if (destination && !destRule) destRule = 'label'
  }

  // 장소 라벨 탐색 실패 시 본문 스캔 — 발신처 주소(우편번호 기준) 이전만 탐색
  if (!destination) {
    // "우 XXXXX" 우편번호, 전화번호, 팩스번호, 시행 이후 제외
    const bodyText = tc.split(/우\s*\d{3}[-\d]*\s*[가-힣]|전화\s*번호|팩스\s*번호/)[0]
    // 수신자 정보(병원명 등)가 포함된 앞부분은 제외하고 본문 핵심만 검색
    // "수신" 이후 첫 가-힣로 시작하는 의미 있는 본문부터 탐색
    const bodyCore = bodyText.replace(/^.*?(?=\d+\.\s)/s, '')  // "1. 귀 기관..." 이후부터
    destination = matchRegion(bodyCore) || matchRegion(bodyText)
    if (destination) destRule = 'body'
  }

  // ── 등록비 ──
  let registration = null
  let registrationNote = null
  let feeRule = ''

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
    // 회원가 토막은 '비회원' 앞에서 끊는다 — 회원가를 못 읽으면 바로 뒤 비회원가(110,000원)를 집었다
    const snipMember = tnFee.slice(tnFee.search(/(?:회원병원|정회원)/)).split(/비회원|미등록/)[0]
    const amtM = snipMember.match(amtPat)
    if (amtM) {
      registration = amtM[1]
        ? parseInt(amtM[1].replace(/,/g,'')) * 10000
        : parseAmt(amtM[2])
    } else {
      registration = parseAmt(memberM[1])
    }
  }

  if (registration) feeRule = 'member'
  // 우선순위2: 사전납입 기준
  if (!registration) {
    const i = tnFee.indexOf('사전납입')
    if (i >= 0) {
      const amtM = tnFee.slice(i, i+30).match(amtPat)
      if (amtM) registration = amtM[1] ? parseInt(amtM[1].replace(/,/g,''))*10000 : parseAmt(amtM[2])
    }
  }

  if (registration && !feeRule) feeRule = 'prepaid'
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

  if (registration && !feeRule) feeRule = 'table'
  // 우선순위3: "금 XXX원" 형식 — 납부 안내서, 고지서 (예: "금 25,000 원 / 1 명")
  // ※ \b는 한글 앞뒤에서 동작하지 않으므로 사용하지 않음
  if (!registration) {
    const kinM = tcFee.match(/금\s+([\d,]+)\s*원(?:\s|\/|$)/)
    if (kinM) registration = parseAmt(kinM[1])
  }

  if (registration && !feeRule) feeRule = 'geum'
  // 우선순위4: 교육비·등록비·참가비·참가회비 등 키워드 뒤 금액 (만원 단위 포함)
  // "1인당", "1인" 같은 중간 수식어 허용 (예: 참가회비 1인당 450,000원)
  if (!registration) {
    const kwRegex = /(?:사전\s*등\s*록\s*비|사전\s*등록|참\s*가\s*회\s*비|등\s*록\s*비|참\s*가\s*비|교\s*육\s*비|수\s*강\s*료)\s*[：:\-]?\s*(?:1\s*인\s*당\s*)?(?:([\d,]+)\s*만\s*원|([\d,]+)\s*원)/
    const kwM = tcFee.match(kwRegex)
    if (kwM) {
      registration = kwM[1]
        ? parseInt(kwM[1].replace(/,/g,'')) * 10000
        : parseAmt(kwM[2])
    }
  }

  if (registration && !feeRule) feeRule = 'keyword'
  // 우선순위5: 정규화 텍스트에서 키워드+금액 슬라이딩 검색 (만원 포함)
  if (!registration) {
    const kwPats = ['사전등록비','사전등록','참가회비','등록비','참가비','교육비','수강료']
    // 첫 등장만 보면 "교육비 납부방법을 안내하오니"처럼 금액 없는 문장에서 멈춘다 — 모든 등장을 본다
    for (const kw of kwPats) {
      for (let ki = tnFee.indexOf(kw); ki >= 0 && !registration; ki = tnFee.indexOf(kw, ki + kw.length)) {
        const amtM = tnFee.slice(ki, ki + kw.length + 50).match(amtPat)
        if (amtM) registration = amtM[1] ? parseInt(amtM[1].replace(/,/g,'')) * 10000 : parseAmt(amtM[2])
      }
      if (registration) break
    }
  }

  // 간호사 보수교육 공문은 금액을 못 읽어도 기본값을 채운다.
  // 의료법 시행규칙 제20조에 따라 연간 8시간 이상 이수 의무이고, 8시간 프로그램 회원가는 40,000원으로 같다.
  if (registration && !feeRule) feeRule = 'sliding'
  // 라벨 없이 회원가·비회원가 두 금액만 나란히 찍힌 교육 안내 화면(간호협회 에듀센터 캡처) — 작은 쪽이 회원가
  if (!registration) {
    const pairM = tc.match(/(?<![\d,])(\d{1,3}(?:,\d{3})+)\s*원\s+(\d{1,3}(?:,\d{3})+)\s*원/)
    const [a, b] = pairM ? [parseAmt(pairM[1]), parseAmt(pairM[2])] : []
    if (a && b && a < b) {
      registration = a
      feeRule = 'pair'
      registrationNote = '공문에 금액이 두 개 있어 낮은 쪽(회원가)으로 넣었어요. 맞나요?'
    }
  }

  // 오프라인이라고 밝힌 병원 주관 과정(서울아산병원 코칭 과정 80,000원)은 간협 온라인 가격과 달라 기본값을 쓰지 않는다
  const offlineOnly = /오프라인/.test(tnFee) && !/온라인/.test(tnFee)
  if (!registration && /보수교육/.test(tnFee) && /간호/.test(tnFee) && !offlineOnly) {
    registration = 40000
    feeRule = 'default'
    registrationNote = '간호사 보수교육 8시간·회원 기준 기본값이에요. 다르면 고쳐주세요.'
  }

  // ── 온라인 여부 (제목에 "온라인" 명시된 경우만 true, 없으면 false=오프라인)
  // 교육장소 칸이 '온라인'인 공문(방사선진흥협회 직장교육)도 온라인이다
  const isOnline = /온라인/.test(title) || /온라인/.test(tc.slice(0, 300)) || /^온\s*라\s*인/.test(venue)
  if (isOnline && /^온\s*라\s*인/.test(venue)) destination = ''

  const { startTime, endTime, timeRule } = extractTimes(tcD)

  // 출장·교육 공문이 맞는지 — 아니면 화면에서 "못 찾았다"고 말한다.
  // 교육 말고도 타 기관에 나가 일하는 공문이 있다 — 세무조정·실사 협조요청처럼
  // '교육'이라는 말이 한 번도 안 나오는 출장 공문을 영수증 취급해 내치지 않는다.
  const isTripDoc = /교육|출장|세미나|연수|워크숍|워크샵|학술대회|심포지엄|컨퍼런스|포럼|보수교육|학회|훈련|협조요청|협조부탁|업무협의|파견|실사|현장점검|교류회|간담회|이사회|총회|강좌/.test(tn)
    || /seminar|workshop|conference|symposium|forum|training|test\s*drive|venue|registration/i.test(tc)

  // 결재된 출장신청서 자체를 올린 경우 — 기안일이 출장일로 잡혔다. 공문이 아니라고 말한다.
  const docKind = /출\s*장\s*신\s*청\s*서/.test(tc.slice(0, 60)) && /기\s*안/.test(tc) ? 'trip-form'
    : isTripDoc ? 'notice' : 'other'
  if (docKind !== 'notice') {
    return { title: '', periodDisplay: '', startDate: '', endDate: '', nights: 0, days: 0, destination: '',
             registration: null, registrationNote: null, isOnline: false, startTime: '', endTime: '',
             venue: '', yearGuessed: false, isTripDoc: false, docKind, multiSession: false }
  }

  const address = extractAddress(tc)
  tripTitle.scrubbed = false
  const meta = { title: tripTitle(title), titleScrubbed: tripTitle.scrubbed, address, periodDisplay, startDate, endDate, nights, days, destination, registration,
           registrationNote, isOnline, startTime, endTime, venue, venueSearch: venueSearchName(venue),
           yearGuessed, isTripDoc, docKind, multiSession }
  meta.rules = { date: dateRule, time: timeRule || '', fee: feeRule, dest: destRule, venue: venueRule, title: titleRule }
  assessMeta(meta, normalized)
  return meta
}

// ── 판독 확신도와 교차검증(2026-09-29 지석초이 "오탐률을 줄이는 방법") ─────────────────────────────
// 틀린 값을 그럴듯하게 채우는 게 빈칸보다 위험하다 — 사용자는 틀린 줄 모르고 넘어간다. 그래서 칸마다
// ① 어느 규칙이 값을 정했는지로 확신도를 매기고 ② 값끼리·원문과 교차검증해 올리거나 내린다.
// 확신도 low 인 칸은 카드4가 바로 채우지 않고 '공문 추정 — 넣기' 버튼으로 한 번 확인받는다.
const RULE_CONF = {
  // 날짜: 라벨(일시·기간…) 뒤·차수 목록·교육일시 표 = high / 연도 있는 범위 = mid / 라벨 없이 문서 어딘가의 날짜 = low
  date: { P0: 'high', PL: 'high', P6: 'high', P1: 'mid', 'P1.5': 'mid', P2: 'mid', P3: 'mid', P4: 'low', P7: 'low', P8: 'low', P9: 'low' },
  time: { day: 'high', label: 'high', range: 'mid', keyword: 'low', from: 'low' },
  fee: { member: 'high', prepaid: 'high', geum: 'high', keyword: 'high', table: 'mid', sliding: 'mid', pair: 'low', default: 'low' },
  dest: { venue: 'high', label: 'high', body: 'low' },
}
const CONF_UP = { low: 'mid', mid: 'high', high: 'high' }
const DOW_OF = iso => '일월화수목금토'[new Date(`${iso}T00:00:00`).getDay()]

function assessMeta(meta, text) {
  const t = String(text || '').replace(/\s+/g, ' ')
  const conf = {
    date: meta.startDate ? (RULE_CONF.date[meta.rules.date] || 'low') : '',
    time: meta.startTime ? (RULE_CONF.time[meta.rules.time] || 'low') : '',
    fee: meta.registration ? (RULE_CONF.fee[meta.rules.fee] || 'low') : '',
    dest: meta.destination ? (RULE_CONF.dest[meta.rules.dest] || 'low') : '',
  }
  const checks = []
  const down = (k, why) => { if (conf[k]) { conf[k] = 'low'; checks.push({ field: k, why }) } }
  if (meta.startDate) {
    const [, m, d] = meta.startDate.split('-').map(Number)
    // ① 요일 대조 — 공문에 적힌 요일과 달력 요일. 맞으면 날짜를 제대로 읽었다는 강한 증거, 틀리면 오독이다
    const wd = t.match(new RegExp(String.raw`(?<!\d)0?${m}\s*[.월/]\s*0?${d}\s*[.일]?\s*\(\s*([일월화수목금토])\s*\)`))
    if (wd) {
      if (wd[1] === DOW_OF(meta.startDate)) conf.date = CONF_UP[conf.date]
      else down('date', `공문 요일(${wd[1]})과 달력 요일(${DOW_OF(meta.startDate)})이 달라요`)
    }
    // ② 발행일 대조 — 교육일이 공문 발행일보다 한참 앞서거나 1년 넘게 뒤면 다른 날짜(발행일·관련 문서 날짜)를 읽은 것이다
    // 발행일은 하단 정식 표기 "시행 부서-번호 (2026.09.11)"의 괄호 속 날짜만 인정한다 — 제목의 '교류회 시행 안내'를 라벨로 읽었다
    // '시행의'(조사)는 빼되 '시행 의료서비스혁신단'(부서명)은 살린다 — 조사는 띄어 쓰지 않는다
    const issued = t.match(/시\s*행(?!\s*(?:하|할|합|되|된|중|령|규|계|안내)|의|에|을)[^()]{0,50}\(\s*((?:19|20)\d{2})\s*[.\-년]\s*(\d{1,2})\s*[.\-월]\s*(\d{1,2})/)
    if (issued) {
      // 두 날짜 모두 UTC 자정으로 맞춘다 — 한쪽만 현지 자정이면 같은 날이 9시간 어긋나 '같은 날'을 못 잡았다
      const gap = Math.round((Date.parse(`${meta.startDate}T00:00:00Z`) - Date.UTC(+issued[1], +issued[2] - 1, +issued[3])) / 86400000)
      // 발행한 날 바로 여는 회의도 있어 '같은 날'은 약한 신호다 — 한 단계만 내린다(high→mid, mid→low)
      if (gap === 0) { if (conf.date === 'mid') down('date', '공문 발행일과 같은 날짜예요'); else if (conf.date === 'high') conf.date = 'mid' }
      else if (gap < -3) down('date', '공문 발행일보다 앞선 날짜예요')
      else if (gap > 400) down('date', '공문 발행일보다 1년 넘게 뒤예요')
    }
    if (!meta.isOnline && meta.nights > 30) down('date', '기간이 30일을 넘어요')
    // ④ 접수·등록 기간 대조 — 고른 날짜가 신청·접수·등록 기간 안이면 교육일이 아니라 그 기간의 날짜를 읽은 것이다
    const DT = String.raw`((?:19|20)\d{2})\s*[.\-년]\s*(\d{1,2})\s*[.\-월]\s*(\d{1,2})`
    const PART = String.raw`(?:((?:19|20)\d{2})\s*[.\-년]\s*)?(\d{1,2})\s*[.\-월]\s*(\d{1,2})`
    const regRe = new RegExp(String.raw`(?:신\s*청|접\s*수|등\s*록|사\s*전\s*등\s*록|납\s*부)[^0-9]{0,15}${DT}[^~0-9]{0,15}~\s*${PART}`, 'g')
    for (const r of t.matchAll(regRe)) {
      const from = `${r[1]}-${String(r[2]).padStart(2, '0')}-${String(r[3]).padStart(2, '0')}`
      const to = `${r[4] || r[1]}-${String(r[5]).padStart(2, '0')}-${String(r[6]).padStart(2, '0')}`
      if (meta.startDate >= from && meta.startDate <= to) { down('date', '신청·접수 기간 안의 날짜예요'); break }
    }
    // ⑤ 고른 날짜가 원문에 처음 나오는 자리 바로 앞(60자)에 신청·접수·입금·마감 말이 있으면 그 날짜는 접수 쪽이다
    //    (표 칸 "접수기간 … 회원병원 99,000원 2026.8.10~"처럼 금액이 끼어 ④가 못 잡는 경우)
    const [sy, sm, sd] = meta.startDate.split('-').map(Number)
    const at = t.search(new RegExp(String.raw`(?:${sy}|${String(sy).slice(2)})\s*[.\-년]\s*0?${sm}\s*[.\-월]\s*0?${sd}(?!\d)`))
    if (at > 0 && /(?:신\s*청|접\s*수|입\s*금|마\s*감|사\s*후\s*등\s*록|사\s*전\s*등\s*록|환\s*불)/.test(t.slice(Math.max(0, at - 120), at))
      && !/(?:일\s*시|일\s*자|교\s*육\s*일|행\s*사\s*일|개\s*최\s*일)/.test(t.slice(Math.max(0, at - 25), at))) {
      down('date', '신청·접수 안내 옆의 날짜예요')
    }
  }
  // ⑥ 제목: 깨진 토막을 걷었거나, 제목의 영문 약어가 본문 어디에도 다시 안 나오면(OCR이 지어낸 글자 'ET AXTF') 확인받는다
  if (meta.title) {
    conf.title = 'high'
    const lone = (meta.title.match(/[A-Za-z]*[A-Z][A-Za-z]+/g) || []).filter(w => t.split(w).length - 1 < 2)
    if (meta.titleScrubbed) down('title', '공문 글자가 흐려 제목 일부를 읽지 못했어요')
    else if (lone.length) down('title', `제목의 '${lone.join(' ')}'를 본문에서 다시 찾지 못했어요`)
  }
  if (meta.startTime && (meta.startTime < '06:00' || meta.startTime > '21:00')) down('time', `시작시각 ${meta.startTime}은 교육 시각으로 드물어요`)
  if (meta.registration) {
    // ③ 비회원가 대조 — 고른 금액이 '비회원·미등록' 바로 뒤에 적힌 값이면 회원가를 놓친 것이다
    const amt = meta.registration.toLocaleString()
    if (new RegExp(String.raw`(?:비\s*회\s*원|미\s*등\s*록|준\s*회\s*원|미\s*납)[^0-9]{0,12}${amt.replace(/,/g, ',?')}`).test(t)) down('fee', '비회원·준회원·미납 금액으로 보여요')
  }
  meta.confidence = conf
  meta.checks = checks
  return meta
}

// 공문 제목 → 출장/교육명(2026-09-29 지석초이 "안내라는 말은 빼면 더 좋"). 제목 끝의 행정 문구
// (개최 안내·참여 요청·초청의 건·수강 신청 안내…)를 떼고 「」 안의 행사명만 남긴다. 너무 짧아지면 원래 제목을 쓴다.
const TITLE_TAIL_RE = [
  /\s*\([^()]*용\s*\)$/,                                           // (병의원, 보건소용)
  /\s*(?:件|공문|메일)$/,
  /\s*(?:의\s*)?건$/,
  /\s*(?:안내|알림|공지|공고)$/,
  /\s*(?:초청|협조\s*요청|협조\s*부탁|참여\s*요청|참석\s*요청|참여\s*안내|요청)$/,
  /\s*(?:수강\s*)?(?:신청|등록|접수)$/,
  /\s*(?:개최|시행|진행|실시)$/,
]
function tripTitle(raw) {
  let t = String(raw || '').replace(/_/g, ' ')
    .replace(/(\d)\s+(년도|년|회|차)(?=\s|$)/g, '$1$2')
    .replace(/\s*[·ㆍ․]\s*/g, '·')
    .replace(/^붙\s*임\s*\d*\s*[.)]\s*/, '')
    .replace(/^\(\s*((?:19|20)\d{2}년?)\s*\)\s*/, '$1 ')              // (2026년) 방사선작업종사자 …
  const bracket = t.match(/[「『]\s*([^」』]{4,}?)\s*[」』]/)
  if (bracket) t = bracket[1]
  for (let prev = ''; prev !== t; ) {
    prev = t
    for (const re of TITLE_TAIL_RE) t = t.replace(re, '').trim()
  }
  // OCR 찌꺼기 토막(홀로 선 자모 'ㅠㅠ', 기호 '&×', '『')은 제목이 아니다 — 걷고 확인 필요로 표시한다(삼성전자 메일, 2026-09-30)
  const scrubbed = t.split(/\s+/).filter(w => !/^(?:[ㄱ-ㅎㅏ-ㅣ]+|[&×『』%{}<>|\\~^]+[A-Za-z0-9]?)$/.test(w)).join(' ')
  tripTitle.scrubbed = scrubbed !== t.replace(/\s+/g, ' ').trim()
  t = scrubbed.replace(/\((\d{1,2})\s*자\)/g, '($1차)')   // "(3자)" — '차'를 '자'로 읽은 OCR
  t = t.replace(/\s{2,}/g, ' ').trim()
  return t.replace(/\s/g, '').length >= 4 ? t : String(raw || '').trim()
}

// 날짜 토막을 지운다. "기간 : 2026.11.05.(목), 14시~11.06.(금)"처럼 날짜와 시각이 한 줄에
// 섞여 있으면 날짜 숫자가 시각 자리를 먹어 시각을 못 읽었다(재협 추계세미나 공문).
function stripDateTokens(snip) {
  return String(snip || '')
    .replace(/\d{4}\s*[.\-년]\s*\d{1,2}\s*[.\-월]\s*\d{1,2}\s*[.일]?/g, ' ')
    .replace(/(?<![\d:])\d{1,2}\s*[.\-월]\s*\d{1,2}\s*[.일]?(?![:\d])/g, ' ')
    .replace(/\(\s*[가-힣]{1,3}\s*\)/g, ' ')
}

// 시각이 붙는 라벨. 날짜 라벨(일자·기간)도 포함한다 — 시작시각이 기간 줄에만 적힌 공문이 있다.
const TIME_LABEL_RE = /(?:교\s*육\s*|행\s*사\s*|연\s*수\s*)?(?:일\s*_?\s*시|일\s*_?\s*자|기\s*간|교육시간|시\s*간|시\s*작)\s*[:]?/g

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
  // "8시간 65,000원"처럼 교육 '시간'(지속시간)을 시작시각으로 읽지 않도록 시 뒤의 '간'을 막는다
  // '7 시나리오'처럼 '시'로 시작하는 낱말도 막는다(간호협회 프로그램 표에서 07:00으로 읽혔다)
  const T = '(\\d{1,2})\\s*(?::|시(?!\\s*간)(?![가-힣])|시(?=부터|까지|에|경))\\s*(\\d{1,2})?\\s*분?'
  const rangeRe = new RegExp(AMPM + T + '\\s*(?:~|-|–|부터)\\s*' + AMPM + T)
  const singleRe = new RegExp(AMPM + T)
  // ① 라벨(일시·일자·기간·시작) 뒤 토막에서 날짜를 지운 뒤 시각을 찾는다.
  // 토막은 70자까지만 인정하되 뒤에 20자를 더 붙여 읽는다 — 토막이 "5시"에서 끊기면
  // 뒤에 오는 '간'을 못 보고 교육시간(8시간)을 시작시각으로 읽었다(방사선안전교육 공문).
  // ⓪ 날짜 바로 뒤에 붙은 시각 "20일(일요일) 14:00~18:00", "14일(수) 오후 1시 ~" — 라벨이 OCR로 뭉개져도
  // (방사선사협회 스캔 "mg 시 :") 교육일 옆의 시각은 남는다. 라벨 규칙은 '이수시간'·'(시간엄수)' 같은
  // 엉뚱한 '시간' 뒤의 접수 마감 시각(18:00)을 먼저 집었다. 시작 뒤에 ~ 가 있어야 인정한다.
  const dayAdj = tc.match(new RegExp('\\d{1,2}\\s*[일.]\\s*(?:\\(\\s*[^)]{1,4}\\s*\\))?\\s*,?\\s*' + AMPM + T + '\\s*~'))
  if (dayAdj) {
    const start = toHM(dayAdj[2], dayAdj[3], dayAdj[1])
    const tail = tc.slice(dayAdj.index + dayAdj[0].length).match(new RegExp('^\\s*' + AMPM + T))
    const end = tail ? toHM(tail[2], tail[3], tail[1] || dayAdj[1]) : ''
    if (start) return { startTime: start, endTime: end && end > start ? end : '', timeRule: 'day' }
  }
  const NEAR = 70, LOOKAHEAD = 20
  for (const lm of tc.matchAll(TIME_LABEL_RE)) {
    const from = lm.index + lm[0].length
    const snip = stripDateTokens(tc.slice(from, from + NEAR + LOOKAHEAD))
    const limit = Math.max(0, snip.length - LOOKAHEAD)
    const r = snip.match(rangeRe)
    if (r && r.index <= limit) {
      const start = toHM(r[2], r[3], r[1])
      const end   = toHM(r[5], r[6], r[4] || r[1])
      if (start) return { startTime: start, endTime: end && end > start ? end : '', timeRule: 'label' }
    }
    const one = snip.match(singleRe)
    // 범위의 뒤쪽 시각("~ 15:00")은 시작시각이 아니다 — 앞 시각을 못 읽었을 때 끝 시각을 시작으로 집었다
    const isRangeEnd = one && /[~\-–]\s*$/.test(snip.slice(0, one.index))
    if (one && one.index <= limit && !isRangeEnd) {
      const start = toHM(one[2], one[3], one[1])
      if (start) return { startTime: start, endTime: '', timeRule: 'label' }
    }
  }
  const range = tc.match(rangeRe)
  if (range) {
    const start = toHM(range[2], range[3], range[1])
    const end   = toHM(range[5], range[6], range[4] || range[1])
    if (start) return { startTime: start, endTime: end && end > start ? end : '', timeRule: 'range' }
  }
  const kwRe = new RegExp('(?:일\\s*시|시\\s*간|교육시간|시작)[^\\d오전후]{0,12}?' + AMPM + T)
  const kw = tc.match(kwRe)
  if (kw) {
    const start = toHM(kw[2], kw[3], kw[1])
    if (start) return { startTime: start, endTime: '', timeRule: 'keyword' }
  }
  const from = tc.match(new RegExp(AMPM + T + '\\s*부터'))
  if (from) {
    const start = toHM(from[2], from[3], from[1])
    if (start) return { startTime: start, endTime: '', timeRule: 'from' }
  }
  return { startTime: '', endTime: '' }
}

// 공문의 장소 줄에서 기관·건물명을 뽑는다(카카오 장소 검색에 그대로 넣는다).
// tc 는 공백을 하나로 접은 본문이라 '다. 참가회비' 같은 다음 항목이 장소 뒤에 붙어 온다.
function extractVenue(tc) {
  // 차수 목록: "1차: 2026. 6. 9.(화), 삼성서울병원 암병원 지하 1층 강당 ○ 2차: …" → 1차 장소
  const session = tc.match(/1\s*차\s*[：:]\s*\d{4}[^,]{2,30},\s*(.{2,60}?)(?=\s*[○◦•]|\s+2\s*차|$)/)
  if (session) return tidyVenue(session[1])
  // 신청자 명단 표: "교육일시 성명 교육장소 … 2026-06-01 (10:00 ~ 13:00) 홍길동 부산-부산교육원"
  // 성명과 장소가 자간 벌어진 채 붙어 와("이 화수 부 산 - 부 산교 육 원") 공백을 걷고 '지역-기관' 꼴을 찾는다
  const table = tc.match(/교\s*육\s*장\s*소[\s\S]{0,240}?\d{4}-\d{2}-\d{2}\s*\([^)]*\)\s*([가-힣][가-힣\s-]{2,40})/)
  if (table) {
    const squeezed = table[1].replace(/\s+/g, '')
    const hy = squeezed.match(/[가-힣]{2}-[가-힣]{2,}/)
    if (hy) return hy[0]
  }
  // 장소 라벨이 여러 번 나오면(웹 화면 캡처의 표·본문 반복) 쓸 만한 첫 값을 고른다. 금액·날짜·교육시간이 섞인 값은
  // 장소가 아니다 — 판독 순서가 뒤섞인 표에서 "80,000원 148,000원 교육일정 2026.09.30…"이 장소로 들어갔다(코칭 과정, 2026-09-29).
  const LABEL = /(?<![가-힣])(?:장\s*_?\s*소|개\s*최\s*장\s*소|행\s*사\s*장\s*소|교\s*육\s*장\s*소|교\s*육\s*장)(?![가-힣])\s*(?:[：:]|[\]】])?\s*(.{2,90})/g
  let posterLike = false
  const rejected = []
  for (const m of tc.matchAll(LABEL)) {
    // 포스터는 라벨(일정·장소·접수)이 먼저 모두 나오고 값이 뒤에 온다 — 장소 칸에 다른 라벨이 오면 그 값은 장소가 아니다
    if (/^(?:접\s*수|대\s*상|일\s*[시정자]|기\s*간|시\s*간)(?![가-힣])/.test(m[1])) { posterLike = true; continue }
    const v = tidyVenue(m[1])
    if (v && !venueLooksWrong(v)) return v
    if (v) rejected.push(v)
  }
  // 깨진 값에 온전한 부분이 남아 있으면("MEBHERAYR 은명대강당" — 크롬 스캔 판독) 문서 다른 곳에서 그 부분 앞의 이름을 찾는다
  // ("세브란스병원 은명대강당" — 3쪽 프로그램 표, 거기선 '장 소' 라벨이 'O&A 소'로 깨져 라벨로 못 잡았다)
  for (const v of rejected) {
    // 장소처럼 끝나는 조각만 이어 찾는다 — '교육일정' 같은 표 머리글을 이어 붙이면 '일정 교육일정'이 됐다(코칭 과정)
    for (const tail of v.split(/\s+/).filter(w => /^[가-힣]{2,}(?:강당|홀|관|실|센터|병원|호텔|회관|빌딩|타워|캠퍼스)$/.test(w))) {
      const again = tc.match(new RegExp(String.raw`([가-힣][가-힣A-Za-z]{1,19})\s*${tail}`))
      if (again && !venueLooksWrong(again[1]) && !PLACE_GENERIC_ONLY.test(again[1])) { extractVenue.rule = 'label'; return tidyVenue(`${again[1]} ${tail}`) }
    }
  }
  // 라벨 값이 모두 틀렸거나 라벨이 없으면: 실시기관(교육을 여는 병원·기관) → 행사장 이름(호텔·컨벤션센터…, 붙어 있는 지역명까지)
  const host = tc.match(/(?<![가-힣])(?:실\s*시\s*기\s*관|교\s*육\s*기\s*관)(?![가-힣])\s*[：:]?\s*([가-힣A-Za-z][가-힣A-Za-z0-9 ]{1,30}?)(?=\s{2,}|\s+(?:교육|장소|일정|기간|접수|대상)|$)/)
  if (host && !venueLooksWrong(host[1])) { extractVenue.rule = 'host'; return tidyVenue(host[1]) }
  const hall = tc.match(/[가-힣A-Za-z]{2,}(?:컨벤션센터|컨벤션|호텔|리조트|연수원|박물관|아트홀)(?:부산|서울|제주|대구|대전|울산|창원|광주|수원)?(?:\s*\([A-Za-z]{2,10}\))?(?:\s*[\dA-Z]{1,5}\s*홀)?/)
  if (hall && (posterLike || !LABEL.test(tc))) { extractVenue.rule = 'hall'; return tidyVenue(hall[0]) }
  return ''
}

// 장소 칸에 들어가면 안 되는 모양 — 금액·연월일·교육시간·일정 표 머리글
// 대문자 영문 7자 이상이 한글 장소에 섞이면 스캔 판독 찌꺼기다('MEBHERAYR 은명대강당'). COEX·BEXCO·ICC 같은 짧은 영문 이름은 둔다.
const PLACE_GENERIC_ONLY = /^(?:장소|교육장|강당|대강당|회의실|본관|별관)$/
function venueLooksWrong(v) {
  if (/[가-힣]/.test(String(v || '')) && /(?<![A-Za-z])[A-Z]{7,}(?![A-Za-z])/.test(String(v || ''))) return true
  return /\d[\d,]{2,}\s*원|(?:19|20)\d{2,4}\s*[.\-년]\s*\d|\d{6}[.]\d|교육\s*일정|총\s*교육\s*시간|\d+\s*시간\s*\(/.test(String(v || ''))
}

// 본문의 "주소 : 경기도 용인시 …" — 장소 이름이 판독에서 깨졌을 때 좌표 검색에만 쓴다. 우편번호로 시작하는 줄은 발신처 주소라 뺀다.
function extractAddress(tc) {
  for (const m of tc.matchAll(/(?<![가-힣])주\s*소(?![가-힣])\s*[：:]?\s*([^\n]{6,60})/g)) {
    const v = m[1].trim()
    if (/^\(?\s*\d{5}/.test(v) || /^\(?\s*우\s*\d/.test(v)) continue
    const addr = (v.match(/(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣]*\s+[가-힣]+[시군구][^,)]{2,40}?\d+(?:-\d+)?/) || [])[0]
    if (addr) return addr.trim()
  }
  return ''
}

// OCR이 깨뜨린 조각 — 판독 기호(『』%{}<>&×/)가 섞였거나, 숫자·영문이 뒤엉킨 토막("0006『56", "08/6대", "E48")
// 층·호·번지·동(3층, 107호, 2F, B1)은 정상 표기라 둔다.
function ocrJunkToken(w) {
  if (/[『』%{}<>×|\\]/.test(w) || /(?<![A-Za-z])&|&(?![A-Za-z])/.test(w) || /\d\/\d|\/[가-힣]/.test(w)) return true
  if (/^(?:[A-Z]?\d{1,4}(?:층|호|번지|동|F)?|B\d|\d+F)$/.test(w)) return false
  return /\d{3,}[^\d\s가-힣(),.\-]|\d[A-Za-z]{1,2}\d/.test(w)
}
// 괄호 속이 한글 없이 짧은 영문 대문자 토막만이면("M EH E48", "AM XH G48") 한글 이름을 잘못 읽은 것이다
function ocrJunkParen(inner) {
  const ws = String(inner || '').trim().split(/\s+/)
  return !/[가-힣]/.test(inner) && ws.length >= 2 && ws.every(w => /^[A-Z0-9<>&]{1,4}$/.test(w))
}
// 장소 이름이 판독에서 깨졌으면 "주소 … 서천동로 59 삼성전자 The UniverSE"처럼 주소 뒤에 딸린 건물명으로 되살린다.
// 되살릴 근거가 없으면 깨진 토막만 걷는다 — 아무 이름이나 지어내지 않는다(2026-09-30 지석초이 "장소가 이상하다").
function repairGarbledVenue(venue, tc) {
  let v = String(venue || '')
  if (!v) return v
  const pm = v.match(/^(.*?)\s*\(([^)]*)\)?\s*$/)
  let head = pm ? pm[1] : v
  let paren = pm ? (pm[2] || '') : ''
  const parenBad = !!paren && ocrJunkParen(paren)
  if (parenBad) paren = ''
  const headBad = head.split(/\s+/).some(ocrJunkToken)
  if (!headBad) return parenBad ? head : v     // 고칠 게 없으면 원문 그대로(괄호 앞 띄어쓰기까지)
  // 주소 줄에서 도로명·번지 뒤의 건물명을 찾는다
  const am = tc.match(/(?<![가-힣])주\s*소(?![가-힣])\s*[：:]?\s*[^\n]{0,60}?(?:로|길|동)\s*\d+(?:-\d+)?\s+([가-힣A-Za-z][가-힣A-Za-z0-9 ]{1,30}?)(?=\s{2,}|\s*[(,]|\s+(?:감사|문의|※|\d+\s*\.)|$)/)
  let name = am ? am[1].trim() : ''
  if (name && name.split(/\s+/).some(ocrJunkToken)) name = ''
  if (name) {
    // 장소 첫 낱말("The")이 건물명 안에 있으면 거기서부터 쓴다 — "삼성전자 The UniverSE" → "The UniverSE"
    const first = head.split(/\s+/)[0]
    const at = first && !ocrJunkToken(first) ? name.indexOf(first) : -1
    head = at > 0 ? name.slice(at) : name
  } else {
    head = head.split(/\s+/).filter(w => !ocrJunkToken(w)).join(' ')
    if (!/[가-힣]{2,}|[A-Za-z]{3,}/.test(head)) head = ''
  }
  head = head.replace(/[,·\s]+$/, '')
  if (!head) return paren
  return paren ? `${head}(${paren})` : head
}

function tidyVenue(raw) {
  let v = String(raw || '')
    .replace(/\s*\(?\s*(?:www\.|https?:\/\/).*$/i, '')        // (www.glad-hotels.com/…) 홈페이지 주소
    .replace(/\s+[가나다라마바사아자차카타파하]\s*\.\s.*$/, '')  // 다음 항목 "다. 참가회비"
    .replace(/\s+[가나다라마바사아자차카타파하]\s*\.(?=[가-힣]).*$/, '')   // 띄어쓰기 없는 다음 항목 "마.교 육 비"
    .replace(/\s+\d{1,2}\s*[.)]\s.*$/, '')                      // 다음 항목 "4. 담당회계법인"
    .replace(/(?<=[가-힣A-Za-z])\d{1,2}\s*\.(?:\s|$).*$/, '')      // 글자에 붙은 다음 항목 번호 "캠퍼스3. :"
    .replace(/\s+[A-Za-z]{1,3}\s*\.\s+(?=[가-힣])/, ' ').replace(/\s+[A-Za-z]{1,3}\s*\.\s.*$/, '')  // OCR이 항목기호 "라."를 "gt."로 읽은 경우
    // 표 머리 "교육일시 교육장소 2차 2023.7.4.(화) 12:50-16:40 대전무역회관…" — 앞이 머리글·차수·날짜뿐일 때만 걷는다.
    // (.*로 걷었더니 장소 뒤에 시간표가 붙은 공문에서 장소 이름까지 지웠다 — 수술감염학회·방사선사협회)
    .replace(/^(?:\s|교\s*육\s*일\s*시|교\s*육\s*장\s*소|\d{1,2}\s*차|\d{4}\s*[.\-]\s*\d{1,2}\s*[.\-]\s*\d{1,2}\s*\.?|\(\s*[가-힣]\s*\))+\d{1,2}\s*:\s*\d{2}\s*[-~–]\s*\d{1,2}\s*:\s*\d{2}\s*/, '')
    .replace(/^[\/\s:：\-]+/, '')                               // 포스터 "/ 장소 / 중앙대학교병원"
    .replace(/\s*[▪■◼•ㆍ○◦©◎⊙].*$/, '')                       // 다음 항목 글머리표 "▪ 참석 대상자", "ㆍ사내 강사", 스캔 '○'→'©'
    // 장소 칸 아래 줄의 분반 배정 "PI담당자반 : 206호 (담당강사 …)"은 장소가 아니다(삼성전자 메일, 2026-09-30)
    .replace(/\s+\S{0,8}반\s*[:：]\s*\d{1,4}\s*호.*$/, '')
    .replace(/\s+(?:담당|기타|교육대상|대상|참가|등록|사전등록|등록방법|등록비|입금|초록|프로그램|숙박|문의|※|소요|발표자|접\s*수|교\s*육\s*비).*$/, '')
    .replace(/\s*(?:현장\s*참여|ZOOM|Zoom|zoom).*$/, '')           // 하이브리드 교육의 온라인 병기
    .replace(/\s+[-–]\s.*$/, '')                                // 다음 줄 목록 "- 사전등록"
    .replace(/[,·|｜\-–\s]+$/, '')
    .trim()
  // 장소 뒤에 딸린 길 안내 "(여의나루역 1번 출구 도보 10분)"는 검색을 방해한다
  v = v.replace(/\s*\([^)]*(?:출구|도보|분 거리|주차)[^)]*\)\s*$/, '')
  return trimVenueJunk(fixLetterSpacing(v)).slice(0, 60).trim()
}

// 장소 이름 뒤에 딸려 온 주석·판독 찌꺼기를 걷는다(2026-09-30 전수 점검: 화면에 "S82 세 3333 그 고게 : = 830-850",
// "* 주차지원 룰가하니 HERS…", "(본관 6춤) oh", "( 주소 : 대전광역시 …"가 그대로 떴다 — 좌표는 맞아서 점검을 통과했었다).
const VENUE_TAIL_KEEP = /^[룸홀관실동층점원장당방관]$/
function trimVenueJunk(raw) {
  let v = String(raw || '')
    .replace(/\s*\(?\s*[*※].*$/, '')                  // 주석 "* 주차지원…", "(* 제주특별자치도 …)"
    .replace(/\s*\(\s*주\s*소\s*[:：].*$/, '')        // 괄호 속 주소 줄 "( 주소 : 대전광역시 …"
    .replace(/(\d)\s*춤/g, '$1층')                     // 스캔 오독 6춤 → 6층
    .replace(/\(\s*(\d+)\s*층\s*\)/g, '($1층)')
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    .replace(/\s*\(\d{2,6}\)/g, '')                    // 숫자만 든 괄호 "(0800)" — 영문 약칭을 잘못 읽은 것
  let ws = v.split(/\s+/).filter(Boolean)
  const cut = ws.findIndex((w, i) => i > 0 && /^(?:[=:;*∎■□]+|\d{4,}|\d{3,}-\d{3,})$/.test(w))
  if (cut > 0) ws = ws.slice(0, cut)
  while (ws.length > 1) {
    const w = ws[ws.length - 1]
    if (/^[^가-힣A-Za-z0-9()]+$/.test(w) || /^[a-z]{1,3}$/.test(w) || (/^[가-힣]$/.test(w) && !VENUE_TAIL_KEEP.test(w)) || (ocrJunkToken(w) && !/\([가-힣]/.test(w))) ws.pop()
    else break
  }
  return ws.join(' ').replace(/[∎■□,·|｜\s]+$/, '').replace(/\s*\([^)]*(?:출구|도보|분 거리|주차)[^)]*\)\s*$/, '')
}

// 공문 장소에서 '검색할 이름'만 남긴다(2026-09-29 지석초이). 카카오 장소 검색은 "CFO 아카데미4층2강의실"
// 같은 세부 위치가 붙으면 아무것도 못 찾고, 좌표가 없으면 역→현장 이동시간·경로 링크가 통째로 빠진다.
// 층·호·강의실·강당 같은 건물 안 위치와 괄호 안내를 떼고 건물·기관 이름만 남긴다.
// '%'는 사진 판독에서 '호'가 바뀌어 나온 것("107%, 206%"), 'B2F'는 지하 층
const VENUE_DETAIL_HEAD = /(?:지하\s*|B)?\d+\s*(층|호실|호관|호|F|%)(?![가-힣])|(지하|B)\s*\d+\s*층|\d+[A-Z]?\s*홀/
const VENUE_DETAIL_WORD = /^(?:제?\s*\d*\s*)?(?:대?강의실|대?회의실|세미나실|중?소회의실|강당|대강당|교육장|교육실|다목적홀|컨벤션홀|컨퍼런스룸|국제회의실|시청각실|실습실|홀|룸)$|^[가-힣]{1,6}팀$/

function venueSearchName(venue) {
  let v = String(venue || '').replace(/[∎■□▪◼]/g, ' ')
  // 괄호 안 안내·주소는 겹괄호("(ICC) (*제주특별자치도 …224(중문동))")까지 안쪽부터 걷는다
  for (let prev = ''; prev !== v; ) { prev = v; v = v.replace(/\s*\([^()]*\)/g, ' ') }
  v = v.replace(/\s*\([^)]*$/, ' ').trim()
  if (!v) return ''
  // 주소 + 기관명이 함께 온 경우("부산 해운대구 …298번길 24, 팔레드시즈")는 쉼표 뒤 이름이 검색어다
  const tail = v.split(',').map(x => x.trim()).filter(Boolean).pop()
  if (/\d/.test(v.split(',')[0] || '') && tail && !/\d/.test(tail) && tail.length >= 2) v = tail
  const cut = v.search(VENUE_DETAIL_HEAD)
  if (cut > 1) v = v.slice(0, cut)
  const words = v.split(/\s+/).filter(Boolean)
  while (words.length > 1 && (VENUE_DETAIL_WORD.test(words[words.length - 1])
    || /^[가-힣A-Za-z0-9-]{2,}(?:홀|룸|강당|Ballroom|Hall|Room)$/.test(words[words.length - 1])
    || /^[A-Za-z]{1,3}$/.test(words[words.length - 1]))) words.pop()   // 'T-아트홀', OCR 찌꺼기 'oh'
  v = words.join(' ').replace(/[,·\-–|]+$/, '').trim()
  return v.length >= 2 ? v : String(venue || '').trim()
}

function renderParseResult(filename, meta, hasText) {
  const grid = document.getElementById('resultGrid')
  const resultEl = document.getElementById('parseResult')

  // 못 읽은 칸은 추측으로 채우지 않고 모른다고 말한다 — 다음 화면에서 직접 넣어야 한다
  const fmt = v => v ? `<span>${escapeHtml(String(v))}</span>` : `<span class="empty">확인 안 됨 — 직접 입력</span>`
  // 확신도 낮은 값 — 다음 화면에서 바로 채우지 않고 '넣기'로 확인받는다
  const lowTag = k => (meta.confidence || {})[k] === 'low' ? '<span class="low-tag">확인 필요</span>' : ''
  const feeStr = meta.registration ? `${meta.registration.toLocaleString()}원` : ''

  let warnHtml = ''
  // 출장·교육 공문이 아니면(영수증·매출전표 등) 읽은 척하지 않는다
  if (hasText && meta.docKind === 'trip-form') {
    warnHtml += `
      <div class="result-warn full">
        <span>❌</span>
        <div>
          <strong>출장신청서예요 — 공문이 아니에요</strong>
          <p>기안일이 출장일로 잘못 들어가지 않게 아무것도 채우지 않았어요.<br>행사 공문(안내문)을 올리시거나, 다음 단계에서 직접 입력해주세요.</p>
        </div>
      </div>`
  } else if (hasText && meta.isTripDoc === false) {
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

  // 연도를 늘 붙인다 — 작년 공문을 올해로 읽어도 사용자가 알아챌 수 있게
  const periodStr = periodWithYear(meta)

  // 지역은 읽었지만 건물·기관명(장소)은 못 읽는 공문이 많다.
  // 예전에는 그걸 "장소"로 보여줘 다음 화면에서 "출장 지역" 오류로 막혔다.
  if (meta.multiSession) {
    warnHtml += `
      <div class="result-warn full">
        <span>⚠️</span>
        <div>
          <strong>1차·2차처럼 차수가 나뉜 공문이에요</strong>
          <p>1차 날짜·장소로 채웠어요. 다른 차수에 가셨다면 다음 화면에서 날짜와 장소를 고쳐주세요.</p>
        </div>
      </div>`
  }
  // 연도 추정 경고는 싣지 않는다 — 연도를 화면에 내보이지 않으므로 알릴 것도 없다(2026-09-30). 지난 날짜면 날짜 칸 경고가 따로 뜬다.
  const venueHtml = meta.venue
    ? `<div class="result-item full"><label>장소</label><span>${escapeHtml(meta.venue)}</span></div>`
    : `<div class="result-item full"><label>장소</label><span class="empty">확인 안 됨 — 직접 입력</span></div>`

  grid.innerHTML = `
    <div class="result-item full"><label>파일명</label><span>${escapeHtml(filename)}</span></div>
    <div class="result-item full"><label>출장/교육명</label>${fmt(meta.title)}${lowTag('title')}</div>
    <div class="result-item"><label>기간</label>${fmt(periodStr)}${lowTag('date')}</div>
    <div class="result-item"><label>지역</label>${fmt(meta.destination)}${lowTag('dest')}</div>
    <div class="result-item"><label>첫날 시작시각</label>${fmt(meta.startTime)}${lowTag('time')}</div>
    <div class="result-item"><label>교육 형태</label><span>${meta.isOnline ? '온라인' : '오프라인'}</span></div>
    ${venueHtml}
    <div class="result-item full"><label>등록비 (회원·사전납입 기준)</label>${fmt(feeStr)}${lowTag('fee')}</div>
    ${warnHtml}
  `
  resultEl.classList.remove('hidden')
  // 결과가 업로드 상자 아래 화면 밖에 뜬다 — 읽은 내용을 바로 보이게 올린다
  requestAnimationFrame(() => resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' }))
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

  // 교육 시각은 KTX 역산과 8시간 일당 판정에만 쓰인다. 온라인 교육은 둘 다 하지
  // 않으므로(prepareCard9·dailyAllowance가 isOnline에서 바로 빠진다) 입력칸째 숨긴다.
  // 값은 지우지 않는다 — 오프라인으로 되돌렸을 때 공문에서 읽어 둔 시각이 사라지면
  // KTX 역산이 통째로 빠진다(2026-09-26 ui_sweep에서 실제로 잡힌 회귀).
  const fieldTime = document.getElementById('field-time')
  if (fieldTime) fieldTime.classList.toggle('hidden', isOnline)

  // 기차 역산 안내는 탈 기차를 추천할 때만 의미가 있다 — 온라인 교육과
  // 이미 다녀온 출장에서는 숨긴다(다녀온 출장은 routePanel도 추천을 빼고 그린다).
  document.getElementById('time-ktx-hint')?.classList.toggle('hidden', isOnline)
  renderPrevDayVerdict()

  // 온라인이면 "출장"이 아니라 "교육"이다 — 라벨·자리표시를 맞춘다
  const labelTitle  = document.getElementById('label-title')
  const labelPeriod = document.getElementById('label-period')
  if (labelTitle)  labelTitle.textContent  = isOnline ? '교육명' : '출장 / 교육명'
  if (labelPeriod) labelPeriod.textContent = isOnline ? '교육 기간' : '출장 기간'

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
// ── CARD 4: 출장 정보 확인 ────────────────────────────────────────────────────
// 새 공문을 올리면 그 공문 기준으로 칸을 전부 다시 채운다. 공문에 없는 칸은 비운다 —
// 예전에는 '값이 없을 때만' 채워서, 먼저 입력한 장소(강북삼성병원)·시각(12:10)이나 앞서 올린
// 공문의 13:00이 그대로 남아 이번 공문의 값처럼 보였다(2026-09-26 지석초이 제보).
// 같은 공문으로 카드4에 다시 들어올 때는 사용자가 고친 값을 지키려고 한 번만 적용한다.
function setDocField(id, value) {
  const el = document.getElementById(id)
  if (!el) return
  el.value = value || ''
  if (id === 'input-fee') sizeFeeInput(el)
  el.classList.toggle('input-autofilled', !!value)
  if (value) el.addEventListener('input', () => el.classList.remove('input-autofilled'), { once: true })
}

// 시작시각은 필수다. 공문에서 못 읽었으면 모른다고 말하고 직접 고르게 한다.
const TIME_HINT_DEFAULT = '등록·오리엔테이션이 먼저 있으면 그 시각으로 골라 주세요.'
function renderTimeHint(meta) {
  const el = document.getElementById('time-ktx-hint')
  if (!el) return
  const missing = !!meta && !meta.startTime
  // 선택지(~18:30) 밖의 늦은 시각은 칸이 빈다 — 읽었다고만 하면 틀린 안내다
  const late = !!meta?.startTime && snapTo10(meta.startTime) > LATEST_START
  el.textContent = missing
    ? '⚠️ 공문에서 시작시각을 찾지 못했어요. 첫날 교육(등록) 시작시각을 직접 골라 주세요.'
    : late ? `⚠️ 공문 시작시각은 ${meta.startTime}인데 선택지는 ${LATEST_START}까지예요. ${LATEST_START}을 골라 주세요 — 그 뒤 시작은 모두 당일 이동이라 정산은 같아요.`
    : meta ? `📄 공문에서 읽은 시각이에요. ${TIME_HINT_DEFAULT}` : TIME_HINT_DEFAULT
  el.classList.toggle('is-warn', missing || late)
}

// 공문에서 읽은 장소는 글자뿐이라 좌표가 없다. 좌표가 없으면 역산이 '지역 대표역' 기준이 돼
// 현장까지 이동시간이 근거 없는 값이 됐다(서울역→서울역). 카카오 장소 검색으로 좌표를 찾아 둔다.
// 이름 → 괄호 안 주소 → 전체 순으로 찾고, 찾은 곳은 화면에 밝혀 사람이 확인하게 한다.
// 찾은 곳 이름이 공문 장소와 실제로 겹치는지 — 지역만 맞으면 엉뚱한 곳이 통과했다("부산-부산교육원" → 부산가톨릭대 음악교육원).
// 지역명과 흔한 꼬리말(병원·대학교·교육원·호텔·센터…)을 떼고 남은 고유 이름이 한쪽에 들어 있어야 같은 곳으로 본다.
const PLACE_GENERIC = /(?:대학교병원|대학병원|종합병원|병원|의료원|대학교|대학|학교|교육원|연수원|연구원|센터|호텔|리조트|회관|빌딩|타워|아카데미|캠퍼스|본관|별관)$/
const PLACE_REGION_WORDS = new Set(['서울', '부산', '대구', '동대구', '대전', '울산', '인천', '광주', '제주', '수원', '창원', '마산', '진주', '전주', '경주', '천안', '오송', '여수', '순천', '목포', '광양', '경기', '경남', '경북', '충남', '충북', '전남', '전북', '강원'])
function placeCore(word) {
  let w = String(word || '').replace(/[()（）\[\]「」『』·,.:]/g, '')
  for (let prev = ''; prev !== w; ) {
    prev = w
    w = w.replace(PLACE_GENERIC, '')
    for (const r of PLACE_REGION_WORDS) if (w.length > r.length && w.endsWith(r)) w = w.slice(0, -r.length)
  }
  return PLACE_REGION_WORDS.has(w) ? '' : w
}
function sameNamedPlace(query, placeName) {
  const squeeze = x => String(x || '').replace(/\s+/g, '').toLowerCase()
  const place = squeeze(placeName), q = squeeze(query)
  const words = String(query || '').split(/[\s\-–]+/).filter(Boolean)
  const cores = words.map(placeCore).filter(c => c.length >= 2)
  if (cores.some(c => place.includes(c.toLowerCase()))) return true
  // 영문 이름(CFO·The UniverSE)은 한글 표기와 글자가 달라 고유 이름 대조가 안 된다 — 영문 낱말 그대로, 아니면 꼬리말까지 겹치면 인정
  if (words.some(w => /^[A-Za-z]{3,}$/.test(w) && place.includes(w.toLowerCase()))) return true
  if (words.some(w => /[A-Za-z]/.test(w)) && words.some(w => w.length >= 3 && place.includes(squeeze(w)))) return true
  // 결과 쪽 고유 이름이 공문 장소 안에 있으면 같은 곳("세브란스병원" ⊂ "신촌세브란스병원")
  const placeCores = String(placeName || '').split(/\s+/).map(placeCore).filter(c => c.length >= 2)
  return placeCores.some(c => q.includes(c.toLowerCase()))
}

async function geocodeDocVenue(venue, rawVenue = venue, meta = null) {
  // 2026-09-29 장소 전수 점검: 이름에 강의실·홀이 붙으면 0건, 이름이 깨지면 엉뚱한 지역의 같은 이름(코칭 과정 → 부산 해운대 가게,
  // 삼성전자 연수원 → 충남 서천)이 잡혔다. ① 공문 지역과 주소가 맞는 결과만 쓰고 ② 안 맞으면 '지역 + 이름'으로 다시,
  // ③ 0건이면 뒤 낱말을 하나씩 떼며 다시 찾고 ④ 그래도 없으면 본문 '주소:'로 찾는다. 끝내 못 찾으면 좌표를 쓰지 않는다.
  const note = document.getElementById('place-geo-note')
  if (note) { note.textContent = ''; note.classList.add('hidden'); note.classList.remove('is-warn') }
  document.getElementById('field-place')?.classList.remove('place-needs-pick')
  state.placeNeedsPick = false
  if (meta && !venue && !meta.isOnline && !meta.isJeju && meta.destination !== '제주') { showPlaceNeedsPick('공문에서 교육 장소를 찾지 못했어요.'); return }
  if (!venue || !KAKAO_API_KEY) return
  if (meta?.isOnline || /^온\s*라\s*인/.test(venue)) return   // 온라인 교육은 찾을 곳이 없다('서울온라인학교'가 잡혔다)
  // 지역 칸이 비었으면(본문 추정이라 확인 대기) 본문 '주소:'가 가리키는 지역으로 대조한다 — 삼성전자 메일 '(서천연수원)'이 충남 서천으로 잡혔다
  const region = (document.getElementById('input-region')?.value || state.region || '').trim()
    || (meta?.address ? guessRegionFromAddress(meta.address) : '')
  const inParen = (rawVenue.match(/\(([^)]+)\)/) || [])[1] || ''
  const base = [venue, venueSearchName(rawVenue), rawVenue.replace(/\s*\(.*$/, ''), inParen]
  const words = venue.split(/\s+/)
  for (let n = words.length - 1; n >= 1; n--) {
    const cut = words.slice(0, n).join(' ')
    if (cut.replace(/\s/g, '').length >= 4) base.push(cut)   // 'The' 같은 한 낱말만 남으면 아무 곳이나 잡힌다
  }
  const queries = [...base, ...(region ? base.map(q => `${region} ${q}`) : [])]
    .map(q => String(q || '').trim()).filter((q, i, a) => q.replace(/\s/g, '').length >= 3 && a.indexOf(q) === i)
  const regionOf = d => regionFromKakaoAddress(d.road_address_name || d.address_name || '')
  // 지역을 알면 주소가 그 지역인 결과만 받는다 — 주소로 지역을 못 가르는 곳(충남 서천, 전남 신안)도 '모름'이 아니라 불일치다
  const fits = d => !region || regionOf(d) === region
  const search = async (url) => {
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` } })
    return (await res.json()).documents || []
  }
  let hit = null, misfit = null
  // 판독이 깨진 이름('The 0006『56 미담당자반 :')으로는 같은 주소의 ATM·충전소 같은 곳이 잡힌다 — 본문 주소가 있으면 그것부터
  const garbled = /[『』{}]|[A-Za-z]*\d{4}[A-Za-z『]|:\s*$/.test(venue)
  const byAddress = async () => {
    if (!meta?.address) return null
    const d = (await search(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(meta.address)}&size=1`))[0]
    return d && fits(d) ? { ...d, place_name: meta.address, road_address_name: d.road_address?.address_name || d.address_name, viaAddress: true } : null
  }
  try {
    if (garbled) hit = await byAddress()
    for (const q of hit ? [] : queries) {
      const docs = await search(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=5`)
      if (state.place !== venue) return  // 그사이 사용자가 장소를 바꿨다
      // 주차장·충전소·정류장 같은 부속 지점은 건물 자체가 아니다(삼성전자 연수원 → '…전기차충전소'가 잡혔다)
      hit = docs.find(d => fits(d) && sameNamedPlace(q, d.place_name) && !/(?:주차장|충전소|정류장|ATM|출입구|화장실|흡연)\s*$/.test(d.place_name))
      if (hit) break
      misfit ||= docs[0] || null
    }
    if (!hit && !garbled) hit = await byAddress()
  } catch (e) {
    console.warn('공문 장소 좌표 검색 실패:', e)
    return
  }
  if (state.place !== venue) return
  if (!hit) {
    // 확신 없는 곳을 넣지 않는다 — 좌표를 비워 두고 직접 검색해 고르라고 분명히 말한다(2026-09-29 지석초이)
    showPlaceNeedsPick(`'${venue}'을(를) 지도에서 확실히 찾지 못했어요${misfit ? ` (비슷한 결과: ${misfit.place_name} · ${misfit.road_address_name || misfit.address_name || ''})` : ''}.`)
    return
  }
  // 판독이 깨진 장소 이름 대신 본문 주소로 찾았으면 장소 칸도 그 주소로 바꾼다 — 'The 0006『56 미담당자반'이 그대로 남았다
  if (hit.viaAddress || garbled) {
    const placeEl = document.getElementById('input-place')
    const shown = hit.viaAddress ? meta.address : hit.place_name
    if (placeEl) { placeEl.value = shown; state.place = shown }
  }
  state.placeLat = Number(hit.y) || null
  state.placeLon = Number(hit.x) || null
  state.transitAccess = {}
  // 지역 칸이 비어 있으면(본문 추정이라 '넣기' 대기 중이던 경우 포함) 찾은 곳의 주소로 채운다 — 장소 줄에서 나온 근거라 믿을 만하다
  const found = regionOf(hit)
  const regionEl = document.getElementById('input-region')
  if (found && regionEl && !regionEl.value.trim()) {
    regionEl.value = found
    onRegionInput()
    document.getElementById('regionSuggest')?.classList.add('hidden')
    document.querySelectorAll('#field-region .doc-suggest').forEach(el => el.remove())
    clearCard4Error('input-region')
  }
  document.getElementById('field-place')?.classList.remove('place-needs-pick')
  if (note) {
    note.classList.remove('is-warn')
    note.textContent = `📍 카카오 지도 위치: ${hit.place_name} · ${hit.road_address_name || hit.address_name || ''} — 다르면 장소를 다시 검색해 고르세요.`
    note.classList.remove('hidden')
  }
  renderPrevDayVerdict()
}

// 장소를 못 정했을 때 — 장소 칸을 강조하고 이유와 할 일을 적는다. 여정표도 같은 말을 한다(renderRoutePanel/manualPick).
function showPlaceNeedsPick(reason) {
  const note = document.getElementById('place-geo-note')
  document.getElementById('field-place')?.classList.add('place-needs-pick')
  state.placeNeedsPick = true
  if (note) {
    note.textContent = `⚠️ ${reason} 위 장소 칸에 기관·건물 이름을 입력하고 검색 목록에서 골라 주세요 — 골라야 여정표에 현장까지 걸리는 시간이 나와요.`
    note.classList.add('is-warn')
    note.classList.remove('hidden')
  }
  renderPrevDayVerdict()
}

function resetFeePresence() {
  state.hasFee = null
  state.fee = 0
  state.feeStatus = null
  document.getElementById('feeBtn-yes')?.classList.remove('selected-yes')
  document.getElementById('feeBtn-no')?.classList.remove('selected-no')
  document.getElementById('feeAmountWrap')?.classList.add('hidden')
  document.getElementById('feeNoneMsg')?.classList.add('hidden')
  setDocField('input-fee', '')
  document.getElementById('fee-subhint').textContent = '사전납입 · 회원병원 기준 금액으로 입력해주세요'
}

function prepareCard4WithMeta() {
  const meta = state.parsedMeta
  if (!meta || state.appliedMeta === meta) return
  state.appliedMeta = meta

  setDocField('input-title', meta.title)
  setDocField('input-start', meta.startDate)
  setDocField('input-end', meta.endDate)
  onDateChange()
  setDocField('input-region', meta.destination)
  onRegionInput()
  document.getElementById('regionSuggest')?.classList.add('hidden')
  // 장소 칸에는 검색되는 이름만 넣는다 — 층·강의실까지 넣으면 카카오 검색이 아무것도 못 찾아
  // 좌표가 비고, 역→현장 이동시간·경로 링크가 통째로 사라진다(2026-09-29 지석초이)
  const venueName = meta.venueSearch || meta.venue
  setDocField('input-place', venueName)
  state.place = venueName || ''
  state.placeLat = null
  state.placeLon = null
  state.accessOverride = {}
  state.pinStation = null
  state.transitAccess = {}
  setStartTime(meta.startTime ? snapTo10(meta.startTime) : '', !!meta.startTime)
  renderTimeHint(meta)
  geocodeDocVenue(venueName, meta.venue, meta)
  if (meta.registration) {
    setDocField('input-fee', meta.registration.toLocaleString())
    state.fee = meta.registration
    // 금액을 인식했으면 "있어요"까지 미리 골라 둔다
    selectFeePresence(true)
  } else {
    resetFeePresence()
  }

  // 확인 뷰 메시지
  if (meta.periodDisplay && meta.days) {
    const durStr = meta.nights === 0 ? `${meta.days}일 (당일치기)` : `${meta.nights}박 ${meta.days}일`
    // 기간 / "N박 M일 출장이시군요!"를 두 줄로 — 어중간한 곳에서 줄이 꺾이지 않게 각 줄을 한 덩어리로 둔다
    const msg = document.getElementById('c4-period-msg')
    msg.textContent = ''
    for (const t of [periodWithYear(meta), `${durStr} 출장이시군요!`]) {
      const line = document.createElement('span')
      line.className = 'period-line'
      line.textContent = t
      msg.appendChild(line)
    }
  }
  if (meta.destination) {
    document.getElementById('c4-place-msg').textContent = `지역: ${meta.destination}`
  }

  // 금액은 이미 채우고 '있어요'까지 골랐다 — 다시 묻지 않고 근거만 금액 아래에 적는다
  if (meta.registration) {
    const basis = (meta.registrationNote || '사전납입·회원병원 기준 금액이에요').replace(/\s*맞나요\?\s*$/, '')
    document.getElementById('fee-subhint').textContent = `📄 공문에서 읽은 금액 · ${basis.replace(/\.?$/, '.')} 다르면 고쳐 주세요.`
  }

  // 온라인/오프라인 자동 설정 (공문 제목에 "온라인" 있으면 온라인, 없으면 오프라인)
  selectOnlineMode(meta.isOnline === true)
  holdLowConfidence(meta)

  document.getElementById('c4-confirm-view').classList.remove('hidden')
  document.getElementById('c4-input-view').classList.add('hidden')
}

// 확신도 낮은 칸은 비워 두고 '📄 공문 추정: 값 — 넣기'로 한 번 확인받는다(2026-09-29 오탐 줄이기).
// 틀린 값이 조용히 들어가는 것보다, 한 번 누르게 하는 편이 정산 사고를 막는다.
function holdLowConfidence(meta) {
  document.querySelectorAll('#card-4 .doc-suggest').forEach(el => el.remove())
  const conf = meta.confidence || {}
  const why = k => (meta.checks || []).filter(c => c.field === k).map(c => c.why)[0]
    || (k === 'dest' ? '장소 줄이 아니라 본문에서 찾은 지역이에요' : '라벨 없이 문서에서 찾은 값이에요')
  const offer = (anchor, label, apply, k) => {
    if (!anchor) return
    const box = document.createElement('div')
    box.className = 'doc-suggest'
    box.innerHTML = `<span>📄 공문 추정: <b>${escapeHtml(label)}</b></span><button type="button" class="doc-suggest-btn">넣기</button><span class="doc-suggest-why">${escapeHtml(why(k))} — 맞으면 넣어 주세요</span>`
    box.querySelector('button').addEventListener('click', () => { apply(); box.remove() })
    anchor.appendChild(box)
  }
  if (conf.date === 'low' && meta.startDate) {
    setDocField('input-start', ''); setDocField('input-end', ''); onDateChange()
    document.getElementById('duration-tag')?.classList.add('hidden')   // 날짜를 비웠는데 '1일 (당일)'이 남아 있었다
    document.getElementById('c4-period-msg').textContent = '출장 정보를 확인해 주세요'
    offer(document.getElementById('input-start')?.closest('.info-field'), periodWithYear(meta), () => {
      setDocField('input-start', meta.startDate); setDocField('input-end', meta.endDate); onDateChange()
    }, 'date')
  }
  // 제목은 정산 금액에 영향이 없어 비우지 않고, 칸 아래에 확인 문구만 단다
  document.getElementById('title-check-note')?.remove()
  if (conf.title === 'low' && meta.title) {
    const note = document.createElement('div')
    note.id = 'title-check-note'
    note.className = 'doc-suggest-why title-check-note'
    note.textContent = `⚠️ ${why('title')} — 공문과 맞는지 확인해 고쳐 주세요`
    document.getElementById('input-title')?.insertAdjacentElement('afterend', note)
  }
  if (conf.time === 'low' && meta.startTime) {
    setStartTime('', false); renderTimeHint(null)
    offer(document.getElementById('field-time'), meta.startTime, () => setStartTime(snapTo10(meta.startTime), true), 'time')
  }
  if (conf.dest === 'low' && meta.destination) {
    setDocField('input-region', ''); onRegionInput(); document.getElementById('regionSuggest')?.classList.add('hidden')
    document.getElementById('c4-place-msg').textContent = ''
    offer(document.getElementById('field-region'), meta.destination, () => {
      setDocField('input-region', meta.destination); onRegionInput(); document.getElementById('regionSuggest')?.classList.add('hidden')
    }, 'dest')
  }
  if (conf.fee === 'low' && meta.registration) {
    setDocField('input-fee', ''); state.fee = 0; resetFeePresence()
    document.getElementById('fee-subhint').textContent = '사전납입 · 회원병원 기준 금액으로 입력해주세요'
    offer(document.getElementById('field-fee'), `${meta.registration.toLocaleString()}원`, () => {
      selectFeePresence(true); setDocField('input-fee', meta.registration.toLocaleString()); state.fee = meta.registration
      document.getElementById('fee-subhint').textContent = `📄 공문에서 읽은 금액 · ${(meta.registrationNote || '사전납입·회원병원 기준 금액이에요').replace(/\s*맞나요\?\s*$/, '')} 다르면 고쳐 주세요.`
    }, 'fee')
  }
}

function showCard4InputMode() {
  document.getElementById('c4-confirm-view').classList.add('hidden')
  document.getElementById('c4-input-view').classList.remove('hidden')
  document.getElementById('fee-subhint').textContent = '사전납입 · 회원병원 기준 금액으로 입력해주세요'
  renderTimeHint(null)
  // 직접 입력 시 기본값: 오프라인
  selectOnlineMode(false)
}

// 데스크톱 크롬은 날짜 칸 본문을 눌러도 달력을 열지 않는다(투명 입력이라 아무 일도 없어 보였다).
// 클릭은 그대로 네이티브 입력이 받고, 되는 브라우저에서만 달력을 추가로 연다 — 사파리는 조용히 무시한다.
function openDatePicker(el) {
  try { el.showPicker?.() } catch { /* 이미 열려 있거나 미지원 */ }
}

function periodWithYear(meta) {
  if (!meta.periodDisplay) return ''
  // 공문에 연도가 없으면 추정한 연도를 내보이지 않고 월·일만 쓴다(2026-09-30 지석초이 "연도가 파악 안 되면 생략").
  // 날짜 칸은 달력 값이라 내부적으로는 연도가 필요해 요일이 맞는 해를 그대로 넣어 둔다.
  if (meta.yearGuessed) return meta.periodDisplay
  const year = (meta.startDate || '').slice(0, 4)
  return year ? `${year}년 ${meta.periodDisplay}` : meta.periodDisplay
}

const LONG_TRIP_NIGHTS = 7

// 막지는 않고 알리기만 한다 — 신청기간을 교육기간으로 읽었거나 연도가 어긋난 경우를 잡는다
function renderDateWarn() {
  const el = document.getElementById('date-warn')
  if (!el) return
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  let msg = ''
  if (state.startDate && state.endDate && state.nights >= LONG_TRIP_NIGHTS) {
    msg = `${state.nights}박으로 길어요. 신청·접수 기간을 교육 기간으로 읽었을 수 있으니 공문의 교육 일시를 확인해 주세요.`
  } else if (state.tripStatus === 'planned' && state.startDate && state.startDate < today) {
    msg = '갈 예정인 출장인데 시작일이 이미 지났어요. 연도와 날짜를 확인해 주세요.'
  } else if (state.tripStatus === 'done' && state.startDate && state.startDate > today) {
    msg = '다녀온 출장인데 시작일이 아직 오지 않았어요. 연도와 날짜를 확인해 주세요.'
  }
  el.textContent = msg
  el.classList.toggle('hidden', !msg)
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
  renderPrevDayVerdict()

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
  renderDateWarn()
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
  '서울', '수원', '오송', '대전', '동대구', '경주', '울산', '부산',
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
  state.transitAccess = {}
  document.getElementById('place-geo-note')?.classList.add('hidden')
  guessRegionFromPlaceText(val)
  renderPrevDayVerdict()

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
  // 사람이 검색 목록에서 고른 곳이면 '장소 확인 필요' 경고를 거둔다
  state.placeNeedsPick = false
  document.getElementById('field-place')?.classList.remove('place-needs-pick')
  document.getElementById('place-geo-note')?.classList.remove('is-warn')
  document.getElementById('input-place').value = name
  document.getElementById('placeSuggest').classList.add('hidden')
  state.place = name
  state.placeLat = Number(lat) || null
  state.placeLon = Number(lon) || null
  state.transitAccess = {}
  // 주소에서 지역 자동 채우기 (장소 선택 시 항상 덮어씀)
  if (addr) {
    const regionGuess = guessRegionFromAddress(addr)
    if (regionGuess) {
      document.getElementById('input-region').value = regionGuess
      state.region  = regionGuess
      state.regionFromPlace = false   // 검색 목록에서 고른 주소 기준 — 글자 추측으로 다시 덮지 않는다
      state.isJeju  = regionGuess.includes('제주')
      state.isSeoul = regionGuess.includes('서울')
      document.getElementById('jeju-hint').classList.toggle('hidden', !state.isJeju)
      document.getElementById('regionSuggest').classList.add('hidden')
    }
  }
  clearCard4Error('input-region')
  updateDocStrip()
  renderPrevDayVerdict()
}

// 주소 문자열에서 운임표 기준 지역명 추출
// 카카오 주소는 늘 시·도로 시작한다("부산 해운대구 …"). 예전엔 주소 전체에서 낱말을 찾아 '해운대구'의 '대구'를
// 동대구로 읽었다(2026-09-29 장소 전수 점검: 팔레드시즈·웨스틴조선 부산이 '지역 불일치'로 버려짐). 시·도 → 시·군 순으로 가른다.
const PROVINCE_REGION = {
  서울: '서울', 서울특별시: '서울', 인천: '서울', 인천광역시: '서울', 부산: '부산', 부산광역시: '부산',
  대구: '동대구', 대구광역시: '동대구', 대전: '대전', 대전광역시: '대전', 울산: '울산', 울산광역시: '울산',
  세종: '오송', 세종특별자치시: '오송', 제주: '제주', 제주특별자치도: '제주',
}
const CITY_REGION = [['수원', '수원'], ['용인', '수원'], ['기흥', '수원'], ['천안', '천안'], ['아산', '천안'], ['청주', '오송'],
  ['경주', '경주'], ['전주', '전주'], ['광양', '광양'], ['순천', '순천'], ['여수', '여수'], ['목포', '목포'],
  ['창원', '창원'], ['마산', '창원'], ['진해', '창원'], ['진주', '진주']]
function regionFromKakaoAddress(addr) {
  const [prov, city = ''] = String(addr || '').trim().split(/\s+/)
  if (PROVINCE_REGION[prov]) return PROVINCE_REGION[prov]
  const hit = CITY_REGION.find(([k]) => city.startsWith(k))
  if (hit) return hit[1]
  if (/^경기/.test(prov || '')) return '서울'   // 수원·용인 밖 경기는 서울역 기준
  return ''
}

function guessRegionFromAddress(addr) {
  const byProvince = regionFromKakaoAddress(addr)
  if (byProvince) return byProvince
  const pairs = [
    // 수도권 — 수원·용인·기흥은 수원역 운임표, 나머지 경기·인천은 서울 기준
    ['수원', '수원'], ['용인', '수원'], ['기흥', '수원'],
    ['서울', '서울'], ['경기', '서울'], ['인천', '서울'],
    // 제주
    ['제주', '제주'],
    // KTX 목적지
    ['대전', '대전'], ['오송', '오송'], ['천안', '천안'],
    ['울산', '울산'], ['경주', '경주'],
    ['대구', '동대구'],
    // 시외버스 목적지
    ['부산', '부산'], ['전주', '전주'],
    ['광양', '광양'], ['순천', '순천'], ['여수', '여수'], ['목포', '목포'],
    // 인근 지역
    ['창원', '창원'], ['진주', '진주'],
  ]
  for (const [keyword, region] of pairs) {
    if (addr.includes(keyword)) return region
  }
  return ''
}

// 장소 글자에 지역이 드러나면("부산 벡스코", "삼성창원병원") 지역 칸을 바로 채운다(2026-09-29 사용자 관점 점검 —
// 장소를 쳐 놓고 지역을 또 쳐야 했다. 검색 목록을 눌러야만 지역이 채워졌다). 공문 판독과 같은 규칙(matchRegionInVenue)을 쓰고,
// 지역 칸이 비었거나 앞서 이렇게 자동으로 채운 경우에만 바꾼다 — 사람이 직접 친 지역은 덮어쓰지 않는다.
function guessRegionFromPlaceText(place) {
  const el = document.getElementById('input-region')
  if (!el || (el.value.trim() && !state.regionFromPlace)) return
  const guess = matchRegionInVenue(place)
  if (!guess || guess === el.value.trim()) return
  el.value = guess
  onRegionInput()
  state.regionFromPlace = true
  document.getElementById('regionSuggest')?.classList.add('hidden')
  clearCard4Error('input-region')
}

function onRegionInput() {
  const val = document.getElementById('input-region').value.trim()
  state.regionFromPlace = false
  state.region  = val
  state.isJeju  = val.includes('제주')
  state.isSeoul = val.includes('서울') || val.includes('여의도')

  document.getElementById('jeju-hint').classList.toggle('hidden', !state.isJeju)
  updateDocStrip()
  renderPrevDayVerdict()

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
  state.regionFromPlace = false
  document.getElementById('regionSuggest').classList.add('hidden')
  state.region  = region
  state.isJeju  = region.includes('제주')
  state.isSeoul = region.includes('서울') || region.includes('여의도')
  document.getElementById('jeju-hint').classList.toggle('hidden', !state.isJeju)
  clearCard4Error('input-region')
  updateDocStrip()
  renderPrevDayVerdict()
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
    if (feeEl) { feeEl.value = ''; sizeFeeInput(feeEl) }
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
  sizeFeeInput(input)
}

// 금액 칸을 숫자 길이만큼만 넓혀 '원'을 숫자 바로 뒤에 붙인다(2026-09-29 지석초이 — 칸 끝의 '원'이 숫자와 너무 떨어져 있었다)
function sizeFeeInput(input = document.getElementById('input-fee')) {
  if (!input) return
  const len = Math.max(2, (input.value || input.placeholder || '').length)
  input.style.width = `calc(${len}ch + 4px)`
}

// ── CARD 6: 등록비 납부 (납부 여부 + 납부 형태 통합) ────────────────────────
// 예전에는 "납부했나요"(Card 6) → "어떻게 납부했나요"(Card 7)로 갈라 두 화면에서
// 선택지를 두 개씩만 물었다. 같은 주제를 두 번 넘기게 되어 한 화면으로 합쳤다.
// 등록비 납부: 주의사항(안내 상자)은 중요하니 넓은 화면에선 선택지 옆 칸에 모아 보인다(2026-10-01 지석초이).
// 원래 자리의 상자는 넓은 화면에서만 CSS로 숨기고, 여기엔 지금 보이는 상자를 복제해 싣는다.
function renderC6Aside() {
  const aside = document.getElementById('c6-aside')
  if (!aside) return
  const shown = el => { for (let n = el; n && n.id !== 'card-6'; n = n.parentElement) if (n.classList?.contains('hidden')) return false; return true }
  const notes = [...document.querySelectorAll('#card-6 .card-body > .c7-sub .c7-note-box, #card-6 .card-body > .c7-sub .c7-reference')].filter(shown)
  aside.innerHTML = notes.length ? `<div class="c6-aside-title">⚠️ 꼭 확인하세요</div>` + notes.map(n => n.outerHTML).join('') : ''
  aside.classList.toggle('hidden', !notes.length)
}

function resetCard6() {
  ;['c6-card-note', 'c6-bank-opts']
    .forEach(id => document.getElementById(id)?.classList.add('hidden'))
  ;['c6-btn-card', 'c6-btn-bank']
    .forEach(id => document.getElementById(id)?.classList.remove('selected'))
  const q = document.getElementById('card6-q')
  // 2026-10-01 지석초이: 갈 예정(계획 단계)이니 '이미 냈나요'가 아니라 '어떻게 낼 건가요'로 묻는다
  if (q) q.innerHTML = state.tripStatus === 'done'
    ? '교육비 / 등록비를<br>어떻게 납부하셨나요?'
    : '교육비 / 등록비는<br>어떻게 내실 건가요?'
  renderC6Aside()
}

function select6Method(method) {
  state.feeStatus   = 'paid'
  state.receiptType = null
  ;['card', 'bank'].forEach(m =>
    document.getElementById(`c6-btn-${m}`)?.classList.toggle('selected', m === method))
  document.getElementById('c6-card-note')?.classList.toggle('hidden', method !== 'card')
  document.getElementById('c6-bank-opts')?.classList.toggle('hidden', method !== 'bank')
  updateDocStrip()
  const panelId = method === 'card' ? 'c6-card-note' : 'c6-bank-opts'
  document.getElementById(panelId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  renderC6Aside()
}

function select6Receipt(val) {
  state.feeStatus   = 'paid'
  state.receiptType = val
  updateDocStrip()
  setTimeout(() => state.isOnline ? goToCard(9) : goToCard(8), 150)
}

// ── 전날 이동 판정 ───────────────────────────────────────────────────────────
// 기준은 하나다: 교육 시작에 닿으려면 정상 출근시각(08:30)보다 먼저 마산역을 떠나야
// 하는가. 예전 기준이던 '서울 + 12시 이전 시작'은 이 판정의 옛 근사치라 버렸다
// (2026-09-25 지석초이 승인). 역산이 되는 구간은 앱이 자동으로 답을 정한다.
const WORK_START_MIN = 8 * 60 + 30

// 역산으로 답이 정해지는지 한 곳에서 판정한다. 카드4 즉시 판정·카드8 질문 여부·카드9 근거가
// 모두 이 결과를 쓴다. auto 가 true 면 사람에게 묻지 않는다(2026-09-26 지석초이 승인) —
// 판정이 실제와 다르면 예/아니요를 뒤집는 대신 시작시각(등록 시각 등)을 고친다.
function judgePrevDayMove() {
  if (state.isOnline) return { auto: true, move: false, kind: 'na' }
  // 제주는 항공편이라 기차 역산을 하지 않는다 — 전날 이동 여부는 사람에게 묻는다
  if (state.isJeju) return { auto: false, kind: 'jeju' }
  const r = computeRoutePlan()
  if (!r) return { auto: false, kind: 'unknown' }
  if (r.skip === 'notime') return { auto: false, kind: 'notime' }
  // 시외버스 구간은 집에서 오가는 거리라 전날 이동을 인정하지 않는다(2026-09-26 지석초이)
  if (r.skip === 'bus' || r.skip === 'busonly') return { auto: true, move: false, kind: 'bus' }
  if (r.skip === 'needmanual') return { auto: false, kind: 'noplace' }
  // 창원 시내는 병원에서 시내버스로 가는 거리라 전날 이동이 없다
  if (r.skip === 'citybus') return { auto: true, move: false, kind: 'citybus', fare: r.busFare }
  if (r.skip) return { auto: false, kind: 'unknown' }
  const plan = r.plan
  if (plan && plan.ok && plan.best) {
    const b = plan.best
    return { auto: true, move: b.dep < WORK_START_MIN, kind: 'train', best: b, dest: r.dest }
  }
  if (plan && plan.reason === 'no-train') return { auto: true, move: true, kind: 'no-train' }
  if (plan && plan.reason === 'near')     return { auto: true, move: false, kind: 'near' }
  if (plan && plan.reason === 'detour')   return { auto: true, move: false, kind: 'bus' }
  return { auto: false, kind: 'unknown' }
}

// 역→현장 이동. 추정값은 직선거리로 잡은 값이라 그렇게 밝히고, 실제 경로는 카카오맵에서 연다
// (카카오는 앱에서 쓸 대중교통 길찾기 API를 공개하지 않는다 — 2026-09-26 확인).
function kakaoRouteUrl(mode, fromName, from, toName, to) {
  // 링크 형식이 '이름,위도,경도'라 이름 속 쉼표·괄호 설명은 뺀다
  const pt = (n, p) => `${encodeURIComponent(n.replace(/\s*\(.*$/, '').replace(/,/g, ' ').trim())},${p.lat},${p.lon}`
  return `https://map.kakao.com/link/by/${mode}/${pt(fromName, from)}/${pt(toName, to)}`
}
// ── 서울시 대중교통 조회 ─────────────────────────────────────────────────────
// 역→현장 이동시간을 직선거리 추정 대신 실제 대중교통 경로로 바꾼다(api/transit.js → 서울시
// 대중교통환승경로, 무료·하루 1,000건). 서울시 자료라 수도권 밖은 추정 그대로다. 같은 역·좌표는
// 브라우저에 30일 저장하고, 한 목적지에서 역마다 한 번만 부른다.
const TRANSIT_CACHE_DAYS = 30
const transitPending = new Set()
const inCapitalArea = p => p.lat > 37.2 && p.lat < 37.8 && p.lon > 126.6 && p.lon < 127.4

function transitKey(st, dest) {
  return [st.lon, st.lat, dest.lon, dest.lat].map(n => Number(n).toFixed(4)).join(',')
}

async function fetchTransit(st, dest) {
  const key = transitKey(st, dest)
  const cacheKey = `transit:v1:${key}`
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey) || 'null')
    if (hit && Date.now() - hit.at < TRANSIT_CACHE_DAYS * 86400000) return { ...hit.v, key }
  } catch { /* 저장소를 못 쓰면 매번 조회 */ }
  const qs = new URLSearchParams({ sx: st.lon, sy: st.lat, ex: dest.lon, ey: dest.lat })
  const res = await fetch(`./api/transit?${qs}`)
  const body = await res.json()
  if (!body.ok) throw new Error(body.error || `응답 오류 ${res.status}`)
  const v = { min: body.min, steps: body.steps }
  try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), v })) } catch { /* 무시 */ }
  return { ...v, key }
}

// 추천역이 직선거리 추정이면 그 역만 조회해 채우고 다시 그린다(역이 바뀌면 새 역도 한 번)
function ensureTransit(b, dest) {
  if (!b || b.accessSrc !== 'est' || !dest || dest.proxy || !inCapitalArea(dest)) return
  const st = KtxRoute.stations && KtxRoute.stations[b.station]
  if (!st) return
  const key = transitKey(st, dest)
  const cur = state.transitAccess[b.station]
  if ((cur && cur.key === key) || transitPending.has(key)) return
  transitPending.add(key)
  fetchTransit(st, dest)
    .then(v => { state.transitAccess = { ...state.transitAccess, [b.station]: v }; renderPrevDayVerdict() })
    .catch(e => console.warn('서울시 대중교통 조회 실패:', e.message))
    .finally(() => transitPending.delete(key))
}

function transitDetailHtml(route) {
  if (!route || !route.steps || !route.steps.length) return ''
  return `<details class="ra-transit"><summary>대중교통 경로 상세</summary><ol>${
    route.steps.map(s => `<li>${escapeHtml(s.text)}</li>`).join('')}</ol></details>`
}

// 도착역 → 현장 카카오맵 길찾기 링크(대중교통·택시). 대안 여정 카드에도 같은 링크를 단다(2026-09-30 지석초이).
function stationRouteLinks(station, dest) {
  const st = KtxRoute.stations && KtxRoute.stations[station]
  if (!st || !dest || dest.proxy || !Number.isFinite(dest.lat)) return ''
  return `<span class="ra-links"><a class="ra-link" target="_blank" rel="noopener" href="${kakaoRouteUrl('traffic', station + '역', st, dest.label || '목적지', dest)}">대중교통 경로 ↗</a>` +
    `<a class="ra-link" target="_blank" rel="noopener" href="${kakaoRouteUrl('car', station + '역', st, dest.label || '목적지', dest)}">택시 경로 ↗</a></span>`
}
function accessLine(b, dest) {
  if (!dest || dest.proxy) return `${escapeHtml(b.station)}역 기준 계산 — 장소를 검색 목록에서 고르면 현장까지 실제 거리로 계산해요`
  const basis = b.accessSrc === 'est' ? `추정 · 역에서 <x-nb>직선 ${b.stationKm}km</x-nb> 기준`
    : b.accessSrc === 'transit' ? '서울시 대중교통 조회'
    : b.accessSrc === 'known' ? '확인값' : '직접 입력'
  // 경로 링크는 설명 아래 한 줄에 모은다(2026-09-26 지석초이)
  const links = stationRouteLinks(b.station, dest)
  ensureTransit(b, dest)
  return `대중교통 약 ${b.access}분(${basis})${links}${transitDetailHtml(b.accessRoute)}`
}

// 코레일 예매 화면. 코레일 목록 화면은 조회 조건을 주소가 아니라 자기 사이트 안의 화면 상태(history.state)로만
// 받는다(2026-09-26 실측) — 다른 사이트 링크로는 구간·날짜가 채워진 목록을 열 수 없다. 그래서 앱이 가진 시간표로
// 그날 그 구간 직통 열차 목록을 바로 펼쳐 보이고, 예매는 코레일에서 한다. 좌석 여부는 코레일에서만 보인다.
const KORAIL_SEARCH_URL = 'https://www.korail.com/ticket/search/general'
function korailLinkHtml(leg, picked, earlier) {
  const day = state.startDate ? `${shortDate(state.startDate)} ` : ''
  const trains = findItineraries(leg.to, 1440 * 2, tripDow())
    .filter(it => it.transfers === 0)
    .sort((x, y) => x.dep - y.dep)
  const rows = trains.map(it => {
    const l = it.legs[0]
    const mark = it.dep === picked ? ' is-picked' : it.dep === earlier ? ' is-earlier' : ''
    const tag = it.dep === picked ? '<em>권한 편</em>' : it.dep === earlier ? '<em>앞 편</em>' : ''
    return `<tr class="kt-row${mark}"><td>${fmtTime(l.dep)}</td><td>${fmtTime(l.arr)}</td><td>${escapeHtml(l.no)}</td><td>${fmtDur(l.arr - l.dep)}${tag}</td></tr>`
  }).join('')
  const list = trains.length ? `<details class="kt-list"><summary>${day}${escapeHtml(leg.from)}→${escapeHtml(leg.to)} 직통 열차 ${trains.length}편 보기</summary>
      <table class="kt-table"><thead><tr><th>출발</th><th>도착</th><th>열차</th><th>소요</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="kt-note">KORAIL 시간표 기준 · 좌석은 코레일에서 확인해 주세요</div>
    </details>` : ''
  return `<span class="ra-links"><a class="ra-link" target="_blank" rel="noopener" href="${KORAIL_SEARCH_URL}">코레일에서 예매 ↗</a>` +
    `<span class="ra-hint">${day}${escapeHtml(leg.from)}→${escapeHtml(leg.to)} ${fmtTime(leg.dep)} 편</span></span>${list}`
}

// ── 마산시외버스터미널 시간표 ────────────────────────────────────────────────
// 시외버스 구간(부산·울산·전주·순천·여수·광양)은 터미널 공식 홈페이지 시간표(data/bus_masan.json,
// tools/check_bus_masan.mjs 로 원문 대조)로 탈 버스를 안내한다(2026-09-26 지석초이). 요금은 터미널 고시
// 참고값이고 정산 운임(rates.json)은 그대로다. 전날 이동 여부는 기차와 달리 아직 사람이 답한다.
let BUS_MASAN = null
async function loadBusData() {
  try { BUS_MASAN = await (await fetch('./data/bus_masan.json')).json() } catch { BUS_MASAN = null }
}

function busRoutesFor(text) {
  if (!BUS_MASAN || !text) return []
  if (text.includes('광양')) return BUS_MASAN.routes.filter(r => r.region === '광양')
  return BUS_MASAN.routes.filter(r => text.includes(r.region))
}

// 교육 시작에 닿는 가장 늦은 버스(노선마다) → 터미널에서 현장까지 짧은 노선
// 삼성창원병원 → 마산시외버스터미널 이동시간(분). bus_masan.json 의 origin.fromWorkMin 을 쓰고,
// 자료가 없으면 10분으로 본다 — 직선 0.9km 라 앱 추정식의 최솟값과 같다(2026-09-29 지석초이).
function originAccessMin() {
  const v = BUS_MASAN && BUS_MASAN.origin && Number(BUS_MASAN.origin.fromWorkMin)
  return Number.isFinite(v) && v > 0 ? v : 10
}

function planBus(startMin) {
  const routes = busRoutesFor(`${state.place || ''} ${state.region || ''}`)
  if (!routes.length || startMin == null) return null
  const dest = state.placeLat && state.placeLon ? { lat: state.placeLat, lon: state.placeLon } : null
  const cands = routes.map(r => {
    const access = dest ? accessMinutes(haversineKm(r.lat, r.lon, dest.lat, dest.lon)) : 0
    const deps = r.times.map(toMinutes)
    const ok = deps.filter(d => d + r.durationMin + access + 10 <= startMin)
    return { r, access, deps, dep: ok.length ? Math.max(...ok) : null }
  })
  const feasible = cands.filter(c => c.dep != null)
    .sort((a, b) => (a.r.durationMin + a.access) - (b.r.durationMin + b.access) || b.dep - a.dep)
  const first = cands.map(c => ({ ...c, dep: Math.min(...c.deps) })).sort((a, b) => a.dep - b.dep)[0]
  return { best: feasible[0] || null, first, dest, all: cands, originMin: originAccessMin() }
}

function busListHtml(c, picked) {
  const day = state.startDate ? `${shortDate(state.startDate)} ` : ''
  const rows = c.deps.map(d => `<tr class="kt-row${d === picked ? ' is-picked' : ''}"><td>${fmtTime(d)}</td><td>${fmtTime(d + c.r.durationMin)}</td><td>${fmtDur(c.r.durationMin)}</td><td>${d === picked ? '<em>권한 편</em>' : ''}</td></tr>`).join('')
  return `<details class="kt-list"><summary>${day}마산→${escapeHtml(c.r.terminal)} 버스 ${c.deps.length}편 보기</summary>
    <table class="kt-table"><thead><tr><th>출발</th><th>도착(약)</th><th>소요</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="kt-note">마산시외버스터미널 홈페이지 시간표 기준 · 편도 일반 ${c.r.fare.toLocaleString()}원${c.r.fareNote ? ` (${escapeHtml(c.r.fareNote)})` : ''}</div>
  </details>`
}

function busVerdictHtml(plan, startMin) {
  if (!plan.best) {
    const f = plan.first
    return `<div class="ra-verdict is-info"><span>당일 도착하는 버스가 없어요</span></div>
      <div class="ra-why">첫차 마산시외버스터미널 ${fmtTime(f.dep)} → ${escapeHtml(f.r.terminal)} ${fmtTime(f.dep + f.r.durationMin)} 도착이라 ${escapeHtml(state.startTime)} 교육에 못 닿아요. 시외버스 구간은 전날 이동 대상이 아니에요.</div>${busListHtml(f, null)}`
  }
  const c = plan.best, arr = c.dep + c.r.durationMin
  const st = { lat: c.r.lat, lon: c.r.lon }
  const links = plan.dest ? `<span class="ra-links"><a class="ra-link" target="_blank" rel="noopener" href="${kakaoRouteUrl('traffic', c.r.terminal, st, state.place || '목적지', plan.dest)}">대중교통 경로 ↗</a><a class="ra-link" target="_blank" rel="noopener" href="${kakaoRouteUrl('car', c.r.terminal, st, state.place || '목적지', plan.dest)}">택시 경로 ↗</a></span>` : ''
  const access = plan.dest
    ? `대중교통 약 ${c.access}분(추정)${links}`
    : '장소를 검색 목록에서 고르면 터미널에서 현장까지 시간을 더해요'
  const leave = c.dep - plan.originMin
  const why = leave >= WORK_START_MIN
    ? `<div class="ra-why">병원에서 ${fmtTime(leave)}에 나서면 닿아요 — 정규 출근시각(08:30) 이후라 전날 이동이 아니에요</div>`
    : `<div class="ra-why">병원에서 ${fmtTime(leave)}에 나서야 해요 — 시외버스 구간은 전날 이동 대상이 아니에요</div>`
  const short = c.r.terminal.replace(/\s*\(.*\)$/, '').replace(/(?:종합|공용)?(?:시외)?버스(?:공용)?터미널$|터미널$/, '')
  const strip = routeStrip({ legs: [{ type: '시외버스', dep: c.dep, arr, to: short }] }, { startName: '마산', access: plan.dest ? c.access : null })
  return `<div class="ra-verdict is-go"><span>이렇게 이동하세요</span><b>마산시외버스터미널 ${fmtTime(c.dep)} 출발</b></div>
    ${why}
    <div class="rc rc-main">${strip}</div>
    <ol class="ra-timeline">
      <li><span class="ra-t">${fmtTime(leave)}</span><span class="ra-dot"></span><span>삼성창원병원 출발<span class="ra-sub"${BUS_MASAN?.origin?.fromWorkNote ? ` title="${escapeHtml(BUS_MASAN.origin.fromWorkNote)}"` : ''}>터미널까지 약 ${fmtDur(plan.originMin)}(추정)</span></span></li>
      <li class="is-train"><span class="ra-t">${fmtTime(c.dep)}</span><span class="ra-dot"></span><span>마산시외버스터미널 출발<span class="ra-sub">시외버스 일반 · 편도 ${c.r.fare.toLocaleString()}원</span>${busListHtml(c, c.dep)}</span></li>
      <li><span class="ra-t">${fmtTime(arr)}</span><span class="ra-dot"></span><span>${escapeHtml(c.r.terminal)} 도착<span class="ra-sub">약 ${fmtDur(c.r.durationMin)}</span></span></li>
      ${plan.dest ? `<li><span class="ra-t">${fmtTime(arr + c.access)}</span><span class="ra-dot"></span><span>현장 도착<span class="ra-sub">${access}</span></span></li>` : `<li><span class="ra-t"></span><span class="ra-dot"></span><span class="ra-sub">${access}</span></li>`}
      <li class="is-slack"><span class="ra-t"></span><span class="ra-dot"></span><span>${slackPill(startMin - (arr + c.access))}</span></li>
      <li class="is-goal"><span class="ra-t">${escapeHtml(state.startTime)}</span><span class="ra-dot"></span><span>교육 시작</span></li>
    </ol>`
}

// 현장 도착 후 교육 시작까지 남는 시간(2026-09-26 지석초이) — 빠듯 15분 미만 / 적당 ~60분 / 넉넉
// ── 창원 시내 이동(2026-09-29 지석초이 "시내버스도 카카오 대중교통·택시 소요시간을 여정표에") ──────────
// 카카오는 앱에서 쓸 대중교통 길찾기 API를 공개하지 않고(2026-09-26 실측) 서울시 API는 수도권뿐이라, 병원↔교육장
// 직선거리로 시간을 '추정'하고 그렇게 밝힌다. 실제 경로·시간은 카카오맵 대중교통·자동차 길찾기 링크로 연다.
// 병원 좌표: 카카오 로컬 검색 "삼성창원병원"(경남 창원시 마산회원구 팔용로 158) 2026-09-29 실측.
const WORK_ORIGIN = { name: '삼성창원병원', lat: 35.2425222, lon: 128.5925312 }
const CITY_ARRIVE_EARLY = 15   // 교육 시작 15분 전 도착을 목표로 출발 시각을 역산한다(10분이면 '빠듯'으로 떴다)
function taxiMinutes(km) {
  // 도로는 직선보다 약 1.35배, 시내 평균 28km/h, 호출·승하차 5분. 5분 단위로 올린다.
  return Math.max(10, Math.ceil((5 + km * 1.35 / 28 * 60) / 5) * 5)
}
function cityTripHtml(fare) {
  const head = `<div class="ra-verdict is-go"><span>이렇게 이동하세요</span><b>시내버스 · 당일 이동</b></div>`
  const pay = `<div class="ra-why">창원 시내라 기차·시외버스를 타지 않아요. 교통비는 시내버스 요금(교통카드 편도 ${fare.cityBus.toLocaleString()}원 × 왕복)으로 정산해요</div>`
  const place = state.place || '교육장'
  if (!Number.isFinite(state.placeLat) || !Number.isFinite(state.placeLon)) {
    return head + pay + `<div class="ra-why">장소를 검색 목록에서 고르면 병원에서 버스·택시로 얼마나 걸리는지 계산해 드려요.</div>`
  }
  const dest = { lat: state.placeLat, lon: state.placeLon }
  const km = haversineKm(WORK_ORIGIN.lat, WORK_ORIGIN.lon, dest.lat, dest.lon)
  const bus = accessMinutes(km), taxi = taxiMinutes(km)
  const start = toMinutes(state.startTime)
  const links = `<span class="ra-links"><a class="ra-link" target="_blank" rel="noopener" href="${kakaoRouteUrl('traffic', WORK_ORIGIN.name, WORK_ORIGIN, place, dest)}">카카오맵 대중교통 경로 ↗</a>` +
    `<a class="ra-link" target="_blank" rel="noopener" href="${kakaoRouteUrl('car', WORK_ORIGIN.name, WORK_ORIGIN, place, dest)}">택시(자동차) 경로 ↗</a></span>`
  const leaveBus = start - CITY_ARRIVE_EARLY - bus, leaveTaxi = start - CITY_ARRIVE_EARLY - taxi
  const rows = [
    `<li class="is-train"><span class="ra-t">${fmtTime(leaveBus)}</span><span class="ra-dot"></span><span>${WORK_ORIGIN.name} 출발<span class="ra-sub">🚌 시내버스 약 ${fmtDur(bus)} <b>추정</b> · <x-nb>직선 ${km.toFixed(1)}km</x-nb> · 정류장 걷기·기다림 포함</span>${links}</span></li>`,
    `<li><span class="ra-t">${fmtTime(leaveBus + bus)}</span><span class="ra-dot"></span><span>${escapeHtml(place)} 도착</span></li>`,
    `<li class="is-slack"><span class="ra-t"></span><span class="ra-dot"></span><span>${slackPill(CITY_ARRIVE_EARLY)}</span></li>`,
    `<li class="is-goal"><span class="ra-t">${escapeHtml(state.startTime)}</span><span class="ra-dot"></span><span>교육 시작</span></li>`,
  ]
  const taxiAlt = `<div class="ra-earlier"><div class="ra-earlier-title">🚕 택시로 가면</div>약 ${fmtDur(taxi)} <b>추정</b> — 병원 ${fmtTime(leaveTaxi)} 출발이면 ${fmtTime(start - CITY_ARRIVE_EARLY)} 도착` +
    `<span class="ra-sub">정산 금액은 이동 수단과 관계없이 시내버스 요금 기준으로 계산돼요</span></div>`
  const note = `<div class="ra-why">버스·택시 시간은 직선거리로 잡은 추정이에요. 실제 노선·시간은 위 카카오맵 링크에서 확인하세요.</div>`
  const lead = `<div class="ra-verdict is-go" style="margin-top:0"><span>이렇게 이동하세요</span><b>병원 ${fmtTime(leaveBus)} 출발 · 시내버스</b></div>`
  return (Number.isFinite(start) ? lead : head) + pay +
    (Number.isFinite(start) ? `<ol class="ra-timeline">${rows.join('')}</ol>${taxiAlt}` : `<div class="ra-why">첫날 교육 시작시각을 고르면 병원에서 언제 나서야 하는지 알려 드려요. 시내버스 약 ${fmtDur(bus)} · 택시 약 ${fmtDur(taxi)} <b>추정</b></div>${links}`) + note
}

// ── 여정 도식(2026-09-30 지석초이 "줄글 나열 말고 도식화, 환승편도 도식화") ──────────────────────────
// 역을 점, 구간을 선으로 잇는다: 마산 ─KTX─ 동대구(환승 21분) ─SRT─ 동탄 ┄25분┄ 현장. 선 색은 열차 종류(KTX 파랑·SRT 보라·
// 그 밖 회색), 역→현장은 점선이다. 시각은 점 아래에 적는다.
function trainClass(type) {
  return /버스/.test(type) ? 'is-bus' : /SRT/i.test(type) ? 'is-srt' : /KTX/i.test(type) ? 'is-ktx' : 'is-rail'
}
function routeStrip(it, opt = {}) {
  const legs = it.legs || []
  if (!legs.length) return ''
  const node = (cls, name, time, extra = '') =>
    `<div class="rs-node ${cls}"><i></i><b>${escapeHtml(name)}</b><time>${time}</time>${extra}</div>`
  const seg = (cls, label) => `<div class="rs-seg ${cls}"><span>${escapeHtml(label)}</span></div>`
  let html = node('is-start', opt.startName || '마산', fmtTime(legs[0].dep))
  legs.forEach((l, i) => {
    html += seg(trainClass(l.type), String(l.type || '열차').replace(/-산천/, ''))
    const next = legs[i + 1]
    if (next) html += node('is-xfer', l.to, `${fmtTime(l.arr)}<small>→${fmtTime(next.dep)}</small>`, `<em>환승 ${fmtDur(next.dep - l.arr)}</em>`)
    else html += node(opt.access != null ? '' : 'is-end', l.to, fmtTime(l.arr))
  })
  if (opt.access != null) {
    html += seg('is-access', `${opt.accessIcon || ''}${fmtDur(opt.access)}`)
    html += node('is-goal', '현장', fmtTime(legs[legs.length - 1].arr + opt.access))
  }
  return `<div class="rs" role="img" aria-label="${escapeHtml(legs.map((l, i) => `${i ? '' : '마산 ' + fmtTime(l.dep) + ' → '}${l.to} ${fmtTime(l.arr)}`).join(' → '))}">${html}</div>`
}
// 여정 한 벌을 카드로 — 머리(역·환승 여부) + 도식 + 결과 알약
function routeCard(title, tag, it, opt = {}, foot = '') {
  return `<div class="rc"><div class="rc-head"><b>${title}</b>${tag ? `<span class="rc-tag${/환승/.test(tag) ? ' is-xfer' : ''}">${escapeHtml(tag)}</span>` : ''}</div>` +
    routeStrip(it, opt) + (foot ? `<div class="rc-foot">${foot}</div>` : '') + `</div>`
}
const xferTag = it => it.transfers ? `${(it.via || []).join('·')} 환승` : '직통'

// 당일 열차로는 못 닿는 구간(전날 이동 강제) — '당일 가장 빠른 길'과 '전날 이렇게 가세요'를 같이 보인다(2026-09-30 지석초이:
// "수원은 아침 도착 열차가 없는데 이럴 때 동탄역으로 환승 알려줘"). 예전엔 "당일 열차가 없어요" 한 줄뿐이었다.
function noTrainHtml() {
  const head = `<div class="ra-verdict is-go"><span>이렇게 이동하세요</span><b>전날 이동</b></div>
    <div class="ra-why">첫날 ${escapeHtml(state.startTime)} 시작에 닿는 당일 열차가 없어요</div>`
  const r = computeRoutePlan()
  const dest = r && r.dest
  if (!dest || typeof earliestSameDay !== 'function') return head
  const args = { lat: dest.lat, lon: dest.lon, dow: r.dow, destRow: dest.row || null, access: state.accessOverride, transit: state.transitAccess }
  let html = head
  const prev = planPreviousDay(args)
  if (prev && prev.options.length) {
    html += `<div class="rc-group"><div class="rc-group-title">전날(${shortDate(state.startDate, -1)}) 이렇게 가세요</div>` +
      prev.options.slice(0, 2).map((o, i) => routeCard(`${i + 1}. ${escapeHtml(prev.station)}역 ${fmtTime(o.arr)} 도착`, xferTag(o), o)).join('') +
      `<div class="rc-note">전날 밤 10시 전에 닿는 늦은 편부터 · 역→현장 약 ${fmtDur(prev.access)}(추정)</div></div>`
  }
  const fast = earliestSameDay(args)
  const start = toMinutes(state.startTime)
  if (fast) {
    const late = Math.max(fast.site - start, 0)
    html += `<div class="rc-group"><div class="rc-group-title">참고 · 당일 가장 빠른 길</div>` +
      routeCard(`${escapeHtml(fast.station)}역 경유`, xferTag(fast), fast, { access: fast.access },
        `<span class="slack-pill is-late">교육 시작보다 ${fmtDur(late)} 늦음</span> 당일로는 못 닿아요${stationRouteLinks(fast.station, dest)}`) + `</div>`
  }
  return html
}

// 대안 여정(2026-09-30 지석초이: "수원이 애매할 때 동탄역을 대안 여정으로(환승편), 직통은 잘 없더라"). 역산이 고른 편 말고
// 환승편·다른 도착역 중 제때 닿는 편을 두 개까지 보인다. 정산 운임은 위의 권한 편 기준 그대로다.
function altRoutesHtml(best) {
  const r = computeRoutePlan()
  // 2026-09-30 지석초이: 대안은 '마산에서 더 늦게 타고 동대구·대전에서 갈아타 제때 닿는 편'만 보인다.
  // 같은 시각에 떠나 갈아타기만 하는 편(광명 환승 등)은 비효율이라 싣지 않는다.
  const alts = ((r && r.plan && r.plan.alternatives) || [])
    .filter(a => a.transfers > 0 && ['동대구', '대전'].includes((a.via || [])[0]) && a.dep > best.dep)
    .slice(0, 2)
  if (!alts.length) return ''
  const start = toMinutes(state.startTime)
  const cards = alts.map(a => routeCard(`마산 ${fmtTime(a.dep)} 출발 <span class="rc-later">${fmtDur(a.dep - best.dep)} 늦게</span>`, xferTag(a), a, { access: a.access },
    (Number.isFinite(start) ? slackPill(start - (a.arr + a.access)) : '') +
    `<span class="rc-access">${escapeHtml(a.station)}역→현장 대중교통 약 ${fmtDur(a.access)}(추정)</span>${stationRouteLinks(a.station, r.dest)}`)).join('')
  return `<div class="rc-group"><div class="rc-group-title">대안 여정 · 더 늦게 출발</div>${cards}` +
    `<div class="rc-note">정산 운임은 위에서 권한 편 기준이에요. 좌석·시간은 코레일·SRT에서 확인하세요.</div></div>`
}

function slackPill(min) {
  if (!Number.isFinite(min)) return ''
  const cls = min < 15 ? 'is-tight' : min <= 60 ? 'is-ok' : 'is-loose'
  const word = min < 15 ? '빠듯' : min <= 60 ? '' : '넉넉'
  return `<span class="slack-pill ${cls}">⏱ 여유 ${fmtDur(min)}${word ? ` · ${word}` : ''}</span>`
}

// 조금 더 일찍 닿고 싶을 때 — 같은 역으로 가는 바로 앞 직통편(2026-09-26 지석초이).
// 정산 판정은 권한 편 기준 그대로다. 앞 편을 탄다고 전날 이동이 되지 않는다.
function earlierDirect(b) {
  if (!b || b.transfers) return null
  return findItineraries(b.station, b.arr, tripDow())
    .filter(it => it.transfers === 0 && it.dep < b.dep)
    .sort((x, y) => y.dep - x.dep)[0] || null
}

function earlierTrainHtml(b) {
  const prev = earlierDirect(b)
  if (!prev) return ''
  return `<div class="rc-group"><div class="rc-group-title">조금 더 일찍 가려면</div>` +
    routeCard(`${escapeHtml(b.station)}역`, `${prev.legs[0].type} ${prev.legs[0].no}`, prev, { access: b.access },
      `${slackPill(toMinutes(state.startTime) - (prev.arr + b.access))} 정산은 위 ${fmtTime(b.dep)} 편 기준이에요`) + `</div>`
}

// 카드4 첫날 이동 안내 패널(넓은 화면은 오른쪽 여백). '어떻게 가는지'만 안내하고, 전날 이동 인정·추가 금액은
// 예상 금액 화면에서 알린다(2026-09-26 지석초이). 탈 기차 시각과 전날 이동 판정을 한눈에 보인다.
function renderPrevDayVerdict() {
  const el = document.getElementById('prevday-verdict')
  const aside = document.getElementById('route-aside')
  if (!el || !aside) return
  const place  = document.getElementById('input-place')?.value.trim()
  const region = document.getElementById('input-region')?.value.trim()
  if (place != null) state.place = place
  if (region != null) state.region = region

  const off = state.isOnline || state.isJeju
  aside.classList.toggle('is-off', off)
  // 장소를 못 정한 상태면 여정표 맨 위에 같은 경고를 건다 — 역까지 기차 시간은 맞아도 현장까지 시간은 추정일 뿐이다
  const head = '<div class="ra-head">첫날 이동 안내</div>' + (state.placeNeedsPick
    ? '<div class="ra-pick-warn">⚠️ 교육 장소를 지도에서 확인하지 못했어요. 장소 칸에서 검색해 목록에서 고르면 현장까지 걸리는 시간이 나와요.</div>' : '')
  const show = (html, hasResult) => {
    el.innerHTML = head + html
    aside.classList.toggle('has-result', !!hasResult && !off)
  }
  if (off) return show('', false)
  if (!state.startTime || !(state.place || state.region)) {
    return show(`<div class="ra-why">첫날 교육 시작시각과 장소를 넣으면 몇 시에 어떻게 출발해야 하는지(기차·시외버스) 여기서 바로 보여드려요.</div>`, false)
  }

  const j = judgePrevDayMove()
  if (j.kind === 'train') {
    const b = j.best
    const rows = []
    b.legs.forEach((leg, i) => {
      rows.push(`<li class="is-train"><span class="ra-t">${fmtTime(leg.dep)}</span><span class="ra-dot"></span>
        <span>${i === 0 ? '마산역' : escapeHtml(leg.from) + '역 환승'} 출발<span class="ra-sub">${escapeHtml(leg.type)} ${escapeHtml(leg.no)}</span>
        ${i === 0 && !b.transfers ? korailLinkHtml(leg, b.dep, earlierDirect(b)?.dep) : korailLinkHtml(leg)}</span></li>`)
      if (i < b.legs.length - 1) {
        rows.push(`<li><span class="ra-t">${fmtTime(leg.arr)}</span><span class="ra-dot"></span><span>${escapeHtml(leg.to)}역 도착 <span class="rc-tag is-xfer">환승 ${fmtDur(b.legs[i + 1].dep - leg.arr)}</span></span></li>`)
      }
    })
    rows.push(`<li><span class="ra-t">${fmtTime(b.arr)}</span><span class="ra-dot"></span><span>${escapeHtml(b.station)}역 도착</span></li>`)
    rows.push(`<li><span class="ra-t">${fmtTime(b.arr + b.access)}</span><span class="ra-dot"></span>
      <span>현장 도착<span class="ra-sub">${accessLine(b, j.dest)}</span></span></li>`)
    rows.push(`<li class="is-slack"><span class="ra-t"></span><span class="ra-dot"></span><span>${slackPill(toMinutes(state.startTime) - (b.arr + b.access))}</span></li>`)
    rows.push(`<li class="is-goal"><span class="ra-t">${escapeHtml(state.startTime)}</span><span class="ra-dot"></span><span>교육 시작</span></li>`)
    const verdict = `<div class="ra-verdict is-go"><span>이렇게 이동하세요</span><b>마산역 ${fmtTime(b.dep)} 출발</b></div>
      ${j.move ? '<div class="ra-why">정규 출근시각(08:30) 전에 출발하는 편이에요</div>' : ''}`
    const overview = routeStrip(b, { access: b.access })
    return show(`${verdict}<div class="rc rc-main">${overview}</div><ol class="ra-timeline">${rows.join('')}</ol>${earlierTrainHtml(b)}${altRoutesHtml(b)}`, true)
  }
  if (j.kind === 'no-train') return show(noTrainHtml(), true)
  if (j.kind === 'citybus') return show(cityTripHtml(j.fare), true)
  if (j.kind === 'near') {
    return show(`<div class="ra-verdict is-go"><span>이렇게 이동하세요</span><b>당일 이동</b></div>
      <div class="ra-why">마산역 인근이라 기차를 타지 않는 구간이에요</div>`, true)
  }
  if (j.kind === 'bus') {
    const noDirect = BUS_MASAN && Object.entries(BUS_MASAN.noDirect || {}).find(([k]) => `${state.place} ${state.region}`.includes(k))
    if (noDirect) return show(`<div class="ra-verdict is-info"><span>직행 버스가 없어요</span></div><div class="ra-why">${escapeHtml(noDirect[1])}</div>`, true)
    const bp = planBus(toMinutes(state.startTime))
    if (bp) return show(busVerdictHtml(bp, toMinutes(state.startTime)), true)
    return show(`<div class="ra-verdict is-info"><span>자동 계산 불가</span></div>
      <div class="ra-why">시외버스 구간이라 시간표 자료가 없어요. 출발시각은 '추가 확인'에서 여쭤볼게요.</div>`, true)
  }
  if (j.kind === 'noplace') {
    return show(`<div class="ra-verdict is-info"><span>장소를 목록에서 골라 주세요</span></div>
      <div class="ra-why">출장 장소를 검색해 목록에서 고르면 탈 기차·시외버스를 바로 계산해요. 못 찾으면 '추가 확인'에서 여쭤볼게요.</div>`, true)
  }
  show('', false)
}

function applyPrevDayMove() {
  const autoEl = document.getElementById('daytrip-auto')
  if (autoEl) autoEl.classList.add('hidden')
  const j = judgePrevDayMove()

  if (j.auto) {
    state.prevDayMove = j.kind === 'na' ? null : j.move
    state.prevDayAuto = true
    return { mode: j.kind === 'near' || j.kind === 'citybus' ? 'skip' : j.kind === 'no-train' ? 'forced' : 'auto', judgment: j }
  }

  // 자동으로 골라 뒀던 답이 남아 있으면 사람이 새로 답하게 비운다
  if (state.prevDayAuto) {
    state.prevDayMove = null
    state.prevDayAuto = false
    document.querySelectorAll('#field-daytrip .yn-btn').forEach(b => b.classList.remove('selected'))
  }
  if (autoEl && state.startTime) {
    autoEl.innerHTML = `입력하신 첫날 교육 시작시각은 <strong>${escapeHtml(state.startTime)}</strong>이에요. ` +
      (j.kind === 'jeju' ? '제주는 항공편이라 자동 역산을 못 해요 — '
        : '장소 좌표를 몰라 자동 역산을 못 해요 — ') +
      '여기에 맞추려면 08:30 전에 나서야 했는지 골라주세요.'
    autoEl.classList.remove('hidden')
  }
  return { mode: 'ask', judgment: j }
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

  // 8시간 판정은 자동으로 못 한다 — 종료시각을 받지 않고(2026-09-26), 시외버스 구간
  // (부산·울산·전주 등)은 소요시간 자료도 없어 왕복 이동시간을 더할 수 없다.
  const shortAutoEl = document.getElementById('shortday-auto')
  if (shortAutoEl) {
    const startLine = startMin != null
      ? `입력하신 교육 시작시각은 <strong>${escapeHtml(state.startTime)}</strong>이에요. ` : ''
    const bp = ((fare && fare.bus) || busOnlyRegion(state.region || state.place)) && startMin != null
      ? planBus(startMin) : null
    const bpBest = bp && bp.best
    const roundTripMin = bpBest ? 2 * (bp.originMin + bpBest.r.durationMin + (bpBest.access || 0)) : null
    shortAutoEl.innerHTML = startLine +
      (roundTripMin
        ? `시간표 기준 왕복 이동시간은 약 ${fmtDur(roundTripMin)}(병원↔터미널 포함, 추정)이에요 — 교육시간을 더해 8시간을 넘는지 골라주세요.`
        : (fare && fare.bus) || busOnlyRegion(state.region || state.place)
        ? '시외버스 구간은 시간표가 없어 왕복 이동시간까지 자동으로 더하지 못해요 — 직접 골라주세요.'
        : '교육시간에 왕복 이동시간을 더해 8시간을 넘는지 골라주세요.')
    shortAutoEl.classList.toggle('hidden', !showShortDay)
  }

  // 제주: 항공은 필수라 안내만, 셔틀은 안 탔으면 영수증을 요구하면 안 되므로 묻는다
  document.getElementById('field-plane').classList.toggle('hidden', !state.isJeju)
  document.getElementById('field-shuttle').classList.toggle('hidden', !state.isJeju)
  const planned = state.tripStatus === 'planned'
  document.getElementById('shuttle-q').textContent = planned ? '공항 셔틀버스를 이용하실 건가요?' : '공항 셔틀버스를 이용하셨나요?'
  document.getElementById('shuttle-yes').textContent = planned ? '예, 이용할 예정이에요' : '예, 이용했어요'
  state.hasPlane = state.isJeju ? true : null
  if (!state.isJeju) state.hasShuttle = null
}

// ── Card 8 유효성 검사 ────────────────────────────────────────────────────────
// 화면에 보이는 Y/N 질문 중 답하지 않은 것이 있으면 금액을 계산하지 않는다.
// 예전에는 무검증으로 Card 9 로 넘어가, 숙소 제공 질문을 못 보고 지나치면
// 숙박비 10만원이 그대로 붙은 금액이 '예상 정산 총액'으로 나왔다.
const CARD8_QUESTIONS = [
  { field: 'isShortDayTrip',  id: 'field-shortdaytrip', label: '교육+이동 8시간 이하 당일 출장인지' },
  { field: 'isMS',            id: 'field-rank',         label: '직급이 MS 이상인지' },
  { field: 'prevDayMove',     id: 'field-daytrip',      label: '정규 출근시각(08:30) 전에 출발해야 했는지' },
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
  if (field === 'isMS') saveProfile({ isMS: val })
  if (field === 'prevDayMove') state.prevDayAuto = false

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
    document.querySelectorAll(`#c8-err-banner li[data-err="${q.id}"]`).forEach(li => li.remove())
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
// 예상 금액 항목 계산(카드9·전표 안내가 같이 쓴다 — 금액 기준을 두 벌로 두지 않는다, 2026-09-30).
// kind: transport·air·shuttle·daily·meal·lodging·fee. amount가 숫자가 아니면 영수증 금액·확인 필요 같은 미확정 항목이다.
function computeCostBreakdown() {
  if (state.isOnline) {
    const breakdown = state.fee > 0 ? [{ kind: 'fee', label: '교육비 / 등록비', amount: state.fee, note: '사전납입·회원병원 기준' }] : []
    return { breakdown, total: state.fee > 0 ? state.fee : 0, isJeju: false }
  }
  const isJeju  = state.isJeju
  const breakdown = []
  let total = 0

  // 1. 교통비 — 역산으로 도착역이 정해지면 그 역 운임을 쓴다.
  // (예: 삼성서울병원은 서울역이 아니라 수서역이 나오므로 금액도 수서역 기준이어야 한다)
  const fare = getFare(state.region || state.place)
  const rf   = isJeju ? null : routeFare()
  if (isJeju) {
    // 항공·셔틀은 정액이 아니다 — 영수증(매출전표)을 내야 결제한 금액만큼 정산된다(2026-09-26 지석초이)
    breakdown.push({ kind: 'air', label: '항공료 (왕복)', amount: '영수증 금액', note: '법인카드로 결제하고 신용카드 매출전표를 내면 결제한 금액만큼 정산돼요' })
    if (state.hasShuttle === true) {
      breakdown.push({ kind: 'shuttle', label: '공항 셔틀버스', amount: '영수증 금액', note: '법인카드 결제 · 매출전표를 내면 그 금액만큼 정산돼요' })
    }
  } else if (rf) {
    const kind = rf.transfers ? `${rf.via.join('·')} 환승 ${rf.transfers}회` : '직통'
    const bf = routeBusFaster()
    const busNote = bf
      ? ` · 시외버스가 약 ${fmtDur(bf.savedMin)} 빠른 구간 — 버스로 다녀오셨다면 실제 버스 요금으로 정산`
      : ''
    breakdown.push({ kind: 'transport',
      label: `KTX ${rf.grade} (${rf.station}역)`,
      amount: rf.roundTrip,
      note: `마산역 ${fmtTime(rf.dep)} 출발 · ${kind} · 편도 ${rf.oneWay.toLocaleString()}원 × 2회${busNote}`,
    })
    total += rf.roundTrip
  } else if (fare && fare.cityBus) {
    breakdown.push({ kind: 'transport', label: '시내버스 (창원)', amount: cityBusRoundTrip(fare), note: cityBusNote(fare) })
    total += cityBusRoundTrip(fare)
  } else if (fare) {
    const useFirst = state.isMS && fare.ktxFirst
    const fareAmt = useFirst ? fare.ktxFirst : (fare.ktxNormal ?? fare.bus ?? 0)
    const route = fareRouteText(fare)
    const oneWay = fareAmt / 2
    const origin = fare.bus ? ORIGIN_BUS : ORIGIN_RAIL
    // 시외버스는 운임표에 경로가 없어 "왕복 기준"만 적혀 근거를 알 수 없었다(2026-09-29 지석초이).
    // 터미널 고시 요금과 왕복 금액이 맞으면 어느 터미널 편도인지까지 밝힌다.
    const busRef = fare.bus ? busRoutesFor(`${state.place || ''} ${state.region || ''}`)
      .find(r => r.fare * 2 === fare.bus) : null
    const routeNote = route
      ? `${origin} → ${fare.label} · ${route} · 편도 ${oneWay.toLocaleString()}원 × 2회`
      : busRef
      ? `${origin} ↔ ${busRef.terminal} · 터미널 고시 편도 ${busRef.fare.toLocaleString()}원 × 2회`
      : `왕복 기준 · ${origin} → ${fare.label} · 편도 ${oneWay.toLocaleString()}원 × 2회`
    const fareLabel = fare.bus
      ? `시외버스 (${fare.label})`
      : `KTX ${useFirst ? '특실' : '일반실'} (${fare.label})`
    breakdown.push({ kind: 'transport', label: fareLabel, amount: fareAmt, note: routeNote })
    total += fareAmt
  } else if (state.region || state.place) {
    const detour  = routeDetour()
    const busOnly = busOnlyRegion(state.region || state.place)
    if (busOnly) {
      const ref = busRoutesFor(`${state.place || ''} ${state.region || ''}`)[0]
      breakdown.push({ kind: 'transport', receipt: !!ref, label: '교통비 (시외버스)', amount: ref ? '영수증 금액' : '직접 확인 필요',
        note: ref
          ? `${busOnly.label}은 시외버스 고정 구간 · 터미널 고시 편도 ${ref.fare.toLocaleString()}원(왕복 ${(ref.fare * 2).toLocaleString()}원) — 실제 탄 버스 영수증 금액으로 정산`
          : `${busOnly.label}은 시외버스 고정 구간 · 철도는 오송 경유로 돌아가 제외 · ${ORIGIN_BUS} 왕복 요금 확인 필요` })
    } else {
      breakdown.push(detour
        ? { kind: 'transport', label: '교통비 (시외버스)', amount: '직접 확인 필요',
            note: `철도는 ${detour.hub}까지 올라갔다 되내려오는 우회 구간 · 시외버스 왕복 요금 확인 필요` }
        : { kind: 'transport', label: '교통비', amount: '직접 확인 필요', note: '운임표에 없는 지역' })
    }
  }

  // 2. 일당 / 식사비 계산
  if (state.isShortDayTrip === true) {
    // ── 8시간 이하 당일 출장 예외 ──
    breakdown.push({ kind: 'daily', label: '일당', amount: 0, note: '교육+이동 8시간 이하 당일 출장 → 해당없음' })
    breakdown.push({ kind: 'meal', label: '식사비', amount: mealCapText(), emph: true, note: '법인카드 결제 필수 · 영수증 제출 · 한도 안 실비' })
    // 숙박비 없음 (당일)
  } else {
    let baseDays = Math.max(1, state.days || 1)
    const prevDayBonus = state.prevDayMove ? 1 : 0  // 전날 +1일
    const totalDays  = baseDays + prevDayBonus
    const tripNights = Math.max(0, state.nights || 0)

    // 날짜별 일당 — 가는 날·오는 날(전날 이동 포함)은 전액, 식사를 제공받는 끼인 날만 25%
    const quarterMid = !!(state.mealProvided && !state.isDayTrip && tripNights >= 2)
    const dayList = []
    if (prevDayBonus) dayList.push({ date: shortDate(state.startDate, -1), label: '전날 이동', amt: DAILY_RATE })
    for (let i = 0; i < baseDays; i++) {
      const first = i === 0, last = i === baseDays - 1
      const quarter = quarterMid && !first && !last
      dayList.push({ date: shortDate(state.startDate, i), quarter,
        label: baseDays === 1 ? '당일' : first ? '가는 날' : last ? '오는 날' : '끼인 날',
        amt: quarter ? DAILY_RATE_25P : DAILY_RATE })
    }

    let dailyTotal = 0
    if (state.mealProvided && !state.isDayTrip && tripNights >= 2) {
      // 식사 지원: 출장 중간날만 25% 적용
      const middleDays    = Math.max(0, baseDays - 2)
      const tripNormDays  = baseDays - middleDays
      dailyTotal = prevDayBonus * DAILY_RATE
                 + tripNormDays * DAILY_RATE
                 + middleDays * DAILY_RATE_25P
      breakdown.push({ kind: 'daily', label: `일당 (${totalDays}일)`, amount: dailyTotal, prevDay: !!prevDayBonus, days: dayList,
        note: '가는 날·오는 날은 전액, 식사를 제공받는 끼인 날은 <x-nb>25%만</x-nb> 지급돼요' })
    } else {
      dailyTotal = totalDays * DAILY_RATE
      breakdown.push({ kind: 'daily', label: `일당 (${totalDays}일)`, amount: dailyTotal, prevDay: !!prevDayBonus,
        note: prevDayBonus
          ? `출장 ${baseDays}일 + 전날 이동 1일 · ${totalDays}일 × ${DAILY_RATE.toLocaleString()}원`
          : `${totalDays}일 × ${DAILY_RATE.toLocaleString()}원`,
        days: dayList.length >= 2 ? dayList : null })
    }
    total += dailyTotal

    // 3. 숙박비 (제주 포함 동일 기준: 100,000원/박, 숙박제공시 0원)
    if (!state.isDayTrip) {
      if (state.lodgingProvided) {
        if (prevDayBonus > 0) {
          const bonusLodging = prevDayBonus * LODGING_RATE
          breakdown.push({ kind: 'lodging', label: `숙박비 전날 이동 (${prevDayBonus}박)`, amount: bonusLodging, prevDay: true, note: '전날 밤 숙박은 숙소 제공 범위 밖이라 지급' })
          total += bonusLodging
        }
        if (tripNights > 0) {
          breakdown.push({ kind: 'lodging', label: `숙박비 (${tripNights}박)`, amount: 0, note: '숙소 제공으로 미지급' })
        }
      } else {
        const baseNights = tripNights + prevDayBonus
        if (baseNights > 0) {
          const lodgingTotal = baseNights * LODGING_RATE
          breakdown.push({ kind: 'lodging', label: `숙박비 (${baseNights}박)`, amount: lodgingTotal, prevDay: !!prevDayBonus,
            note: prevDayBonus
              ? `${tripNights ? `출장 ${tripNights}박 + ` : ''}전날 이동 1박 · ${baseNights}박 × ${LODGING_RATE.toLocaleString()}원`
              : `${baseNights}박 × ${LODGING_RATE.toLocaleString()}원` })
          total += lodgingTotal
        }
      }
    }
  }

  // 4. 등록비
  if (state.fee > 0 && (state.feeStatus === 'paid' || state.feeStatus === 'not-paid')) {
    breakdown.push({ kind: 'fee', label: '교육비 / 등록비', amount: state.fee,
      note: state.feeStatus === 'not-paid' ? '사전납입·회원병원 기준 · 납부 예정' : '사전납입·회원병원 기준' })
    total += state.fee
  }

  return { breakdown, total, isJeju }
}

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
    const { breakdown, total } = computeCostBreakdown()
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
    document.getElementById('amount-note-text').textContent = '실제 정산은 결재 후 확정돼요'
    return
  }
  document.getElementById('amount-note-text').textContent = state.isJeju
    ? '실제 정산은 결재 후 확정돼요. 항공·셔틀은 낸 영수증 금액으로 정산돼요'
    : '실제 정산은 결재 후 확정돼요'

  const { breakdown, total, isJeju } = computeCostBreakdown()

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
          <span class="breakdown-label">${item.label}${item.prevDay ? ' <span class="pd-badge">전날 이동 포함</span>' : ''}</span>
          ${item.note ? `<span class="breakdown-note">${item.note}</span>` : ''}
          ${item.days ? `<div class="day-chips">${item.days.map(d => `
            <div class="day-chip${d.quarter ? ' is-quarter' : ''}">
              <span class="day-chip-date">${d.date}</span><span class="day-chip-label">${d.label}${d.quarter ? ' 25%' : ''}</span>
              <b>${d.amt.toLocaleString()}원</b>
            </div>`).join('')}</div>` : ''}
        </div>
        <span class="breakdown-amount ${isNum ? '' : item.emph ? 'breakdown-amount-emph' : 'breakdown-amount-text'}">${amtStr}</span>
      </div>`
  }).join('')

  const hasNonNum = breakdown.some(i => typeof i.amount !== 'number')
  // 금액 뒤 덧붙임(영수증 금액·실비)은 작게 한 줄로 — 휴대폰에서 총액이 두 줄로 꺾였다
  const plus = isJeju ? `+ 항공${state.hasShuttle === true ? '·셔틀' : ''} 영수증 금액` : hasNonNum ? '+ 실비' : ''
  document.getElementById('totalAmount').innerHTML =
    `${total.toLocaleString()}원${plus ? `<span class="amount-total-plus">${plus}</span>` : ''}`

  renderRoutePanel()

  // 전날 이동 인정 시 — 총액 바로 아래에서 날짜·이유·추가 금액을 한눈에 보인다(2026-09-26 지석초이)
  const prevDayHintEl = document.getElementById('prevDayHint')
  if (prevDayHintEl) {
    const show = state.prevDayMove === true
    prevDayHintEl.classList.toggle('hidden', !show)
    if (show) prevDayHintEl.innerHTML = prevDayHintHtml()
  }
}

// 'YYYY-MM-DD' → '9/23(수)'. offset 일만큼 옮긴다.
function shortDate(iso, offset = 0) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + offset)
  return `${d.getMonth() + 1}/${d.getDate()}(${'일월화수목금토'[d.getDay()]})`
}

// 받침이 있으면 '으로', 없거나 ㄹ받침이면 '로' (서울로 · 수원으로)
function josaRo(word) {
  const c = (word || '').charCodeAt(word.length - 1) - 0xac00
  if (c < 0 || c > 11171) return '로'
  const jong = c % 28
  return jong === 0 || jong === 8 ? '로' : '으로'
}

function prevDayHintHtml() {
  const j = judgePrevDayMove()
  const where = escapeHtml(state.region || state.place || '출장지')
  const start = escapeHtml(state.startTime || '')
  const why = j.kind === 'train'
    ? `${start} 교육에 닿으려면 <b>마산역 ${fmtTime(j.best.dep)}</b> KTX를 타야 해요 — 정규 출근시각(08:30) 전 출발`
    : j.kind === 'no-train'
    ? `첫날 ${start} 교육에 닿는 당일 기차가 없어요`
    : `추가 확인에서 '08:30 전에 나서야 한다'고 답하셨어요`
  const bonus = DAILY_RATE + LODGING_RATE
  return `
    <div class="pd-head"><span>🌙 전날 이동으로 정산돼요</span><b>+${bonus.toLocaleString()}원</b></div>
    <div class="pd-days">
      <div class="pd-day is-prev"><span class="pd-date">${shortDate(state.startDate, -1)}</span><span>${where}${josaRo(where)} 이동 · 숙박</span></div>
      <span class="pd-arrow">→</span>
      <div class="pd-day"><span class="pd-date">${shortDate(state.startDate)}</span><span>${start ? `${start} ` : ''}교육 시작</span></div>
    </div>
    <div class="pd-why">${why}</div>
    <div class="pd-sum">일당 1일 ${DAILY_RATE.toLocaleString()}원 + 숙박 1박 ${LODGING_RATE.toLocaleString()}원 — 아래 일당·숙박비에 포함됐어요</div>`
}

// 시·분 두 칸으로만 받는다 — 분은 10분 단위 선택지뿐이라 역산 기준이 늘 10분 단위다.
// 시작시각은 05:00~18:30까지 고른다(2026-09-26 16:00 → 2026-09-29 지석초이 지시로 18:30 — 저녁 총회·세미나).
// 마지막 시(18시)는 30분까지만 남긴다.
const LATEST_START = '18:30'
function onTimeChange() {
  const hourEl = document.getElementById('input-starthour')
  const minEl  = document.getElementById('input-startmin')
  const lastHour = hourEl?.value === LATEST_START.slice(0, 2)
  const lastMin = LATEST_START.slice(3)
  minEl?.querySelectorAll('option').forEach(o => { o.disabled = lastHour && o.value !== '' && o.value > lastMin })
  if (hourEl?.value && (!minEl.value || (lastHour && minEl.value > lastMin))) minEl.value = '00'
  state.startTime = hourEl?.value && minEl?.value ? `${hourEl.value}:${minEl.value}` : ''
  const hidden = document.getElementById('input-starttime')
  if (hidden) hidden.value = state.startTime
  hourEl?.classList.toggle('is-empty', !hourEl.value)
  minEl?.classList.toggle('is-empty', !minEl.value)
  state.endTime = ''  // 종료시각 입력칸 제거 (2026-09-26) — 귀가편 역산은 쓰지 않는다
  if (state.startTime) clearCard4Error('field-time')
  renderPrevDayVerdict()
}

// 공문에서 읽은 시각을 두 칸에 나눠 넣는다. 선택지 밖(05:00~18:30)이면 비워 두고 사람이 고르게 한다.
function setStartTime(hhmm, autofilled) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '')
  const hourEl = document.getElementById('input-starthour')
  const minEl  = document.getElementById('input-startmin')
  if (!hourEl || !minEl) return
  const hasHour = m && hhmm <= LATEST_START && [...hourEl.options].some(o => o.value === m[1])
  hourEl.value = hasHour ? m[1] : ''
  minEl.value  = hasHour ? m[2] : ''
  ;[hourEl, minEl].forEach(el => {
    el.classList.toggle('input-autofilled', !!(autofilled && hasHour))
    el.addEventListener('change', () => el.classList.remove('input-autofilled'), { once: true })
  })
  onTimeChange()
}

// 'HH:MM' → 10분 단위로 내린 'HH:MM'
function snapTo10(hhmm) {
  const min = toMinutes(hhmm)
  if (min == null) return hhmm
  const f = Math.floor(min / 10) * 10
  return String(Math.floor(f / 60)).padStart(2, '0') + ':' + String(f % 60).padStart(2, '0')
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

// 역산 계산만 떼어낸 함수. 화면 안내(renderRoutePanel)와 정산 교통비가 서로 다른 역을
// 가리키지 않도록, 두 곳이 모두 이 함수 하나를 부른다.
function computeRoutePlan() {
  if (state.isOnline) return { skip: 'online' }
  if (state.isJeju)   return { skip: 'jeju' }
  // 버스 고정 구간(목포·여수·순천·광양)을 먼저 본다 — 운임표에 버스 요금이 생겨도 기차를 뺀 이유를 안내해야 한다
  const busOnly = busOnlyRegion(state.region || state.place)
  if (busOnly) return { skip: 'busonly', busOnly }
  const busFare = getFare(state.region || state.place)
  if (busFare && busFare.bus) return { skip: 'bus', busFare }
  if (busFare && busFare.cityBus) return { skip: 'citybus', busFare }
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
    destRow: dest.row || null, access: state.accessOverride, transit: state.transitAccess, only: state.pinStation,
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
  if (r.skip === 'jeju')   return hide('')
  if (r.skip === 'bus') {
    return hide(`🚌 ${escapeHtml(r.busFare.label)}은 시외버스 구간이라 기차 시간표 역산 대상이 아니에요. ${ORIGIN_BUS}에서 출발합니다. (왕복 ${r.busFare.bus.toLocaleString()}원)`)
  }
  if (r.skip === 'busonly') return show(busOnlyHtml(r.busOnly))
  if (r.skip === 'citybus') return hide('')
  if (r.skip === 'data')   return hide('🚄 시간표 데이터를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.')
  if (r.skip === 'notime') {
    return hide(isDone
      ? '🚄 교육 시작시각을 넣으면 도착역과 정산 기준 운임을 계산해 드려요. (정보 확인 화면 → 교육 시작시각)'
      : '🚄 교육 시작시각을 넣으면 몇 시에 출발해야 하는지 역산해 드려요. (정보 확인 화면 → 교육 시작시각)')
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
      destRow: dest.row || null, access: state.accessOverride, transit: state.transitAccess }) : null
    const prevHtml = prev && prev.options.length
      ? `<div class="route-alt-title">전날 이동 후보 (${prev.station}역 도착)</div>` +
        prev.options.map(o => `<div class="route-alt">마산 ${fmtTime(o.dep)} → ${prev.station} ${fmtTime(o.arr)} · ${o.legs[0].no}${o.transfers ? ` · ${o.via.join('·')} 환승` : ' · 직통'}</div>`).join('')
      : ''
    show(`<div class="route-head"><span class="route-head-title">🚄 당일 출발로는 시작시각을 못 맞춰요</span></div>
      <div class="route-warn">시작시각 ${state.startTime} 기준으로 도착 가능한 당일 열차가 없습니다. 전날 이동이 필요합니다.</div>${prevHtml}`)
    return
  }

  // 예상 금액 화면에서는 '정산 기준' 상자를 띄우지 않는다(2026-09-26 지석초이). 탈 기차는 정보 확인 화면의
  // 이동 패널이, 금액·도착역은 위 내역이 이미 보인다. 시외버스가 더 빠른 구간·직접 고른 역의 우회 경고만 남긴다.
  const b = plan.best
  const detourWarn = b.detour
    ? `<div class="route-warn">직접 고르신 ${escapeHtml(b.station)}역은 ${escapeHtml(b.detour.hub)}까지 올라갔다 되내려오는 경로예요 — 직선 ${b.detour.directKm}km를 ${b.detour.railKm}km로 돕니다. 시외버스가 빠를 수 있습니다.</div>`
    : ''
  const extra = (plan.busFaster ? busFasterHtml(plan.busFaster) : '') + detourWarn
  if (extra) show(extra)
  else hide('')
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

// 창원 시내버스(2026-09-29 지석초이) — 운임표의 cityBus 는 일반·성인·교통카드 편도 1회 요금이다.
// 정산은 왕복 2회. 관리자 화면에서 고칠 수 있고, 원문은 tools/build_fares.py 의 KEEP 주석(창원시 고시)이다.
function cityBusRoundTrip(fare) { return fare && fare.cityBus ? fare.cityBus * 2 : 0 }
const cityBusNote = fare => `창원 시내버스 일반버스 교통카드 편도 ${fare.cityBus.toLocaleString()}원 × 왕복 2회 · 창원시 고시 요금(2025.8.1. 시행)`

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
    if (fare && fare.cityBus) {
      const one = fare.cityBus
      fareTotal = cityBusRoundTrip(fare)
      fareRows = `
        <tr>
          <th class="tf-th tf-th-multi" rowspan="2">교통비</th>
          <td class="tf-td">삼성창원병원 → ${escapeHtml(state.place || '창원 시내')}&nbsp;&nbsp;@ ${one.toLocaleString()} × 1회 × 1명 = ₩ ${one.toLocaleString()} (시내버스 편)</td>
        </tr>
        <tr>
          <td class="tf-td">${escapeHtml(state.place || '창원 시내')} → 삼성창원병원&nbsp;&nbsp;@ ${one.toLocaleString()} × 1회 × 1명 = ₩ ${one.toLocaleString()} (시내버스 편)</td>
        </tr>`
    } else if (fare) {
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
  }
  // 교통비·등록비는 8시간 이하 당일 출장이어도 정산한다 — 일당만 없다. 예전엔 이 둘까지 if (!isShort) 안에 있어
  // 신청서 합계가 ₩0으로 나오고 예상 금액 화면(교통비 포함)과 달랐다(2026-09-29 창원 시내버스 점검 중 발견).
  totalAmt += (state.fareOverride !== null && !isJeju) ? state.fareOverride : fareTotal
  if (state.fee > 0 && (state.feeStatus === 'paid' || state.feeStatus === 'not-paid')) {
    totalAmt += state.fee
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
    tokgiItems.push(`교육+이동 8시간 이하 당일 출장 — 식사비 ${mealCapText()} 법인카드 결제`)
  } else {
    if (state.isMS === true)  tokgiItems.push('&lt;교통비&gt; MS 적용')
    if (state.isMS === false) tokgiItems.push('&lt;교통비&gt; MS 미적용')
    if (prevDayBonus > 0) tokgiItems.push('정규 출근시각 전 출발 — 전날 이동 적용 (+1일 +1박)')
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

// ── 본인 정보 기억(2026-09-29 지석초이 "다시 입력해야 하는 사항") ─────────────────────
// 소속·성명·직급(MS 여부)은 정산할 때마다 같은 답인데 매번 새로 입력했다. 이 기기 브라우저에만 저장하고
// 다음번에 미리 채운 뒤 '지난번 입력'이라고 밝힌다 — 같은 PC를 여럿이 쓰면 바로 고칠 수 있게.
const PROFILE_KEY = 'expense_guide_profile_v1'
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {} } catch { return {} }
}
function saveProfile(patch) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...loadProfile(), ...patch })) } catch { /* 저장 불가 브라우저 — 매번 입력 */ }
}
function profileHint(el, text) {
  if (!el) return
  let hint = el.querySelector('.profile-hint')
  if (!hint) { hint = document.createElement('div'); hint.className = 'profile-hint'; el.appendChild(hint) }
  hint.textContent = text
  hint.classList.toggle('hidden', !text)
}
function prefillProfileCard8() {
  const rank = document.getElementById('field-rank')
  const saved = loadProfile().isMS
  if (!rank || rank.classList.contains('hidden') || state.isMS !== null || typeof saved !== 'boolean') return
  setYN('isMS', saved)
  profileHint(rank, '↺ 지난번 답을 미리 골라 뒀어요. 바뀌었으면 다시 고르세요.')
}
function prefillProfileCard10() {
  const p = loadProfile()
  const dept = document.getElementById('input-dept'), name = document.getElementById('input-name')
  let filled = false
  if (dept && !dept.value && p.dept) { dept.value = p.dept; filled = true }
  if (name && !name.value && p.name) { name.value = p.name; filled = true }
  if (filled) profileHint(dept?.closest('.info-fields-wrap'), '↺ 지난번 입력한 소속·성명이에요. 다르면 고쳐 주세요.')
}

// 소속/성명 입력 시 실시간 반영
function onPersonInput() {
  state.dept = document.getElementById('input-dept')?.value || ''
  state.name = document.getElementById('input-name')?.value || ''
  saveProfile({ dept: state.dept.trim(), name: state.name.trim() })
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
    items.push({ icon: '🍽️', title: '식사비 신용카드 매출전표', desc: `법인카드로 결제 · ${mealCapText()}`, shortday: true })
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
    currentCard: 2, tripStatus: 'planned', isOnline: false, hasDoc: null, parsedMeta: null,
    title: '', startDate: '', endDate: '', nights: 0, days: 0,
    place: '', region: '', isJeju: false, isSeoul: false, fee: 0,
    hasFee: null, feeStatus: null, receiptType: null,
    dept: '', name: '',
    isMS: null, isShortDayTrip: null, isDayTrip: null, prevDayMove: null,
    lodgingProvided: null, mealProvided: null, hasPlane: null, hasShuttle: null,
    startTime: '', endTime: '', placeLat: null, placeLon: null,
    accessOverride: {}, pinStation: null, fareOverride: null, prevDayAuto: false, appliedMeta: null, transitAccess: {},
  })
  // 폼 초기화
  ;['input-title','input-start','input-end','input-starthour','input-startmin','input-starttime','input-place','input-region','input-fee','input-dept','input-name'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.value = ''
  })
  sizeFeeInput()
  onTimeChange()
  renderTimeHint(null)
  document.getElementById('fee-subhint').textContent = '사전납입 · 회원병원 기준 금액으로 입력해주세요'
  document.getElementById('duration-tag')?.classList.add('hidden')
  document.getElementById('date-warn')?.classList.add('hidden')
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
  const first = document.getElementById('card-2')
  first.classList.add('active')
  first.style.transform = ''
  updateProgress()
  if (!navigatingByHistory) history.pushState({ card: 2 }, '')
}

// ── 자동 테스트 (콘솔에서 runTests() 호출) ────────────────────────────────────
const TEST_DOCS = [
  { label: '학술사업 공문 (88,000원 / 서울 / 2025-12-11)',  url: '/test-docs/학술사업_공문.pdf' },
  { label: '삼일아카데미 (510,000원 / 08.08~09)',           url: '/test-docs/삼일아카데미_교육.pdf' },
  { label: '세무조정 공문 (등록비 없음 / 수원 / 5.15~16)',  url: '/test-docs/세무조정_공문.pdf' },
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

// ── 알약 배지 한 줄 맞춤 ─────────────────────────────────────────────────────
// 배지 문구가 칸보다 한두 글자 길어 두 줄로 접히는 것을 막는다. CSS가 nowrap을
// 걸어 두고, 여기서 들어갈 때까지 글자 크기만 0.5px씩 줄인다(최소 8px).
const PILL_SELECTOR = '.alt-tag, .auto-badge, .pending-badge, .doc-badge-jeju, .doc-badge-shortday, .duration-tag, .duration-badge, .sub-badge, .tf-post-badge'
const PILL_MIN_PX = 8

function fitPills(root = document) {
  root.querySelectorAll(PILL_SELECTOR).forEach(el => {
    if (!el.offsetParent) return
    const parent = el.parentElement
    if (!parent) return
    const ps = getComputedStyle(parent)
    const avail = parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight)
    if (!(avail > 0)) return

    el.style.fontSize = ''
    let size = parseFloat(getComputedStyle(el).fontSize)
    const base = size
    // 글자가 칸 밖으로 나가는 경우는 둘이다 — 배지 자체가 부모보다 넓거나(inline-block),
    // 배지 폭은 부모에 맞춰졌는데 nowrap 글자가 그 안에서 넘치거나(block).
    const overflows = () =>
      el.getBoundingClientRect().width > avail + 0.5 || el.scrollWidth > el.clientWidth + 0.5
    while (overflows() && size > PILL_MIN_PX) {
      size -= 0.5
      el.style.fontSize = `${size}px`
    }
    if (size === base) el.style.fontSize = ''
  })
}

// ── 줄바꿈 다듬기 ────────────────────────────────────────────────────────────
// CSS word-break:keep-all 은 한글 어절만 지킨다. 사파리(아이폰)는 여는 괄호 뒤,
// 숫자 사이 쉼표·콜론 뒤에서 여전히 줄을 끊어 "₩ 68,/400", "(/2026년으로" 같은
// 조각을 만든다. U+2060(WORD JOINER)은 사파리가 무시한다(2026-09-26 실측) —
// 끊기면 안 되는 토막만 <x-nb>(white-space:nowrap)로 감싼다. span 이 아니라 사용자 정의
// 태그인 이유는, 기존 CSS의 `.final-check-text span { display:block }` 같은 선택자에 걸려
// 감싼 토막이 블록이 돼 줄이 통째로 갈라졌기 때문이다(2026-09-26 실측).
// 글자 자체는 건드리지 않으므로 innerText·복사본은 그대로다. 점검은 tools/wrap_scan.mjs.
const TIGHT_NUM = String.raw`\d+(?:,\d{3})+`
const TIGHT_TIME = String.raw`\d{1,2}:\d{2}(?:\s*~\s*\d{1,2}:\d{2})?`
// 여는 괄호·원화기호·가운뎃점·닫는 괄호는 뒤 토막과 한 덩어리로 묶는다
const TIGHT_RE = new RegExp(`₩\\s?${TIGHT_NUM}|[([{₩·)](?:${TIGHT_TIME}|${TIGHT_NUM}|\\S)|${TIGHT_TIME}|${TIGHT_NUM}`, 'g')
const TIGHT_SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|OPTION|CODE|PRE)$/

function joinTightWords(root) {
  const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT)
  const targets = []
  let n
  while ((n = walker.nextNode())) {
    const p = n.parentElement
    if (!p || TIGHT_SKIP.test(p.tagName) || p.tagName === 'X-NB') continue
    const t = n.nodeValue
    if (!t || t.length < 2) continue
    TIGHT_RE.lastIndex = 0
    if (TIGHT_RE.test(t)) targets.push(n)
  }
  targets.forEach(node => {
    const t = node.nodeValue
    const frag = document.createDocumentFragment()
    let last = 0, m
    TIGHT_RE.lastIndex = 0
    while ((m = TIGHT_RE.exec(t))) {
      if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)))
      const nb = document.createElement('x-nb')
      nb.textContent = m[0]
      frag.appendChild(nb)
      last = m.index + m[0].length
    }
    if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)))
    node.parentNode.replaceChild(frag, node)
  })
}

let pillFitQueued = false
let pillObserver = null

// fitPills 자신이 style을 건드리므로 관찰을 끊고 맞춘 뒤 다시 붙인다.
// 끊지 않으면 자기 변경을 다시 감지해 매 프레임 무한 반복한다.
function queueFitPills() {
  if (pillFitQueued) return
  pillFitQueued = true
  requestAnimationFrame(() => {
    pillFitQueued = false
    pillObserver?.disconnect()
    joinTightWords()
    fitPills()
    pillObserver?.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] })
  })
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadRates(), loadRouteData(), loadBusData()])
  updateProgress()

  // 배지가 그려지거나 화면 폭이 바뀔 때마다 한 줄로 다시 맞춘다
  pillObserver = new MutationObserver(queueFitPills)
  pillObserver.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] })
  window.addEventListener('resize', queueFitPills)
  queueFitPills()

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
