// 전표 작성 안내 — 계산·분기만 담는다(화면은 app.js). 브라우저에서는 window.Voucher, 테스트에서는 require.
// 기준 자료: data/voucher_rules.json(경영지원팀 전표 실무길라잡이 2025.6 발췌). 자료에 없는 처리는 issues로 돌려
// '확인 필요'로 보이고, 금액을 추정해 채우지 않는다.
;(function (root) {
  const FIXED_CASH = ['transport', 'daily', 'lodging']
  const CARD_KINDS = ['air', 'shuttle', 'meal']
  const KIND_LABEL = { transport: '교통비', daily: '일당', lodging: '숙박비', fee: '등록비', air: '항공료', shuttle: '공항 셔틀', meal: '식사비' }

  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const won = v => (num(v) == null ? '입력 필요' : `${v.toLocaleString()}원`)

  // 비용 계정 — 목적과 직종으로만 고른다. 직급(MS)으로 직종을 짐작하지 않는다.
  function expenseAccountKey(purpose, job) {
    if (purpose === 'trip') return 'travel'
    if (purpose !== 'edu') return null
    return { nurse: 'eduNurse', tech: 'eduTech', etc: 'eduEtc' }[job] || null
  }

  // 앞 단계 예상 금액 → 전표용 항목. 최종 정산에서 사용자가 확정한 금액(finalAmounts)이 있으면 그걸 쓴다.
  // 0원(숙소 제공·8시간 이하 일당)은 전표에 올리지 않는다. 숫자가 아닌 예상값(영수증 금액)은 null = 입력 필요.
  function costItems(v) {
    const fin = v.finalAmounts || {}
    const out = []
    for (const c of v.costs || []) {
      const k = c.kind
      if (!k) continue
      const given = num(fin[k])
      const est = num(c.amount)
      const amount = given != null ? given : est
      if (amount === 0 && given == null) continue
      out.push({ kind: k, label: c.label || KIND_LABEL[k], amount, estimate: est,
                 basis: FIXED_CASH.includes(k) && est != null ? 'fixed' : 'receipt' })
    }
    return out
  }

  const sum = arr => arr.reduce((a, x) => a + (num(x) || 0), 0)

  // 먼저 받는 돈(2026-09-30 지석초이): 등록비만 / 여비(일당·숙박·교통)만 / 둘 다. 예전 저장분은 등록비만.
  const advKindsOf = v => (v.advKinds && v.advKinds.length ? v.advKinds : ['fee'])
  const travelSum = v => {
    const xs = (v.costs || []).filter(c => FIXED_CASH.includes(c.kind) && num(c.amount) != null && c.amount > 0)
    return xs.length ? sum(xs.map(c => c.amount)) : null
  }
  const ADV_NAME = k => (k.includes('fee') && k.includes('travel') ? '등록비·여비' : k.includes('travel') ? '여비' : '등록비')

  // 처리 방법 판정(기획 A~E). 큰 금액이라는 이유만으로 선지급을 고르지 않는다 — 사용자가 고른 할 일과
  // 증빙 시점·기존 처리 상태로만 정한다.
  function decidePlan(v) {
    if (v.task === 'advance') {
      const ak = advKindsOf(v)
      if (!ak.includes('fee')) return { code: 'B', title: '여비를 먼저 받고, 다녀와서 정산을 마무리해요',
        why: '일당·숙박비·교통비를 출장 전에 먼저 받아 두는 경우예요. 먼저 받은 돈을 ‘가지급금’으로 적어 두고, 다녀와서 실제 금액으로 정리해요.',
        now: '여비 선지급 전표 작성', later: '다녀와서 최종 정산 전표 작성' }
      if (v.feeEvidence === 'after') return { code: 'B', title: '등록비를 먼저 보내고, 영수증이 발급되면 정산을 마무리해요',
        why: '돈은 지금 보내야 하지만 정산에 필요한 증빙은 나중에 나오기 때문이에요. 먼저 보낸 돈을 ‘가지급금’으로 적어 두고, 증빙을 받은 뒤 실제 비용으로 정리해요.',
        now: '등록비 선지급 전표 작성', later: '영수증(증빙)이 발급되면 최종 정산 전표 작성' }
      // 2026-10-01 지석초이: 적격증빙이 나오는 기관이면 출장 전이라도 바로 정산 — 가지급금(두 번 정산)으로 하지 않는다
      if (v.feeEvidence === 'received') return { code: 'E', title: '영수증이 이미 있으면 바로 정산해요',
        why: '적격증빙(카드 매출전표·세금계산서·병원 사업자번호 현금영수증)이 나와 있으면 가지급금 없이 바로 비용으로 정산해요. 출장 전이라도 괜찮아요.',
        now: '한 번에 정산 전표 작성', later: '' }
      return { code: 'D', title: '증빙을 언제 받는지 먼저 확인해요',
        why: '증빙 발급 시점에 따라 처리 방법이 달라져요. 주최기관에 발급 시점을 물어본 뒤 이어서 진행하면 돼요.',
        now: '주최기관에 증빙 발급 시점 문의', later: '답을 받으면 이어서 작성' }
    }
    const adv = v.paid && v.paid.bank && v.bankPay
    if (adv && v.bankPay.status === 'unknown') return { code: 'D', title: '먼저 보낸 등록비의 처리 상태를 확인해요',
      why: '같은 돈을 두 번 비용으로 잡거나 다시 지급하지 않으려면, 먼저 보낸 등록비가 어떻게 처리됐는지 알아야 해요.',
      now: '기존 전표에 ‘가지급금-기타’가 있는지 확인', later: '확인 후 최종 전표 작성', unconfirmed: 'advanceStatus' }
    const missingEv = Object.entries(v.evidence || {}).filter(([, s]) => s && s !== 'received').map(([k]) => KIND_LABEL[k] || k)
    if (missingEv.length) return { code: 'D', title: '아직 받지 못한 증빙이 있어요',
      why: `${missingEv.join('·')} 증빙을 받아야 최종 정산을 마칠 수 있어요. 지금까지 적은 내용은 이 기기에 저장해 두고 이어서 할 수 있어요.`,
      now: '부족한 증빙 받기', later: '증빙을 받으면 이어서 작성' }
    if ((adv && v.bankPay.status === 'advance') || num(v.travelAdv) != null) return { code: 'C', title: '먼저 받은 돈까지 포함해 최종 정산해요',
      why: '먼저 받은 금액은 다시 받지 않고, 이번 전표에서 가지급금을 정리해요.', now: '최종 정산 전표 작성', later: '' }
    return { code: 'A', title: '지금 최종 정산을 준비할 수 있어요',
      why: '전체 비용과 이미 결제한 내역을 확인한 뒤, 이번에 지급할 금액을 정리할게요.', now: '최종 정산 전표 작성', later: '' }
  }

  // kinds: 이 줄이 신청서의 어느 항목(교통비·일당·숙박비·등록비·항공…)에서 왔는지 — 화면에서 신청서 행과 잇는다
  function line(rules, key, side, amount, plain, memo, kinds = []) {
    const a = rules.accounts[key] || { name: key, code: '' }
    // 현금·보통예금 줄의 보조 설명(적요에 넣을 것)은 규칙 파일에서 — 현금은 펌뱅킹 사번, 보통예금은 은행코드(2026-10-01 지석초이)
    return { key, name: a.name, code: a.code, side, amount: num(amount), plain, memo: memo || (rules.memoHint || {})[key] || '', kinds }
  }

  // 선지급 전표(p.6): 차 가지급금-기타 / 대 보통예금(등록비, 병원→주최기관) · 현금(여비, 병원→직원)
  // 여비 선지급은 원 자료 사례(등록비)와 같은 방식(가지급금)으로 잡는다 — 받는 계정만 현금(1101, 직원 정액 지급)
  function buildAdvance(v, rules) {
    const ak = advKindsOf(v)
    const fee = ak.includes('fee') ? num(v.advanceAmount != null ? v.advanceAmount : (v.costs || []).find(c => c.kind === 'fee')?.amount) : 0
    const trav = ak.includes('travel') ? num(v.advanceTravel != null ? v.advanceTravel : travelSum(v)) : 0
    const travKinds = (v.costs || []).filter(c => FIXED_CASH.includes(c.kind) && num(c.amount) > 0).map(c => c.kind)
    const debitKinds = [...(ak.includes('fee') ? ['fee'] : []), ...(ak.includes('travel') ? travKinds : [])]
    const total = fee == null || trav == null ? null : fee + trav
    const lines = [line(rules, 'advance', 'D', total, `먼저 받는 ${ADV_NAME(ak)}를 잠시 적어 두는 금액`, '', debitKinds)]
    if (ak.includes('fee')) lines.push(line(rules, 'bank', 'C', fee, '병원 계좌에서 주최기관으로 보내는 등록비', '', ['fee']))
    if (ak.includes('travel')) lines.push(line(rules, 'cash', 'C', trav, `직원에게 먼저 주는 여비(${travKinds.map(k => KIND_LABEL[k]).join('·')})`, '', travKinds))
    const issues = []
    if (ak.includes('fee') && fee == null) issues.push({ level: 'block', key: 'fee', msg: '먼저 보낼 등록비 금액을 넣어 주세요' })
    if (ak.includes('travel') && trav == null) issues.push({ level: 'block', key: 'travel', msg: '먼저 받을 여비 금액을 넣어 주세요' })
    const plan = decidePlan(v)
    if (plan.code === 'E') issues.push({ level: 'block', key: 'evidenceNow', msg: rules.evidenceNow })
    if (plan.code === 'D') issues.push({ level: 'block', key: 'feeEvidence', msg: '등록비 증빙을 언제 받는지 주최기관에 확인해 주세요' })
    return finish({ kind: 'advance', lines, issues, plan, advKinds: ak, advFee: fee, advTravel: trav }, v, rules)
  }

  // 최종 정산 전표(p.7): 차 비용 계정(전체 인정 비용 − 이미 비용 처리된 금액) / 대 가지급금 정리·카드·보통예금·현금
  function buildFinal(v, rules) {
    const items = costItems(v)
    const extras = (v.extras || []).filter(x => x && (x.label || x.amount != null)).map(x => ({ label: x.label || '추가 비용', amount: num(x.amount), pay: x.pay === 'card' ? 'card' : 'cash' }))
    const issues = []
    const paid = v.paid || {}
    const bp = paid.bank ? (v.bankPay || {}) : null
    const cardAmt = v.cardItems || {}
    const credits = []
    let expensedExcluded = 0

    const feeItem = items.find(i => i.kind === 'fee')
    const feePaidByCard = num(cardAmt.fee) != null && cardAmt.fee > 0
    // 본인 돈으로 낸 등록비는 현금(1101)으로 돌려받는다(2026-10-01 지석초이 확인)
    const personalFee = paid.personal && feeItem && !(bp && bp.status) && !feePaidByCard ? feeItem : null
    if (paid.unknown) issues.push({ level: 'block', key: 'paidUnknown', msg: '이미 결제·지급한 내역이 있는지 확인해 주세요. 모르면 같은 금액을 두 번 지급할 수 있어요' })
    if (v.refund) issues.push({ level: 'block', key: 'refund', msg: rules.unconfirmed.refund })

    if (feeItem) {
      if (bp && bp.status === 'expensed') {
        // 이미 비용으로 처리된 등록비 — 이번 전표에 다시 비용으로 잡지 않는다
        expensedExcluded += num(feeItem.amount) || 0
        feeItem.excluded = true
      } else if (bp && bp.status === 'advance') {
        const adv = num(bp.amount)
        if (adv == null) issues.push({ level: 'block', key: 'advAmount', msg: '먼저 보낸 등록비(가지급금) 금액을 넣어 주세요' })
        else {
          credits.push(line(rules, 'advance', 'C', adv, '먼저 보낸 등록비 정리', bp.ref ? `원 전표 ${bp.ref}` : '', ['fee']))
          if (num(feeItem.amount) != null && adv > feeItem.amount) issues.push({ level: 'block', key: 'overAdvance', msg: rules.unconfirmed.overAdvance })
          if (num(feeItem.amount) != null && adv < feeItem.amount) issues.push({ level: 'block', key: 'underAdvance', msg: rules.unconfirmed.underAdvance })
        }
        if (feePaidByCard) issues.push({ level: 'block', key: 'dupFee', msg: '등록비가 가지급금과 법인카드 양쪽에 들어가 있어요. 한 번만 결제했는지 확인해 주세요' })
      } else if (bp && bp.status === 'unknown') {
        issues.push({ level: 'block', key: 'advanceStatus', msg: rules.unconfirmed.advanceStatus })
      } else if (feePaidByCard) {
        credits.push(line(rules, 'card', 'C', feeItem.amount, '법인카드로 결제한 등록비', '카드번호·승인일(매출전표 보고)', ['fee']))
        if (num(feeItem.amount) != null && cardAmt.fee !== feeItem.amount) issues.push({ level: 'check', key: 'feeCardDiff', msg: '카드 결제 금액과 등록비가 달라요. 매출전표 금액을 확인해 주세요' })
      } else if (!paid.personal) {
        credits.push(line(rules, 'bank', 'C', feeItem.amount, '병원 계좌에서 주최기관으로 보내는 등록비', '', ['fee']))
      }
    }
    for (const k of CARD_KINDS) {
      const it = items.find(i => i.kind === k)
      if (it) credits.push(line(rules, 'card', 'C', it.amount, `법인카드로 결제한 ${KIND_LABEL[k]}`, '카드번호·승인일(매출전표 보고)', [k]))
    }
    const cashItems = items.filter(i => FIXED_CASH.includes(i.kind))
    const travAdv = num(v.travelAdv)
    if (v.travelAdvUnknown) issues.push({ level: 'block', key: 'advanceStatus', msg: rules.unconfirmed.advanceStatus })
    if (cashItems.length) {
      const cashAmt = cashItems.some(i => num(i.amount) == null) ? null : sum(cashItems.map(i => i.amount))
      const ck = cashItems.map(i => i.kind)
      if (travAdv != null) {
        // 먼저 받은 여비는 가지급금으로 정리하고, 모자란 만큼만 현금으로 더 받는다
        credits.push(line(rules, 'advance', 'C', travAdv, '먼저 받은 여비 정리', v.advanceRef ? `원 전표 ${v.advanceRef}` : '', ck))
        if (cashAmt != null && cashAmt > travAdv) credits.push(line(rules, 'cash', 'C', cashAmt - travAdv, '더 받을 여비(차액)', '', ck))
        if (cashAmt != null && cashAmt < travAdv) issues.push({ level: 'block', key: 'overAdvance', msg: rules.unconfirmed.overAdvance })
        if (cashAmt == null) credits.push(line(rules, 'cash', 'C', null, '더 받을 여비(차액)', '', ck))
      } else {
        credits.push(line(rules, 'cash', 'C', cashAmt, `직원에게 지급(${cashItems.map(i => KIND_LABEL[i.kind]).join('·')})`, '', ck))
      }
    }
    if (personalFee) {
      const cashLine = credits.find(c => c.key === 'cash' && !/차액/.test(c.plain))
      if (cashLine) {
        cashLine.amount = cashLine.amount == null || personalFee.amount == null ? null : cashLine.amount + personalFee.amount
        cashLine.kinds = [...cashLine.kinds, 'fee']
        cashLine.plain = cashLine.plain.replace(/\)$/, '·본인이 낸 등록비)')
      } else credits.push(line(rules, 'cash', 'C', personalFee.amount, '본인이 먼저 낸 등록비 돌려받기', '', ['fee']))
    }
    // 다녀와서 생긴 추가 비용(리무진·택시·주차비 등, 2026-10-01 지석초이) — 법인카드면 카드 줄, 개인 돈이면 현금으로 돌려받는다
    for (const x of extras) {
      if (x.pay === 'card') credits.push(line(rules, 'card', 'C', x.amount, `법인카드로 결제한 ${x.label}`, '카드번호·승인일(매출전표 보고)', ['extra']))
      else {
        const cashLine = credits.find(c => c.key === 'cash' && !/차액/.test(c.plain))
        if (cashLine) {
          cashLine.amount = cashLine.amount == null || x.amount == null ? null : cashLine.amount + x.amount
          if (!cashLine.kinds.includes('extra')) cashLine.kinds = [...cashLine.kinds, 'extra']
          cashLine.plain = cashLine.plain.replace(/\)$/, `·${x.label})`)
        } else credits.push(line(rules, 'cash', 'C', x.amount, `직원에게 지급(${x.label})`, '', ['extra']))
      }
    }
    // 가지급금 정리는 한 줄로(원 전표 하나) — 등록비·여비를 함께 받았으면 합친다
    const advs = credits.filter(c => c.key === 'advance')
    if (advs.length > 1) {
      const merged = { ...advs[0], amount: advs.some(a => a.amount == null) ? null : sum(advs.map(a => a.amount)),
        plain: '먼저 받은 등록비·여비 정리', kinds: [...new Set(advs.flatMap(a => a.kinds))], memo: advs.find(a => a.memo)?.memo || '' }
      credits.splice(credits.indexOf(advs[0]), 1, merged)
      for (const a of advs.slice(1)) credits.splice(credits.indexOf(a), 1)
    }

    const debitItems = [...items.filter(i => !i.excluded), ...extras.map(x => ({ kind: 'extra', label: x.label, amount: x.amount }))]
    const missing = debitItems.filter(i => num(i.amount) == null)
    for (const m of missing) issues.push({ level: 'block', key: `amount-${m.kind}`, msg: `${m.label} 금액을 넣어 주세요` })
    const expTotal = missing.length ? null : sum(debitItems.map(i => i.amount))
    const accKey = expenseAccountKey(v.purpose, v.job)
    if (!accKey) issues.push({ level: 'block', key: 'account', msg: v.purpose === 'edu' ? '교육 계정을 고르려면 직종을 골라 주세요' : '비용 목적(교육·학회 / 업무 출장)을 골라 주세요' })
    const allKinds = debitItems.map(i => i.kind)
    const debit = accKey ? line(rules, accKey, 'D', expTotal, '이번 출장·교육에 든 전체 비용', '', allKinds)
      : { key: null, name: '비용 계정 선택 필요', code: '', side: 'D', amount: expTotal, plain: '이번 출장·교육에 든 전체 비용', memo: '', kinds: allKinds }
    const lines = [debit, ...credits]

    // 신청서 금액(예상)과 최종 금액이 다르면 출장정산서(원 자료의 출장여비 정산서를 이 앱에서 만든 출장정산서로 대체, 2026-10-01 지석초이)
    const planTotal = num(v.planTotal)
    const finalTotal = missing.length ? null : sum([...items, ...extras].map(i => i.amount))
    const changed = planTotal != null && finalTotal != null && planTotal !== finalTotal
    return finish({ kind: 'final', lines, issues, plan: decidePlan(v), items, extras, expensedExcluded,
                    planTotal, finalTotal, changed,
                    employeePay: credits.filter(c => c.key === 'cash').reduce((a, c) => (a == null || c.amount == null ? null : a + c.amount), 0) }, v, rules)
  }

  function finish(r, v, rules) {
    const d = r.lines.filter(l => l.side === 'D'), c = r.lines.filter(l => l.side === 'C')
    const unknown = r.lines.some(l => l.amount == null)
    r.sumD = unknown ? null : sum(d.map(l => l.amount))
    r.sumC = unknown ? null : sum(c.map(l => l.amount))
    r.balanced = r.sumD != null && r.sumD === r.sumC
    // 합계 차이는 다른 확인 사항(처리 상태 모름·개인 선납 등)의 결과일 때가 많다 — 그런 원인이 없을 때만 따로 알린다
    const rootBlock = r.issues.some(i => i.level === 'block')
    if (!rootBlock && r.sumD != null && r.sumC != null && r.sumD !== r.sumC) r.issues.push({ level: 'block', key: 'balance', msg: `차변 ${won(r.sumD)}과 대변 ${won(r.sumC)}이 달라요` })
    r.docs = buildDocs(r, v, rules)
    r.usesCashOrBank = r.lines.some(l => l.side === 'C' && (l.key === 'cash' || l.key === 'bank'))
    // 안내를 마쳤다는 것과 실제 제출·지급·정산 완료는 다르다 — ready는 '제출 준비'까지만 뜻한다
    r.ready = r.balanced && !r.issues.some(i => i.level === 'block')
    return r
  }

  function buildDocs(r, v, rules) {
    const D = rules.docs
    const t = v.trip || {}
    const docs = []
    const add = (key, extra = {}) => docs.push({ key, title: D[key].title, check: extra.check || D[key].check, src: D[key].src, optional: !!extra.optional })
    if (r.kind === 'advance') {
      add('application', { check: '신청서의 선지급 금액이 이번 전표·공문과 같은지, 결재와 인사지원팀 합의가 됐는지 확인해 주세요' })
      if (t.hasDoc) add('notice')
      if (advKindsOf(v).includes('fee')) add('bankCopy', { optional: true })
      return docs
    }
    add('application', { check: '앞서 냈더라도 이번 전표에 다시 첨부해요. 교육명·일정·금액, 결재와 인사지원팀 합의를 확인해 주세요' })
    if (t.hasDoc) add('notice', { check: '앞서 냈더라도 이번 전표에 다시 첨부해요. 신청서의 기준 금액이 공문과 맞는지 확인해 주세요' })
    const kinds = new Set((r.items || []).filter(i => !i.excluded).map(i => i.kind))
    if (kinds.has('fee')) add('feeEvidence')
    // 병원 계좌에서 주최기관으로 보내는 등록비가 이 전표에 있으면 통장 사본(공문에 계좌가 없을 때만)
    if (r.lines.some(l => l.key === 'bank' && l.side === 'C')) add('bankCopy', { optional: true })
    if (kinds.has('air')) add('airEvidence')
    if (kinds.has('shuttle')) add('shuttleEvidence')
    if (kinds.has('meal')) add('mealEvidence')
    for (const x of r.extras || []) docs.push({ key: `extra-${x.label}`, title: `${x.label} 영수증`, check: x.pay === 'card' ? '법인카드로 결제한 매출전표' : '본인이 낸 영수증', optional: false })
    if (r.changed) add('settlement')
    return docs
  }

  // 적요 초안 — 사용자가 고칠 수 있다
  function memoDraft(v) {
    const t = v.trip || {}
    const title = t.title || '교육·출장'
    const day = t.startDate ? `${+t.startDate.slice(5, 7)}월 ${+t.startDate.slice(8, 10)}일` : ''
    if (v.task === 'advance') return `${title} ${ADV_NAME(advKindsOf(v))} 선지급${day ? ` / 교육일 ${day}` : ''}`
    const advFee = v.paid && v.paid.bank && v.bankPay && v.bankPay.status === 'advance'
    const advTrav = num(v.travelAdv) != null
    return `${title} 최종 정산${advFee || advTrav ? ` / 선지급 ${ADV_NAME([...(advFee ? ['fee'] : []), ...(advTrav ? ['travel'] : [])])} 포함` : ''}`
  }

  // 같은 교육·출장인지 가리는 열쇠 — 다른 건의 저장 내역이 섞이지 않게
  function tripKey(t) {
    return [t.title || '', t.startDate || '', t.endDate || '', t.place || t.region || ''].join('|')
  }

  const api = { travelSum, advKindsOf, expenseAccountKey, costItems, decidePlan, buildAdvance, buildFinal, memoDraft, tripKey, won, KIND_LABEL, FIXED_CASH, CARD_KINDS }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.Voucher = api
})(typeof window !== 'undefined' ? window : globalThis)
