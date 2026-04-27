// ===== RECURRING DETECTION =====

// Resolve aliases first (so different raw strings mapped to the same display
// name — "משיכת שיק 2500" + "דמי שכירות" — group together), then delegate
// to the canonical normalizer in autocat.js. autocat.js is loaded before
// recurring.js in index.html, so the function is globally available.
// `amount` flows through so amount-conditional aliases resolve correctly:
// e.g. "העברה" tx of ₪5,000 groups under "משכנתא" while a ₪200 "העברה"
// stays raw.
function _normalizeVendor(v, amount) {
  const resolved = (typeof resolveVendor === 'function') ? resolveVendor(v, amount) : v
  return (typeof normalizeVendorForAutocat === 'function')
    ? normalizeVendorForAutocat(resolved)
    : String(resolved || '').toLowerCase().trim()
}

// Cadence dictionary used by both auto-detection and manual flags/groups.
// Days are notional (30 / 60 / 90) — used both for "next expected" and for
// converting per-occurrence avg into monthly-equivalent (smoothed).
const RECURRING_CADENCES = {
  monthly:    { days: 30,  label: 'חודשי' },
  bimonthly:  { days: 60,  label: 'דו-חודשי' },
  quarterly:  { days: 90,  label: 'רבעוני' },
  weekly:     { days: 7,   label: 'שבועי' },
  biweekly:   { days: 14,  label: 'דו-שבועי' },
  annual:     { days: 365, label: 'שנתי' },
}

function recurringCadenceLabel(c) { return RECURRING_CADENCES[c]?.label || c }
function recurringCadenceDays(c)  { return RECURRING_CADENCES[c]?.days  || 30 }

function _addDays(iso, days) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
}

// Drops outliers whose |amount| exceeds 2 × mean(|amounts|) — i.e. anything
// >100% above the average. Returns the original array if it has fewer than
// 3 items (not enough signal to call something an outlier).
function _filterAmountOutliers(txs) {
  if (txs.length < 3) return txs
  const mean = txs.reduce((s,t)=>s+Math.abs(t.amount),0) / txs.length
  const limit = mean * 2
  const kept = txs.filter(t => Math.abs(t.amount) <= limit)
  return kept.length >= 3 ? kept : txs
}

// Bucket key for "which cadence-period does this date fall into".
// Used by manual paths to count DISTINCT cadence periods, so two tx in the
// same month (e.g. wife's salary from two employers) count as ONE monthly
// occurrence — matching the user-facing notion of "monthly income".
function _cadencePeriodKey(iso, cadence) {
  if (!iso) return ''
  const [y, m] = iso.split('-').map(Number)
  if (cadence === 'monthly')   return `${y}-${m}`
  if (cadence === 'bimonthly') return `${y}-${Math.floor((m-1)/2)}`     // 2-month bins
  if (cadence === 'quarterly') return `${y}-${Math.floor((m-1)/3)}`     // 3-month bins
  return iso
}

// Manual recurring (flag + merge) average: sum/periods rather than
// sum/tx_count. If a salary arrives in two transfers each month, the
// monthly figure is the SUM of the two — not their average.
// Outlier filter (>100% above per-tx mean) runs first.
function _avgPerCadencePeriod(txs, cadence) {
  if (txs.length === 0) return { avg: 0, sum: 0, periods: 0, kept: [] }
  const kept = _filterAmountOutliers(txs)
  const sum = kept.reduce((s,t) => s + (t.amount || 0), 0)
  const periodKeys = new Set()
  for (const t of kept) {
    const k = _cadencePeriodKey(t.date, cadence)
    if (k) periodKeys.add(k)
  }
  const periods = Math.max(periodKeys.size, 1)
  return { avg: sum / periods, sum, periods, kept }
}

function _daysBetween(a, b) {
  const da = new Date(a), db = new Date(b)
  return Math.round((db - da) / (1000 * 60 * 60 * 24))
}

function _classifyCadence(gaps) {
  if (gaps.length === 0) return null
  const median = gaps.slice().sort((a,b)=>a-b)[Math.floor(gaps.length/2)]
  if (median >= 28 && median <= 31) return { cadence: 'monthly', label: 'חודשי', days: 30 }
  if (median >= 13 && median <= 15) return { cadence: 'biweekly', label: 'דו-שבועי', days: 14 }
  if (median >= 6 && median <= 8) return { cadence: 'weekly', label: 'שבועי', days: 7 }
  if (median >= 55 && median <= 65) return { cadence: 'bimonthly', label: 'דו-חודשי', days: 60 }
  if (median >= 88 && median <= 95) return { cadence: 'quarterly', label: 'רבעוני', days: 90 }
  if (median >= 360 && median <= 370) return { cadence: 'annual', label: 'שנתי', days: 365 }
  return null
}

function detectRecurring() {
  // Exclude transfers and bank-level CC payment aggregates — the real detail
  // lives on the CC account (individual purchases), which IS included. Also
  // exclude linked savings/investment deposits (they're a single structural
  // flow to a savings bucket, not a recurring "bill"). Tx that are part of
  // a manual merged group are excluded — they belong to that group only.
  const txs = getTransactions().filter(t => {
    if (t.type === 'transfer') return false
    if (t.ccPaymentForAccountId) return false
    if (t.transferAccountId) return false
    if (t.recurringGroupId) return false
    return true
  })
  const groups = {}
  txs.forEach(t => {
    const key = _normalizeVendor(t.vendor, t.amount)
    if (!key) return
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  })
  const out = []
  for (const [key, rawList] of Object.entries(groups)) {
    if (rawList.length < 3) continue
    // Drop amount-outliers (>100% above mean) — they distort the cadence
    // gap calculation and pull the average around. Only kept when the
    // remainder still has ≥3 occurrences.
    const list = _filterAmountOutliers(rawList)
    if (list.length < 3) continue
    // sort by date asc
    list.sort((a,b) => (a.date||'').localeCompare(b.date||''))
    // median amount
    const amounts = list.map(t => t.amount).sort((a,b)=>a-b)
    const median = amounts[Math.floor(amounts.length/2)]
    // filter within ±20% of median
    const tol = Math.abs(median) * 0.2 || 5
    const filtered = list.filter(t => Math.abs(t.amount - median) <= tol)
    if (filtered.length < 3) continue
    // gaps
    const gaps = []
    for (let i = 1; i < filtered.length; i++) {
      const g = _daysBetween(filtered[i-1].date, filtered[i].date)
      if (g > 0 && g < 400) gaps.push(g)
    }
    const cadence = _classifyCadence(gaps)
    if (!cadence) continue
    const last = filtered[filtered.length - 1]
    // Timezone-safe: 'YYYY-MM-DD' parsed via `new Date(str)` is UTC midnight,
    // but getDate() reads local. In UTC+2/3 this can shift the day backward.
    // Use the local-time Date constructor + local getters only.
    const [ly, lm, ld] = last.date.split('-').map(Number)
    const nextDate = new Date(ly, lm - 1, ld + cadence.days)
    const nextExpected = `${nextDate.getFullYear()}-${String(nextDate.getMonth()+1).padStart(2,'0')}-${String(nextDate.getDate()).padStart(2,'0')}`
    const avgAmount = filtered.reduce((s,t)=>s+t.amount,0) / filtered.length
    out.push({
      key,
      sourceKey: key,
      vendor: resolveVendor(filtered[filtered.length-1].vendor, filtered[filtered.length-1].amount),
      cadence: cadence.cadence,
      cadenceLabel: cadence.label,
      cadenceDays: cadence.days,
      avgAmount,
      // Monthly-equivalent: bimonthly /2, quarterly /3, weekly ×4.33, etc.
      // Used in summaries and forecast so different cadences sum apples to apples.
      smoothedMonthly: avgAmount * (30 / cadence.days),
      lastSeen: last.date,
      nextExpected,
      occurrences: filtered.length,
      accountId: last.accountId,
      categoryId: last.categoryId,
      source: 'auto',
    })
  }
  return out
}

// ===== MANUAL: per-tx recurringFlag (acts at the vendor level) =====
// User flags one tx with 'monthly'/'bimonthly'/'quarterly'. We treat every
// other tx of the same vendor key as part of the same recurring entry.
// If multiple flags exist for the same vendor, the latest-dated tx wins.
// Outlier filter (|amount| > 2×mean) is applied before averaging.
function _getManualFlagRecurring() {
  const all = getTransactions()
  const flagByKey = {}
  for (const t of all) {
    if (!t.recurringFlag) continue
    if (t.recurringGroupId) continue
    const key = _normalizeVendor(t.vendor, t.amount)
    if (!key) continue
    const cur = flagByKey[key]
    if (!cur || (t.date || '') > (cur.date || '')) {
      flagByKey[key] = { cadence: t.recurringFlag, date: t.date, ref: t }
    }
  }
  const out = []
  for (const [key, info] of Object.entries(flagByKey)) {
    const same = all.filter(t =>
      !t.recurringGroupId &&
      t.type !== 'transfer' &&
      !t.ccPaymentForAccountId &&
      _normalizeVendor(t.vendor, t.amount) === key
    )
    if (same.length === 0) continue
    const sorted = [...same].sort((a,b) => (a.date||'').localeCompare(b.date||''))
    const last = sorted[sorted.length-1]
    const cad = RECURRING_CADENCES[info.cadence] || RECURRING_CADENCES.monthly
    const { avg, periods } = _avgPerCadencePeriod(same, info.cadence)
    const cadenceMonths = cad.days / 30  // 1 / 2 / 3
    out.push({
      key: 'mflag:' + key,
      sourceKey: key,
      vendor: resolveVendor(last.vendor, last.amount),
      cadence: info.cadence,
      cadenceLabel: cad.label,
      cadenceDays: cad.days,
      avgAmount: avg,
      smoothedMonthly: avg / cadenceMonths,
      lastSeen: last.date,
      nextExpected: _addDays(last.date, cad.days),
      occurrences: same.length,
      periods,
      accountId: last.accountId,
      categoryId: last.categoryId,
      source: 'manual-flag',
    })
  }
  return out
}

// ===== MANUAL: merged groups =====
// User selects N arbitrary tx in the tx screen → groups them into one labeled
// recurring entry. Each tx gets `recurringGroupId = group.id` and is hidden
// from the tx list (still counted in P&L / balance — same row, different view).
function getManualRecurringGroups() { return DB.get('finManualRecurringGroups', []) }
function saveManualRecurringGroups(list) { DB.set('finManualRecurringGroups', list) }

function createManualRecurringGroup({ label, cadence, txIds }) {
  if (!label || !cadence || !Array.isArray(txIds) || txIds.length === 0) return null
  if (!RECURRING_CADENCES[cadence]) return null
  const id = genId()
  const list = getManualRecurringGroups()
  list.push({ id, label: String(label).trim(), cadence, createdAt: Date.now() })
  saveManualRecurringGroups(list)
  // Stamp the tx with the group id.
  const txs = getTransactions()
  const set = new Set(txIds)
  let n = 0
  txs.forEach(t => {
    if (set.has(t.id)) {
      t.recurringGroupId = id
      // Clear any per-tx recurring flag — the group owns the cadence now.
      delete t.recurringFlag
      n++
    }
  })
  if (n > 0) DB.set('finTransactions', txs)
  return { id, count: n }
}

function unmergeManualRecurringGroup(groupId) {
  const list = getManualRecurringGroups().filter(g => g.id !== groupId)
  saveManualRecurringGroups(list)
  const txs = getTransactions()
  let n = 0
  txs.forEach(t => {
    if (t.recurringGroupId === groupId) { delete t.recurringGroupId; n++ }
  })
  if (n > 0) DB.set('finTransactions', txs)
  return n
}

function clearRecurringFlagForVendorKey(vendorKey) {
  const txs = getTransactions()
  let n = 0
  txs.forEach(t => {
    if (t.recurringFlag && _normalizeVendor(t.vendor, t.amount) === vendorKey) {
      delete t.recurringFlag
      n++
    }
  })
  if (n > 0) DB.set('finTransactions', txs)
  return n
}

function _getManualGroupRecurring() {
  const groups = getManualRecurringGroups()
  if (groups.length === 0) return []
  const all = getTransactions()
  const out = []
  for (const g of groups) {
    const txs = all.filter(t => t.recurringGroupId === g.id)
    if (txs.length === 0) continue
    const sorted = [...txs].sort((a,b) => (a.date||'').localeCompare(b.date||''))
    const last = sorted[sorted.length-1]
    const cad = RECURRING_CADENCES[g.cadence] || RECURRING_CADENCES.monthly
    const { avg, periods } = _avgPerCadencePeriod(txs, g.cadence)
    const cadenceMonths = cad.days / 30
    out.push({
      key: 'mgroup:' + g.id,
      groupId: g.id,
      vendor: g.label,
      cadence: g.cadence,
      cadenceLabel: cad.label,
      cadenceDays: cad.days,
      avgAmount: avg,
      smoothedMonthly: avg / cadenceMonths,
      lastSeen: last.date,
      nextExpected: _addDays(last.date, cad.days),
      occurrences: txs.length,
      periods,
      accountId: g.accountId || last.accountId,
      categoryId: g.categoryId || last.categoryId,
      source: 'manual-group',
    })
  }
  return out
}

// Unified recurring list (auto + manual flag + manual group). Manual entries
// override auto ones with the same vendor key (user's explicit signal wins).
function getAllRecurring() {
  const auto         = detectRecurring()
  const manualFlags  = _getManualFlagRecurring()
  const manualGroups = _getManualGroupRecurring()
  const overrideKeys = new Set(manualFlags.map(m => m.sourceKey))
  const autoKept = auto.filter(a => !overrideKeys.has(a.sourceKey))
  return [...autoKept, ...manualFlags, ...manualGroups]
    .sort((a,b) => Math.abs(b.smoothedMonthly) - Math.abs(a.smoothedMonthly))
}

// Monthly-equivalent income/expense/net of NON-HIDDEN recurring entries.
// Used by dashboard / analysis / recurring-screen summaries.
function recurringMonthlyTotals() {
  const items = getAllRecurring()
  const hidden = getHiddenRecurring()
  let income = 0, expense = 0
  for (const r of items) {
    if (hidden.has(r.key)) continue
    if (r.smoothedMonthly > 0) income += r.smoothedMonthly
    else expense += Math.abs(r.smoothedMonthly)
  }
  return { income, expense, net: income - expense, count: items.filter(r => !hidden.has(r.key)).length }
}

// Unified recurring list. Recomputed each call (linear in tx count, fast
// enough); manual flags / merges need to reflect immediately so the cache
// that detectRecurring used to keep is no longer worth it.
function getRecurring() { return getAllRecurring() }
function refreshRecurring() { return getAllRecurring() }

// ===== CASH FLOW FORECAST =====
// Projects next N months based on: recurring + rolling 3-month avg of non-recurring counted tx
function forecastCashFlow(monthsAhead = 3) {
  const recurring = getRecurring()
  const recurringKeys = new Set(recurring.map(r => r.key))
  const now = new Date()
  // last 3 months of counted non-recurring tx
  const threeMoAgo = new Date(now.getFullYear(), now.getMonth()-3, 1)
  const recent = getTransactions().filter(t => {
    if (!t.date) return false
    if (new Date(t.date) < threeMoAgo) return false
    if (recurringKeys.has(_normalizeVendor(t.vendor, t.amount))) return false
    return true
  })
  const avgMonthlyIncome = sumIncome(recent) / 3
  const avgMonthlyExpense = sumExpenses(recent) / 3

  // projected recurring per month — use precomputed smoothedMonthly so
  // each entry is already a monthly-equivalent regardless of cadence.
  const recurringMonthlyIncome = recurring.filter(r => r.smoothedMonthly > 0)
    .reduce((s,r) => s + r.smoothedMonthly, 0)
  const recurringMonthlyExpense = recurring.filter(r => r.smoothedMonthly < 0)
    .reduce((s,r) => s + Math.abs(r.smoothedMonthly), 0)

  const projectedIncome = avgMonthlyIncome + recurringMonthlyIncome
  const projectedExpense = avgMonthlyExpense + recurringMonthlyExpense
  const monthlyNet = projectedIncome - projectedExpense

  const months = []
  for (let i = 1; i <= monthsAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push({
      month: _ym(d),
      income: projectedIncome,
      expense: projectedExpense,
      net: monthlyNet,
    })
  }
  return { months, projectedIncome, projectedExpense, monthlyNet, recurringMonthlyIncome, recurringMonthlyExpense }
}

// ===== HIDDEN RECURRING =====
function getHiddenRecurring() { return new Set(DB.get('finRecurringHidden', [])) }
function setHiddenRecurring(setObj) { DB.set('finRecurringHidden', [...setObj]) }
function hideRecurring(key) { const s = getHiddenRecurring(); s.add(key); setHiddenRecurring(s); renderRecurring() }
function unhideRecurring(key) { const s = getHiddenRecurring(); s.delete(key); setHiddenRecurring(s); renderRecurring() }

let _recShowHidden = false
let _recFlowMode = 'expense'  // 'expense' | 'income' — sticky toggle
function toggleShowHiddenRecurring() { _recShowHidden = !_recShowHidden; renderRecurring() }
function setRecurringFlowMode(mode) { _recFlowMode = mode; renderRecurring() }

// Recurring rows carry arbitrary Hebrew / punctuation in `key`, which breaks
// inline onclick attribute string-escaping. We keep a render-time map from a
// safe index string to the real key and use data-idx + event delegation.
let _recKeyMap = {}

// ===== RECURRING SCREEN =====
function renderRecurring() {
  const items = getAllRecurring()
  const container = document.getElementById('recurringList')
  if (!container) return

  const hidden = getHiddenRecurring()
  const expenseItems = items.filter(r => r.smoothedMonthly < 0)
  const incomeItems  = items.filter(r => r.smoothedMonthly > 0)
  const bucket = _recFlowMode === 'income' ? incomeItems : expenseItems

  const visible    = bucket.filter(r => !hidden.has(r.key))
  const hiddenList = bucket.filter(r =>  hidden.has(r.key))

  // Rebuild the idx→key map for this render.
  _recKeyMap = {}
  items.forEach((r, i) => { _recKeyMap['k' + i] = r.key })
  const idxOf = r => Object.keys(_recKeyMap).find(k => _recKeyMap[k] === r.key)

  // Top summary — monthly-equivalent of all non-hidden recurring entries.
  const totals = recurringMonthlyTotals()
  const summary = `
    <div class="recurring-summary">
      <div class="recurring-summary-card">
        <span class="recurring-summary-label">הוצאות קבועות (חודשי שקול)</span>
        <span class="recurring-summary-val expense-color">-${formatCurrency(totals.expense)}</span>
      </div>
      <div class="recurring-summary-card">
        <span class="recurring-summary-label">הכנסות קבועות (חודשי שקול)</span>
        <span class="recurring-summary-val income-color">+${formatCurrency(totals.income)}</span>
      </div>
      <div class="recurring-summary-card">
        <span class="recurring-summary-label">נטו חודשי שקול</span>
        <span class="recurring-summary-val ${totals.net>=0?'income-color':'expense-color'}">${totals.net>=0?'+':''}${formatCurrency(totals.net)}</span>
      </div>
    </div>`

  const modeLabel = _recFlowMode === 'income' ? 'הכנסות' : 'הוצאות'
  const toggle = `
    <div class="recurring-mode-toggle">
      <button class="mode-btn ${_recFlowMode==='expense'?'active':''}" onclick="setRecurringFlowMode('expense')">📉 הוצאות קבועות <span class="mode-count">${expenseItems.length}</span></button>
      <button class="mode-btn ${_recFlowMode==='income'?'active':''}" onclick="setRecurringFlowMode('income')">📈 הכנסות קבועות <span class="mode-count">${incomeItems.length}</span></button>
    </div>`

  const toolbar = `
    <div class="recurring-toolbar">
      <div style="color:var(--text-muted);font-size:.85rem">${visible.length} ${modeLabel} פעילות · ${hiddenList.length} מוסתרות</div>
      ${hiddenList.length > 0 ? `<button class="btn-ghost" onclick="toggleShowHiddenRecurring()">${_recShowHidden?'הסתר מוסתרות':'הצג מוסתרות'}</button>` : ''}
    </div>`

  if (items.length === 0) {
    container.innerHTML = summary + toggle +
      '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:3rem">לא זוהו הוצאות/הכנסות קבועות. נדרשות לפחות 3 עסקאות חוזרות לאותו ספק, או סמן עסקה ידנית.</p>'
    return
  }

  const buildRow = (r, isHidden = false) => {
    const idx = idxOf(r)
    const amountCls = r.smoothedMonthly > 0 ? 'amount-inc' : 'amount-exp'
    const sourceBadge = r.source === 'manual-group'
      ? '<span class="type-badge type-refund" title="קבוצה ידנית מאוחדת">📦 ידנית</span>'
      : r.source === 'manual-flag'
      ? '<span class="type-badge type-refund" title="סומן ידנית">✋ ידנית</span>'
      : ''
    // Smoothed (monthly-equivalent) is the primary number; show the
    // raw per-occurrence amount underneath when the cadence isn't monthly.
    const showSmoothNote = r.cadenceDays !== 30
    const smoothNote = showSmoothNote
      ? `<div style="font-size:.7rem;color:var(--text-muted);margin-top:.15rem">${r.avgAmount>0?'+':''}${formatCurrency(r.avgAmount)} ל${r.cadenceLabel}</div>`
      : ''
    // Manual entries get a tailored secondary action (unmerge / clear flag).
    const manualAction = r.source === 'manual-group'
      ? `<button class="btn-ghost" style="font-size:.7rem;padding:.25rem .55rem;margin-inline-start:.3rem" onclick="event.stopPropagation();unmergeManualRecurringByIdx('${idx}')" title="פרק את הקבוצה">פרק</button>`
      : r.source === 'manual-flag'
      ? `<button class="btn-ghost" style="font-size:.7rem;padding:.25rem .55rem;margin-inline-start:.3rem" onclick="event.stopPropagation();clearRecurringFlagByIdx('${idx}')" title="הסר סימון ידני">בטל סימון</button>`
      : ''
    return `
      <tr class="recurring-row ${isHidden?'recurring-row-hidden':''}" onclick="openRecurringDrillByIdx('${idx}')">
        <td style="font-weight:500">${r.vendor} ${sourceBadge}</td>
        <td><span class="type-badge type-income">${r.cadenceLabel}</span></td>
        <td class="${amountCls}">${r.smoothedMonthly>0?'+':''}${formatCurrency(r.smoothedMonthly)}${smoothNote}</td>
        <td>${formatDate(r.lastSeen)}</td>
        <td>${formatDate(r.nextExpected)}</td>
        <td title="${r.periods && r.periods !== r.occurrences ? r.occurrences + ' עסקאות לאורך ' + r.periods + ' תקופות' : r.occurrences + ' מופעים'}">${r.periods && r.periods !== r.occurrences ? `${r.occurrences} <span style="color:var(--text-muted);font-size:.7rem">(${r.periods})</span>` : r.occurrences}</td>
        <td onclick="event.stopPropagation()">
          ${isHidden
            ? `<button class="btn-ghost" style="font-size:.75rem;padding:.3rem .6rem" onclick="unhideRecurringByIdx('${idx}')">שחזר</button>`
            : `<button class="btn-ghost" style="font-size:.75rem;padding:.3rem .6rem" onclick="hideRecurringByIdx('${idx}')">הסתר</button>`}
          ${manualAction}
        </td>
      </tr>`
  }

  const visibleTable = visible.length === 0
    ? `<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:2rem">אין ${modeLabel} קבועות${bucket.length>0?' (כולן מוסתרות)':''}.</p>`
    : `<table class="data-table recurring-table">
        <thead><tr>
          <th>ספק</th><th>תדירות</th><th>חודשי שקול</th>
          <th>מופע אחרון</th><th>מופע הבא</th><th>מופעים</th><th></th>
        </tr></thead>
        <tbody>${visible.map(r => buildRow(r, false)).join('')}</tbody>
      </table>`

  const hiddenBlock = (_recShowHidden && hiddenList.length > 0)
    ? `<div class="card-title" style="margin-top:1.5rem">מוסתרות (${hiddenList.length})</div>
       <table class="data-table recurring-table">
        <thead><tr>
          <th>ספק</th><th>תדירות</th><th>חודשי שקול</th>
          <th>מופע אחרון</th><th>מופע הבא</th><th>מופעים</th><th></th>
        </tr></thead>
        <tbody>${hiddenList.map(r => buildRow(r, true)).join('')}</tbody>
       </table>`
    : ''

  container.innerHTML = summary + toggle + toolbar + visibleTable + hiddenBlock
}

// Thin wrappers that resolve an idx→key via _recKeyMap — avoids escaping Hebrew
// or punctuation inside inline onclick attributes.
function hideRecurringByIdx(idx)   { const k = _recKeyMap[idx]; if (k) hideRecurring(k) }
function unhideRecurringByIdx(idx) { const k = _recKeyMap[idx]; if (k) unhideRecurring(k) }
function openRecurringDrillByIdx(idx) { const k = _recKeyMap[idx]; if (k) openRecurringDrill(k) }

function unmergeManualRecurringByIdx(idx) {
  const k = _recKeyMap[idx]
  if (!k || !k.startsWith('mgroup:')) return
  const groupId = k.slice('mgroup:'.length)
  if (!confirm('לפרק את הקבוצה? העסקאות יחזרו להופיע ברשימת העסקאות הרגילה.')) return
  unmergeManualRecurringGroup(groupId)
  renderRecurring()
}

function clearRecurringFlagByIdx(idx) {
  const k = _recKeyMap[idx]
  if (!k || !k.startsWith('mflag:')) return
  const vendorKey = k.slice('mflag:'.length)
  if (!confirm('להסיר את הסימון הידני? אם הספק עדיין חוזר באופן קבוע, הוא ימשיך להופיע מזיהוי אוטומטי.')) return
  clearRecurringFlagForVendorKey(vendorKey)
  renderRecurring()
}

// ===== DRILL-DOWN =====
let _drillKey = null
let _drillRange = '3m'  // '3m' | '6m' | '12m' | 'custom'
let _drillCustomStart = ''
let _drillCustomEnd = ''

function openRecurringDrill(key) {
  _drillKey = key
  _drillRange = '3m'
  _drillCustomStart = ''
  _drillCustomEnd = ''
  _renderDrillModal()
  document.getElementById('recurringDrillModal').classList.add('open')
}

function closeRecurringDrill() {
  document.getElementById('recurringDrillModal').classList.remove('open')
  _drillKey = null
}

function setDrillRange(range) { _drillRange = range; _renderDrillModal() }

function _getDrillBounds() {
  const now = new Date()
  const end = _iso(now)
  if (_drillRange === 'custom') {
    return { start: _drillCustomStart || _iso(new Date(now.getFullYear(), now.getMonth()-3, 1)), end: _drillCustomEnd || end }
  }
  const monthsBack = _drillRange === '12m' ? 12 : _drillRange === '6m' ? 6 : 3
  return { start: _iso(new Date(now.getFullYear(), now.getMonth() - monthsBack, 1)), end }
}

function applyDrillCustom() {
  _drillCustomStart = document.getElementById('drillCustomStart').value
  _drillCustomEnd   = document.getElementById('drillCustomEnd').value
  _drillRange = 'custom'
  _renderDrillModal()
}

function _renderDrillModal() {
  if (!_drillKey) return
  // Drill key encoding: 'mgroup:<id>' (manual merge), 'mflag:<vendorKey>'
  // (manual flag), or the bare vendor key for an auto-detected entry.
  let allTx, vendor
  if (_drillKey.startsWith('mgroup:')) {
    const gid = _drillKey.slice('mgroup:'.length)
    allTx = getTransactions().filter(t => t.recurringGroupId === gid)
    const g = getManualRecurringGroups().find(g => g.id === gid)
    vendor = g?.label || gid
  } else if (_drillKey.startsWith('mflag:')) {
    const vk = _drillKey.slice('mflag:'.length)
    allTx = getTransactions().filter(t =>
      !t.recurringGroupId && _normalizeVendor(t.vendor, t.amount) === vk
    )
    vendor = (allTx[0] && resolveVendor(allTx[0].vendor, allTx[0].amount)) || vk
  } else {
    allTx = getTransactions().filter(t =>
      !t.recurringGroupId && _normalizeVendor(t.vendor, t.amount) === _drillKey
    )
    vendor = (allTx[0] && resolveVendor(allTx[0].vendor, allTx[0].amount)) || _drillKey
  }
  document.getElementById('drillTitle').textContent = `היסטוריית "${vendor}"`

  const { start, end } = _getDrillBounds()
  const filtered = allTx
    .filter(t => t.date && t.date >= start && t.date <= end)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const totalAmount = filtered.reduce((s, t) => s + t.amount, 0)
  const totalAbs = filtered.reduce((s, t) => s + Math.abs(t.amount), 0)
  const avg = filtered.length > 0 ? totalAmount / filtered.length : 0

  const rangeBtn = (key, label) =>
    `<button class="period-btn ${_drillRange===key?'active':''}" onclick="setDrillRange('${key}')">${label}</button>`

  const customRow = _drillRange === 'custom' ? `
    <div class="period-custom" style="display:flex;margin-top:.5rem">
      <label class="form-label" style="margin:0">מ:</label>
      <input type="date" id="drillCustomStart" value="${_drillCustomStart || start}">
      <label class="form-label" style="margin:0">עד:</label>
      <input type="date" id="drillCustomEnd" value="${_drillCustomEnd || end}">
      <button class="btn-primary" style="padding:.35rem .9rem" onclick="applyDrillCustom()">החל</button>
    </div>` : ''

  const rows = filtered.length === 0
    ? `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted)">אין עסקאות בתקופה</td></tr>`
    : filtered.map(t => {
        const cat = getCategoryById(t.categoryId)
        return `
          <tr>
            <td>${formatDate(t.date)}</td>
            <td style="font-weight:500">${resolveVendor(t.vendor, t.amount) || '—'}</td>
            <td>${cat ? `<span class="cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon||''} ${cat.name}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td class="${t.amount>0?'amount-inc':'amount-exp'}" style="font-weight:600">${t.amount>0?'+':''}${formatCurrency(t.amount)}</td>
          </tr>`
      }).join('')

  document.getElementById('drillBody').innerHTML = `
    <div class="period-selector" style="margin-bottom:1rem">
      <div class="period-presets">
        ${rangeBtn('3m', '3 חודשים')}
        ${rangeBtn('6m', '6 חודשים')}
        ${rangeBtn('12m', '12 חודשים')}
        ${rangeBtn('custom', 'טווח מותאם')}
      </div>
      ${customRow}
    </div>
    <div class="drill-stats">
      <div><span class="drill-stat-label">עסקאות</span><span class="drill-stat-val">${filtered.length}</span></div>
      <div><span class="drill-stat-label">סה"כ</span><span class="drill-stat-val ${totalAmount>=0?'income-color':'expense-color'}">${totalAmount>=0?'+':''}${formatCurrency(totalAmount)}</span></div>
      <div><span class="drill-stat-label">ממוצע</span><span class="drill-stat-val">${formatCurrency(avg)}</span></div>
      <div><span class="drill-stat-label">טווח</span><span class="drill-stat-val" style="font-size:.85rem">${formatDate(start)} – ${formatDate(end)}</span></div>
    </div>
    <div style="overflow-x:auto;margin-top:1rem">
      <table class="data-table">
        <thead><tr><th>תאריך</th><th>ספק</th><th>קטגוריה</th><th style="text-align:left">סכום</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

function renderCashFlowForecast(containerId) {
  const el = document.getElementById(containerId)
  if (!el) return
  const f = forecastCashFlow(3)
  const cls = f.monthlyNet >= 0 ? 'income-color' : 'expense-color'
  el.innerHTML = `
    <div class="forecast-main">
      <div class="forecast-label">תזרים צפוי לחודש הבא</div>
      <div class="forecast-big ${cls}">${f.monthlyNet>=0?'+':''}${formatCurrency(f.monthlyNet)}</div>
    </div>
    <div class="forecast-split">
      <div><span class="forecast-item-label">הכנסות צפויות</span><span class="forecast-item-val income-color">${formatCurrency(f.projectedIncome)}</span></div>
      <div><span class="forecast-item-label">הוצאות צפויות</span><span class="forecast-item-val expense-color">${formatCurrency(f.projectedExpense)}</span></div>
    </div>
    <div class="forecast-months">
      ${f.months.map((m, i) => `
        <div class="forecast-month">
          <div class="forecast-month-label">+${i+1} חודש</div>
          <div class="forecast-month-val ${m.net>=0?'income-color':'expense-color'}">${m.net>=0?'+':''}${formatCurrency(m.net)}</div>
        </div>
      `).join('')}
    </div>
  `
}
