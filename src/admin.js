// ── 관리자 설정 ──────────────────────────────────────────────────────────────
// 비밀번호를 변경하려면 아래 값을 수정하세요 (GitHub에 올라가므로 단순 잠금용)
const ADMIN_PASSWORD = 'zjfjqtus1@'

const GITHUB_OWNER = 'xxiohc'
const GITHUB_REPO  = 'easy-settlement-guide'
const RATES_PATH   = 'data/rates.json'  // 저장소 내 경로 (index.html 이 읽는 ./data/rates.json 과 같은 파일)

// ── 기본값 ───────────────────────────────────────────────────────────────────
const DEFAULT_RATES = {
  // tools/build_fares.py 생성 — 직접 수정 금지
  fareTable: [
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
  ],

  dailyRate:    35000,
  dailyRate25p: 8750,
  lodgingRate:  100000,
}

// 현재 편집 중인 데이터
let currentRates = JSON.parse(JSON.stringify(DEFAULT_RATES))

// ── 비밀번호 게이트 ──────────────────────────────────────────────────────────
function checkPassword() {
  const input = document.getElementById('gateInput')
  const error = document.getElementById('gateError')
  if (input.value === ADMIN_PASSWORD) {
    document.getElementById('gateOverlay').classList.add('hidden')
    document.getElementById('adminMain').classList.remove('hidden')
    initAdmin()
  } else {
    error.classList.remove('hidden')
    input.value = ''
    input.focus()
    setTimeout(() => error.classList.add('hidden'), 3000)
  }
}

function logout() {
  // 토큰은 탭을 닫으면 사라지는 sessionStorage 에만 둔다.
  // 예전 버전이 localStorage 에 남겨둔 토큰도 여기서 함께 지운다.
  sessionStorage.removeItem('smc_admin_token')
  localStorage.removeItem('smc_admin_token')
  const tokenInput = document.getElementById('githubToken')
  if (tokenInput) tokenInput.value = ''
  document.getElementById('adminMain').classList.add('hidden')
  document.getElementById('gateOverlay').classList.remove('hidden')
  document.getElementById('gateInput').value = ''
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
async function initAdmin() {
  // 저장된 토큰 복원
  // 예전 버전이 localStorage 에 영구 저장한 토큰이 있으면 sessionStorage 로 옮기고 지운다
  const legacyToken = localStorage.getItem('smc_admin_token')
  if (legacyToken) {
    sessionStorage.setItem('smc_admin_token', legacyToken)
    localStorage.removeItem('smc_admin_token')
  }
  const savedToken = sessionStorage.getItem('smc_admin_token')
  if (savedToken) document.getElementById('githubToken').value = savedToken

  // 현재 rates.json 로드
  try {
    const r = await fetch('./data/rates.json?t=' + Date.now())
    if (r.ok) {
      const d = await r.json()
      currentRates = { ...DEFAULT_RATES, ...d }
    }
  } catch {}

  renderFareTable()
  renderRateInputs()
}

// ── 숫자 포맷 헬퍼 ───────────────────────────────────────────────────────────
const fmt  = n => Number(n).toLocaleString('ko-KR')
const unFmt = s => +String(s).replace(/,/g, '')

function attachCommaInput(el, onChange) {
  el.addEventListener('input', () => {
    const raw = el.value.replace(/,/g, '').replace(/[^\d]/g, '')
    const num = raw ? +raw : 0
    const pos = el.selectionStart
    const prevLen = el.value.length
    el.value = fmt(num)
    const newLen = el.value.length
    el.setSelectionRange(pos + (newLen - prevLen), pos + (newLen - prevLen))
    onChange(num)
  })
  el.addEventListener('focus', () => el.select())
}

// ── 요금표 렌더링 ─────────────────────────────────────────────────────────────
function renderFareTable() {
  const tbody = document.getElementById('fareEditorBody')
  tbody.innerHTML = ''

  currentRates.fareTable.forEach((row, i) => {
    const isKtx  = row.ktxNormal !== undefined
    const isBus  = row.bus !== undefined
    const isJeju = !!row.jeju

    let modeTag
    if (isKtx)       modeTag = '<span class="fare-tag ktx">KTX</span>'
    else if (isBus)  modeTag = '<span class="fare-tag bus">버스</span>'
    else if (isJeju) modeTag = '<span class="fare-tag jeju">제주</span>'

    // 운임표에서 뽑은 경로 (직통/환승) — 표시 전용, 편집 대상 아님
    const routeNote = Array.isArray(row.path) && row.path.length > 1
      ? `<div class="fare-route">${row.path.join(' → ')}${
          row.transfers ? ` · 환승 ${row.transfers}회` : ' · 직통'}</div>`
      : ''

    const fareInput = (field, val) =>
      `<input type="text" inputmode="numeric" class="fare-input"
              data-i="${i}" data-f="${field}" value="${fmt(val)}" />`

    tbody.innerHTML += `
      <tr>
        <td class="fare-label-cell">${row.label}${modeTag}${routeNote}</td>
        <td style="text-align:center;color:#8b95a1;font-size:12px">
          ${isKtx ? 'KTX' : isBus ? '시외버스' : '항공'}
        </td>
        <td style="text-align:center">
          ${isKtx
            ? `${fareInput('ktxNormal', row.ktxNormal)}<span class="fare-unit">원</span>`
            : '<span style="color:#e5e8ec">—</span>'}
        </td>
        <td style="text-align:center">
          ${isKtx
            ? `${fareInput('ktxFirst', row.ktxFirst)}<span class="fare-unit">원</span>`
            : '<span style="color:#e5e8ec">—</span>'}
        </td>
        <td style="text-align:center">
          ${isBus
            ? `${fareInput('bus', row.bus)}<span class="fare-unit">원</span>`
            : isJeju
              ? '<span style="font-size:12px;color:#d97706">실비 정산</span>'
              : '<span style="color:#e5e8ec">—</span>'}
        </td>
      </tr>`
  })

  // 이벤트 부착
  tbody.querySelectorAll('.fare-input').forEach(el => {
    const i = +el.dataset.i
    const f = el.dataset.f
    attachCommaInput(el, num => { currentRates.fareTable[i][f] = num })
    el.addEventListener('focus', () => el.select())
  })
}

// ── 일당/숙박비 렌더링 ────────────────────────────────────────────────────────
function renderRateInputs() {
  const daily   = document.getElementById('inputDailyRate')
  const daily25 = document.getElementById('inputDailyRate25p')
  const lodging = document.getElementById('inputLodgingRate')

  daily.value   = fmt(currentRates.dailyRate)
  daily25.value = fmt(currentRates.dailyRate25p)
  lodging.value = fmt(currentRates.lodgingRate)

  attachCommaInput(daily, num => {
    currentRates.dailyRate = num
    if (document.getElementById('autoCalc25p').checked) {
      const v = Math.round(num * 0.25 / 100) * 100
      currentRates.dailyRate25p = v
      daily25.value = fmt(v)
    }
  })
  attachCommaInput(daily25, num => { currentRates.dailyRate25p = num })
  attachCommaInput(lodging, num => { currentRates.lodgingRate  = num })
}

function toggleAuto25p() {
  const auto    = document.getElementById('autoCalc25p').checked
  const daily25 = document.getElementById('inputDailyRate25p')
  daily25.disabled = auto
  if (auto) {
    const v = Math.round(currentRates.dailyRate * 0.25 / 100) * 100
    currentRates.dailyRate25p = v
    daily25.value = fmt(v)
  }
}

// ── 토큰 저장 ─────────────────────────────────────────────────────────────────
function saveToken() {
  const tok = document.getElementById('githubToken').value.trim()
  if (tok) {
    sessionStorage.setItem('smc_admin_token', tok)
    setStatus('토큰을 이 탭에만 저장했습니다. 탭을 닫으면 지워집니다.', 'ok')
  }
}

// ── 기본값 초기화 ─────────────────────────────────────────────────────────────
function resetDefaults() {
  if (!confirm('모든 요금을 기본값으로 되돌리겠습니까?')) return
  currentRates = JSON.parse(JSON.stringify(DEFAULT_RATES))
  renderFareTable()
  document.getElementById('inputDailyRate').value    = currentRates.dailyRate
  document.getElementById('inputDailyRate25p').value = currentRates.dailyRate25p
  document.getElementById('inputLodgingRate').value  = currentRates.lodgingRate
  setStatus('기본값으로 초기화되었습니다. 저장 및 배포를 눌러 적용하세요.', '')
}

// ── GitHub 저장 ───────────────────────────────────────────────────────────────
async function saveAll() {
  const token = document.getElementById('githubToken').value.trim()
  if (!token) {
    setStatus('GitHub 토큰을 먼저 입력하세요.', 'err')
    document.getElementById('githubToken').focus()
    return
  }

  const btn = document.getElementById('btnSave')
  btn.disabled = true
  setStatus('저장 중...', 'ing')

  const payload = {
    fareTable:    currentRates.fareTable,
    dailyRate:    currentRates.dailyRate,
    dailyRate25p: currentRates.dailyRate25p,
    lodgingRate:  currentRates.lodgingRate,
    updatedAt:    new Date().toISOString().slice(0, 10),
  }
  const content = JSON.stringify(payload, null, 2) + '\n'
  const encoded = btoa(unescape(encodeURIComponent(content)))

  try {
    // 현재 파일 SHA 조회
    const getRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${RATES_PATH}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    )
    let sha = undefined
    if (getRes.ok) {
      const meta = await getRes.json()
      sha = meta.sha
    }

    // 커밋
    const body = { message: `chore: 요금 업데이트 (${payload.updatedAt})`, content: encoded }
    if (sha) body.sha = sha

    const putRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${RATES_PATH}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )

    if (putRes.ok) {
      sessionStorage.setItem('smc_admin_token', token)
      setStatus('✅ 저장 완료 — Vercel 재배포 중 (약 30초 후 적용)', 'ok')
    } else {
      const err = await putRes.json()
      setStatus(`오류: ${err.message || putRes.status}`, 'err')
    }
  } catch (e) {
    setStatus(`네트워크 오류: ${e.message}`, 'err')
  } finally {
    btn.disabled = false
  }
}

// ── 상태 메시지 ───────────────────────────────────────────────────────────────
function setStatus(msg, type) {
  const el = document.getElementById('saveStatus')
  el.textContent = msg
  el.className = 'save-status' + (type ? ` ${type}` : '')
}

// ── 게이트 입력 엔터 처리 ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gateInput').focus()
})
