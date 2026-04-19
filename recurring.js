// ===== RECURRING DETECTION =====

// Resolve aliases first (so different raw strings mapped to the same display
// name — "משיכת שיק 2500" + "דמי שכירות" — group together), then delegate
// to the canonical normalizer in autocat.js. autocat.js is loaded before
// recurring.js in index.html, so the function is globally available.
function _normalizeVendor(v) {
  const resolved = (typeof resolveVendor === 'function') ? resolveVendor(v) : v
  return (typeof normalizeVendorForAutocat === 'function')
    ? normalizeVendorForAutocat(resolved)
    : String(resolved || '').toLowerCase().trim()
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
  // flow to a savings bucket, not a recurring "bill").
  const txs = getTransactions().filter(t => {
    if (t.type === 'transfer') return false
    if (t.ccPaymentForAccountId) return false
    if (t.transferAccountId) return false
    return true
  })
  const groups = {}
  txs.forEach(t => {
    const key = _normalizeVendor(t.vendor)
    if (!key) return
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  })
  const out = []
  for (const [key, list] of Object.entries(groups)) {
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
      vendor: resolveVendor(filtered[filtered.length-1].vendor),
      cadence: cadence.cadence,
      cadenceLabel: cadence.label,
      cadenceDays: cadence.days,
      avgAmount,
      lastSeen: last.date,
      nextExpected,
      occurrences: filtered.length,
      accountId: last.accountId,
      categoryId: last.categoryId,
    })
  }
  return out.sort((a,b) => Math.abs(b.avgAmount) - Math.abs(a.avgAmount))
}

function getCachedRecurring() {
  try {
    const raw = localStorage.getItem('finRecurring')
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj.generatedAt || Date.now() - obj.generatedAt > 24 * 60 * 60 * 1000) return null
    return obj.items
  } catch { return null }
}

function refreshRecurring() {
  const items = detectRecurring()
  localStorage.setItem('finRecurring', JSON.stringify({ generatedAt: Date.now(), items }))
  return items
}

function getRecurring() { return getCachedRecurring() || refreshRecurring() }

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
    if (recurringKeys.has(_normalizeVendor(t.vendor))) return false
    return true
  })
  const avgMonthlyIncome = sumIncome(recent) / 3
  const avgMonthlyExpense = sumExpenses(recent) / 3

  // projected recurring per month
  const recurringMonthlyIncome = recurring.filter(r => r.avgAmount > 0)
    .reduce((s,r) => s + r.avgAmount * (30 / r.cadenceDays), 0)
  const recurringMonthlyExpense = recurring.filter(r => r.avgAmount < 0)
    .reduce((s,r) => s + Math.abs(r.avgAmount) * (30 / r.cadenceDays), 0)

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
  const items = refreshRecurring()
  const container = document.getElementById('recurringList')
  if (!container) return

  const hidden = getHiddenRecurring()
  const expenseItems = items.filter(r => r.avgAmount < 0)
  const incomeItems  = items.filter(r => r.avgAmount > 0)
  const bucket = _recFlowMode === 'income' ? incomeItems : expenseItems

  const visible    = bucket.filter(r => !hidden.has(r.key))
  const hiddenList = bucket.filter(r =>  hidden.has(r.key))

  // Rebuild the idx→key map for this render.
  _recKeyMap = {}
  items.forEach((r, i) => { _recKeyMap['k' + i] = r.key })
  const idxOf = r => Object.keys(_recKeyMap).find(k => _recKeyMap[k] === r.key)

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
    container.innerHTML = toggle +
      '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:3rem">לא זוהו הוצאות/הכנסות קבועות. נדרשות לפחות 3 עסקאות חוזרות לאותו ספק.</p>'
    return
  }

  const buildRow = (r, isHidden = false) => {
    const idx = idxOf(r)
    const amountCls = r.avgAmount > 0 ? 'amount-inc' : 'amount-exp'
    return `
      <tr class="recurring-row ${isHidden?'recurring-row-hidden':''}" onclick="openRecurringDrillByIdx('${idx}')">
        <td style="font-weight:500">${r.vendor}</td>
        <td><span class="type-badge type-income">${r.cadenceLabel}</span></td>
        <td class="${amountCls}">${r.avgAmount>0?'+':''}${formatCurrency(r.avgAmount)}</td>
        <td>${formatDate(r.lastSeen)}</td>
        <td>${formatDate(r.nextExpected)}</td>
        <td>${r.occurrences}</td>
        <td onclick="event.stopPropagation()">
          ${isHidden
            ? `<button class="btn-ghost" style="font-size:.75rem;padding:.3rem .6rem" onclick="unhideRecurringByIdx('${idx}')">שחזר</button>`
            : `<button class="btn-ghost" style="font-size:.75rem;padding:.3rem .6rem" onclick="hideRecurringByIdx('${idx}')">הסתר</button>`}
        </td>
      </tr>`
  }

  const visibleTable = visible.length === 0
    ? `<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:2rem">אין ${modeLabel} קבועות${bucket.length>0?' (כולן מוסתרות)':''}.</p>`
    : `<table class="data-table recurring-table">
        <thead><tr>
          <th>ספק</th><th>תדירות</th><th>סכום ממוצע</th>
          <th>מופע אחרון</th><th>מופע הבא</th><th>מופעים</th><th></th>
        </tr></thead>
        <tbody>${visible.map(r => buildRow(r, false)).join('')}</tbody>
      </table>`

  const hiddenBlock = (_recShowHidden && hiddenList.length > 0)
    ? `<div class="card-title" style="margin-top:1.5rem">מוסתרות (${hiddenList.length})</div>
       <table class="data-table recurring-table">
        <thead><tr>
          <th>ספק</th><th>תדירות</th><th>סכום ממוצע</th>
          <th>מופע אחרון</th><th>מופע הבא</th><th>מופעים</th><th></th>
        </tr></thead>
        <tbody>${hiddenList.map(r => buildRow(r, true)).join('')}</tbody>
       </table>`
    : ''

  container.innerHTML = toggle + toolbar + visibleTable + hiddenBlock
}

// Thin wrappers that resolve an idx→key via _recKeyMap — avoids escaping Hebrew
// or punctuation inside inline onclick attributes.
function hideRecurringByIdx(idx)   { const k = _recKeyMap[idx]; if (k) hideRecurring(k) }
function unhideRecurringByIdx(idx) { const k = _recKeyMap[idx]; if (k) unhideRecurring(k) }
function openRecurringDrillByIdx(idx) { const k = _recKeyMap[idx]; if (k) openRecurringDrill(k) }

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
  const allTx = getTransactions().filter(t => _normalizeVendor(t.vendor) === _drillKey)
  const vendor = (allTx[0] && resolveVendor(allTx[0].vendor)) || _drillKey
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
            <td style="font-weight:500">${resolveVendor(t.vendor) || '—'}</td>
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
