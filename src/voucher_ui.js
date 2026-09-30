// 전표 작성 안내 화면(2026-09-30). 계산·분기는 voucher.js, 계정·기준은 data/voucher_rules.json.
// 카드11(구비서류) 아래에서 원하는 사람만 들어온다. 답에 따라 필요 없는 화면은 건너뛴다.
// 저장은 이 기기 브라우저에만 한다(계좌번호·증빙 원본은 받지 않는다).

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
  try { const v = JSON.parse(localStorage.getItem(VG_KEY) || 'null'); return v && v.version === 1 ? v : null } catch { return null }
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
    feeStatus: state.feeStatus, receiptType: state.receiptType, nights: state.nights, days: state.days,
  }
  const costs = breakdown.map(b => ({ kind: b.kind, label: b.label, amount: typeof b.amount === 'number' ? b.amount : null, note: b.note && String(b.note).replace(/<[^>]+>/g, '') }))
  return { version: 1, trip, costs, planTotal: total, screen: 'confirm', checks: {}, answers: true,
           tripKey: Voucher.tripKey(trip), fromFlow: true }
}

function startVoucherGuide() {
  if (!VG_RULES) { alert('전표 기준 자료를 불러오지 못했어요. 새로고침한 뒤 다시 눌러 주세요.'); return }
  const fresh = vgFromState()
  const saved = vgLoad()
  if (saved && saved.tripKey === fresh.tripKey) {
    // 같은 건을 이어서 — 앞 단계 금액이 바뀌었으면 새 예상 금액으로 바꾸고 알린다
    vg = saved
    if (JSON.stringify(saved.costs) !== JSON.stringify(fresh.costs)) {
      vg.costs = fresh.costs; vg.planTotal = fresh.planTotal
      vgNotice = '앞 단계 금액이 바뀌어 예상 금액을 새로 가져왔어요.'
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
  if (finalNow) startFinalAfterAdvance()
  vgFrom = 2
  goToCard(12)
  renderVoucher()
}

// 선지급을 마친 건의 최종 정산 시작 — 저장된 '지급 예정액'을 '실제 지급액'으로 여기지 않고 다시 묻는다
function startFinalAfterAdvance() {
  const planned = vg.advanceAmount
  vg.task = 'final'
  vg.paid = { bank: true }
  vg.bankPay = { amount: null, ref: '', status: null, plannedAmount: planned }
  vg.resume = { done: null, changed: null }
  vg.evidence = {}
  vg.checks = {}
  vg.memo = ''
  vg.pendingFinal = false
  vg.screen = 'resume'
  vgSave()
}

function renderVoucherResume() {
  const box = document.getElementById('voucher-resume')
  if (!box) return
  const s = vgLoad()
  if (!s) { box.classList.add('hidden'); box.innerHTML = ''; return }
  const t = s.trip || {}
  const day = t.startDate ? `교육 일정 ${shortDate(t.startDate)}${t.endDate && t.endDate !== t.startDate ? ` ~ ${shortDate(t.endDate)}` : ''}` : ''
  const head = s.pendingFinal
    ? `<b>${escapeHtml(t.title || '교육·출장')} — 최종 정산이 남아 있어요</b><span>먼저 보내기로 한 등록비 ${Voucher.won(s.advanceAmount)} · ${escapeHtml(day)}</span>`
    : `<b>${escapeHtml(t.title || '교육·출장')} 전표 안내를 이어서 할 수 있어요</b><span>${escapeHtml(day)}</span>`
  const go = s.pendingFinal
    ? `<button type="button" class="vg-btn vg-btn-primary" onclick="resumeVoucherGuide(true)">다녀왔어요 · 최종 정산 시작</button>`
    : `<button type="button" class="vg-btn vg-btn-primary" onclick="resumeVoucherGuide(false)">이어하기</button>`
  box.innerHTML = `<div class="vg-resume">${head}<small>이 기기에 저장된 내용이에요 · ${fmtSaved(s.savedAt)}</small>
    <div class="vg-resume-btns">${go}<button type="button" class="vg-btn" onclick="if (confirm('저장된 전표 안내를 지울까요?')) vgDelete()">저장 삭제</button></div></div>`
  box.classList.remove('hidden')
}
function fmtSaved(iso) {
  const d = new Date(iso || '')
  return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 저장`
}

// ── 화면 순서 ───────────────────────────────────────────────────────────────
// [화면 id, 묶음(진행 표시)] — 답에 따라 필요 없는 화면은 뺀다
function vgScreens() {
  const list = []
  if (vg.screen === 'resume' || vg.resume) list.push(['resume', 0])
  else list.push(['confirm', 0], ['task', 0])
  if (vg.task === 'advance') {
    // 확인이 필요한 경우(D·E)도 미리 보기는 이어 갈 수 있다 — 제출 준비 완료로는 표시하지 않는다
    list.push(['adv', 0], ['plan', 0], ['voucher', 1], ['docs', 2], ['check', 3], ['done', 3])
    return list
  }
  if (vg.task === 'final') {
    list.push(['paid', 0])
    if (vgEvidenceKinds().length) list.push(['evidence', 0])
    list.push(['plan', 0], ['account', 1], ['amounts', 1], ['voucher', 1], ['docs', 2], ['check', 3], ['done', 3])
  }
  return list
}
function vgEvidenceKinds() {
  const kinds = new Set((vg.costs || []).map(c => c.kind))
  const out = []
  const feeExpensed = vg.paid?.bank && vg.bankPay?.status === 'expensed'
  if (kinds.has('fee') && !feeExpensed && (vg.costs.find(c => c.kind === 'fee').amount || (vg.finalAmounts || {}).fee)) out.push('fee')
  for (const k of ['air', 'shuttle', 'meal']) if (kinds.has(k)) out.push(k)
  return out
}
function vgResult() {
  if (!vg || !VG_RULES || !vg.task) return null
  if (!vg.memoEdited) vg.memo = Voucher.memoDraft(vg)
  return vg.task === 'advance' ? Voucher.buildAdvance(vg, VG_RULES) : Voucher.buildFinal(vg, VG_RULES)
}

function vgGo(delta) {
  const list = vgScreens()
  const i = list.findIndex(([id]) => id === vg.screen)
  const next = list[i + delta]
  if (!next) {
    if (delta < 0) { goToCard(vgFrom === 2 ? 2 : 11); return }
    return
  }
  if (vg.screen === 'resume' && delta > 0) vg.resume = null
  vg.screen = next[0]
  vgSave()
  renderVoucher()
  const cardEl = document.getElementById('card-12')   // 카드 자체가 스크롤 칸이다
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

// ── 그리기 ──────────────────────────────────────────────────────────────────
function renderVoucher() {
  const body = document.getElementById('vg-screen')
  if (!body || !vg) return
  const list = vgScreens()
  if (!list.some(([id]) => id === vg.screen)) vg.screen = list[0][0]
  const idx = list.findIndex(([id]) => id === vg.screen)
  const group = list[idx][1]
  renderVoucherTrail(list, group)
  const r = vgResult()
  vgSyncChecks(r)
  const html = (VG_SCREEN[vg.screen] || (() => ''))(r)
  const notice = vgNotice ? `<div class="vg-notice">${escapeHtml(vgNotice)}</div>` : ''
  vgNotice = ''
  body.innerHTML = notice + html
  const next = document.getElementById('vg-next')
  const nextLabel = VG_NEXT_LABEL[vg.screen]
  next.textContent = typeof nextLabel === 'function' ? nextLabel(r) : (nextLabel || '다음')
  next.disabled = !vgCanNext(r)
  next.classList.toggle('hidden', vg.screen === 'done')
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
function vgJump(screen) {
  vg.screen = screen
  vgSave()
  renderVoucher()
  const cardEl = document.getElementById('card-12')
  if (cardEl) cardEl.scrollTop = 0
}

// 금액·서류가 바뀌면 이전 확인 표시는 풀고 알린다
function vgSyncChecks(r) {
  if (!r) return
  const sig = JSON.stringify([r.lines.map(l => [l.key, l.side, l.amount]), (r.docs || []).map(d => d.key)])
  if (vg.checksSig && vg.checksSig !== sig && Object.values(vg.checks || {}).some(Boolean)) {
    vg.checks = {}
    vgNotice = '금액이나 서류가 바뀌어서, 앞서 한 확인 표시를 다시 풀었어요.'
  }
  vg.checksSig = sig
}

function vgCanNext(r) {
  switch (vg.screen) {
    case 'task': return !!vg.task
    case 'adv': return !!vg.feeEvidence && vg.advanceAmount > 0
    case 'resume': return vg.bankPay?.status != null && vg.resume?.done != null && vg.resume?.changed != null
    case 'paid': return vgPaidAnswered()
    case 'evidence': return vgEvidenceKinds().every(k => vg.evidence?.[k])
    case 'plan': return true
    case 'account': return !!Voucher.expenseAccountKey(vg.purpose, vg.job) || (vg.purpose === 'edu' && vg.job === 'unknown')
    default: return true
  }
}
function vgPaidAnswered() {
  const p = vg.paid || {}
  if (!Object.values(p).some(Boolean)) return false
  if (p.bank && !vg.bankPay?.status) return false
  if (p.card && !(vg.cardItems && 'fee' in vg.cardItems)) return false
  return true
}

const VG_NEXT_LABEL = {
  confirm: '이 내용으로 계속', plan: r => (r && r.plan.code === 'D' ? '그래도 전표 미리 보기' : r && r.plan.code === 'E' ? '확인할 내용 정리하기' : '이번 전표 작성하기'),
  voucher: '서류 확인하기', docs: '제출 전 점검하기', check: r => (r && r.ready && vgUserChecksDone(r) ? '제출 안내 보기' : '남은 일 정리해서 보기'),
}

const choice = (on, attrs, icon, title, sub = '') =>
  `<button type="button" class="choice-btn vg-choice${on ? ' is-on' : ''}" ${attrs}><span class="choice-icon">${icon}</span><div><strong>${title}</strong>${sub ? `<span>${sub}</span>` : ''}</div></button>`
const pill = (on, attrs, label) => `<button type="button" class="vg-pill${on ? ' is-on' : ''}" ${attrs}>${label}</button>`
const why = (q, a) => `<details class="vg-why"><summary>${q}</summary><div>${a}</div></details>`
const moneyInput = (path, val, ph = '금액') =>
  `<span class="vg-money"><input type="text" inputmode="numeric" class="info-input" data-money="${path}" value="${val != null && val !== '' ? Number(val).toLocaleString() : ''}" placeholder="${ph}"><em>원</em></span>`
const copyBtn = (text, label = '복사') => `<button type="button" class="vg-copy" data-copy="${escapeHtml(text)}">${label}</button>`

function accountCard(key) {
  const a = VG_RULES.accounts[key]
  if (!a) return ''
  return `<div class="vg-acc"><div class="vg-acc-plain">${escapeHtml(a.plain)}</div>
    <div class="vg-acc-row"><b>${escapeHtml(a.name)}</b>${copyBtn(a.name, '계정명 복사')}</div>
    <div class="vg-acc-row"><code>${escapeHtml(a.code)}</code>${copyBtn(a.code, '코드 복사')}</div></div>`
}

const VG_SCREEN = {
  // 1. 작성할 교육·출장 확인
  confirm() {
    const t = vg.trip
    const period = t.startDate ? `${shortDate(t.startDate)}${t.endDate && t.endDate !== t.startDate ? ` ~ ${shortDate(t.endDate)}` : ''}` : '일정 입력 필요'
    const rows = (vg.costs || []).map(c => `<div class="vg-row"><span>${escapeHtml(c.label)}</span><b>${c.amount == null ? '<em class="vg-need">금액 확인 필요</em>' : `${c.amount.toLocaleString()}원`}</b></div>`).join('')
    return `<h1 class="card-question">이 건의 전표를<br>작성할게요</h1>
      <p class="card-desc">아래 금액은 앞 단계에서 계산한 <b>예상 금액</b>이에요. 실제 정산할 금액은 뒤에서 한 번 더 확인해요.</p>
      <div class="vg-box">
        <div class="vg-row"><span>교육·출장명</span><b>${escapeHtml(t.title || '입력 필요')}</b></div>
        <div class="vg-row"><span>일정</span><b>${escapeHtml(period)}</b></div>
        <div class="vg-row"><span>장소</span><b>${escapeHtml(t.isOnline ? '온라인' : [t.region, t.place].filter(Boolean).join(' · ') || '입력 필요')}</b></div>
        ${t.dept || t.name ? `<div class="vg-row"><span>소속·성명</span><b>${escapeHtml([t.dept, t.name].filter(Boolean).join(' · '))}</b></div>` : ''}
      </div>
      <div class="vg-box"><div class="vg-box-title">예상 금액</div>${rows || '<div class="vg-row"><span>계산된 금액이 없어요</span></div>'}
        <div class="vg-row vg-row-total"><span>예상 합계</span><b>${(vg.planTotal || 0).toLocaleString()}원${(vg.costs || []).some(c => c.amount == null) ? ' + 확인 필요 금액' : ''}</b></div></div>
      ${vg.fromFlow ? '<button type="button" class="vg-link" onclick="goToCard(4)">정보 수정하러 가기</button>' : ''}`
  },

  // 2. 지금 필요한 처리
  task() {
    const fee = (vg.costs || []).find(c => c.kind === 'fee' && c.amount)
    const online = vg.trip.isOnline
    const paidByCard = vg.trip.feeStatus === 'paid' && vg.trip.receiptType === 'card-receipt'
    return `<h1 class="card-question">지금 어떤 처리가<br>필요한가요?</h1>
      <div class="choice-list">
        ${fee && !paidByCard ? choice(vg.task === 'advance', `onclick="vgSet('task','advance')"`, '📤', '병원 계좌로 등록비를 먼저 보내야 해요',
          '납부 기한이 교육보다 먼저라, 교육 전에 병원이 주최기관에 등록비를 보내는 경우') : ''}
        ${choice(vg.task === 'final', `onclick="vgSet('task','final')"`, '🧾', online ? '교육을 마친 비용을 정산하려고 해요' : '다녀온 비용을 정산하려고 해요',
          online ? '교육이 끝나고 증빙을 받았을 때' : '다녀와서 증빙을 모았을 때 · 지금은 미리 보고 저장해 둘 수 있어요')}
      </div>
      ${fee && !paidByCard ? why('등록비를 먼저 보내면 뭐가 달라요?', '등록비를 미리 내야 하거나 병원에서 먼저 보내야 하는 경우예요. 정산용 증빙을 언제 받을 수 있는지에 따라 처리 방법이 달라져요.') : ''}
      ${paidByCard ? '<p class="vg-hint">등록비는 앞에서 법인카드로 결제했다고 하셨어요. 카드 결제는 먼저 보내는 전표가 필요 없어서, 다녀온 뒤 정산에서 함께 정리해요.</p>' : ''}`
  },

  // 2-A. 선지급: 증빙 시점
  adv() {
    const fee = (vg.costs || []).find(c => c.kind === 'fee')
    if (vg.advanceAmount == null && fee?.amount) vg.advanceAmount = fee.amount
    const ask = '등록비 정산에 필요한 증빙은 어떤 종류로, 언제 발급받을 수 있나요?'
    return `<h1 class="card-question">등록비 증빙은<br>언제 받을 수 있나요?</h1>
      <p class="card-desc">돈을 보냈더라도 정산용 증빙(영수증·세금계산서 등)은 나중에 받을 수 있어요.</p>
      <div class="vg-field"><label>먼저 보낼 등록비</label>${moneyInput('advanceAmount', vg.advanceAmount)}<small>공문·신청서의 등록비와 같아야 해요</small></div>
      <div class="choice-list">
        ${choice(vg.feeEvidence === 'after', `onclick="vgSet('feeEvidence','after')"`, '⏳', '교육이 끝난 뒤 받을 수 있어요')}
        ${choice(vg.feeEvidence === 'received', `onclick="vgSet('feeEvidence','received')"`, '✅', '이미 받았어요')}
        ${choice(vg.feeEvidence === 'unknown', `onclick="vgSet('feeEvidence','unknown')"`, '❓', '발급 시점을 모르겠어요')}
      </div>
      ${vg.feeEvidence === 'unknown' ? `<div class="vg-box"><div class="vg-box-title">주최기관에 이렇게 물어보세요</div><p class="vg-quote">“${ask}”</p>${copyBtn(ask, '문의 문구 복사')}<small class="vg-small">복사만 해요. 메시지를 대신 보내지는 않아요.</small></div>` : ''}
      ${why('신청 안내문이나 송금 내역만 있으면 안 되나요?', '신청 안내문·입금 계좌 안내·송금 내역은 돈을 보낸 기록이에요. 정산에 쓰는 증빙(카드 매출전표·세금계산서·사업자번호로 받은 현금영수증)이 따로 있는지 확인해야 해요.')}`
  },

  // 재개: 선지급 뒤 최종 정산
  resume() {
    const p = vg.bankPay || {}
    const st = (v, label, sub = '') => choice(p.status === v, `onclick="vgSet('bankPay.status','${v}')"`, { advance: '📤', expensed: '🧾', unknown: '❓' }[v], label, sub)
    return `<h1 class="card-question">최종 정산 전에<br>몇 가지만 확인할게요</h1>
      <p class="card-desc">저장해 둔 금액은 ‘보낼 예정’이던 금액이에요. 실제로 처리된 내용을 알려 주세요.</p>
      <div class="vg-box-title">먼저 보낸 등록비는 어떻게 처리됐나요?</div>
      <div class="choice-list">
        ${st('advance', '가지급금으로 보냈어요', '가지급금-기타 전표로 먼저 보냄')}
        ${st('expensed', '비용으로 이미 처리했어요')}
        ${st('unknown', '확인이 필요해요', '기존 전표에 ‘가지급금-기타’가 있는지 보거나 전표 처리자에게 물어보세요')}
      </div>
      ${p.status === 'advance' || p.status === 'expensed' ? `<div class="vg-field"><label>실제로 보낸 금액</label>${moneyInput('bankPay.amount', p.amount, p.plannedAmount ? `예정 ${p.plannedAmount.toLocaleString()}` : '금액')}</div>
      <div class="vg-field"><label>기존 전표번호 <small>(있으면)</small></label><input type="text" class="info-input" data-text="bankPay.ref" value="${escapeHtml(p.ref || '')}" placeholder="예: 20261001-0001-001"></div>` : ''}
      <div class="vg-box-title">교육·출장이 끝났나요?</div>
      <div class="vg-pills">${pill(vg.resume?.done === true, `onclick="vgSet('resume.done',true)"`, '끝났어요')}${pill(vg.resume?.done === false, `onclick="vgSet('resume.done',false)"`, '아직이에요')}</div>
      ${vg.resume?.done === false ? '<p class="vg-hint">최종 정산은 교육이 끝나고 증빙을 받은 뒤에 해요. 지금은 미리 보기로만 이어갈 수 있어요.</p>' : ''}
      <div class="vg-box-title">금액이나 일정이 바뀌었나요?</div>
      <div class="vg-pills">${pill(vg.resume?.changed === 'none', `onclick="vgSet('resume.changed','none');vgSet('refund',false)"`, '바뀐 것 없어요')}${pill(vg.resume?.changed === 'amount', `onclick="vgSet('resume.changed','amount');vgSet('refund',false)"`, '금액·일정이 바뀌었어요')}${pill(vg.resume?.changed === 'refund', `onclick="vgSet('resume.changed','refund');vgSet('refund',true)"`, '취소·환불이 있어요')}</div>
      ${vg.resume?.changed === 'amount' ? '<p class="vg-hint">뒤의 ‘최종 금액’ 화면에서 바뀐 금액을 넣어 주세요. 신청서와 달라지면 출장여비 정산서를 함께 준비해요.</p>' : ''}
      ${vg.resume?.changed === 'refund' ? `<p class="vg-warn">${escapeHtml(VG_RULES.unconfirmed.refund)}</p>` : ''}`
  },

  // 3. 이미 결제·지급한 내역
  paid() {
    const p = vg.paid || {}
    if (!vg.paidPrefilled) {
      vg.paidPrefilled = true
      const feeAmt0 = (vg.costs.find(c => c.kind === 'fee') || {}).amount ?? null
      // 앞 단계 답을 미리 채우되, 계좌이체를 '가지급금'으로 짐작하지는 않는다(처리 상태는 사용자가 고른다)
      if (vg.trip.feeStatus === 'paid' && vg.trip.receiptType === 'card-receipt') { p.card = true; vg.cardItems = { fee: feeAmt0 } }
      else if (vg.trip.feeStatus === 'paid' && vg.trip.receiptType) { p.bank = true; vg.bankPay = vg.bankPay || { amount: feeAmt0, ref: '', status: null } }
      vg.paid = p
    }
    const tog = (k, icon, label, sub = '') => choice(!!p[k], `onclick="vgTogglePaid('${k}')"`, icon, label, sub)
    const bp = vg.bankPay || {}
    const feeAmt = (vg.costs.find(c => c.kind === 'fee') || {}).amount
    return `<h1 class="card-question">이 건으로 이미 결제하거나<br>지급한 금액이 있나요?</h1>
      <p class="card-desc">여러 개를 고를 수 있어요. 먼저 지급한 금액은 최종 정산에 함께 반영해서, 같은 금액을 다시 지급하지 않게 해요.</p>
      <div class="choice-list">
        ${tog('bank', '🏦', '병원에서 주최기관에 송금했어요', '등록비 등을 병원 계좌에서 보냄')}
        ${p.bank ? `<div class="vg-sub">
          <div class="vg-field"><label>보낸 금액</label>${moneyInput('bankPay.amount', bp.amount)}</div>
          <div class="vg-field"><label>기존 전표번호 <small>(있으면)</small></label><input type="text" class="info-input" data-text="bankPay.ref" value="${escapeHtml(bp.ref || '')}" placeholder="예: 20261001-0001-001"></div>
          <div class="vg-box-title">그 송금은 어떻게 처리됐나요?</div>
          <div class="vg-pills">${pill(bp.status === 'advance', `onclick="vgSet('bankPay.status','advance')"`, '가지급금으로 처리')}${pill(bp.status === 'expensed', `onclick="vgSet('bankPay.status','expensed')"`, '비용으로 이미 처리')}${pill(bp.status === 'unknown', `onclick="vgSet('bankPay.status','unknown')"`, '확인이 필요해요')}</div>
          ${bp.status === 'unknown' ? `<p class="vg-hint">모르겠다면 기존 전표에서 ‘가지급금-기타’가 있는지 확인하거나 전표 처리자에게 물어보세요. 지금 내용은 저장해 두고 이어서 할 수 있어요.</p>` : ''}
        </div>` : ''}
        ${tog('card', '💳', '법인카드로 결제했어요', '항공·셔틀·식사는 법인카드 결제가 원칙이에요')}
        ${p.card ? `<div class="vg-sub"><div class="vg-box-title">등록비도 법인카드로 결제했나요?</div>
          <div class="vg-pills">${pill(vg.cardItems && vg.cardItems.fee > 0, `onclick="vgSet('cardItems.fee', ${feeAmt || 0})"`, '네, 등록비도 카드로')}${pill(vg.cardItems && 'fee' in vg.cardItems && !(vg.cardItems.fee > 0), `onclick="vgSet('cardItems.fee', 0)"`, '아니요')}</div>
          ${vg.cardItems && vg.cardItems.fee > 0 ? `<div class="vg-field"><label>카드로 결제한 등록비</label>${moneyInput('cardItems.fee', vg.cardItems.fee)}</div>` : ''}
          <small class="vg-small">항공료·셔틀·식사비 결제 금액은 뒤의 ‘최종 금액’에서 매출전표 금액으로 넣어요.</small></div>` : ''}
        ${tog('personal', '👛', '개인이 먼저 결제했어요')}
        ${p.personal ? `<p class="vg-warn">${escapeHtml(VG_RULES.unconfirmed.personalPrepay)}</p>` : ''}
        ${tog('none', '🙅', '지급한 금액이 없어요')}
        ${tog('unknown', '❓', '잘 모르겠어요')}
      </div>`
  },

  // 4. 증빙 준비 상태
  evidence() {
    const kinds = vgEvidenceKinds()
    const ev = vg.evidence || {}
    if (!vg.evPrefilled) {
      vg.evPrefilled = true
      if (vg.trip.feeStatus === 'paid' && vg.trip.receiptType && vg.trip.receiptType !== 'transfer') { ev.fee = 'received'; vg.feeEvidenceType = vg.trip.receiptType }
      vg.evidence = ev
    }
    const types = [['card-receipt', '신용카드 매출전표'], ['tax-invoice', '세금계산서'], ['cash-receipt', '현금영수증'], ['other', '그 외 서류']]
    const rows = kinds.map(k => `<div class="vg-ev">
      <div class="vg-box-title">${escapeHtml(Voucher.KIND_LABEL[k])} 증빙</div>
      <div class="vg-pills">${pill(ev[k] === 'received', `onclick="vgSet('evidence.${k}','received')"`, '받았어요')}${pill(ev[k] === 'after', `onclick="vgSet('evidence.${k}','after')"`, k === 'fee' ? '교육이 끝난 뒤 받아요' : '아직 없어요')}${pill(ev[k] === 'unknown', `onclick="vgSet('evidence.${k}','unknown')"`, '모르겠어요')}</div>
      ${k === 'fee' && ev.fee === 'received' ? `<div class="vg-sublabel">어떤 증빙을 받았나요?</div><div class="vg-pills">${types.map(([v, l]) => pill(vg.feeEvidenceType === v, `onclick="vgSet('feeEvidenceType','${v}')"`, l)).join('')}</div>
        ${vg.feeEvidenceType === 'other' ? '<p class="vg-hint">적격증빙은 신용카드 매출전표·(세금)계산서·사업자번호로 받은 현금영수증이에요. 그 밖의 서류로 되는지는 전표 처리자에게 확인해 주세요.</p>' : ''}` : ''}
    </div>`).join('')
    return `<h1 class="card-question">정산에 쓸 영수증(증빙)은<br>준비됐나요?</h1>
      <p class="card-desc">증빙은 돈을 냈다는 공식 영수증이에요(카드 매출전표·세금계산서·현금영수증). 항목마다 따로 확인해요.</p>${rows}
      ${why('KTX·숙박 영수증은 안 내나요?', escapeHtml(VG_RULES.fixedCashNote))}`
  },

  // 5. 처리 방법
  plan(r) {
    const p = r.plan
    const blocks = r.issues.filter(i => i.level === 'block' && !/^amount-|^account$|^balance$/.test(i.key))
    return `<h1 class="card-question">${escapeHtml(p.title)}</h1>
      <p class="card-desc">${escapeHtml(p.why)}</p>
      <div class="vg-steps">
        <div class="vg-steps-row"><span class="vg-tag">지금</span><b>${escapeHtml(p.now)}</b></div>
        ${p.later ? `<div class="vg-steps-row"><span class="vg-tag vg-tag-later">나중</span><b>${escapeHtml(p.later)}</b></div>` : ''}
      </div>
      ${blocks.length ? `<div class="vg-box vg-box-warn"><div class="vg-box-title">확인이 필요한 것 ${blocks.length}가지</div><ul>${blocks.map(b => `<li>${escapeHtml(b.msg)}</li>`).join('')}</ul></div>` : ''}
      ${p.code === 'D' || p.code === 'E' ? `<button type="button" class="vg-btn vg-btn-gap" onclick="vgSave();vgNotice='이 기기에 저장했어요. 첫 화면에서 이어서 할 수 있어요.';renderVoucher()">저장하고 나중에 이어하기</button>` : ''}
      ${p.code === 'B' ? why('가지급금이 뭐예요?', escapeHtml(VG_RULES.accounts.advance.plain) + '. 증빙을 받은 뒤 최종 정산 전표에서 실제 비용 계정으로 옮겨 정리해요.') : ''}`
  },

  // 6. 비용 계정
  account() {
    const key = Voucher.expenseAccountKey(vg.purpose, vg.job)
    return `<h1 class="card-question">어떤 목적의<br>비용인가요?</h1>
      <p class="card-desc">목적에 따라 비용 계정이 달라져요.</p>
      <div class="choice-list">
        ${choice(vg.purpose === 'edu', `onclick="vgSet('purpose','edu')"`, '🎓', '교육·학회 참석', '역량 향상·직무 교육, 학술대회 참가')}
        ${choice(vg.purpose === 'trip', `onclick="vgSet('purpose','trip')"`, '🧳', '회의·협의회·업무 출장', '외부에서 업무를 보러 간 경우 (예: 협의회 세미나, 세무조정 출장)')}
      </div>
      ${vg.purpose === 'edu' ? `<div class="vg-box-title">교육받는 분의 직종은요?</div>
        <div class="vg-pills">${[['nurse', '간호사'], ['tech', '의료기사'], ['etc', '그 외 직원'], ['unknown', '확인 필요']].map(([v, l]) => pill(vg.job === v, `onclick="vgSet('job','${v}')"`, l)).join('')}</div>
        ${vg.job === 'unknown' ? '<p class="vg-hint">직종에 따라 계정이 나뉘어요. 인사 기록의 직종을 확인해 주세요. 직급으로 짐작하지 않아요.</p>' : ''}` : ''}
      ${key ? `<div class="vg-box"><div class="vg-box-title">이번 비용은 이 계정으로 안내할게요</div>${accountCard(key)}</div>` : ''}
      ${why('목적은 어떻게 고르나요?', '교육·학회처럼 배우러 가면 교육훈련비(직종별), 외부에서 업무를 보러 가면 여비교통비-국내출장비예요. 협의회 세미나처럼 애매하면 전표 처리자에게 한 번 확인해 주세요.')}`
  },

  // 7. 최종 금액
  amounts(r) {
    const items = r.items || []
    const fin = vg.finalAmounts || {}
    const row = it => {
      const fixed = it.basis === 'fixed'
      return `<div class="vg-amt"><div><b>${escapeHtml(it.label)}</b><small>${fixed ? '기준 금액 · 출장여비 규정' : '증빙 금액 · 영수증에 적힌 금액'}</small>${it.excluded ? '<small class="vg-need">이미 비용 처리 — 이번 전표에서 빼요</small>' : ''}</div>
        ${fixed ? `<span class="vg-amt-val">${Voucher.won(it.amount)}</span><button type="button" class="vg-link" onclick="vgEditAmount('${it.kind}')">바뀌었어요</button>` : moneyInput(`finalAmounts.${it.kind}`, fin[it.kind] ?? it.amount, '영수증 금액')}
        ${fixed && vg.editKinds?.[it.kind] ? `<div class="vg-sub">${moneyInput(`finalAmounts.${it.kind}`, fin[it.kind] ?? it.amount)}</div>` : ''}</div>`
    }
    const creditRows = r.lines.filter(l => l.side === 'C' && l.key !== 'cash')
    const cash = r.lines.find(l => l.side === 'C' && l.key === 'cash')
    const diff = r.planTotal != null && r.finalTotal != null ? r.finalTotal - r.planTotal : null
    return `<h1 class="card-question">최종 금액을<br>확인할게요</h1>
      <div class="vg-box"><div class="vg-box-title">① 전체 인정 비용</div>${items.map(row).join('')}
        <div class="vg-row vg-row-total"><span>합계</span><b>${Voucher.won(r.finalTotal)}</b></div></div>
      <div class="vg-box"><div class="vg-box-title">② 이미 지급·결제한 내역</div>
        ${creditRows.length ? creditRows.map(l => `<div class="vg-row"><span>${escapeHtml(l.plain)}</span><b>${Voucher.won(l.amount)}</b></div>`).join('') : '<div class="vg-row"><span>없어요</span></div>'}
        ${r.expensedExcluded ? `<div class="vg-row"><span>이미 비용 처리된 등록비(이번 전표 제외)</span><b>${r.expensedExcluded.toLocaleString()}원</b></div>` : ''}</div>
      <div class="vg-box vg-box-strong"><div class="vg-box-title">③ 이번 전표</div>
        <div class="vg-row"><span>이번 전표의 비용</span><b>${Voucher.won(r.sumD)}</b></div>
        <div class="vg-row vg-row-total"><span>이번에 직원에게 지급할 금액</span><b>${cash ? Voucher.won(cash.amount) : '없어요'}</b></div></div>
      ${diff ? `<p class="vg-warn">신청서 예상 금액(${r.planTotal.toLocaleString()}원)과 ${diff > 0 ? '+' : ''}${diff.toLocaleString()}원 달라요. 출장여비 정산서를 함께 준비해요.</p>` : ''}
      ${why('기준 금액과 증빙 금액은 뭐가 달라요?', escapeHtml(VG_RULES.fixedCashNote))}`
  },

  // 8. 전표 미리보기
  voucher(r) {
    const t = vg.trip
    const rows = r.lines.map(l => `<tr><td class="vg-acc-cell"><b>${escapeHtml(l.name)}</b><small>${escapeHtml(l.code || '코드 확인 필요')}</small><small class="vg-plain">${escapeHtml(l.plain)}</small>${l.memo ? `<small class="vg-memo">적요: ${escapeHtml(l.memo)}</small>` : ''}</td>
      <td class="num" data-label="차변">${l.side === 'D' ? Voucher.won(l.amount) : ''}</td><td class="num" data-label="대변">${l.side === 'C' ? Voucher.won(l.amount) : ''}</td>
      <td class="vg-copies">${l.code ? copyBtn(l.code, '코드') : ''}${copyBtn(l.name, '계정명')}${l.amount != null ? copyBtn(String(l.amount), '금액') : ''}</td></tr>`).join('')
    return `<h1 class="card-question">대체전표에<br>이렇게 적어요</h1>
      <p class="card-desc">기본 정보 → 차변 → 대변 → 합계 순서로 적어요.</p>
      <div class="vg-box"><div class="vg-box-title">기본 정보</div>
        <div class="vg-row"><span>전표일자</span><b>제출하는 날짜</b></div>
        <div class="vg-row"><span>부서·작성자</span><b>${escapeHtml([t.dept, t.name].filter(Boolean).join(' · ') || '본인 부서·이름')}</b></div>
        <div class="vg-field"><label>적요 <small>(고칠 수 있어요)</small></label><textarea class="info-input vg-textarea" rows="2" data-text="memo" data-memo="1">${escapeHtml(vg.memo || '')}</textarea>${copyBtn(vg.memo || '', '적요 복사')}</div></div>
      ${why('차변·대변이 뭐예요?', '전표는 한 건의 돈을 두 쪽에 나눠 적어요. <b>차변</b>(왼쪽)에는 돈이 어디에 쓰였는지(교육비·출장비, 또는 먼저 보낸 돈)를, <b>대변</b>(오른쪽)에는 그 돈이 어디서 나갔는지(현금·병원 통장·법인카드)를 적어요. 두 쪽 합계는 항상 같아야 해요.')}
      <div class="vg-lead"><b>먼저 차변</b> — 비용 또는 먼저 보내는 금액을 적어요.</div>
      <div class="vg-lead"><b>다음 대변</b> — 돈을 어디서 냈는지(현금·보통예금·법인카드·가지급금 정리)를 줄마다 적어요.</div>
      <div class="vg-table-wrap"><table class="vg-table"><colgroup><col class="c-acc"><col class="c-num"><col class="c-num"><col class="c-copy"></colgroup><thead><tr><th>계정</th><th>차변</th><th>대변</th><th></th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><td>합계</td><td class="num" data-label="차변">${Voucher.won(r.sumD)}</td><td class="num" data-label="대변">${Voucher.won(r.sumC)}</td><td>${r.balanced ? '<span class="vg-ok">일치</span>' : '<span class="vg-need">확인 필요</span>'}</td></tr></tfoot></table></div>
      ${r.lines.some(l => l.key === 'card') ? '<p class="vg-hint">법인카드 줄은 매출전표 한 장마다 한 줄씩 적어요. 적요에는 카드번호와 승인일을 적어요(원 자료 p.7 사례).</p>' : ''}
      ${r.lines.some(l => l.key === 'cash') ? '<p class="vg-hint">현금 줄은 받는 직원마다 한 줄씩, 적요에 사번을 적어요(원 자료 p.5·p.7 사례).</p>' : ''}
      ${r.lines.some(l => l.key === 'advance' && l.side === 'C') ? `<p class="vg-hint">가지급금 줄의 적요에는 먼저 보낸 전표의 번호를 적어요. ERP에서 원래 전표를 불러오는 방법은 자료 범위 밖이라 전표 처리자에게 확인해 주세요.</p>` : ''}
      ${r.issues.length ? `<div class="vg-box vg-box-warn"><div class="vg-box-title">확인할 것</div><ul>${r.issues.map(i => `<li>${escapeHtml(i.msg)}</li>`).join('')}</ul></div>` : ''}
      ${why('예시 보기 — 원 자료의 전표', vg.task === 'advance'
        ? '사전 등록비 800,000원을 주최기관에 먼저 보낸 사례: 차변 가지급금-기타 800,000 / 대변 보통예금 800,000 (원 자료 p.6)'
        : '선지급 후 최종 정산 사례: 차변 여비교통비-국내출장비 1,339,700 / 대변 법인카드 7줄 382,200 · 현금 2명 157,500 · 가지급금-기타 800,000 (원 자료 p.7)')}`
  },

  // 9. 서류
  docs(r) {
    const c = vg.checks || {}
    return `<h1 class="card-question">이번 전표에<br>붙일 서류예요</h1>
      <p class="card-desc">준비한 서류에 표시해 주세요. 표시는 ‘준비했어요’라는 뜻이고, 앱이 서류를 검사하지는 않아요.</p>
      <div class="final-checklist">${r.docs.map(d => `<label class="final-check-item${d.optional ? ' pending' : ''}">
        <input type="checkbox" class="doc-checkbox" data-check="doc-${d.key}" ${c[`doc-${d.key}`] ? 'checked' : ''}/>
        <span class="doc-checkmark"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5l2.5 2.5 4.5-5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <div class="final-check-text"><strong>${escapeHtml(d.title)}${d.optional ? ' <small>(필요할 때만)</small>' : ''}</strong><span>${escapeHtml(d.check)}</span></div></label>`).join('')}</div>
      ${vg.task === 'advance' && vg.trip.isJeju ? '<p class="vg-hint">제주 항공권·공항 셔틀은 아직 예매 전이면 신청서에 공란으로 두고 ‘사후 실비 정산’이라고 적어 둬요(원 자료 p.6).</p>' : ''}`
  },

  // 10. 제출 전 점검
  check(r) {
    const c = vg.checks || {}
    const auto = [
      ['차변·대변 합계가 같아요', r.balanced],
      ['빠진 금액이 없어요', !r.issues.some(i => /^amount-/.test(i.key) || i.key === 'fee' || i.key === 'advAmount')],
      ...(vg.task === 'final' && vg.paid?.bank ? [['먼저 보낸 등록비를 반영했어요', vg.bankPay?.status === 'advance' ? r.lines.some(l => l.key === 'advance') : vg.bankPay?.status === 'expensed']] : []),
      ...(vg.task === 'final' ? [['신청서 금액과 최종 금액', r.changed ? '달라요 — 출장여비 정산서 첨부' : r.finalTotal == null ? null : true]] : []),
      ['같은 결제가 두 번 들어가지 않았어요', !r.issues.some(i => i.key === 'dupFee')],
    ]
    const users = vgUserChecks(r)
    const left = vgLeft(r)
    return `<h1 class="card-question">제출 전에<br>점검할게요</h1>
      <div class="vg-box"><div class="vg-box-title">자동으로 확인한 것</div>${auto.map(([l, ok]) => `<div class="vg-row"><span>${escapeHtml(l)}</span><b>${ok === true ? '<span class="vg-ok">확인</span>' : typeof ok === 'string' ? `<span class="vg-need">${escapeHtml(ok)}</span>` : '<span class="vg-need">확인 필요</span>'}</b></div>`).join('')}
        <small class="vg-small">합계가 맞는다고 회계 처리 전체가 검증된 건 아니에요.</small></div>
      <div class="vg-box"><div class="vg-box-title">직접 확인해 주세요</div>${users.map(([k, l]) => `<label class="vg-check"><input type="checkbox" data-check="${k}" ${c[k] ? 'checked' : ''}><span>${escapeHtml(l)}</span></label>`).join('')}</div>
      ${left.length ? `<div class="vg-box vg-box-warn"><div class="vg-box-title">아직 ${left.length}가지가 남았어요</div><ul>${left.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : '<div class="vg-box vg-box-ok">남은 확인이 없어요.</div>'}`
  },

  // 11. 제출 안내
  done(r) {
    const left = vgLeft(r)
    const ready = !left.length
    const adv = vg.task === 'advance'
    const head = ready
      ? (adv ? '등록비 선지급 전표<br>제출 준비가 끝났어요' : '전표 제출 준비가<br>끝났어요')
      : '아직 확인할 것이<br>남아 있어요'
    const desc = ready
      ? (adv ? '이번에는 등록비를 먼저 보내는 단계예요. 교육이 끝나면 증빙을 받아 최종 정산을 이어서 해 주세요.' : '작성 내용과 서류를 확인한 뒤 내부 절차에 따라 제출해 주세요.')
      : '아래 남은 일을 마친 뒤 제출해 주세요. 지금 내용은 이 기기에 저장돼 있어요.'
    if (ready && adv && !vg.pendingFinal) { vg.pendingFinal = true; vgSave() }
    const summary = vgSummaryText(r)
    return `<div class="vg-print">
      <h1 class="card-question">${head}</h1><p class="card-desc">${escapeHtml(desc)}</p>
      ${left.length ? `<div class="vg-box vg-box-warn"><div class="vg-box-title">남은 일 ${left.length}가지</div><ul>${left.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="vg-box"><div class="vg-box-title">요약</div><pre class="vg-summary">${escapeHtml(summary)}</pre></div>
      ${r.usesCashOrBank ? `<p class="vg-warn">⏰ ${escapeHtml(VG_RULES.deadline.cashOrBank)}</p>` : ''}
      <p class="vg-small">안내를 마친 것이지, 지급이나 정산이 끝난 것은 아니에요. 제출·지급은 내부 절차에 따라 진행돼요.</p></div>
      <div class="vg-actions">
        ${copyBtn(summary, '작성 내용 복사')}
        <button type="button" class="vg-btn" onclick="window.print()">저장·인쇄</button>
        <button type="button" class="vg-btn" onclick="vgSave();vgNotice='이 기기에 저장했어요. 첫 화면에서 이어서 할 수 있어요.';renderVoucher()">나중에 이어하기</button>
        <button type="button" class="vg-btn" onclick="if (confirm('저장된 전표 안내를 지울까요?')) { vgDelete(); goToCard(2) }">저장 삭제</button>
      </div>
      ${adv && ready ? '<p class="vg-hint">다녀온 뒤 첫 화면의 ‘다녀왔어요 · 최종 정산 시작’을 누르면 이어서 할 수 있어요(이 기기에서만).</p>' : ''}`
  },
}

// [키, 체크 문구, 남은 일 문구]
function vgUserChecks(r) {
  const out = [['user-dup', '기존 전표와 중복 처리하지 않았어요', '기존 전표와 중복되지 않는지 확인']]
  if (r.usesCashOrBank) out.push(['user-payee', '지급 대상과 계좌 정보가 맞아요', '지급 대상과 계좌 정보 확인'])
  out.push(['user-approval', '필요한 결재·합의와 증빙을 확인했어요', '결재·합의와 증빙 확인'])
  return out
}
function vgUserChecksDone(r) { return vgUserChecks(r).every(([k]) => vg.checks?.[k]) }
function vgLeft(r) {
  const left = r.issues.filter(i => i.level === 'block').map(i => i.msg)
  const c = vg.checks || {}
  const docsLeft = (r.docs || []).filter(d => !d.optional && !c[`doc-${d.key}`]).map(d => `${d.title} 준비`)
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
  if (vg.task === 'final') {
    L.push(`전체 비용: ${Voucher.won(r.finalTotal)}`)
    const cash = r.lines.find(l => l.key === 'cash')
    if (cash) L.push(`이번 직원 지급액: ${Voucher.won(cash.amount)}`)
  }
  L.push(`준비 서류: ${(r.docs || []).map(d => d.title + (d.optional ? '(필요 시)' : '')).join(', ')}`)
  if (vg.task === 'advance') L.push('남은 일: 교육이 끝나면 증빙을 받아 최종 정산 전표 작성')
  return L.join('\n')
}

function vgTogglePaid(k) {
  const p = { ...(vg.paid || {}) }
  if (k === 'none' || k === 'unknown') {
    const on = !p[k]
    Object.keys(p).forEach(x => { p[x] = false })
    p[k] = on
  } else {
    p[k] = !p[k]
    p.none = false
    p.unknown = false
  }
  if (!p.bank) vg.bankPay = null
  else if (!vg.bankPay) vg.bankPay = { amount: (vg.costs.find(c => c.kind === 'fee') || {}).amount ?? null, ref: '', status: null }
  if (!p.card) delete vg.cardItems
  vg.paid = p
  vgSave()
  renderVoucher()
}
function vgEditAmount(kind) {
  vg.editKinds = { ...(vg.editKinds || {}), [kind]: true }
  renderVoucher()
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
    if (el.dataset.money) {
      const d = el.value.replace(/[^\d]/g, '')
      el.value = d ? Number(d).toLocaleString() : ''
    }
  })
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]')
    if (!b) return
    const text = b.dataset.copy
    const done = () => { const o = b.textContent; b.textContent = '복사됨'; setTimeout(() => { b.textContent = o }, 1200) }
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
