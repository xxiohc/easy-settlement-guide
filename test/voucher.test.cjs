// 전표 작성 안내 계산·분기 검증(2026-09-30). 기준: data/voucher_rules.json(경영지원팀 전표 실무길라잡이 발췌).
// 금액은 PDF 사례(p.4·p.6·p.7)와 기획안 검증 기준 1~12를 따른다.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const V = require('../src/voucher.js')
const R = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/voucher_rules.json'), 'utf8'))

const trip = { title: '의료기관 회계기준 연수', startDate: '2026-10-12', endDate: '2026-10-13', place: '서울', hasDoc: true }
const COSTS = [
  { kind: 'transport', label: 'KTX 일반실', amount: 119600 },
  { kind: 'daily', label: '일당 (2일)', amount: 70000 },
  { kind: 'lodging', label: '숙박비 (1박)', amount: 100000 },
  { kind: 'fee', label: '교육비 / 등록비', amount: 300000 },
]
const base = extra => ({ trip, costs: COSTS, purpose: 'edu', job: 'etc', planTotal: 589600, ...extra })
const byKey = (r, key, side) => r.lines.filter(l => l.key === key && (!side || l.side === side))
const blocks = r => r.issues.filter(i => i.level === 'block').map(i => i.key)

test('계정 코드는 자료에서 확인한 값만 쓴다', () => {
  assert.equal(R.accounts.eduNurse.code, '5301-16-03')
  assert.equal(R.accounts.eduTech.code, '5301-16-04')
  assert.equal(R.accounts.eduEtc.code, '5301-16-99')
  assert.equal(R.accounts.travel.code, '5301-02-02')
  assert.equal(R.accounts.cash.code, '1101')
  assert.equal(R.accounts.bank.code, '1102-02')
  assert.equal(R.accounts.card.code, '2110-07')
  assert.equal(R.accounts.advance.code, '1114-99')
})

test('① 다녀온 뒤 한 번에 정산 — 등록비는 보통예금, 정액은 현금, 차대 일치', () => {
  const r = V.buildFinal(base({ task: 'final', paid: { none: true }, evidence: { fee: 'received' } }), R)
  assert.equal(r.plan.code, 'A')
  assert.equal(r.lines[0].name, '교육훈련비-기타')
  assert.equal(r.sumD, 589600)
  assert.equal(byKey(r, 'bank', 'C')[0].amount, 300000)
  assert.equal(byKey(r, 'cash', 'C')[0].amount, 289600)
  assert.ok(r.balanced && r.ready)
  assert.ok(!r.docs.some(d => d.key === 'settlement'), '신청서 금액과 같으면 정산서 불필요')
})

test('② 등록비 선지급, 증빙은 교육 후 — 차 가지급금-기타 / 대 보통예금(p.6)', () => {
  const r = V.buildAdvance(base({ task: 'advance', feeEvidence: 'after' }), R)
  assert.equal(r.plan.code, 'B')
  assert.deepEqual(r.lines.map(l => [l.name, l.side, l.amount]), [['가지급금-기타', 'D', 300000], ['보통예금', 'C', 300000]])
  assert.ok(r.ready)
  assert.ok(r.docs.some(d => d.key === 'application') && r.docs.some(d => d.key === 'notice'))
  assert.ok(r.usesCashOrBank, '보통예금 전표는 지급일 1~2일 전 제출 안내 대상')
})

test('③ 기존 가지급금이 있는 최종 정산 — 가지급금 정리, 직원에겐 정액만(p.7)', () => {
  const r = V.buildFinal(base({ task: 'final', paid: { bank: true }, bankPay: { amount: 300000, status: 'advance', ref: '20261001-0001-001' }, evidence: { fee: 'received' } }), R)
  assert.equal(r.plan.code, 'C')
  assert.equal(byKey(r, 'advance', 'C')[0].amount, 300000)
  assert.match(byKey(r, 'advance', 'C')[0].memo, /20261001-0001-001/)
  assert.equal(byKey(r, 'bank').length, 0, '먼저 보낸 등록비를 다시 보내지 않는다')
  assert.equal(r.employeePay, 289600)
  assert.ok(r.balanced && r.ready)
})

test('④ 선지급 등록비 + 법인카드 항공·셔틀 — 카드분이 직원 현금에 섞이지 않는다', () => {
  const costs = [...COSTS.filter(c => c.kind !== 'transport'), { kind: 'air', label: '항공료', amount: '영수증 금액' }, { kind: 'shuttle', label: '공항 셔틀', amount: '영수증 금액' }]
  const v = { trip, costs, purpose: 'trip', planTotal: 470000, task: 'final', paid: { bank: true, card: true },
    bankPay: { amount: 300000, status: 'advance' }, finalAmounts: { air: 145000, shuttle: 15900 },
    evidence: { fee: 'received', air: 'received', shuttle: 'received' } }
  const r = V.buildFinal(v, R)
  assert.equal(r.lines[0].name, '여비교통비-국내출장비')
  assert.deepEqual(byKey(r, 'card', 'C').map(l => l.amount), [145000, 15900])
  assert.equal(r.employeePay, 170000, '일당+숙박만 현금')
  assert.equal(r.sumD, 630900)
  assert.ok(r.balanced && r.ready)
  assert.ok(r.docs.some(d => d.key === 'airEvidence') && r.docs.some(d => d.key === 'shuttleEvidence'))
  assert.ok(r.changed && r.docs.some(d => d.key === 'settlement'), '신청서 470,000 ≠ 최종 630,900 → 출장여비 정산서')
})

test('⑤ 등록비 없는 출장 — 등록비 줄·등록비 증빙 없음', () => {
  const v = base({ costs: COSTS.filter(c => c.kind !== 'fee'), planTotal: 289600, task: 'final', paid: { none: true }, purpose: 'trip' })
  const r = V.buildFinal(v, R)
  assert.equal(byKey(r, 'bank').length, 0)
  assert.ok(!r.docs.some(d => d.key === 'feeEvidence'))
  assert.ok(r.ready)
})

test('⑥ 온라인 교육 — 등록비만, 현금 줄 없음', () => {
  const v = { trip: { ...trip, isOnline: true }, costs: [{ kind: 'fee', label: '교육비', amount: 50000 }], purpose: 'edu', job: 'nurse', planTotal: 50000,
    task: 'final', paid: { none: true }, evidence: { fee: 'received' } }
  const r = V.buildFinal(v, R)
  assert.equal(r.lines[0].code, '5301-16-03')
  assert.equal(byKey(r, 'cash').length, 0)
  assert.ok(r.ready)
})

test('⑦ 신청서와 최종 금액이 다르면 출장여비 정산서', () => {
  const r = V.buildFinal(base({ task: 'final', paid: { none: true }, finalAmounts: { fee: 330000 }, evidence: { fee: 'received' } }), R)
  assert.equal(r.finalTotal, 619600)
  assert.ok(r.changed && r.docs.some(d => d.key === 'settlement'))
})

test('⑧ 증빙이 없거나 선지급 처리 상태를 모르면 제출 준비로 보지 않는다', () => {
  const a = V.buildFinal(base({ task: 'final', paid: { none: true }, evidence: { fee: 'after' } }), R)
  assert.equal(a.plan.code, 'D')
  const b = V.buildFinal(base({ task: 'final', paid: { bank: true }, bankPay: { amount: 300000, status: 'unknown' } }), R)
  assert.equal(b.plan.code, 'D')
  assert.ok(!b.ready && blocks(b).includes('advanceStatus'))
  const c = V.buildAdvance(base({ task: 'advance', feeEvidence: 'unknown' }), R)
  assert.ok(!c.ready && c.plan.code === 'D')
})

test('⑨ 이미 비용 처리된 등록비는 다시 비용으로 잡지 않는다', () => {
  const r = V.buildFinal(base({ task: 'final', paid: { bank: true }, bankPay: { amount: 300000, status: 'expensed' }, evidence: {} }), R)
  assert.equal(r.sumD, 289600)
  assert.equal(r.expensedExcluded, 300000)
  assert.equal(byKey(r, 'bank').length + byKey(r, 'advance').length, 0)
  assert.ok(!r.docs.some(d => d.key === 'feeEvidence'))
  assert.ok(r.ready)
})

test('⑩ 개인 선납·취소 환불·선지급 초과·부족·중복은 확인 필요로 멈춘다', () => {
  assert.ok(blocks(V.buildFinal(base({ task: 'final', paid: { personal: true } }), R)).includes('personalPrepay'))
  assert.ok(blocks(V.buildFinal(base({ task: 'final', paid: { none: true }, refund: true }), R)).includes('refund'))
  const over = V.buildFinal(base({ task: 'final', paid: { bank: true }, bankPay: { amount: 400000, status: 'advance' }, evidence: { fee: 'received' } }), R)
  assert.ok(blocks(over).includes('overAdvance') && !over.ready)
  const under = V.buildFinal(base({ task: 'final', paid: { bank: true }, bankPay: { amount: 200000, status: 'advance' }, evidence: { fee: 'received' } }), R)
  assert.ok(blocks(under).includes('underAdvance'))
  const dup = V.buildFinal(base({ task: 'final', paid: { bank: true, card: true }, bankPay: { amount: 300000, status: 'advance' }, cardItems: { fee: 300000 }, evidence: { fee: 'received' } }), R)
  assert.ok(blocks(dup).includes('dupFee'))
  const ev = V.buildAdvance(base({ task: 'advance', feeEvidence: 'received' }), R)
  assert.equal(ev.plan.code, 'E')
  assert.ok(!ev.ready && blocks(ev).includes('prepayWithEvidence'))
})

test('미입력 금액은 0원으로 확정하지 않는다 — 입력 필요로 남고 합계도 비운다', () => {
  const costs = [...COSTS, { kind: 'air', label: '항공료', amount: '영수증 금액' }]
  const r = V.buildFinal(base({ costs, task: 'final', paid: { none: true }, evidence: { fee: 'received' } }), R)
  assert.equal(r.sumD, null)
  assert.ok(!r.ready && blocks(r).includes('amount-air'))
  assert.equal(V.won(null), '입력 필요')
})

test('직종·목적을 고르지 않으면 계정을 정하지 않는다(직급으로 짐작하지 않음)', () => {
  assert.equal(V.expenseAccountKey('edu', null), null)
  assert.equal(V.expenseAccountKey('edu', 'unknown'), null)
  assert.equal(V.expenseAccountKey('trip', null), 'travel')
  const r = V.buildFinal(base({ job: null, task: 'final', paid: { none: true } }), R)
  assert.ok(blocks(r).includes('account'))
})

test('⑪·⑫ 다른 건 저장이 섞이지 않게 건 열쇠가 다르고, 금액을 바꾸면 결과가 다시 계산된다', () => {
  assert.notEqual(V.tripKey(trip), V.tripKey({ ...trip, startDate: '2026-11-02' }))
  const v = base({ task: 'final', paid: { none: true }, evidence: { fee: 'received' } })
  const before = V.buildFinal(v, R).sumD
  v.finalAmounts = { lodging: 0 }
  assert.equal(V.buildFinal(v, R).sumD, before - 100000)
})

test('적요 초안', () => {
  assert.equal(V.memoDraft(base({ task: 'advance' })), '의료기관 회계기준 연수 등록비 선지급 / 교육일 10월 12일')
  assert.equal(V.memoDraft(base({ task: 'final', paid: { bank: true }, bankPay: { status: 'advance' } })), '의료기관 회계기준 연수 최종 정산 / 선지급 등록비 포함')
})

// ── 2026-09-30 지석초이: 일당·숙박·교통비(여비)도 먼저 받는 경우 ──
test('여비만 선지급 — 차 가지급금-기타 / 대 현금(여비 합계)', () => {
  const r = V.buildAdvance(base({ task: 'advance', advKinds: ['travel'] }), R)
  assert.equal(r.plan.code, 'B')
  assert.deepEqual(r.lines.map(l => [l.name, l.side, l.amount]), [['가지급금-기타', 'D', 289600], ['현금', 'C', 289600]])
  assert.ok(r.ready)
  assert.ok(!r.docs.some(d => d.key === 'bankCopy'), '여비만이면 통장 사본(받는 기관) 불필요')
  assert.equal(V.memoDraft(base({ task: 'advance', advKinds: ['travel'] })), '의료기관 회계기준 연수 여비 선지급 / 교육일 10월 12일')
})
test('등록비·여비 함께 선지급 — 차 가지급금 589,600 / 대 보통예금 300,000 + 현금 289,600', () => {
  const r = V.buildAdvance(base({ task: 'advance', advKinds: ['fee', 'travel'], feeEvidence: 'after' }), R)
  assert.deepEqual(r.lines.map(l => [l.name, l.side, l.amount]), [['가지급금-기타', 'D', 589600], ['보통예금', 'C', 300000], ['현금', 'C', 289600]])
  assert.ok(r.ready)
})
test('여비 선지급 뒤 최종 — 가지급금 정리, 같으면 현금 없음 / 더 들면 차액만 현금 / 덜 들면 확인 필요', () => {
  const same = V.buildFinal(base({ task: 'final', paid: { bank: true }, bankPay: { amount: 300000, status: 'advance' }, travelAdv: 289600, evidence: { fee: 'received' } }), R)
  assert.deepEqual(same.lines.filter(l => l.side === 'C').map(l => [l.name, l.amount]), [['가지급금-기타', 589600]])
  assert.equal(same.employeePay, 0)
  assert.ok(same.ready)
  const more = V.buildFinal(base({ task: 'final', paid: { none: true }, travelAdv: 200000, finalAmounts: {}, evidence: {} }), R)
  assert.deepEqual(more.lines.filter(l => l.side === 'C').map(l => [l.name, l.amount]), [['보통예금', 300000], ['가지급금-기타', 200000], ['현금', 89600]])
  const less = V.buildFinal(base({ task: 'final', paid: { none: true }, travelAdv: 400000 }), R)
  assert.ok(less.issues.some(i => i.key === 'overAdvance') && !less.ready)
})
