// 전표 작성 안내 화면(2026-09-30, 같은 날 전면 개편 — 지석초이 "줄글이 많고 복잡하다, 출장 안내처럼 클릭클릭 넘어가게,
// 차변·대변·계정과목을 크게 보여 줘"). 한 화면에 질문 하나, 고르면 바로 다음으로 넘어간다.
// 계산·분기는 voucher.js, 계정·기준은 data/voucher_rules.json. 저장은 이 기기 브라우저에만 한다.

const VG_KEY = 'expense_guide_voucher_v1'
// 2026-09-30 지석초이: 서류 확인·제출 준비가 겹쳐 한 화면으로 합침
const VG_GROUPS = ['상황 확인', '전표 작성', '제출 준비']
let VG_RULES = null
let vg = null            // 지금 작성 중인 전표 안내 답
let vgFrom = 11          // 어디서 들어왔는지(뒤로 가기)
let vgNotice = ''        // 화면 위에 한 번 띄울 알림

async function loadVoucherRules() {
  try { VG_RULES = await (await fetch('./data/voucher_rules.json')).json() } catch { VG_RULES = null }
}

// ── 저장 ────────────────────────────────────────────────────────────────────
function vgLoad() {
  try { const v = JSON.parse(localStorage.getItem(VG_KEY) || 'null'); return v && v.version === 2 ? v : null } catch { return null }
}
function vgSave() {
  if (!vg) return
  vg.savedAt = new Date().toISOString()
  try { localStorage.setItem(VG_KEY, JSON.stringify(vg)) } catch { /* 저장 불가 브라우저 — 이어하기만 안 된다 */ }
}
function vgDelete() {
  try { localStorage.removeItem(VG_KEY) } catch { /* 무시 */ }
  vg = null
  renderVoucherResume()
}

// ── 시작 ────────────────────────────────────────────────────────────────────
// 앞 단계에서 확인한 교육·출장 정보와 예상 금액을 그대로 가져온다(금액 기준을 새로 두지 않는다).
function vgFromState() {
  const { breakdown, total } = computeCostBreakdown()
  const prof = typeof loadProfile === 'function' ? loadProfile() : {}
  const trip = {
    title: state.title || document.getElementById('input-title')?.value.trim() || '',
    startDate: state.startDate, endDate: state.endDate, place: state.place, region: state.region,
    dept: state.dept || prof.dept || '', name: state.name || prof.name || '',
    isOnline: !!state.isOnline, isJeju: !!state.isJeju, hasDoc: !!state.hasDoc,
    feeStatus: state.feeStatus, receiptType: state.receiptType,
  }
  const costs = breakdown.map(b => ({ kind: b.kind, label: b.label, amount: typeof b.amount === 'number' ? b.amount : null }))
  // 카드10에서 본 출장신청서를 그대로 옮겨 둔다(수정 버튼·입력칸은 빼고) — 전표 옆에서 크로스체크(2026-09-30 지석초이)
  let formHtml = '', formTotal = null
  if (!state.isOnline && typeof renderTripFormPreview === 'function') {
    renderTripFormPreview()
    const box = document.querySelector('#tripFormWrap .tf-box')
    if (box) {
      const c = box.cloneNode(true)
      c.querySelectorAll('button, input, .tf-edit-panel').forEach(n => n.remove())
      formHtml = c.outerHTML
      const n = parseInt((box.querySelector('.tf-total-amount')?.textContent || '').replace(/\+.*$/, '').replace(/[^\d]/g, ''), 10)
      formTotal = Number.isFinite(n) ? n : null
    }
  }
  return { version: 2, trip, costs, planTotal: formTotal ?? total, formHtml, formTotal, screen: 'task', checks: {}, tripKey: Voucher.tripKey(trip), fromFlow: true }
}

function startVoucherGuide() {
  if (!VG_RULES) { alert('전표 기준 자료를 불러오지 못했어요. 새로고침한 뒤 다시 눌러 주세요.'); return }
  const fresh = vgFromState()
  const saved = vgLoad()
  if (saved && saved.tripKey === fresh.tripKey) {
    vg = saved
    if (JSON.stringify(saved.costs) !== JSON.stringify(fresh.costs)) {
      vg.costs = fresh.costs; vg.planTotal = fresh.planTotal
      vgNotice = '앞 단계 금액이 바뀌어 새 금액으로 바꿨어요.'
    }
    vg.trip = { ...saved.trip, ...fresh.trip }
    if (fresh.formHtml) { vg.formHtml = fresh.formHtml; vg.formTotal = fresh.formTotal; vg.planTotal = fresh.planTotal }
    vg.fromFlow = true
  } else {
    vg = fresh
  }
  vgFrom = 11
  vgSave()
  goToCard(12)
  renderVoucher()
}

function skipVoucherGuide() {
  document.getElementById('vg-entry')?.classList.add('is-closed')
}

// 첫 화면에서 이어하기(선지급 후 최종 정산 포함)
function resumeVoucherGuide(finalNow) {
  if (!VG_RULES) { alert('전표 기준 자료를 불러오지 못했어요. 새로고침한 뒤 다시 눌러 주세요.'); return }
  vg = vgLoad()
  if (!vg) return renderVoucherResume()
  vg.fromFlow = false
  if (finalNow) {
    // 저장한 '보낼 예정액'을 실제 지급액으로 여기지 않는다 — 처리됐는지 다시 묻는다
    Object.assign(vg, { task: 'final', feePay: null, resumed: true, evAll: null, checks: {}, pendingFinal: false, screen: 'resumeQ' })
    vgSave()
  }
  vgFrom = 2
  goToCard(12)
  renderVoucher()
}

function renderVoucherResume() {
  const box = document.getElementById('voucher-resume')
  if (!box) return
  const s = vgLoad()
  if (!s) { box.classList.add('hidden'); box.innerHTML = ''; return }
  const t = s.trip || {}
  const day = t.startDate ? `${shortDate(t.startDate)}${t.endDate && t.endDate !== t.startDate ? ` ~ ${shortDate(t.endDate)}` : ''}` : ''
  const head = s.pendingFinal
    ? `<b>${escapeHtml(t.title || '교육·출장')}</b><span>최종 정산이 남아 있어요 · 먼저 받은 ${vgWord(s).what} ${Voucher.won(vgAdvTotal(s))}${day ? ` · ${escapeHtml(day)}` : ''}</span>`
    : `<b>${escapeHtml(t.title || '교육·출장')}</b><span>전표 안내를 이어서 할 수 있어요${day ? ` · ${escapeHtml(day)}` : ''}</span>`
  const go = s.pendingFinal
    ? `<button type="button" class="vg-btn vg-btn-primary" onclick="resumeVoucherGuide(true)">${vgWord(s).btn}</button>`
    : `<button type="button" class="vg-btn vg-btn-primary" onclick="resumeVoucherGuide(false)">이어하기</button>`
  box.innerHTML = `<div class="vg-resume">${head}
    <div class="vg-resume-btns">${go}<button type="button" class="vg-btn" onclick="if (confirm('저장된 전표 안내를 지울까요?')) vgDelete()">삭제</button></div>
    <small>이 기기에만 저장돼 있어요</small></div>`
  box.classList.remove('hidden')
}

// ── 답 → 계산용 값 ──────────────────────────────────────────────────────────
const vgFee = () => (vg.costs || []).find(c => c.kind === 'fee' && c.amount)
const vgFeePaidByCardBefore = () => vg.trip.feeStatus === 'paid' && vg.trip.receiptType === 'card-receipt'
const vgReceiptKinds = () => (vg.costs || []).filter(c => c.amount == null).map(c => c.kind)

// 먼저 받을 수 있는 돈: 등록비(카드로 이미 낸 게 아닐 때) · 여비(일당·숙박·교통, 온라인 아님)
function vgAdvOptions() {
  const out = []
  if (vgFee() && !vgFeePaidByCardBefore()) out.push('fee')
  if (!vg.trip.isOnline && Voucher.travelSum(vg)) out.push('travel')
  return out
}
function vgAdvKinds(src = vg) {
  if (src.advKinds && src.advKinds.length) return src.advKinds
  const opts = src === vg ? vgAdvOptions() : ['fee']
  return opts.length === 1 ? opts : ['fee']
}
// 2회 정산 ② 시점 말: 등록비만이면 '영수증 발급', 여비가 끼면 '다녀와서'
function vgWord(src = vg) {
  const k = vgAdvKinds(src)
  const what = k.includes('fee') && k.includes('travel') ? '등록비·여비' : k.includes('travel') ? '여비' : '등록비'
  return k.includes('travel')
    ? { what, later: '다녀와서', when: '다녀와서 서류가 갖춰지면', btn: '다녀왔어요 · 최종 정산 시작' }
    : { what, later: '영수증 발급 후', when: '영수증이 발급되면', btn: '영수증 받았어요 · 최종 정산 시작' }
}
function vgAdvTotal(src = vg) {
  const k = vgAdvKinds(src)
  const fee = k.includes('fee') ? (src.advanceAmount ?? (src.costs || []).find(c => c.kind === 'fee')?.amount ?? null) : 0
  const tr = k.includes('travel') ? (src.advanceTravel ?? Voucher.travelSum(src)) : 0
  return fee == null || tr == null ? null : fee + tr
}

// 한 번에 하나씩 받은 답을 voucher.js 입력(paid·bankPay·cardItems·evidence)으로 옮긴다
function vgModel(opts = {}) {
  const fee = vgFee()
  const ak = vgAdvKinds()
  const m = { ...vg, paid: {}, bankPay: null, cardItems: {}, evidence: {}, refund: vg.feePay === 'refund' }
  // 이어하기(②)에서 '먼저 받은 돈 처리됐나요?' 답(feePay)은 선지급한 항목에만 적용한다
  const advState = opts.preview ? 'advance' : vg.resumed ? vg.feePay : null
  let pay = vg.feePay || (vgFeePaidByCardBefore() ? 'card' : null)
  if (opts.preview || vg.resumed) pay = ak.includes('fee') ? advState : (vgFeePaidByCardBefore() ? 'card' : 'none')
  if (ak.includes('travel') && advState === 'advance') m.travelAdv = vg.advanceTravel ?? Voucher.travelSum(vg)
  if (ak.includes('travel') && advState === 'unknown') m.travelAdvUnknown = true
  m.advKinds = ak
  if (fee) {
    const amt = vg.advanceAmount ?? fee.amount
    if (pay === 'advance') { m.paid.bank = true; m.bankPay = { amount: amt, status: 'advance', ref: vg.advanceRef || '' } }
    else if (pay === 'expensed') { m.paid.bank = true; m.bankPay = { amount: amt, status: 'expensed' } }
    else if (pay === 'unknown') { m.paid.bank = true; m.bankPay = { amount: amt, status: 'unknown' } }
    else if (pay === 'card') { m.paid.card = true; m.cardItems = { fee: fee.amount } }
    else if (pay === 'personal') m.paid.personal = true
    else m.paid.none = true
  } else m.paid.none = true
  if (vg.evAll) for (const c of vg.costs || []) if (['fee', 'air', 'shuttle', 'meal'].includes(c.kind)) m.evidence[c.kind] = vg.evAll
  if (m.evidence.fee && m.bankPay?.status === 'expensed') delete m.evidence.fee
  return m
}
function vgResult() {
  if (!vg || !VG_RULES || !vg.task) return null
  const m = vgModel()
  vg.memo = Voucher.memoDraft(m)
  m.memo = vg.memo
  if (vg.task === 'advance') { m.advanceAmount = vg.advanceAmount ?? vgFee()?.amount ?? null; m.advanceTravel = vg.advanceTravel ?? null; return Voucher.buildAdvance(m, VG_RULES) }
  return Voucher.buildFinal(m, VG_RULES)
}

// 선지급 건의 ② 최종 정산 전표 미리보기 — 영수증 금액은 아직 모르므로 '영수증 금액'으로 남긴다
function vgFinalPreview() {
  const keepTask = vg.task
  vg.task = 'final'
  const m = vgModel({ preview: true })
  vg.task = keepTask
  m.task = 'final'; m.evidence = {}
  m.memo = Voucher.memoDraft(m)
  const r = Voucher.buildFinal(m, VG_RULES)
  r.memo = m.memo
  return r
}

// ── 화면 순서 ───────────────────────────────────────────────────────────────
// [화면 id, 묶음] — 답에 따라 필요 없는 화면은 뺀다. 선택지 화면은 고르면 바로 넘어간다.
function vgScreens() {
  const list = []
  if (vg.resumed) list.push(['resumeQ', 0])
  else list.push(['task', 0])
  if (vg.task === 'advance') {
    // 2회 정산(원 자료 p.4 Case②): ① 지금 선지급 전표, ② 영수증(적격증빙) 발급 후 최종 정산 전표를 미리 보여 준다
    if (vgAdvOptions().length > 1) list.push(['advWhat', 0])
    if (vgAdvKinds().includes('fee')) list.push(['advEv', 0])
    list.push(['voucher', 1], ['purpose', 1])
    if (vg.purpose === 'edu') list.push(['job', 1])
    list.push(['voucher2', 1], ['done', 2])
  } else if (vg.task === 'final') {
    if (vgFee() && !vg.resumed && !vgFeePaidByCardBefore()) list.push(['feePay', 0])
    // 선지급 때 이미 고른 목적·직종은 다시 묻지 않는다
    const known = vg.resumed && Voucher.expenseAccountKey(vg.purpose, vg.job)
    if (!known) {
      list.push(['purpose', 0])
      if (vg.purpose === 'edu') list.push(['job', 0])
    }
    const needEv = (vg.costs || []).some(c => ['air', 'shuttle', 'meal'].includes(c.kind) || (c.kind === 'fee' && c.amount && vg.feePay !== 'expensed'))
    if (needEv) list.push(['evidence', 0])
    if (vgReceiptKinds().length) list.push(['receipts', 1])
    list.push(['voucher', 1], ['done', 2])
  }
  if (vg.screen === 'amounts') list.splice(list.findIndex(([id]) => id === 'voucher'), 0, ['amounts', 1])
  return list
}
const VG_CHOICE_SCREENS = ['task', 'resumeQ', 'advWhat', 'advEv', 'feePay', 'purpose', 'job', 'evidence']

function vgGo(delta) {
  const list = vgScreens()
  const i = list.findIndex(([id]) => id === vg.screen)
  const next = list[i + delta]
  if (!next) { if (delta < 0) goToCard(vgFrom === 2 ? 2 : 11); return }
  vg.screen = next[0]
  vgSave()
  renderVoucher()
  const cardEl = document.getElementById('card-12')   // 카드 자체가 스크롤 칸이다
  if (cardEl) cardEl.scrollTop = 0
}
function vgJump(screen) {
  vg.screen = screen
  vgSave()
  renderVoucher()
  const cardEl = document.getElementById('card-12')
  if (cardEl) cardEl.scrollTop = 0
}
function vgSet(path, value) {
  const keys = path.split('.')
  let o = vg
  for (const k of keys.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}
  o[keys.at(-1)] = value
  vgSave()
  renderVoucher()
}
// 고르면 잠깐 표시한 뒤 다음 화면으로(본 흐름 select 와 같은 손맛)
function vgPick(path, value) {
  vgSet(path, value)
  setTimeout(() => vgGo(1), 160)
}

// ── 그리기 ──────────────────────────────────────────────────────────────────
function renderVoucher() {
  const body = document.getElementById('vg-screen')
  if (!body || !vg) return
  const list = vgScreens()
  if (!list.some(([id]) => id === vg.screen)) vg.screen = list[0][0]
  const group = list.find(([id]) => id === vg.screen)[1]
  renderVoucherTrail(list, group)
  const r = vgResult()
  vgSyncChecks(r)
  const html = (VG_SCREEN[vg.screen] || (() => ''))(r)
  const notice = vgNotice ? `<div class="vg-notice">${escapeHtml(vgNotice)}</div>` : ''
  vgNotice = ''
  body.innerHTML = notice + html
  document.getElementById('card-12')?.classList.toggle('has-aside', vg.screen === 'voucher' || vg.screen === 'voucher2')
  const next = document.getElementById('vg-next')
  const isChoice = VG_CHOICE_SCREENS.includes(vg.screen)
  next.textContent = { receipts: '다음', amounts: '전표 보기', voucher: vg.task === 'advance' ? `다음 · ${vgWord().later} 최종 정산 보기` : '제출 준비하기', voucher2: '제출 준비하기' }[vg.screen] || '다음'
  next.classList.toggle('hidden', isChoice || vg.screen === 'done')
  next.disabled = vg.screen === 'receipts' && vgReceiptKinds().some(k => vg.finalAmounts?.[k] == null)
}

// 본 흐름(renderTrails)과 같은 모양의 단계 트레일 — 지난 묶음은 눌러서 그 묶음 첫 화면으로 돌아간다
function renderVoucherTrail(list, group) {
  const trail = document.getElementById('vg-progress')
  const info = document.getElementById('vg-progress-info')
  if (!trail || !info) return
  const check = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  trail.innerHTML = VG_GROUPS.map((label, i) => {
    const status = i < group ? 'done' : i === group ? 'current' : 'future'
    const first = list.find(([, g]) => g === i)
    const conn = i ? `<div class="trail-connector${i <= group ? ' done' : ''}"></div>` : ''
    return conn + `<button class="trail-item ${status}" ${status === 'done' && first ? `onclick="vgJump('${first[0]}')"` : 'disabled'} aria-label="${label}"><div class="trail-dot">${status === 'done' ? check : i + 1}</div></button>`
  }).join('')
  const text = `${group + 1} / ${VG_GROUPS.length}단계`
  info.innerHTML = window.innerWidth <= 480
    ? `<span class="trail-mob-badge">${text}</span><span class="trail-mob-label">${VG_GROUPS[group]}</span>`
    : `${text} · ${VG_GROUPS[group]}`
}

// 금액·서류가 바뀌면 이전 확인 표시는 풀고 알린다
function vgSyncChecks(r) {
  if (!r) return
  const sig = JSON.stringify([r.lines.map(l => [l.key, l.side, l.amount]), (r.docs || []).map(d => d.key)])
  if (vg.checksSig && vg.checksSig !== sig && Object.values(vg.checks || {}).some(Boolean)) {
    vg.checks = {}
    vgNotice = '금액이나 서류가 바뀌어서 체크를 다시 풀었어요.'
  }
  vg.checksSig = sig
}

const choice = (on, attrs, icon, title, sub = '') =>
  `<button type="button" class="choice-btn vg-choice${on ? ' is-on' : ''}" ${attrs}><span class="choice-icon">${icon}</span><div><strong>${title}</strong>${sub ? `<span>${sub}</span>` : ''}</div><svg class="choice-arrow" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7.5 15l5-5-5-5" stroke="#c9cdd2" stroke-width="1.5" stroke-linecap="round"/></svg></button>`
const pick = (path, value, icon, title, sub = '') => choice(vgGet(path) === value, `onclick="vgPick('${path}', '${value}')"`, icon, title, sub)
const why = (q, a) => `<details class="vg-why"><summary>${q}</summary><div>${a}</div></details>`
const moneyInput = (path, val, ph = '금액') =>
  `<span class="vg-money"><input type="text" inputmode="numeric" class="info-input" data-money="${path}" value="${val != null && val !== '' ? Number(val).toLocaleString() : ''}" placeholder="${ph}"><em>원</em></span>`
function vgGet(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), vg) }
const q = (title, sub = '') => `<h1 class="card-question">${title}</h1>${sub ? `<p class="card-desc">${sub}</p>` : ''}`

// 이번 건 한 줄 요약(질문 화면 위)
function tripChip() {
  const t = vg.trip
  const day = t.startDate ? shortDate(t.startDate) + (t.endDate && t.endDate !== t.startDate ? ` ~ ${shortDate(t.endDate)}` : '') : ''
  return `<div class="vg-chip"><b>${escapeHtml(t.title || '교육·출장')}</b><span>${day ? `${escapeHtml(day)} · ` : ''}예상 ${Number(vg.planTotal || 0).toLocaleString()}원</span></div>`
}

// 내가 쓴 출장신청서(앞 단계 예상 금액 = 신청서 금액)와 이번 전표 금액을 나란히 — 원 자료 p.5 ①②
// "전표 금액과 출장신청서 금액이 일치하는지 확인, 다르면 출장여비 정산서"를 화면에서 바로 보이게(2026-09-30 지석초이)
// 출장신청서 원본에 형광펜 — 지금 전표에 쓰이는 칸만 칠하고 나머지는 흐리게(2026-09-30 지석초이 "사용자가 한번에 알 수 있도록").
// ① 선지급: 등록비 행만 / ②·한 번 정산: 항목마다 '어떻게 나가는 돈인지'(현금·법인카드·가지급금 정리) 꼬리표 + 출장비 합계 = 차변 합계
const PAY_TAG = { advance: ['가지급금 정리', 't-adv'], bank: ['보통예금', 't-bank'], card: ['법인카드', 't-card'], cash: ['현금 지급', 't-cash'] }
const FORM_KIND = { '일당': 'daily', '숙박비': 'lodging', '교통비': 'transport', '등록비': 'fee' }
function markForm(stage, r) {
  const tpl = document.createElement('template')
  tpl.innerHTML = vg.formHtml
  const pay = {}
  for (const l of r.lines.filter(l => l.side === 'C')) for (const k of l.kinds || []) pay[k] = PAY_TAG[l.key]
  const tag = (el, text, cls = '') => { const t = document.createElement('span'); t.className = `hl-tag ${cls}`; t.textContent = text; el.appendChild(t) }
  let cur = null
  tpl.content.querySelectorAll('tr').forEach(tr => {
    const th = tr.querySelector('th')
    if (th) cur = th.textContent.replace(/\s+/g, '')
    let kind = FORM_KIND[cur] || null
    if (kind === 'transport' && /셔틀/.test(tr.textContent)) kind = 'shuttle'
    else if (kind === 'transport' && /항공/.test(tr.textContent)) kind = 'air'
    const last = tr.querySelector('td:last-child')
    const memoRow = cur === '사유' || cur === '출장기간'
    if (kind) tr.dataset.kind = kind
    if (stage === 1) {
      const advK = (r.lines.find(l => l.side === 'D')?.kinds) || []
      if (kind && advK.includes(kind)) { tr.classList.add('hl-main'); if (th || tr.previousElementSibling?.dataset.kind !== kind) tag(last, kind === 'fee' ? '① 지금 보내는 금액' : '① 지금 받는 금액', 't-now') }
      else if (memoRow) { tr.classList.add('hl-soft'); if (cur === '사유') tag(last, '적요에 써요', 't-memo') }
      else tr.classList.add('hl-dim')
    } else {
      if (kind && pay[kind]) { tr.classList.add('hl-pay'); if (th || !tr.previousElementSibling?.dataset.kind || tr.previousElementSibling.dataset.kind !== kind) tag(last, pay[kind][0], pay[kind][1]) }
      else if (kind) tr.classList.add('hl-dim')
      else if (memoRow && cur === '사유') { tr.classList.add('hl-soft'); tag(last, '적요에 써요', 't-memo') }
    }
  })
  const total = tpl.content.querySelector('.tf-total-row')
  if (total) {
    if (stage === 1) total.classList.add('hl-dim')
    else { total.classList.add('hl-main'); tag(total.querySelector('.tf-total-label') || total, '= 차변 합계', 't-now') }
  }
  return tpl.innerHTML
}

function compareAside(r, kind) {
  const won = v => (v == null ? '—' : `${v.toLocaleString()}원`)
  const checks = []
  const planFee = vgFee()?.amount ?? null
  if (kind === 'advance') {
    const ak = vgAdvKinds()
    const plan = (ak.includes('fee') ? planFee ?? 0 : 0) + (ak.includes('travel') ? Voucher.travelSum(vg) ?? 0 : 0)
    checks.push([ak.includes('travel') ? `신청서 ${vgWord().what}` : '신청서 등록비', plan, '전표 금액', r.sumD])
  } else {
    const planTotal = vg.formTotal ?? vg.planTotal ?? null
    checks.push(['신청서 출장비 합계', planTotal, '전표 전체 비용', r.finalTotal])
    const feeNow = (r.items || []).find(i => i.kind === 'fee')
    if (planFee != null && feeNow) checks.push(['신청서 등록비', planFee, '전표 등록비', feeNow.amount])
  }
  const row = ([la, a, lb, b]) => {
    const ok = a != null && b != null && a === b
    const mark = b == null ? '<i class="vc-need">영수증 후</i>' : ok ? '<i class="vc-ok">✓ 같아요</i>' : `<i class="vc-diff">${b - a > 0 ? '+' : ''}${(b - (a || 0)).toLocaleString()}원</i>`
    return `<div class="vx-row"><div><span>${la}</span><b>${won(a)}</b></div><div><span>${lb}</span><b>${won(b)}</b></div>${mark}</div>`
  }
  const main = checks[0]
  const diff = main[1] != null && main[3] != null && main[1] !== main[3]
  const status = main[3] == null ? '<div class="vc-status is-wait">영수증 금액이 정해지면 비교해요</div>'
    : diff ? `<div class="vc-status is-diff">신청서와 ${main[3] - main[1] > 0 ? '+' : ''}${(main[3] - main[1]).toLocaleString()}원 달라요<small>출장여비 정산서를 함께 내요 (S-portal 양식함)</small></div>`
    : '<div class="vc-status is-ok">✓ 신청서와 전표 금액이 같아요</div>'
  const stage = kind === 'advance' ? 1 : 2
  const legend = stage === 1
    ? `<div class="vx-legend"><mark>형광펜</mark> 칸이 지금 먼저 받는 금액이에요 · 나머지는 ${vgWord().when} ②에서 정산해요</div>`
    : '<div class="vx-legend"><mark>형광펜</mark> 합계가 차변 합계예요 · 항목마다 어떻게 나가는 돈인지 붙여 뒀어요 · 왼쪽 전표 칸을 누르면 해당 행이 칠해져요</div>'
  const form = vg.formHtml
    ? `${legend}<div class="vx-form">${markForm(stage, r)}</div>`
    : '<p class="vc-foot">온라인 교육 등 신청서를 쓰지 않은 건이라 예상 금액과 비교해요.</p>'
  return `<aside class="vg-aside"><div class="vc-card">
    <div class="vc-title">📋 내가 쓴 출장신청서</div>
    ${form}
    <div class="vx-check"><div class="vx-check-title">크로스체크</div>${checks.map(row).join('')}${status}</div>
  </div></aside>`
}

// 2회 정산 단계 표시 — ① 지금 선지급 → ② 영수증 발급 후 최종 정산(2026-09-30 지석초이: 기준은 '교육 종료'가 아니라 '영수증 발급')
// 왜 두 번 정산하나요? — 접지 않고 보여 준다(2026-09-30 지석초이 "왜 두 번 해야 하는지 알기 쉽게")
function twoStepWhy() {
  return `<div class="ts-why"><div class="ts-why-title">왜 두 번 정산하나요?</div>
    <ul class="ts-reasons">
      <li><span>💰</span><p>등록비가 커서 <b>병원 돈으로 먼저 보내야</b> 할 때</p></li>
      <li><span>🧳</span><p>일당·숙박비·교통비를 <b>출장 전에 먼저 받아야</b> 할 때</p></li>
      <li><span>🧾</span><p>영수증 같은 <b>증빙이 아직 없을</b> 때</p></li>
    </ul>
    <div class="ts-flow"><div><b>① 지금 먼저 받기</b><small>가지급금으로 잠시 적어 둬요</small></div><i>→</i>
      <div><b>② 다녀와서 서류가 갖춰지면</b><small>실제 비용으로 최종 정산해요</small></div></div></div>`
}
function stageBar(stage) {
  if (!stage) return `<div class="vs-bar vs-one"><span class="vs-step is-on"><i>1</i>한 번에 정산</span><small>영수증을 모두 받은 뒤 전표 한 장으로 끝나요</small></div>`
  const W = vgWord()
  return `<div class="vs-bar"><span class="vs-step${stage === 1 ? ' is-on' : ' is-done'}"><i>${stage === 1 ? '1' : '✓'}</i><em>지금 · ${W.what} 먼저 받기</em></span><b class="vs-arrow">→</b>
    <span class="vs-step${stage === 2 ? ' is-on' : ''}"><i>2</i><em>${W.later} · 최종 정산</em></span></div>
    ${stage === 1 ? twoStepWhy() : `<p class="vs-note">${W.when} 이 전표로 마무리해요. 먼저 받은 ${W.what}(가지급금)를 여기서 정리해요.</p>`}`
}

function voucherView(r, stage, memo, preview) {
  const D = r.lines.filter(l => l.side === 'D'), C = r.lines.filter(l => l.side === 'C')
  // 2026-09-30 지석초이: 이 화면에서 복사해 시스템에 붙일 환경이 아니다 — 보기 전용, 계정명·금액을 한 줄에 맞춰 정렬
  const amt = l => (l.amount == null && preview ? '영수증 금액' : Voucher.won(l.amount))
  // 장부처럼 한 줄 = 코드 | 계정과목 | 금액, 설명은 계정과목 아래에 같은 줄 시작으로(2026-09-30 지석초이 "코드·계정과목 정렬, 조잡하지 않게")
  const row = l => `<div class="vt-row" tabindex="0" data-side="${l.side}" data-kinds="${(l.kinds || []).join(',')}">
      <span class="vt-code">${escapeHtml(l.code || '확인 필요')}</span>
      <span class="vt-name">${escapeHtml(l.name).replace(/-/g, '-<wbr>')}</span>
      <span class="vt-amt${l.amount == null ? ' is-need' : ''}">${amt(l)}</span>
      <span class="vt-plain">${escapeHtml(l.plain)}${l.memo ? `<em>적요 · ${escapeHtml(l.memo)}</em>` : ''}</span>
    </div>`
  const half = (cls, title, sub, lines, total) => `<div class="vt-half ${cls}">
      <div class="vt-head-row"><b>${title}</b><span>${sub}</span></div>
      <div class="vt-rows">${lines.map(row).join('')}</div>
      <div class="vt-sum"><span>${title} 합계</span><b>${total == null && preview ? '영수증 받은 뒤' : Voucher.won(total)}</b></div>
    </div>`
  const blocks = preview ? [] : r.issues.filter(i => i.level === 'block')
  const ask = '등록비 정산용 증빙은 어떤 종류로, 언제 받을 수 있나요?'
  // 2026-09-30 지석초이: 딱딱한 '전표에 이렇게 적으세요' 대신 친근한 말투로
  const W = vgWord()
  const title = stage === 1 ? `① ${W.what}는 먼저<br>이렇게 처리해요` : stage === 2 && preview ? `② ${W.when}<br>이 전표를 써요` : stage === 2 ? '② 최종 정산은<br>이렇게 해볼까요?' : '회계처리는<br>이렇게 해볼까요?'
  const total = r.balanced ? '<div class="vt-total is-ok">✓ 차변 합계와 대변 합계가 같아요</div>'
    : preview && r.sumD == null ? '<div class="vt-total is-wait">영수증 금액이 정해지면 두 합계가 같아져요</div>'
    : '<div class="vt-total">차변과 대변 합계가 달라요 — 아래 확인할 것을 봐 주세요</div>'
  return `<div class="vg-wrap">${stageBar(stage)}
      ${q(title)}
      <div class="vt-ledger">
        ${half('vt-d', '차변', '돈이 쓰인 곳', D, r.sumD)}
        ${half('vt-c', '대변', '돈이 나간 곳', C, r.sumC)}
      </div>
      ${total}
      ${compareAside(r, stage === 1 ? 'advance' : 'final')}
      <div class="vt-memo-row"><span>적요</span><b>${escapeHtml(memo || '')}</b></div>
      ${preview ? `<p class="vg-hint">${W.when} 첫 화면의 <b>‘${W.btn}’</b>에서 실제 금액으로 이어서 써요.</p>` : ''}
      ${blocks.length ? `<div class="vg-box vg-box-warn"><div class="vg-box-title">⚠️ 확인할 것</div><ul>${blocks.map(b => `<li>${escapeHtml(b.msg)}</li>`).join('')}</ul></div>` : ''}
      ${stage === 1 && vg.feeEvidence === 'unknown' ? `<div class="vg-box"><div class="vg-box-title">주최기관에 이렇게 물어보세요</div><p class="vg-quote">“${ask}”</p></div>` : ''}
      ${preview ? '' : `<button type="button" class="vg-link" onclick="vgJump('amounts')">금액이 달라요 · 고치기</button>`}
      ${why('차변·대변이 뭐예요?', '한 건의 돈을 두 쪽에 나눠 적어요. <b>차변</b>은 돈이 쓰인 곳(비용, 먼저 보낸 돈), <b>대변</b>은 돈이 나간 곳(현금·병원 통장·법인카드)이에요. 두 쪽 합계는 늘 같아요.')}</div>`
}

const VG_SCREEN = {
  task() {
    const fee = vgFee()
    const online = vg.trip.isOnline
    const opts = vgAdvOptions()
    const sub = opts.includes('fee') && opts.includes('travel') ? '등록비를 병원 돈으로 먼저 보내거나, 여비를 미리 받아요'
      : opts.includes('fee') ? `교육 전에 병원 계좌로 등록비 ${fee.amount.toLocaleString()}원 송금` : '일당·숙박비·교통비를 출장 전에 미리 받아요'
    return tripChip() + q('지금 무엇을<br>하려고 하나요?') + `<div class="choice-list">
      ${opts.length ? pick('task', 'advance', '📤', '먼저 받아야 할 돈이 있어요', `${sub} · 두 번 정산`) : ''}
      ${pick('task', 'final', '🧾', online ? '교육비를 정산해요' : '다녀온 비용을 한 번에 정산해요', online ? '교육이 끝난 뒤' : '다녀와서 · 지금 미리 볼 수도 있어요')}
      </div>${opts.length ? why('두 번 정산은 언제 하나요?', '등록비가 커서 병원 돈으로 먼저 보내야 하거나, 일당·숙박비·교통비를 출장 전에 먼저 받아야 하거나, 영수증이 아직 없을 때예요. 먼저 받은 돈은 가지급금으로 적어 두고, 다녀와서 서류가 갖춰지면 실제 비용으로 최종 정산해요.') : ''}`
  },

  advWhat() {
    const fee = vgFee()?.amount, tr = Voucher.travelSum(vg)
    return twoStepWhy() + q('무엇을<br>먼저 받나요?') + `<div class="choice-list">
      ${choice(JSON.stringify(vg.advKinds) === '["fee"]', `onclick="vgPick('advKinds', ['fee'])"`, '🏦', '등록비만', `병원이 주최기관에 ${fee.toLocaleString()}원 먼저 송금`)}
      ${choice(JSON.stringify(vg.advKinds) === '["travel"]', `onclick="vgPick('advKinds', ['travel'])"`, '🧳', '여비만 (일당·숙박비·교통비)', `제가 ${tr.toLocaleString()}원 먼저 받아요`)}
      ${choice(JSON.stringify(vg.advKinds) === '["fee","travel"]', `onclick="vgPick('advKinds', ['fee','travel'])"`, '📦', '등록비 + 여비 둘 다', `모두 ${(fee + tr).toLocaleString()}원`)}
      </div>`
  },

  resumeQ() {
    const W = vgWord()
    return tripChip() + q(`먼저 받기로 한 ${W.what}는<br>처리됐나요?`, `선지급 예정 ${Voucher.won(vgAdvTotal())}`) + `<div class="choice-list">
      ${pick('feePay', 'advance', '✅', '네, 처리됐어요', '가지급금으로 먼저 보내거나 받았어요')}
      ${pick('feePay', 'none', '⏳', '아직 안 됐어요', '이번 정산 때 한꺼번에 처리해요')}
      ${pick('feePay', 'unknown', '❓', '잘 모르겠어요', '전표 처리자에게 확인이 필요해요')}
      ${pick('feePay', 'refund', '↩️', '취소·환불됐어요')}
      </div>`
  },

  advEv() {
    return q('등록비 영수증은<br>언제 받나요?', '세금계산서·현금영수증·카드 매출전표') + `<div class="choice-list">
      ${pick('feeEvidence', 'after', '⏳', '교육이 끝난 뒤에 받아요', '가장 흔한 경우')}
      ${pick('feeEvidence', 'received', '✅', '이미 받았어요')}
      ${pick('feeEvidence', 'unknown', '❓', '모르겠어요', '주최기관에 물어볼 문구를 드려요')}
      </div>`
  },

  feePay() {
    const fee = vgFee()
    return q('등록비는<br>어떻게 냈나요?', `${fee.amount.toLocaleString()}원`) + `<div class="choice-list">
      ${pick('feePay', 'advance', '📤', '병원이 먼저 보냈어요', '가지급금(선지급)')}
      ${pick('feePay', 'card', '💳', '법인카드로 결제했어요')}
      ${pick('feePay', 'none', '🏦', '아직 안 냈어요', '이번 정산 때 병원 계좌로 보내요')}
      ${pick('feePay', 'personal', '👛', '제 돈으로 냈어요')}
      ${pick('feePay', 'unknown', '❓', '잘 모르겠어요')}
      </div>`
  },

  purpose() {
    return q('어떤 목적의<br>비용인가요?') + `<div class="choice-list">
      ${pick('purpose', 'edu', '🎓', '교육·학회 참석', '배우러 간 경우')}
      ${pick('purpose', 'trip', '🧳', '회의·업무 출장', '협의회·세미나·업무 협조 등')}
      </div>` + why('헷갈리면?', '배우러 가면 교육훈련비, 일을 보러 가면 국내출장비예요. 협의회 세미나처럼 애매하면 전표 처리자에게 한 번 확인해 주세요.')
  },

  job() {
    return q('교육받는 분의<br>직종은요?', '직종에 따라 계정이 달라요') + `<div class="choice-list">
      ${pick('job', 'nurse', '🩺', '간호사')}
      ${pick('job', 'tech', '🔬', '의료기사')}
      ${pick('job', 'etc', '👤', '그 외 직원')}
      </div>`
  },

  evidence() {
    const kinds = new Set((vg.costs || []).map(c => c.kind))
    const names = [kinds.has('fee') && '등록비', kinds.has('air') && '항공권', kinds.has('shuttle') && '셔틀', kinds.has('meal') && '식사비'].filter(Boolean)
    return q('영수증은<br>다 받았나요?', names.length ? `${names.join('·')} 영수증(카드 매출전표·세금계산서·현금영수증)` : 'KTX·숙박·일당은 영수증이 필요 없어요') + `<div class="choice-list">
      ${pick('evAll', 'received', '✅', '네, 다 받았어요')}
      ${pick('evAll', 'after', '⏳', '아직 못 받은 게 있어요', '전표는 미리 보고, 받은 뒤 제출해요')}
      </div>`
  },

  // 영수증 금액(항공·셔틀·식사·시외버스처럼 앞 단계에서 금액을 정하지 못한 항목)
  receipts() {
    const rows = (vg.costs || []).filter(c => c.amount == null).map(c =>
      `<div class="vg-amt"><b>${escapeHtml(c.label)}</b>${moneyInput(`finalAmounts.${c.kind}`, vg.finalAmounts?.[c.kind], '영수증 금액')}</div>`).join('')
    return q('영수증 금액을<br>넣어 주세요', '영수증에 적힌 금액 그대로') + `<div class="vg-box">${rows}</div>`
  },

  // 금액 고치기(선택) — 전표 화면의 '금액이 달라요'에서만 온다
  amounts() {
    const rows = (vg.costs || []).map(c => {
      const cur = vg.finalAmounts?.[c.kind] ?? c.amount
      return `<div class="vg-amt"><b>${escapeHtml(c.label)}</b>${moneyInput(`finalAmounts.${c.kind}`, cur)}</div>`
    }).join('')
    const adv = vgModel().bankPay
    return q('바뀐 금액을<br>고쳐 주세요', '신청서와 달라지면 출장여비 정산서를 함께 내요') + `<div class="vg-box">${rows}</div>
      ${vg.task === 'final' && vgModel().travelAdv != null ? `<div class="vg-box"><div class="vg-amt"><b>먼저 받은 여비</b>${moneyInput('advanceTravel', vgModel().travelAdv)}</div></div>` : ''}
      ${vg.task === 'final' && adv && adv.status !== 'unknown' ? `<div class="vg-box"><div class="vg-amt"><b>먼저 보낸 등록비</b>${moneyInput('advanceAmount', adv.amount)}</div>
        <div class="vg-amt"><b>그때 전표번호 <small>(있으면)</small></b><input type="text" class="info-input vg-ref" data-text="advanceRef" value="${escapeHtml(vg.advanceRef || '')}" placeholder="예: 20261001-0001-001"></div></div>` : ''}
      ${vg.task === 'advance' && vgAdvKinds().includes('fee') ? `<div class="vg-box"><div class="vg-amt"><b>먼저 보낼 등록비</b>${moneyInput('advanceAmount', vg.advanceAmount ?? vgFee()?.amount)}</div></div>` : ''}
      ${vg.task === 'advance' && vgAdvKinds().includes('travel') ? `<div class="vg-box"><div class="vg-amt"><b>먼저 받을 여비</b>${moneyInput('advanceTravel', vg.advanceTravel ?? Voucher.travelSum(vg))}</div></div>` : ''}`
  },

  // 전표 — 차변·대변을 크게
  voucher(r) { return voucherView(r, vg.task === 'advance' ? 1 : vgModel().bankPay?.status === 'advance' ? 2 : 0, vg.memo) },
  // ② 영수증 발급 후 최종 정산 전표(선지급 건 미리보기)
  voucher2() { const r2 = vgFinalPreview(); return voucherView(r2, 2, r2.memo, true) },

  // 제출 준비 — 서류 체크리스트가 곧 남은 일 목록이다(체크하면 위 상태가 바로 바뀐다). 전표 요약은 앞 화면과 겹쳐 싣지 않는다.
  done(r) {
    const c = vg.checks || {}
    const left = vgLeft(r)
    const ready = !left.length
    const adv = vg.task === 'advance'
    if (ready && adv && !vg.pendingFinal) { vg.pendingFinal = true; vg.advKinds = vgAdvKinds(); if (vg.advKinds.includes('fee')) vg.advanceAmount = vg.advanceAmount ?? vgFee()?.amount ?? null; if (vg.advKinds.includes('travel')) vg.advanceTravel = vg.advanceTravel ?? Voucher.travelSum(vg); vgSave() }
    const item = (key, title, sub, optional, _req) => `<label class="final-check-item${optional ? ' pending' : ''}">
      <input type="checkbox" class="doc-checkbox" data-check="${key}" ${c[key] ? 'checked' : ''}/>
      <span class="doc-checkmark"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5l2.5 2.5 4.5-5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <div class="final-check-text"><strong>${escapeHtml(title)}${optional ? ' <small>(필요할 때만)</small>' : ''}</strong>${sub ? `<span>${escapeHtml(sub)}</span>` : ''}</div></label>`
    // 2026-09-30 지석초이: 전표 / 증빙(마지막 확인 칸은 지석초이 요청으로 뺌) — 큰 칸으로 먼저 나누고 그 안에 세부 서류. '다시 첨부'는 2회 정산의 ② 전표에서만.
    const again = vg.task === 'final' && (vg.resumed || vgModel().bankPay?.status === 'advance')
    const name = { notice: '교육·출장 공문', feeEvidence: '등록비 영수증' }
    const sub = {
      application: again ? '① 때 냈어도 다시 첨부 · 결재·인사지원팀 합의 확인' : vg.task === 'advance' ? '등록비 금액이 전표와 같은지 · 결재·합의 확인' : '결재·인사지원팀 합의 확인',
      notice: again ? '① 때 냈어도 다시 첨부' : vg.task === 'advance' ? '등록비·입금 계좌 확인' : '신청서 금액 기준이 공문과 같은지',
      bankCopy: '공문에 입금 계좌가 없을 때만', settlement: '신청서 금액과 달라졌어요 · S-portal 양식함',
      feeEvidence: '세금계산서·현금영수증·카드 매출전표 중 하나 · 기관·금액 확인', airEvidence: '법인카드 결제 왕복 전표',
      shuttleEvidence: '법인카드 결제 전표', mealEvidence: '법인카드 결제 전표' }
    const nLines = r.lines.length
    const groups = [
      ['📄', '전표', [item('doc-voucher', '전표', `앞 단계에서 본 대로 · 계정 ${nLines}줄 · 합계 ${Voucher.won(r.sumD)}`, false, true)], ['doc-voucher']],
      ['📎', '증빙', r.docs.map(d => item(`doc-${d.key}`, name[d.key] || d.title, sub[d.key] || d.check, d.optional, !d.optional)), r.docs.filter(d => !d.optional).map(d => `doc-${d.key}`)],
    ]
    const checks = groups.map(([icon, title, items, keys]) => `<div class="vd-group">
        <div class="vd-group-head"><span>${icon} ${title}</span><em>${keys.filter(k => c[k]).length}/${keys.length}</em></div>
        <div class="final-checklist">${items.join('')}</div></div>`).join('')
    // 체크리스트에 없는 남은 일(확인 필요·못 받은 영수증)만 따로 적는다
    const extra = vgLeft(r, true)
    const status = ready
      ? `<div class="vd-status is-ok"><span>✅</span><div><b>${adv ? '① 선지급 전표 제출 준비 끝' : '전표 제출 준비 끝'}</b><small>${adv ? `${vgWord().when} ②로 최종 정산해요` : '내부 절차에 따라 제출하세요'}</small></div></div>`
      : `<div class="vd-status is-left"><span>📋</span><div><b>남은 일 ${left.length}가지</b><small>아래 체크리스트를 채우면 제출 준비가 끝나요</small></div></div>`
    return `<div class="vg-print">${q('서류 챙기고<br>제출해요')}
      ${status}
      ${extra.length ? `<ul class="vd-left">${extra.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
      <div class="vd-checks">${checks}</div>
      ${adv && vg.trip.isJeju ? '<p class="vg-hint">✈️ 항공권·셔틀을 아직 예매 전이면 신청서에 공란 + ‘사후 실비 정산’이라고 적어 두세요.</p>' : ''}
      ${adv ? `<div class="vd-next"><span class="vd-next-num">2</span><div><b>${vgWord().when} 최종 정산</b><small>첫 화면의 ‘${vgWord().btn}’에서 이어서 써요 · 그때 챙길 서류: ${vgFinalPreview().docs.map(d => escapeHtml(name[d.key] || d.title)).join(', ')}</small></div></div>` : ''}
      ${r.usesCashOrBank ? `<p class="vg-warn">⏰ 현금·보통예금 지급 전표는 <b>지급일 1~2일 전</b>까지 경영지원팀에 내요</p>` : ''}
      <p class="vg-small">안내가 끝난 것이지, 지급·정산이 끝난 건 아니에요 · 이 기기에 저장돼 있어요.</p></div>
      <div class="vg-actions">
        <button type="button" class="vg-btn" onclick="window.print()">🖨 인쇄</button>
        <button type="button" class="vg-btn" onclick="if (confirm('저장된 전표 안내를 지울까요?')) { vgDelete(); goToCard(2) }">🗑 삭제</button>
      </div>`
  },
}

function vgLeft(r, extraOnly) {
  const left = r.issues.filter(i => i.level === 'block').map(i => i.msg)
  if (vg.task === 'final' && vg.evAll === 'after') left.push('못 받은 영수증 받기')
  if (extraOnly) return [...new Set(left)]
  const c = vg.checks || {}
  const docsLeft = [...(c['doc-voucher'] ? [] : ['전표 작성']), ...(r.docs || []).filter(d => !d.optional && !c[`doc-${d.key}`]).map(d => `${d.title} 챙기기`)]
  return [...new Set([...left, ...docsLeft])]
}


// 전표 칸을 가리키면 신청서의 해당 행을 칠한다
// 합계 행은 차변(전체 비용) 줄을 가리킬 때만 칠한다 — 대변 현금 줄에 합계까지 칠해졌다(2026-09-30 지석초이).
// 가리키는 동안은 늘 켜 둔 형광펜(합계·등록비)을 잠시 내려 해당 행만 눈에 띄게 한다.
function focusFormRows(kinds, side) {
  const form = document.querySelector('#card-12 .vx-form')
  if (!form) return
  form.classList.toggle('has-focus', kinds.length > 0)
  form.querySelectorAll('[data-kind]').forEach(tr => tr.classList.toggle('is-focus', kinds.includes(tr.dataset.kind)))
  form.querySelectorAll('.tf-total-row').forEach(t => t.classList.toggle('is-focus', side === 'D' && kinds.length > 0))
}

// 입력칸·체크·전표 칸 연결(이벤트 위임)
function bindVoucherEvents() {
  const card = document.getElementById('card-12')
  if (!card || card.dataset.bound) return
  card.dataset.bound = '1'
  const kindsOf = e => (e.target.closest('.vt-row')?.dataset.kinds || '').split(',').filter(Boolean)
  const sideOf = e => e.target.closest('.vt-row')?.dataset.side
  card.addEventListener('mouseover', e => { if (e.target.closest('.vt-row')) focusFormRows(kindsOf(e), sideOf(e)) })
  card.addEventListener('mouseout', e => { if (e.target.closest('.vt-row') && !e.relatedTarget?.closest?.('.vt-row')) focusFormRows([]) })
  card.addEventListener('focusin', e => { if (e.target.closest('.vt-row')) focusFormRows(kindsOf(e), sideOf(e)) })
  card.addEventListener('click', e => { if (e.target.closest('.vt-row')) focusFormRows(kindsOf(e), sideOf(e)) })
  card.addEventListener('change', e => {
    const el = e.target
    if (el.dataset.money) {
      const n = parseInt(el.value.replace(/[^\d]/g, ''), 10)
      vgSet(el.dataset.money, Number.isFinite(n) ? n : null)
    } else if (el.dataset.text) {
      vgSet(el.dataset.text, el.value.trim())
    } else if (el.dataset.check) {
      vg.checks = { ...(vg.checks || {}), [el.dataset.check]: el.checked }
      vgSave()
      renderVoucher()
    }
  })
  card.addEventListener('input', e => {
    const el = e.target
    if (!el.dataset.money) return
    const d = el.value.replace(/[^\d]/g, '')
    el.value = d ? Number(d).toLocaleString() : ''
    const [root, kind] = el.dataset.money.split('.')
    if (vg.screen === 'receipts' && root === 'finalAmounts') {
      // 다 넣었는지 바로 반영(다음 버튼 잠금 해제)
      vg.finalAmounts = { ...(vg.finalAmounts || {}), [kind]: d ? Number(d) : null }
      document.getElementById('vg-next').disabled = vgReceiptKinds().some(k => vg.finalAmounts?.[k] == null)
    }
  })
}

if (typeof document !== 'undefined') {
  loadVoucherRules()
  document.addEventListener('DOMContentLoaded', () => { bindVoucherEvents(); renderVoucherResume() })
  if (document.readyState !== 'loading') { bindVoucherEvents(); renderVoucherResume() }
}
