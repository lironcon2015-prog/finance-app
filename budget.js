// ===== BUDGETS =====

function getBudgets() { return DB.get('finBudgets', []) }
function saveBudgets(b) { DB.set('finBudgets', b) }

function setBudget(categoryId, amount, carryOver = false) {
  const all = getBudgets()
  const idx = all.findIndex(b => b.categoryId === categoryId)
  const rec = { id: idx >= 0 ? all[idx].id : genId(), categoryId, amount: parseFloat(amount) || 0, carryOver: !!carryOver, createdAt: Date.now() }
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
  return budgets.map(b => {
    const cat = getCategoryById(b.categoryId)
    const catTxs = txs.filter(t => t.categoryId === b.categoryId)
    const actual = catTxs.reduce((s,t)=>s+countedExpenseAmount(t),0)
    const budget = b.amount
    const remaining = budget - actual
    const pct = budget > 0 ? (actual / budget) * 100 : 0
    return { ...b, cat, budget, actual, remaining, pct }
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
  const totalBudget = rows.reduce((s,r)=>s+r.budget,0)
  const totalActual = rows.reduce((s,r)=>s+r.actual,0)
  const totalRem = totalBudget - totalActual
  el.innerHTML = `
    <div class="budget-summary">
      <div><div class="budget-label">תקציב</div><div class="budget-val">${formatCurrency(totalBudget)}</div></div>
      <div><div class="budget-label">הוצא</div><div class="budget-val">${formatCurrency(totalActual)}</div></div>
      <div><div class="budget-label">נותר</div><div class="budget-val ${totalRem>=0?'income-color':'expense-color'}">${formatCurrency(totalRem)}</div></div>
    </div>
    <div class="budget-list">
      ${rows.map(r => {
        const cls = r.pct >= 100 ? 'budget-over' : r.pct >= 90 ? 'budget-danger' : r.pct >= 70 ? 'budget-warn' : 'budget-ok'
        const widthPct = Math.min(100, r.pct)
        return `
        <div class="budget-item ${cls}">
          <div class="budget-row-top">
            <span>${r.cat?.icon || '📋'} ${r.cat?.name || 'קטגוריה'}</span>
            <span class="budget-nums">${formatCurrency(r.actual)} / ${formatCurrency(r.budget)}</span>
          </div>
          <div class="budget-bar-track"><div class="budget-bar-fill" style="width:${widthPct}%"></div></div>
          <div class="budget-row-bot">
            <span>${r.pct.toFixed(0)}%</span>
            <span>${r.remaining >= 0 ? 'נותר ' : 'חריגה ' }${formatCurrency(Math.abs(r.remaining))}</span>
          </div>
        </div>`
      }).join('')}
    </div>`
}

// ===== BUDGET SETTINGS TAB =====
function renderBudgetSettings() {
  const container = document.getElementById('budgetList')
  if (!container) return
  const expCats = getCategories().filter(c => c.type === 'expense')
  const budgets = getBudgets()
  const byId = Object.fromEntries(budgets.map(b => [b.categoryId, b]))
  container.innerHTML = `
    <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:1rem">הגדר תקציב חודשי לכל קטגוריית הוצאה. השאר ריק או 0 כדי לא לעקוב.</div>
    ${expCats.map(c => {
      const b = byId[c.id]
      return `
      <div class="budget-setting-row">
        <span class="budget-cat-name">${c.icon} ${c.name}</span>
        <div class="budget-input-wrap">
          <span class="budget-currency">₪</span>
          <input type="number" min="0" step="10" value="${b?.amount || ''}"
            placeholder="0" data-cat="${c.id}" class="budget-input" onchange="onBudgetChange(this)">
        </div>
      </div>`
    }).join('')}
  `
}

function onBudgetChange(input) {
  const catId = input.dataset.cat
  const val = parseFloat(input.value)
  if (!val || val <= 0) {
    deleteBudget(catId)
  } else {
    setBudget(catId, val, false)
  }
}
