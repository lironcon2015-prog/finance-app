// ===== RECURRING DETECTION =====

function _normalizeVendor(v) {
  return (v || '').toString().toLowerCase().replace(/[0-9]+/g, '').replace(/\s+/g, ' ').trim()
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
  if (median >= 88 && median <= 95) return { cadence: 'quarterly', label: 'רבעוני', days: 90 }
  if (median >= 360 && median <= 370) return { cadence: 'annual', label: 'שנתי', days: 365 }
  return null
}

function detectRecurring() {
  const txs = getTransactions().filter(t => t.type !== 'transfer')
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
    const nextDate = new Date(last.date)
    nextDate.setDate(nextDate.getDate() + cadence.days)
    const avgAmount = filtered.reduce((s,t)=>s+t.amount,0) / filtered.length
    out.push({
      key,
      vendor: filtered[filtered.length-1].vendor,
      cadence: cadence.cadence,
      cadenceLabel: cadence.label,
      cadenceDays: cadence.days,
      avgAmount,
      lastSeen: last.date,
      nextExpected: nextDate.toISOString().slice(0,10),
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

// ===== RECURRING SCREEN =====
function renderRecurring() {
  const items = refreshRecurring()
  const container = document.getElementById('recurringList')
  if (!container) return

  if (items.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:3rem">לא זוהו הוצאות/הכנסות קבועות. נדרשות לפחות 3 עסקאות חוזרות לאותו ספק.</p>'
    return
  }

  container.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>ספק</th><th>תדירות</th><th>סכום ממוצע</th>
        <th>מופע אחרון</th><th>מופע הבא</th><th>מופעים</th>
      </tr></thead>
      <tbody>
        ${items.map(r => `
          <tr>
            <td style="font-weight:500">${r.vendor}</td>
            <td><span class="type-badge type-income">${r.cadenceLabel}</span></td>
            <td class="${r.avgAmount>0?'amount-inc':'amount-exp'}">${r.avgAmount>0?'+':''}${formatCurrency(r.avgAmount)}</td>
            <td>${formatDate(r.lastSeen)}</td>
            <td>${formatDate(r.nextExpected)}</td>
            <td>${r.occurrences}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`
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
