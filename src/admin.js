// ── 관리자 설정 ──────────────────────────────────────────────────────────────
// 비밀번호를 변경하려면 아래 값을 수정하세요 (GitHub에 올라가므로 단순 잠금용)
const ADMIN_PASSWORD = 'zjfjqtus1@'

const GITHUB_OWNER = 'xxiohc'
const GITHUB_REPO  = 'easy-settlement-guide'
const RATES_PATH   = 'app/data/rates.json'  // 저장소 내 경로

// ── 기본값 ───────────────────────────────────────────────────────────────────
const DEFAULT_RATES = {
  fareTable: [
    { keywords: ['서울'],           label: '서울역',    ktxNormal: 106600, ktxFirst: 149600 },
    { keywords: ['수서'],           label: '수서역',    ktxNormal: 102000, ktxFirst: 143000 },
    { keywords: ['천안', '아산'],   label: '천안아산역', ktxNormal: 90000,  ktxFirst: 126000 },
    { keywords: ['오송'],           label: '오송역',    ktxNormal: 84000,  ktxFirst: 118000 },
    { keywords: ['대전'],           label: '대전역',    ktxNormal: 68000,  ktxFirst: 95000  },
    { keywords: ['부산', '해운대'], label: '부산',      bus: 19600 },
    { keywords: ['대구'],           label: '동대구역',  ktxNormal: 76000,  ktxFirst: 106000 },
    { keywords: ['울산'],           label: '울산',      bus: 29000 },
    { keywords: ['경주'],           label: '신경주역',  ktxNormal: 34200,  ktxFirst: 48200  },
    { keywords: ['전주'],           label: '전주',      bus: 46000 },
    { keywords: ['제주'],           label: '제주',      jeju: true },
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
  sessionStorage.removeItem('smc_admin_token')
  document.getElementById('adminMain').classList.add('hidden')
  document.getElementById('gateOverlay').classList.remove('hidden')
  document.getElementById('gateInput').value = ''
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
async function initAdmin() {
  // 저장된 토큰 복원
  const savedToken = localStorage.getItem('smc_admin_token')
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

// ── 요금표 렌더링 ─────────────────────────────────────────────────────────────
function renderFareTable() {
  const tbody = document.getElementById('fareEditorBody')
  tbody.innerHTML = ''

  currentRates.fareTable.forEach((row, i) => {
    const isKtx  = row.ktxNormal !== undefined
    const isBus  = row.bus !== undefined
    const isJeju = !!row.jeju

    let modeTag
    if (isKtx)  modeTag = '<span class="fare-tag ktx">KTX</span>'
    else if (isBus)  modeTag = '<span class="fare-tag bus">버스</span>'
    else if (isJeju) modeTag = '<span class="fare-tag jeju">제주</span>'

    tbody.innerHTML += `
      <tr>
        <td class="fare-label-cell">${row.label}${modeTag}</td>
        <td style="text-align:center;color:#8b95a1;font-size:12px">
          ${isKtx ? 'KTX' : isBus ? '시외버스' : '항공'}
        </td>
        <td style="text-align:center">
          ${isKtx ? `
            <input type="number" class="fare-input" data-i="${i}" data-f="ktxNormal"
                   value="${row.ktxNormal}" step="100" onchange="updateFare(this)" />
            <span class="fare-unit">원</span>
          ` : '<span style="color:#e5e8ec">—</span>'}
        </td>
        <td style="text-align:center">
          ${isKtx ? `
            <input type="number" class="fare-input" data-i="${i}" data-f="ktxFirst"
                   value="${row.ktxFirst}" step="100" onchange="updateFare(this)" />
            <span class="fare-unit">원</span>
          ` : '<span style="color:#e5e8ec">—</span>'}
        </td>
        <td style="text-align:center">
          ${isBus ? `
            <input type="number" class="fare-input" data-i="${i}" data-f="bus"
                   value="${row.bus}" step="100" onchange="updateFare(this)" />
            <span class="fare-unit">원</span>
          ` : isJeju
            ? '<span style="font-size:12px;color:#d97706">실비 정산</span>'
            : '<span style="color:#e5e8ec">—</span>'}
        </td>
      </tr>`
  })
}

function updateFare(el) {
  const i = +el.dataset.i
  const f = el.dataset.f
  currentRates.fareTable[i][f] = +el.value
}

// ── 일당/숙박비 렌더링 ────────────────────────────────────────────────────────
function renderRateInputs() {
  document.getElementById('inputDailyRate').value    = currentRates.dailyRate
  document.getElementById('inputDailyRate25p').value = currentRates.dailyRate25p
  document.getElementById('inputLodgingRate').value  = currentRates.lodgingRate

  document.getElementById('inputDailyRate').addEventListener('input', e => {
    currentRates.dailyRate = +e.target.value
    if (document.getElementById('autoCalc25p').checked) {
      const v = Math.round(currentRates.dailyRate * 0.25 / 100) * 100
      currentRates.dailyRate25p = v
      document.getElementById('inputDailyRate25p').value = v
    }
  })
  document.getElementById('inputDailyRate25p').addEventListener('input', e => {
    currentRates.dailyRate25p = +e.target.value
  })
  document.getElementById('inputLodgingRate').addEventListener('input', e => {
    currentRates.lodgingRate = +e.target.value
  })
}

function toggleAuto25p() {
  const auto = document.getElementById('autoCalc25p').checked
  const input25p = document.getElementById('inputDailyRate25p')
  input25p.disabled = auto
  if (auto) {
    const v = Math.round(currentRates.dailyRate * 0.25 / 100) * 100
    currentRates.dailyRate25p = v
    input25p.value = v
  }
}

// ── 토큰 저장 ─────────────────────────────────────────────────────────────────
function saveToken() {
  const tok = document.getElementById('githubToken').value.trim()
  if (tok) {
    localStorage.setItem('smc_admin_token', tok)
    setStatus('토큰이 세션에 저장되었습니다.', 'ok')
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
