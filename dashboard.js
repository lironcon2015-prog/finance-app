let _monthlyChart = null

function renderDashboard() {
  renderPeriodSelector('dashPeriodSelector', () => renderDashboard())
  const period = getActivePeriod()

  document.getElementById('dashPeriodLabel').textContent = period.label || `${period.start} → ${period.end}`

  const all = getTransactions()
  const periodTx = filterByEffectivePeriod(all, period)

  const income         = sumIncome(periodTx)
  const expenses       = sumExpenses(periodTx)
  const net            = income - expenses
  const hiddenSavings  = sumHiddenSavings(periodTx)
  const capitalIncome  = sumCapitalIncome(periodTx)
  const netHidden      = hiddenSavings - capitalIncome

  // Stats row
  const cards = [
    { label: 'הכנסות התקופה', value: income,   color: 'var(--income)',  icon: '📈', bg: 'var(--income-bg)' },
    { label: 'הוצאות התקופה', value: expenses, color: 'var(--expense)', icon: '📉', bg: 'var(--expense-bg)' },
    { label: 'נטו התקופה',    value: net,      color: net >= 0 ? 'var(--income)' : 'var(--expense)', icon: '⚖️', bg: net >= 0 ? 'var(--income-bg)' : 'var(--expense-bg)' },
  ]
  if (hiddenSavings > 0 || capitalIncome > 0) {
    const parts = []
    if (hiddenSavings > 0) parts.push(`+${formatCurrency(hiddenSavings)} חסכונות חבויים`)
    if (capitalIncome > 0) parts.push(`−${formatCurrency(capitalIncome)} הכנסה הונית`)
    cards.push({
      label: 'חיסכון חבוי נטו',
      value: netHidden,
      color: netHidden >= 0 ? 'var(--income)' : 'var(--expense)',
      icon: '🪙',
      bg: netHidden >= 0 ? 'var(--income-bg)' : 'var(--expense-bg)',
      tooltip: `חסכונות חבויים פחות הכנסה הונית:\n${parts.join('\n')}\n\nחיובי = נטו הכנסת כסף לחיסכון. שלילי = נטו שבירת חיסכון.`
    })
  }
  document.getElementById('dashStats').innerHTML = cards.map(s => `
    <div class="stat-card" ${s.tooltip?`title="${s.tooltip}"`:''}>
      <div class="stat-icon" style="background:${s.bg}">${s.icon}</div>
      <div>
        <div class="stat-label">${s.label}</div>
        <div class="stat-value" style="color:${s.color}">${formatCurrency(s.value)}</div>
      </div>
    </div>`).join('')

  // Accounts balances
  _renderAccountBalances()

  // Savings & investment flows for active period
  _renderNonLiquidFlows(period)

  // Monthly chart - respects period (up to 12 months)
  _renderMonthlyChart(all, period)

  // Category breakdown
  _renderCategoryBreakdown(periodTx, expenses)

  // Budget vs actual (current month only)
  const currentMonth = _ym(new Date())
  renderBudgetCard('dashBudget', currentMonth)

  // Cash flow forecast
  renderCashFlowForecast('dashForecast')

  // Recent transactions (10)
  _renderRecentTx(all)
}

function _renderAccountBalances() {
  // Show ONLY checking + cash. Balances for CC / savings / investment are
  // unreliable here because we don't have real-time data (CC has unpaid-but-
  // not-yet-charged purchases; savings/investment usually lag or aren't imported).
  const accs = getAccounts().filter(a => PL_ACCOUNT_TYPES.has(a.type))
  const el = document.getElementById('dashAccounts')
  if (!el) return
  if (accs.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1rem">אין חשבונות עו"ש/מזומן. עבור להגדרות.</p>'
    return
  }
  const TYPE = { checking:'עו"ש', cash:'מזומן' }
  el.innerHTML = accs.map(a => {
    const bal = getAccountBalance(a.id)
    const color = bal >= 0 ? 'var(--income)' : 'var(--expense)'
    return `
      <div class="account-balance-row">
        <div>
          <div class="list-item-name">${a.name}</div>
          <div class="list-item-sub">${TYPE[a.type]||a.type}${a.institution?' · '+a.institution:''}</div>
        </div>
        <span style="font-weight:700;color:${color}">${formatCurrency(bal)}</span>
      </div>`
  }).join('')
}

function _renderNonLiquidFlows(period) {
  const el = document.getElementById('dashNonLiquidFlows')
  const card = document.getElementById('dashNonLiquidFlowsCard')
  if (!el) return
  const accs = getAccounts().filter(a => !isLiquidAccount(a))
  if (accs.length === 0) { el.innerHTML = ''; if (card) card.style.display = 'none'; return }
  if (card) card.style.display = ''

  const rows = accs.map(a => ({ acc: a, ...getAccountFlow(a.id, period) }))
  const totalNet = rows.reduce((s, r) => s + r.net, 0)
  const TYPE = { savings:'חיסכון', investment:'ני"ע / השקעות' }

  el.innerHTML = `
    <div class="card-title" style="display:flex;justify-content:space-between;align-items:baseline">
      <span>💰 תזרים חיסכון והשקעות</span>
      <span style="font-size:.85rem;font-weight:600;color:${totalNet>=0?'var(--income)':'var(--expense)'}">נטו: ${totalNet>=0?'+':''}${formatCurrency(totalNet)}</span>
    </div>
    <div class="nonliquid-flow-list">
      ${rows.map(r => `
        <div class="nonliquid-flow-row">
          <div>
            <div class="list-item-name">${r.acc.name}</div>
            <div class="list-item-sub">${TYPE[r.acc.type]||r.acc.type}${r.acc.institution?' · '+r.acc.institution:''}</div>
          </div>
          <div class="nonliquid-flow-nums">
            <span class="income-color">+${formatCurrency(r.deposited)}</span>
            <span class="expense-color">-${formatCurrency(r.withdrawn)}</span>
            <span style="font-weight:700;color:${r.net>=0?'var(--income)':'var(--expense)'}">${r.net>=0?'+':''}${formatCurrency(r.net)}</span>
          </div>
        </div>`).join('')}
    </div>`
}

function _renderMonthlyChart(all, period) {
  const months = monthsInPeriod(period)
  // if period too short (single month), show last 12 months instead
  const displayMonths = months.length < 2
    ? (() => {
        const out = []
        const now = new Date()
        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
          out.push(_ym(d))
        }
        return out
      })()
    : months

  const incomes = displayMonths.map(mo => sumIncome(all.filter(t => getTxEffectiveMonth(t) === mo)))
  const exps    = displayMonths.map(mo => sumExpenses(all.filter(t => getTxEffectiveMonth(t) === mo)))
  const nets    = incomes.map((v,i) => v - exps[i])
  const labels  = displayMonths.map(mo => mo.slice(5) + '/' + mo.slice(2,4))

  document.getElementById('monthlyChartTitle').textContent =
    displayMonths.length <= 6 ? `הכנסות מול הוצאות – ${displayMonths.length} חודשים`
    : `הכנסות מול הוצאות – ${displayMonths.length} חודשים אחרונים`

  if (_monthlyChart) _monthlyChart.destroy()
  const ctx = document.getElementById('monthlyChart').getContext('2d')
  _monthlyChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'הכנסות', data: incomes, backgroundColor: 'rgba(34,197,94,.7)', borderRadius: 5, yAxisID: 'y' },
        { type: 'bar', label: 'הוצאות', data: exps,    backgroundColor: 'rgba(239,68,68,.7)', borderRadius: 5, yAxisID: 'y' },
        { type: 'line', label: 'נטו',   data: nets,    borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.2)', borderWidth: 2, tension: .3, yAxisID: 'y', pointRadius: 3 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8aaccc', font: { family: 'Heebo' } } } },
      scales: {
        x: { ticks: { color: '#4d6a8a' }, grid: { color: '#1e3a5f' } },
        y: { ticks: { color: '#4d6a8a', callback: v => '₪' + (v/1000).toFixed(0) + 'k' }, grid: { color: '#1e3a5f' } }
      }
    }
  })
}

function _renderCategoryBreakdown(periodTx, expenses) {
  const bycat = {}
  let pieTotal = 0
  periodTx.forEach(t => {
    const ca = countedExpenseAmount(t)
    if (ca <= 0) return
    // Exclude CC-payment bank rows from the category pie — their details
    // live on the CC account and would distort category attribution.
    if (t.ccPaymentForAccountId) return
    const cat = getCategoryById(t.categoryId)
    const key = cat?.id || '__none__'
    if (!bycat[key]) bycat[key] = { name: cat?.name || 'לא מסווג', color: cat?.color || '#64748b', total: 0 }
    bycat[key].total += ca
    pieTotal += ca
  })
  const sorted = Object.values(bycat).sort((a,b) => b.total - a.total).slice(0, 6)
  document.getElementById('catBreakdown').innerHTML = sorted.length === 0
    ? '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1.5rem">אין נתונים</p>'
    : sorted.map(c => `
      <div class="cat-bar-item">
        <div class="cat-bar-header">
          <span>${c.name}</span>
          <span style="color:var(--text-secondary)">${formatCurrency(c.total)}</span>
        </div>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:${pieTotal>0?Math.round(c.total/pieTotal*100):0}%;background:${c.color}"></div>
        </div>
      </div>`).join('')
}

function _renderRecentTx(all) {
  const recent = [...all].sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 10)
  const TYPE_LABEL = { income:'הכנסה', expense:'הוצאה', transfer:'העברה', refund:'החזר' }
  document.getElementById('recentTx').innerHTML = recent.length === 0
    ? '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:2rem">אין עסקאות. התחל בייבוא קובץ.</p>'
    : recent.map(tx => {
        const cat = getCategoryById(tx.categoryId)
        const isNonCounted = tx.type === 'transfer' || tx.type === 'refund'
        const amountColor = isNonCounted ? 'var(--text-muted)' : (tx.amount > 0 ? 'var(--income)' : 'var(--expense)')
        const badge = isNonCounted ? `<span class="type-badge type-${tx.type}" style="margin-inline-start:.4rem">${TYPE_LABEL[tx.type]||tx.type}</span>` : ''
        return `
        <div class="recent-tx-item">
          <div class="recent-tx-left">
            <div class="recent-tx-icon">${cat?.icon || '📋'}</div>
            <div>
              <div class="recent-tx-name">${resolveVendor(tx.vendor, tx.amount) || tx.description || '—'}${badge}</div>
              <div class="recent-tx-meta">${formatDate(tx.date)} · ${cat?.name || 'לא מסווג'}</div>
            </div>
          </div>
          <span style="font-weight:700;color:${amountColor}">
            ${tx.amount>0?'+':''}${formatCurrency(tx.amount)}
          </span>
        </div>`
      }).join('')
}
