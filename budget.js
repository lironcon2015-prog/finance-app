// ===== BUDGETS =====
// Budget record: { id, categoryId, amount, type: 'expense'|'income', carryOver, createdAt }
// `type` added in v1.10 to support expected-income budgets alongside expense budgets.
// Prior records default to 'expense' via migration (see migrateBudgetType_v1).

function getBudgets() { return DB.get('finBudgets', []) }
function saveBudgets(b) { DB.set('finBudgets', b) }

function migrateBudgetType_v1() {
  if (localStorage.getItem('migration_budget_type_v1') === '1') return
  const all = getBudgets()
  let changed = 0
  all.forEach(b => {
    if (!b.type) { b.type = 'expense'; changed++ }
  })
  if (changed > 0) saveBudgets(all)
  localStorage.setItem('migration_budget_type_v1', '1')
}

function setBudget(categoryId, amount, carryOver = false, type = 'expense') {
  const all = getBudgets()
  const idx = all.findIndex(b => b.categoryId === categoryId)
  const rec = { id: idx >= 0 ? all[idx].id : genId(), categoryId, amount: parseFloat(amount) || 0, carryOver: !!carryOver, type, createdAt: Date.now() }
  if (idx >= 0) all[idx] = { ...all[idx], ...rec }
  else all.push(rec)
  saveBudgets(all)
}

function deleteBudget(categoryId) {
  saveBudgets(getBudgets().filter(b => b.categoryId !== categoryId))
}

function computeBudgetStatus(monthKey) {
  const budgets = getBudgets()
  const txs = getTransactions().filter(t => t.date?.startsWith(monthKey))
  // Budget tracking uses the analysis scope: per-category CC detail lines
  // count toward the category budget, NOT the lump-sum bank payment. This
  // matches the budget generator (budgetGen.js) so proposed vs. actual
  // line up — otherwise a "groceries" budget would always show 0 spent
  // while the consolidated CC charge sits in a generic "Credit Card" line.
  const savingsInvestIds = analysisExpenseSavingsInvestIds()
  return budgets.map(b => {
    const cat = getCategoryById(b.categoryId)
    const catTxs = txs.filter(t => t.categoryId === b.categoryId)
    const type = b.type || 'expense'
    const actual = type === 'income'
      ? catTxs.filter(isCountedIncome).reduce((s,t)=>s+t.amount,0)
      : catTxs.reduce((s,t)=>s+analysisExpenseAmount(t, savingsInvestIds),0)
    const budget = b.amount
    const remaining = budget - actual
    const pct = budget > 0 ? (actual / budget) * 100 : 0
    return { ...b, type, cat, budget, actual, remaining, pct }
  }).sort((a,b) => b.pct - a.pct)
}

function renderBudgetCard(containerId, monthKey) {
  const el = document.getElementById(containerId)
  if (!el) return
  const rows = computeBudgetStatus(monthKey)
  if (rows.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1.5rem">לא הוגדרו תקציבים. עבור להגדרות → תקציב</p>'
    return
  }
  const expRows = rows.filter(r => r.type !== 'income')
  const incRows = rows.filter(r => r.type === 'income')
  const totalBudget = expRows.reduce((s,r)=>s+r.budget,0)
  const totalActual = expRows.reduce((s,r)=>s+r.actual,0)
  const totalRem = totalBudget - totalActual
  const renderRow = r => {
    // For income: we want "actual >= budget" to be a good thing (green).
    // Use income-flavored classes so over-target reads as success.
    const isIncome = r.type === 'income'
    const cls = isIncome
      ? (r.pct >= 100 ? 'budget-ok' : r.pct >= 70 ? 'budget-warn' : 'budget-danger')
      : (r.pct >= 100 ? 'budget-over' : r.pct >= 90 ? 'budget-danger' : r.pct >= 70 ? 'budget-warn' : 'budget-ok')
    const widthPct = Math.min(100, r.pct)
    const remLabel = isIncome
      ? (r.remaining <= 0 ? 'מעל היעד ' : 'חסר ')
      : (r.remaining >= 0 ? 'נותר ' : 'חריגה ')
    return `
        <div class="budget-item ${cls}">
          <div class="budget-row-top">
            <span>${r.cat?.icon || '📋'} ${r.cat?.name || 'קטגוריה'}</span>
            <span class="budget-nums">${formatCurrency(r.actual)} / ${formatCurrency(r.budget)}</span>
          </div>
          <div class="budget-bar-track"><div class="budget-bar-fill" style="width:${widthPct}%"></div></div>
          <div class="budget-row-bot">
            <span>${r.pct.toFixed(0)}%</span>
            <span>${remLabel}${formatCurrency(Math.abs(r.remaining))}</span>
          </div>
        </div>`
  }
  const incTotalBudget = incRows.reduce((s,r)=>s+r.budget,0)
  const incTotalActual = incRows.reduce((s,r)=>s+r.actual,0)
  el.innerHTML = `
    <div class="budget-summary">
      <div><div class="budget-label">תקציב</div><div class="budget-val">${formatCurrency(totalBudget)}</div></div>
      <div><div class="budget-label">הוצא</div><div class="budget-val">${formatCurrency(totalActual)}</div></div>
      <div><div class="budget-label">נותר</div><div class="budget-val ${totalRem>=0?'income-color':'expense-color'}">${formatCurrency(totalRem)}</div></div>
    </div>
    ${expRows.length > 0 ? `<div class="budget-list">${expRows.map(renderRow).join('')}</div>` : ''}
    ${incRows.length > 0 ? `
      <h4 style="margin:1rem 0 .5rem">הכנסות צפויות</h4>
      <div class="budget-summary">
        <div><div class="budget-label">יעד</div><div class="budget-val">${formatCurrency(incTotalBudget)}</div></div>
        <div><div class="budget-label">בפועל</div><div class="budget-val">${formatCurrency(incTotalActual)}</div></div>
        <div><div class="budget-label">פער</div><div class="budget-val ${incTotalActual>=incTotalBudget?'income-color':'expense-color'}">${formatCurrency(incTotalActual - incTotalBudget)}</div></div>
      </div>
      <div class="budget-list">${incRows.map(renderRow).join('')}</div>
    ` : ''}`
}

// ===== BUDGET SETTINGS TAB =====
function renderBudgetSettings() {
  const container = document.getElementById('budgetList')
  if (!container) return
  const cats = getCategories()
  const expCats = cats.filter(c => c.type === 'expense')
  const incCats = cats.filter(c => c.type === 'income')
  const budgets = getBudgets()
  const byId = Object.fromEntries(budgets.map(b => [b.categoryId, b]))
  const row = (c, type) => {
    const b = byId[c.id]
    return `
      <div class="budget-setting-row">
        <span class="budget-cat-name">${c.icon} ${c.name}</span>
        <div class="budget-input-wrap">
          <span class="budget-currency">₪</span>
          <input type="number" min="0" step="10" value="${b?.amount || ''}"
            placeholder="0" data-cat="${c.id}" data-type="${type}" class="budget-input" onchange="onBudgetChange(this)">
        </div>
      </div>`
  }
  container.innerHTML = `
    <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:1rem">הגדר תקציב חודשי לכל קטגוריה. השאר ריק או 0 כדי לא לעקוב.</div>
    <h4 style="margin:1rem 0 .5rem">הוצאות</h4>
    ${expCats.map(c => row(c, 'expense')).join('')}
    <h4 style="margin:1.5rem 0 .5rem">הכנסות צפויות</h4>
    ${incCats.map(c => row(c, 'income')).join('')}
  `
}

function onBudgetChange(input) {
  const catId = input.dataset.cat
  const type = input.dataset.type || 'expense'
  const val = parseFloat(input.value)
  if (!val || val <= 0) {
    deleteBudget(catId)
  } else {
    setBudget(catId, val, false, type)
  }
}
