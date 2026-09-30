// 전표 작성 안내 화면(2026-09-30, 같은 날 전면 개편 — 지석초이 "줄글이 많고 복잡하다, 출장 안내처럼 클릭클릭 넘어가게,
// 차변·대변·계정과목을 크게 보여 줘"). 한 화면에 질문 하나, 고르면 바로 다음으로 넘어간다.
// 계산·분기는 voucher.js, 계정·기준은 data/voucher_rules.json. 저장은 이 기기 브라우저에만 한다.

const VG_KEY = 'expense_guide_voucher_v1'
const VG_GROUPS = ['상황 확인', '전표 작성', '서류 확인', '제출 준비']
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
  return { version: 2, trip, costs, planTotal: total, screen: 'task', checks: {}, tripKey: Voucher.tripKey(trip), fromFlow: true }
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
    Object.assign(vg, { task: 'final', feePay: null, resumed: true, evAll: null, checks: {}, memoEdited: false, pendingFinal: false, screen: 'resumeQ' })
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
    ? `<b>${escapeHtml(t.title || '교육·출장')}</b><span>최종 정산이 남아 있어요 · 선지급 ${Voucher.won(s.advanceAmount)}${day ? ` · ${escapeHtml(day)}` : ''}</span>`
    : `<b>${escapeHtml(t.title || '교육·출장')}</b><span>전표 안내를 이어서 할 수 있어요${day ? ` · ${escapeHtml(day)}` : ''}</span>`
  const go = s.pendingFinal
    ? `<button type="button" class="vg-btn vg-btn-primary" onclick="resumeVoucherGuide(true)">다녀왔어요 · 최종 정산 시작</button>`
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

// 한 번에 하나씩 받은 답을 voucher.js 입력(paid·bankPay·cardItems·evidence)으로 옮긴다
function vgModel() {
  const fee = vgFee()
  const m = { ...vg, paid: {}, bankPay: null, cardItems: {}, evidence: {}, refund: vg.feePay === 'refund' }
  const pay = vg.feePay || (vgFeePaidByCardBefore() ? 'card' : null)
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
  if (!vg.memoEdited) vg.memo = Voucher.memoDraft(m)
  m.memo = vg.memo
  if (vg.task === 'advance') { m.advanceAmount = vg.advanceAmount ?? vgFee()?.amount ?? null; return Voucher.buildAdvance(m, VG_RULES) }
  return Voucher.buildFinal(m, VG_RULES)
}

// ── 화면 순서 ───────────────────────────────────────────────────────────────
// [화면 id, 묶음] — 답에 따라 필요 없는 화면은 뺀다. 선택지 화면은 고르면 바로 넘어간다.
function vgScreens() {
  const list = []
  if (vg.resumed) list.push(['resumeQ', 0])
  else list.push(['task', 0])
  if (vg.task === 'advance') {
    list.push(['advEv', 0], ['voucher', 1], ['docs', 2], ['done', 3])
  } else if (vg.task === 'final') {
    if (vgFee() && !vg.resumed && !vgFeePaidByCardBefore()) list.push(['feePay', 0])
    list.push(['purpose', 0])
    if (vg.purpose === 'edu') list.push(['job', 0])
    const needEv = (vg.costs || []).some(c => ['air', 'shuttle', 'meal'].includes(c.kind) || (c.kind === 'fee' && c.amount && vg.feePay !== 'expensed'))
    if (needEv) list.push(['evidence', 0])
    if (vgReceiptKinds().length) list.push(['receipts', 1])
    list.push(['voucher', 1], ['docs', 2], ['done', 3])
  }
  if (vg.screen === 'amounts') list.splice(list.findIndex(([id]) => id === 'voucher'), 0, ['amounts', 1])
  return list
}
const VG_CHOICE_SCREENS = ['task', 'resumeQ', 'advEv', 'feePay', 'purpose', 'job', 'evidence']

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
  const next = document.getElementById('vg-next')
  const isChoice = VG_CHOICE_SCREENS.includes(vg.screen)
  next.textContent = { receipts: '다음', amounts: '전표 보기', voucher: '서류 챙기기', docs: '제출 준비 보기' }[vg.screen] || '다음'
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
const copyBtn = (text, label = '복사') => `<button type="button" class="vg-copy" data-copy="${escapeHtml(text)}">${label}</button>`
function vgGet(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), vg) }
const q = (title, sub = '') => `<h1 class="card-question">${title}</h1>${sub ? `<p class="card-desc">${sub}</p>` : ''}`

// 이번 건 한 줄 요약(질문 화면 위)
function tripChip() {
  const t = vg.trip
  const day = t.startDate ? shortDate(t.startDate) + (t.endDate && t.endDate !== t.startDate ? ` ~ ${shortDate(t.endDate)}` : '') : ''
  return `<div class="vg-chip"><b>${escapeHtml(t.title || '교육·출장')}</b><span>${day ? `${escapeHtml(day)} · ` : ''}예상 ${Number(vg.planTotal || 0).toLocaleString()}원</span></div>`
}

const VG_SCREEN = {
  task() {
    const fee = vgFee()
    const online = vg.trip.isOnline
    const canAdvance = fee && !vgFeePaidByCardBefore()
    return tripChip() + q('지금 무엇을<br>하려고 하나요?') + `<div class="choice-list">
      ${canAdvance ? pick('task', 'advance', '📤', '등록비를 먼저 보내요', `교육 전에 병원 계좌로 ${fee.amount.toLocaleString()}원 송금`) : ''}
      ${pick('task', 'final', '🧾', online ? '교육비를 정산해요' : '다녀온 비용을 정산해요', online ? '교육이 끝난 뒤' : '다녀와서 · 지금 미리 볼 수도 있어요')}
      </div>`
  },

  resumeQ() {
    return tripChip() + q('먼저 보낸 등록비는<br>처리됐나요?', `선지급 예정 ${Voucher.won(vg.advanceAmount)}`) + `<div class="choice-list">
      ${pick('feePay', 'advance', '✅', '네, 보냈어요', '가지급금으로 먼저 보냄')}
      ${pick('feePay', 'none', '⏳', '아직 안 보냈어요', '이번 정산 때 보내요')}
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
      ${vg.task === 'final' && adv && adv.status !== 'unknown' ? `<div class="vg-box"><div class="vg-amt"><b>먼저 보낸 등록비</b>${moneyInput('advanceAmount', adv.amount)}</div>
        <div class="vg-amt"><b>그때 전표번호 <small>(있으면)</small></b><input type="text" class="info-input vg-ref" data-text="advanceRef" value="${escapeHtml(vg.advanceRef || '')}" placeholder="예: 20261001-0001-001"></div></div>` : ''}
      ${vg.task === 'advance' ? `<div class="vg-box"><div class="vg-amt"><b>먼저 보낼 등록비</b>${moneyInput('advanceAmount', vg.advanceAmount ?? vgFee()?.amount)}</div></div>` : ''}`
  },

  // 전표 — 차변·대변을 크게
  voucher(r) {
    const D = r.lines.filter(l => l.side === 'D'), C = r.lines.filter(l => l.side === 'C')
    const card = (l, side) => `<div class="vt-card vt-${side}">
      <button type="button" class="vt-code" data-copy="${escapeHtml(l.code || '')}" ${l.code ? '' : 'disabled'}>${escapeHtml(l.code || '코드 확인 필요')}</button>
      <div class="vt-name">${escapeHtml(l.name)}</div>
      <button type="button" class="vt-amt" data-copy="${l.amount ?? ''}" ${l.amount == null ? 'disabled' : ''}>${Voucher.won(l.amount)}</button>
      <div class="vt-plain">${escapeHtml(l.plain)}${l.memo ? ` · <span class="vt-memo">적요: ${escapeHtml(l.memo)}</span>` : ''}</div>
    </div>`
    const kind = vg.task === 'advance' ? '등록비 선지급 전표' : '최종 정산 전표'
    const flow = vg.task === 'advance' ? '지금 선지급 → 교육 후 최종 정산' : (vgModel().bankPay?.status === 'advance' ? '선지급 등록비까지 정리' : '한 번에 정산')
    const blocks = r.issues.filter(i => i.level === 'block')
    const ask = '등록비 정산용 증빙은 어떤 종류로, 언제 받을 수 있나요?'
    return `<div class="vt-head"><span class="vt-kind">${kind}</span><span class="vt-flow">${escapeHtml(flow)}</span></div>
      ${q('전표에 이렇게<br>적으세요', '코드·금액을 누르면 복사돼요')}
      <div class="vt-grid">
        <div class="vt-col"><div class="vt-col-title"><b>차변</b><span>돈이 쓰인 곳</span></div>${D.map(l => card(l, 'd')).join('')}</div>
        <div class="vt-col"><div class="vt-col-title"><b>대변</b><span>돈이 나간 곳</span></div>${C.map(l => card(l, 'c')).join('')}</div>
      </div>
      <div class="vt-total${r.balanced ? ' is-ok' : ''}"><span>합계</span><b>${Voucher.won(r.sumD)}</b><i>${r.balanced ? '=' : '≠'}</i><b>${Voucher.won(r.sumC)}</b><em>${r.balanced ? '✓ 일치' : '확인 필요'}</em></div>
      <div class="vt-memo-row"><label>적요</label><textarea class="info-input vg-textarea" rows="2" data-text="memo" data-memo="1">${escapeHtml(vg.memo || '')}</textarea>${copyBtn(vg.memo || '', '복사')}</div>
      ${blocks.length ? `<div class="vg-box vg-box-warn"><div class="vg-box-title">⚠️ 확인할 것</div><ul>${blocks.map(b => `<li>${escapeHtml(b.msg)}</li>`).join('')}</ul></div>` : ''}
      ${vg.task === 'advance' && vg.feeEvidence === 'unknown' ? `<div class="vg-box"><div class="vg-box-title">주최기관에 이렇게 물어보세요</div><p class="vg-quote">“${ask}”</p>${copyBtn(ask, '문구 복사')}</div>` : ''}
      <button type="button" class="vg-link" onclick="vgJump('amounts')">금액이 달라요 · 고치기</button>
      ${why('차변·대변이 뭐예요?', '한 건의 돈을 두 쪽에 나눠 적어요. <b>차변</b>은 돈이 쓰인 곳(비용, 먼저 보낸 돈), <b>대변</b>은 돈이 나간 곳(현금·병원 통장·법인카드)이에요. 두 쪽 합계는 늘 같아요.')}
      ${why('원 자료 사례 보기', vg.task === 'advance'
        ? '등록비 800,000원을 먼저 보낸 전표: 차변 가지급금-기타 800,000 / 대변 보통예금 800,000 (경영지원팀 전표 실무길라잡이 p.6)'
        : '선지급 뒤 최종 정산: 차변 여비교통비-국내출장비 1,339,700 / 대변 법인카드 7줄 382,200 · 현금 2명 157,500 · 가지급금-기타 800,000 (p.7). 법인카드는 매출전표 한 장마다 한 줄, 현금은 받는 직원마다 한 줄이에요.')}`
  },

  docs(r) {
    const c = vg.checks || {}
    const item = (key, title, sub, optional) => `<label class="final-check-item${optional ? ' pending' : ''}">
      <input type="checkbox" class="doc-checkbox" data-check="${key}" ${c[key] ? 'checked' : ''}/>
      <span class="doc-checkmark"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5l2.5 2.5 4.5-5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <div class="final-check-text"><strong>${escapeHtml(title)}${optional ? ' <small>(필요할 때만)</small>' : ''}</strong>${sub ? `<span>${escapeHtml(sub)}</span>` : ''}</div></label>`
    const short = { application: vg.task === 'final' ? '앞서 냈어도 다시 첨부 · 결재·인사지원팀 합의 확인' : '등록비 금액이 전표와 같은지 · 결재·합의 확인',
      notice: vg.task === 'final' ? '앞서 냈어도 다시 첨부' : '등록비·입금 계좌 확인', bankCopy: '공문에 입금 계좌가 없을 때만',
      settlement: '신청서 금액과 달라졌어요 · S-portal 양식함', feeEvidence: '기관·금액이 맞는지', airEvidence: '법인카드 결제 왕복 전표',
      shuttleEvidence: '법인카드 결제 전표', mealEvidence: '법인카드 결제 전표' }
    const docs = r.docs.map(d => item(`doc-${d.key}`, d.title, short[d.key] || d.check, d.optional)).join('')
    const mine = vgUserChecks(r).map(([k, l]) => item(k, l, '', false)).join('')
    return q('붙일 서류를<br>챙겨 주세요', '챙긴 것에 체크하세요') + `<div class="final-checklist">${docs}</div>
      <div class="vg-box-title">마지막으로 확인</div><div class="final-checklist">${mine}</div>
      ${vg.task === 'advance' && vg.trip.isJeju ? '<p class="vg-hint">✈️ 항공권·셔틀을 아직 예매 전이면 신청서에 공란 + ‘사후 실비 정산’이라고 적어 두세요.</p>' : ''}`
  },

  done(r) {
    const left = vgLeft(r)
    const ready = !left.length
    const adv = vg.task === 'advance'
    if (ready && adv && !vg.pendingFinal) { vg.pendingFinal = true; vg.advanceAmount = vg.advanceAmount ?? vgFee()?.amount ?? null; vgSave() }
    const summary = vgSummaryText(r)
    const D = r.lines.filter(l => l.side === 'D'), C = r.lines.filter(l => l.side === 'C')
    const row = l => `<div class="vd-row"><span class="vd-code">${escapeHtml(l.code || '—')}</span><span class="vd-name">${escapeHtml(l.name)}</span><b>${Voucher.won(l.amount)}</b></div>`
    return `<div class="vg-print">
      <div class="vd-status ${ready ? 'is-ok' : 'is-left'}"><span>${ready ? '✅' : '⚠️'}</span><div><b>${ready ? (adv ? '선지급 전표 제출 준비 끝' : '전표 제출 준비 끝') : `남은 일 ${left.length}가지`}</b>
        <small>${ready ? (adv ? '교육이 끝나면 최종 정산을 이어서 해요' : '내부 절차에 따라 제출하세요') : '아래를 마친 뒤 제출하세요'}</small></div></div>
      ${left.length ? `<ul class="vd-left">${left.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
      <div class="vd-voucher"><div class="vd-side"><em>차변</em>${D.map(row).join('')}</div><div class="vd-side"><em>대변</em>${C.map(row).join('')}</div>
        <div class="vd-memo">적요 · ${escapeHtml(vg.memo || '')}</div></div>
      ${r.usesCashOrBank ? `<p class="vg-warn">⏰ 현금·보통예금 지급 전표는 <b>지급일 1~2일 전</b>까지 경영지원팀에 내요</p>` : ''}
      <p class="vg-small">안내가 끝난 것이지, 지급·정산이 끝난 건 아니에요.</p></div>
      <div class="vg-actions">
        ${copyBtn(summary, '📋 전체 복사')}
        <button type="button" class="vg-btn" onclick="window.print()">🖨 인쇄</button>
        <button type="button" class="vg-btn" onclick="if (confirm('저장된 전표 안내를 지울까요?')) { vgDelete(); goToCard(2) }">🗑 삭제</button>
      </div>
      ${adv && ready ? '<p class="vg-hint">다녀온 뒤 첫 화면의 <b>‘다녀왔어요 · 최종 정산 시작’</b>을 누르세요 (이 기기에 저장됨)</p>' : '<p class="vg-hint">이 기기에 저장돼 있어요. 첫 화면에서 이어서 할 수 있어요.</p>'}`
  },
}

// [키, 체크 문구, 남은 일 문구]
function vgUserChecks(r) {
  const out = [['user-dup', '기존 전표와 겹치지 않아요', '기존 전표와 겹치지 않는지 확인']]
  if (r.usesCashOrBank) out.push(['user-payee', '받는 곳·계좌가 맞아요', '받는 곳·계좌 확인'])
  return out
}
function vgLeft(r) {
  const left = r.issues.filter(i => i.level === 'block').map(i => i.msg)
  if (vg.task === 'final' && vg.evAll === 'after') left.push('못 받은 영수증 받기')
  const c = vg.checks || {}
  const docsLeft = (r.docs || []).filter(d => !d.optional && !c[`doc-${d.key}`]).map(d => `${d.title} 챙기기`)
  const userLeft = vgUserChecks(r).filter(([k]) => !c[k]).map(([, , left]) => left)
  return [...new Set([...left, ...docsLeft, ...userLeft])]
}

function vgSummaryText(r) {
  const t = vg.trip
  const L = [`[${vg.task === 'advance' ? '등록비 선지급 전표' : '최종 정산 전표'}] ${t.title || ''}`]
  if (t.startDate) L.push(`일정: ${t.startDate}${t.endDate && t.endDate !== t.startDate ? ` ~ ${t.endDate}` : ''}`)
  L.push(`적요: ${vg.memo || ''}`)
  for (const l of r.lines) L.push(`${l.side === 'D' ? '차변' : '대변'}  ${l.code || '코드 확인 필요'} ${l.name}  ${Voucher.won(l.amount)}${l.memo ? `  (${l.memo})` : ''}`)
  L.push(`합계: 차변 ${Voucher.won(r.sumD)} / 대변 ${Voucher.won(r.sumC)}`)
  L.push(`서류: ${(r.docs || []).map(d => d.title + (d.optional ? '(필요 시)' : '')).join(', ')}`)
  if (vg.task === 'advance') L.push('남은 일: 교육이 끝나면 영수증을 받아 최종 정산 전표 작성')
  return L.join('\n')
}

// 입력칸·복사·체크(이벤트 위임)
function bindVoucherEvents() {
  const card = document.getElementById('card-12')
  if (!card || card.dataset.bound) return
  card.dataset.bound = '1'
  card.addEventListener('change', e => {
    const el = e.target
    if (el.dataset.money) {
      const n = parseInt(el.value.replace(/[^\d]/g, ''), 10)
      vgSet(el.dataset.money, Number.isFinite(n) ? n : null)
    } else if (el.dataset.text) {
      if (el.dataset.memo) vg.memoEdited = true
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
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]')
    if (!b || b.disabled) return
    const text = b.dataset.copy
    const done = () => { const o = b.dataset.label || b.textContent; b.dataset.label = o; b.classList.add('is-copied'); b.textContent = '복사됨 ✓'; setTimeout(() => { b.textContent = o; b.classList.remove('is-copied') }, 1100) }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done))
    else fallbackCopy(text, done)
  })
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea')
  ta.value = text; document.body.appendChild(ta); ta.select()
  try { document.execCommand('copy'); done() } catch { /* 복사 불가 */ }
  ta.remove()
}

if (typeof document !== 'undefined') {
  loadVoucherRules()
  document.addEventListener('DOMContentLoaded', () => { bindVoucherEvents(); renderVoucherResume() })
  if (document.readyState !== 'loading') { bindVoucherEvents(); renderVoucherResume() }
}
