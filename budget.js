// ===== BUDGETS (v1.12) =====
// Budget record: { id, categoryId, monthKey, amount, type, carryOver, createdAt, updatedAt }
// monthKey ('YYYY-MM') added in v1.12 — every budget is per month. Legacy records
// (no monthKey) get migrated to the CURRENT month via migrateBudgetMonthly_v2,
// so the previous user's single-record-per-category still tracks this month.
//
// UNFORESEEN_ID is a virtual expense-only category for a "בלת״ם" plug slot.
// It holds a budget amount but never captures transactions — actual stays 0.
// This lets the user reserve room in the plan for unforeseen spend without
// distorting per-category tracking.

const UNFORESEEN_ID = '__unforeseen__'
const UNFORESEEN_NAME = 'בלת״ם'
const UNFORESEEN_ICON = '🎲'
const UNFORESEEN_COLOR = '#a78bfa'

function getBudgets() { return DB.get('finBudgets', []) }
function saveBudgets(b) { DB.set('finBudgets', b) }

function getBudgetsForMonth(monthKey) {
  return getBudgets().filter(b => b.monthKey === monthKey)
}

function migrateBudgetType_v1() {
  if (localStorage.getItem('migration_budget_type_v1') === '1') return
  const all = getBudgets()
  let changed = 0
  all.forEach(b => { if (!b.type) { b.type = 'expense'; changed++ } })
  if (changed > 0) saveBudgets(all)
  localStorage.setItem('migration_budget_type_v1', '1')
}

function migrateBudgetMonthly_v2() {
  if (localStorage.getItem('migration_budget_monthly_v2') === '1') return
  const all = getBudgets()
  const cm = _ym(new Date())
  let changed = 0
  all.forEach(b => { if (!b.monthKey) { b.monthKey = cm; changed++ } })
  if (changed > 0) saveBudgets(all)
  localStorage.setItem('migration_budget_monthly_v2', '1')
}

// Upsert by (categoryId, monthKey). If monthKey omitted, defaults to current month.
function setBudget(categoryId, monthKey, amount, type = 'expense', carryOver = false) {
  if (!monthKey) monthKey = _ym(new Date())
  const all = getBudgets()
  const idx = all.findIndex(b => b.categoryId === categoryId && b.monthKey === monthKey)
  const amt = parseFloat(amount) || 0
  const now = Date.now()
  if (idx >= 0) {
    all[idx] = { ...all[idx], amount: amt, type, carryOver: !!carryOver, updatedAt: now }
  } else {
    all.push({ id: genId(), categoryId, monthKey, amount: amt, type, carryOver: !!carryOver, createdAt: now, updatedAt: now })
  }
  saveBudgets(all)
}

// Delete a specific (category, month) record. Omit monthKey to wipe every
// month for this category (used e.g. when a category itself is deleted).
function deleteBudget(categoryId, monthKey) {
  if (!monthKey) {
    saveBudgets(getBudgets().filter(b => b.categoryId !== categoryId))
    return
  }
  saveBudgets(getBudgets().filter(b => !(b.categoryId === categoryId && b.monthKey === monthKey)))
}

function _isUnforeseen(catId) { return catId === UNFORESEEN_ID }

// Synthesizes a "category" object for the unforeseen slot so UI code can
// stay uniform. Real categories go through getCategoryById.
function _budgetCategoryProxy(catId) {
  if (_isUnforeseen(catId)) {
    return { id: UNFORESEEN_ID, name: UNFORESEEN_NAME, icon: UNFORESEEN_ICON, color: UNFORESEEN_COLOR, type: 'expense', _virtual: true }
  }
  return getCategoryById(catId)
}

// Per-category status for a specific month. Unforeseen rows always report
// actual=0 (they're plug numbers, not tracking real tx).
function computeBudgetStatus(monthKey) {
  const budgets = getBudgetsForMonth(monthKey)
  const txs = getTransactions().filter(t => t.date?.startsWith(monthKey))
  const savingsInvestIds = analysisExpenseSavingsInvestIds()
  return budgets.map(b => {
    const cat = _budgetCategoryProxy(b.categoryId)
    const type = b.type || 'expense'
    let actual = 0
    if (!_isUnforeseen(b.categoryId)) {
      const catTxs = txs.filter(t => t.categoryId === b.categoryId)
      actual = type === 'income'
        ? catTxs.filter(isCountedIncome).reduce((s,t)=>s+t.amount,0)
        : catTxs.reduce((s,t)=>s+analysisExpenseAmount(t, savingsInvestIds),0)
    }
    const budget = b.amount
    const remaining = budget - actual
    const pct = budget > 0 ? (actual / budget) * 100 : 0
    return { ...b, type, cat, budget, actual, remaining, pct, isUnforeseen: _isUnforeseen(b.categoryId) }
  }).sort((a,b) => b.pct - a.pct)
}

function computeBudgetTotals(monthKey) {
  const rows = computeBudgetStatus(monthKey)
  const exp = rows.filter(r => r.type !== 'income')
  const inc = rows.filter(r => r.type === 'income')
  return {
    rows, exp, inc,
    expBudget: exp.reduce((s,r)=>s+r.budget,0),
    expActual: exp.reduce((s,r)=>s+r.actual,0),
    incBudget: inc.reduce((s,r)=>s+r.budget,0),
    incActual: inc.reduce((s,r)=>s+r.actual,0),
  }
}

// ===== DASHBOARD CARD (aggregated totals only) =====
// Deliberately does NOT list per-category rows — the top-level budget screen
// owns that. Clicking "הרחב" navigates there.
function renderBudgetCard(containerId, monthKey) {
  const el = document.getElementById(containerId)
  if (!el) return
  const { rows, expBudget, expActual, incBudget, incActual } = computeBudgetTotals(monthKey)
  const openBtn = `<button class="btn-ghost" onclick="openBudgetScreenAtMonth('${monthKey}')">🔍 הרחב למסך תקציב ↗</button>`
  if (rows.length === 0) {
    el.innerHTML = `
      <p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1rem 0">לא הוגדרו תקציבים לחודש זה.</p>
      <div style="text-align:center">${openBtn}</div>`
    return
  }
  const expRem = expBudget - expActual
  const expPct = expBudget > 0 ? (expActual / expBudget) * 100 : 0
  const expW = Math.min(100, expPct)
  const expCls = expPct >= 100 ? 'budget-over' : expPct >= 90 ? 'budget-danger' : expPct >= 70 ? 'budget-warn' : 'budget-ok'
  const hasInc = incBudget > 0 || incActual > 0
  const incPct = incBudget > 0 ? (incActual / incBudget) * 100 : 0
  const incW = Math.min(100, incPct)
  const incCls = incPct >= 100 ? 'budget-ok' : incPct >= 70 ? 'budget-warn' : 'budget-danger'
  const incRow = !hasInc ? '' : `
    <div class="budget-agg-row ${incCls}">
      <div class="budget-agg-head"><span>📈 הכנסות צפויות</span>
        <span class="budget-agg-nums">${formatCurrency(incActual)} / ${formatCurrency(incBudget)}</span></div>
      <div class="budget-agg-bar-track"><div class="budget-agg-bar-fill" style="width:${incW}%"></div></div>
      <div class="budget-agg-foot"><span>${incPct.toFixed(0)}%</span>
        <span>${incActual>=incBudget?'מעל היעד ':'חסר '}${formatCurrency(Math.abs(incBudget - incActual))}</span></div>
    </div>`
  el.innerHTML = `
    <div class="budget-agg-grid">
      <div class="budget-agg-row ${expCls}">
        <div class="budget-agg-head"><span>📉 הוצאות</span>
          <span class="budget-agg-nums">${formatCurrency(expActual)} / ${formatCurrency(expBudget)}</span></div>
        <div class="budget-agg-bar-track"><div class="budget-agg-bar-fill" style="width:${expW}%"></div></div>
        <div class="budget-agg-foot"><span>${expPct.toFixed(0)}%</span>
          <span>${expRem>=0?'נותר ':'חריגה '}${formatCurrency(Math.abs(expRem))}</span></div>
      </div>
      ${incRow}
    </div>
    <div style="text-align:center;margin-top:.9rem">${openBtn}</div>`
}

// ===== BUDGET SCREEN (top-level) =====
let _budgetScreenMonth = null

function getBudgetScreenMonth() {
  if (!_budgetScreenMonth) _budgetScreenMonth = _ym(new Date())
  return _budgetScreenMonth
}

function setBudgetScreenMonth(m) { _budgetScreenMonth = m; renderBudgetScreen() }

function shiftBudgetScreenMonth(delta) {
  const [y, m] = getBudgetScreenMonth().split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  _budgetScreenMonth = _ym(d)
  renderBudgetScreen()
}

function openBudgetScreenAtMonth(monthKey) {
  if (monthKey) _budgetScreenMonth = monthKey
  navigate('budget')
}

const _HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
function _budgetFormatMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return `${_HE_MONTHS[m-1]} ${y}`
}

function renderBudgetScreen() {
  const container = document.getElementById('budgetScreenBody')
  if (!container) return
  const monthKey = getBudgetScreenMonth()
  const currentKey = _ym(new Date())
  const isCurrent = monthKey === currentKey
  const isFuture  = monthKey > currentKey
  const isPast    = monthKey < currentKey
  const { expBudget, expActual, incBudget, incActual } = computeBudgetTotals(monthKey)
  const expRem = expBudget - expActual
  const incRem = incBudget - incActual
  const netBudget = incBudget - expBudget
  const netActual = incActual - expActual

  const tag = isCurrent ? ' <span class="budget-month-tag">החודש</span>'
            : isFuture  ? ' <span class="budget-month-tag budget-month-tag-future">עתיד</span>'
            : ' <span class="budget-month-tag budget-month-tag-past">היסטוריה</span>'

  const monthNav = `
    <div class="budget-month-nav">
      <button class="btn-ghost" onclick="shiftBudgetScreenMonth(-1)">← חודש קודם</button>
      <div class="budget-month-label">${_budgetFormatMonth(monthKey)}${tag}</div>
      <button class="btn-ghost" onclick="shiftBudgetScreenMonth(1)">חודש הבא →</button>
    </div>`

  const summary = `
    <div class="budget-summary-grid">
      <div class="budget-summary-card">
        <div class="budget-label">הוצאות (בפועל / תקציב)</div>
        <div class="budget-val"><span class="expense-color">${formatCurrency(expActual)}</span> / ${formatCurrency(expBudget)}</div>
        <div class="budget-sub">${expRem>=0?'נותר ':'חריגה '}${formatCurrency(Math.abs(expRem))}</div>
      </div>
      <div class="budget-summary-card">
        <div class="budget-label">הכנסות (בפועל / יעד)</div>
        <div class="budget-val"><span class="income-color">${formatCurrency(incActual)}</span> / ${formatCurrency(incBudget)}</div>
        <div class="budget-sub">${incRem<=0?'מעל היעד ':'חסר '}${formatCurrency(Math.abs(incRem))}</div>
      </div>
      <div class="budget-summary-card">
        <div class="budget-label">נטו</div>
        <div class="budget-val ${netActual>=0?'income-color':'expense-color'}">${formatCurrency(netActual)}</div>
        <div class="budget-sub">מתוכנן: <span class="${netBudget>=0?'income-color':'expense-color'}">${formatCurrency(netBudget)}</span></div>
      </div>
    </div>`

  const actions = isPast ? '' : `
    <div class="budget-actions">
      <button class="btn-primary" onclick="openBudgetGenModalForMonth('${monthKey}')">✨ הצע תקציב ל${_budgetFormatMonth(monthKey)}</button>
      <button class="btn-ghost" onclick="copyBudgetFromPrevMonth()">📋 העתק מחודש קודם</button>
      <button class="btn-ghost" onclick="clearBudgetForMonth()">🗑️ נקה חודש זה</button>
    </div>`

  container.innerHTML = monthNav + summary + actions + _renderBudgetScreenTable(monthKey, isPast)
}

function _renderBudgetScreenTable(monthKey, readOnly) {
  const cats = getCategories()
  const expCats = cats.filter(c => c.type === 'expense')
  const incCats = cats.filter(c => c.type === 'income')
  const budgets = getBudgetsForMonth(monthKey)
  const byKey = {}
  budgets.forEach(b => { byKey[b.categoryId + '|' + (b.type || 'expense')] = b })
  const statusRows = computeBudgetStatus(monthKey)
  const rowByKey = {}
  statusRows.forEach(r => { rowByKey[r.categoryId + '|' + r.type] = r })

  const row = (c, type) => {
    const key = c.id + '|' + type
    const b = byKey[key]
    const status = rowByKey[key]
    const actual = status?.actual ?? 0
    const budget = b?.amount ?? 0
    const rawPct = budget > 0 ? (actual / budget) * 100 : 0
    const pct = Math.min(100, rawPct)
    const isIncome = type === 'income'
    const cls = isIncome
      ? (rawPct >= 100 ? 'budget-ok' : rawPct >= 70 ? 'budget-warn' : rawPct > 0 ? 'budget-danger' : '')
      : (rawPct >= 100 ? 'budget-over' : rawPct >= 90 ? 'budget-danger' : rawPct >= 70 ? 'budget-warn' : rawPct > 0 ? 'budget-ok' : '')
    const actualCls = isIncome ? 'income-color' : 'expense-color'
    const actualCell = budget > 0 || actual > 0
      ? `<span class="budget-screen-actual ${actualCls}">${formatCurrency(actual)}</span>`
      : '<span class="budget-screen-actual" style="color:var(--text-muted)">—</span>'
    const input = readOnly
      ? `<span class="budget-screen-budget">${budget > 0 ? formatCurrency(budget) : '—'}</span>`
      : `<div class="budget-input-wrap">
           <span class="budget-currency">₪</span>
           <input type="number" min="0" step="10" value="${b?.amount || ''}" placeholder="0"
             data-cat="${c.id}" data-type="${type}" data-month="${monthKey}"
             class="budget-input" onchange="onBudgetScreenChange(this)">
         </div>`
    return `
      <div class="budget-screen-row ${cls}">
        <span class="budget-screen-cat">${c.icon||'📋'} ${c.name}</span>
        ${actualCell}
        ${input}
        <div class="budget-screen-bar-track"><div class="budget-screen-bar-fill" style="width:${pct}%"></div></div>
      </div>`
  }

  const uKey = UNFORESEEN_ID + '|expense'
  const uB = byKey[uKey]
  const uInput = readOnly
    ? `<span class="budget-screen-budget">${uB?.amount > 0 ? formatCurrency(uB.amount) : '—'}</span>`
    : `<div class="budget-input-wrap">
         <span class="budget-currency">₪</span>
         <input type="number" min="0" step="10" value="${uB?.amount || ''}" placeholder="0"
           data-cat="${UNFORESEEN_ID}" data-type="expense" data-month="${monthKey}"
           class="budget-input" onchange="onBudgetScreenChange(this)">
       </div>`
  const uRow = `
    <div class="budget-screen-row budget-unforeseen-row">
      <span class="budget-screen-cat">${UNFORESEEN_ICON} ${UNFORESEEN_NAME}
        <span class="budget-unforeseen-tag" title="סלוט של הוצאה בלתי צפויה — לא תופס עסקאות, רק סכום מתוכנן">פלאג</span></span>
      <span class="budget-screen-actual" style="color:var(--text-muted)">—</span>
      ${uInput}
      <div class="budget-screen-bar-track"></div>
    </div>`

  return `
    <div class="budget-screen-section">
      <h3 class="budget-screen-heading">הוצאות</h3>
      <div class="budget-screen-list-head">
        <span>קטגוריה</span><span>בפועל</span><span>תקציב</span><span></span>
      </div>
      <div class="budget-screen-table">
        ${expCats.map(c => row(c, 'expense')).join('')}
        ${uRow}
      </div>
    </div>
    <div class="budget-screen-section">
      <h3 class="budget-screen-heading">הכנסות צפויות</h3>
      <div class="budget-screen-list-head">
        <span>קטגוריה</span><span>בפועל</span><span>יעד</span><span></span>
      </div>
      <div class="budget-screen-table">
        ${incCats.map(c => row(c, 'income')).join('')}
      </div>
    </div>`
}

function onBudgetScreenChange(input) {
  const catId = input.dataset.cat
  const type = input.dataset.type || 'expense'
  const monthKey = input.dataset.month
  const val = parseFloat(input.value)
  if (!val || val <= 0) {
    deleteBudget(catId, monthKey)
  } else {
    setBudget(catId, monthKey, val, type)
  }
  renderBudgetScreen()
}

function copyBudgetFromPrevMonth() {
  const monthKey = getBudgetScreenMonth()
  const [y, m] = monthKey.split('-').map(Number)
  const prev = _ym(new Date(y, m - 2, 1))
  const source = getBudgetsForMonth(prev)
  if (source.length === 0) { alert(`אין תקציב ב-${_budgetFormatMonth(prev)}`); return }
  if (!confirm(`להעתיק ${source.length} ערכי תקציב מ-${_budgetFormatMonth(prev)} ל-${_budgetFormatMonth(monthKey)}? (דריסת ערכים קיימים)`)) return
  source.forEach(b => setBudget(b.categoryId, monthKey, b.amount, b.type || 'expense', !!b.carryOver))
  renderBudgetScreen()
}

function clearBudgetForMonth() {
  const monthKey = getBudgetScreenMonth()
  const source = getBudgetsForMonth(monthKey)
  if (source.length === 0) return
  if (!confirm(`למחוק את כל ${source.length} ערכי התקציב ל-${_budgetFormatMonth(monthKey)}?`)) return
  saveBudgets(getBudgets().filter(b => b.monthKey !== monthKey))
  renderBudgetScreen()
}

function openBudgetGenModalForMonth(monthKey) {
  if (typeof openBudgetGenModal === 'function') openBudgetGenModal(monthKey)
}
