let _monthlyChart = null

function renderDashboard() {
  renderPeriodSelector('dashPeriodSelector', () => renderDashboard())
  const period = getActivePeriod()

  document.getElementById('dashPeriodLabel').textContent = period.label || `${period.start} → ${period.end}`

  const all = getTransactions()
  const periodTx = filterByPeriod(all, period)

  const income   = sumIncome(periodTx)
  const expenses = sumExpenses(periodTx)
  const net      = income - expenses
  const netWorth = getNetWorth()

  // Stats row (4 cards)
  document.getElementById('dashStats').innerHTML = [
    { label: 'שווי נטו כולל',  value: netWorth, color: netWorth >= 0 ? 'var(--income)' : 'var(--expense)', icon: '💎', bg: netWorth >= 0 ? 'var(--income-bg)' : 'var(--expense-bg)' },
    { label: 'הכנסות התקופה', value: income,   color: 'var(--income)',  icon: '📈', bg: 'var(--income-bg)' },
    { label: 'הוצאות התקופה', value: expenses, color: 'var(--expense)', icon: '📉', bg: 'var(--expense-bg)' },
    { label: 'נטו התקופה',    value: net,      color: net >= 0 ? 'var(--income)' : 'var(--expense)', icon: '⚖️', bg: net >= 0 ? 'var(--income-bg)' : 'var(--expense-bg)' },
  ].map(s => `
    <div class="stat-card">
      <div class="stat-icon" style="background:${s.bg}">${s.icon}</div>
      <div>
        <div class="stat-label">${s.label}</div>
        <div class="stat-value" style="color:${s.color}">${formatCurrency(s.value)}</div>
      </div>
    </div>`).join('')

  // Accounts balances
  _renderAccountBalances()

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
  const accs = getAccounts()
  const el = document.getElementById('dashAccounts')
  if (!el) return
  if (accs.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1rem">אין חשבונות. עבור להגדרות.</p>'
    return
  }
  const TYPE = { checking:'עו"ש', savings:'חיסכון', credit_card:'אשראי', cash:'מזומן' }
  el.innerHTML = accs.map(a => {
    const bal = getAccountBalance(a.id)
    const color = a.type === 'credit_card' ? (bal < 0 ? 'var(--expense)' : 'var(--text-secondary)') : (bal >= 0 ? 'var(--income)' : 'var(--expense)')
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

  const incomes = displayMonths.map(mo => sumIncome(all.filter(t => t.date?.startsWith(mo))))
  const exps    = displayMonths.map(mo => sumExpenses(all.filter(t => t.date?.startsWith(mo))))
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
  periodTx.forEach(t => {
    const ca = countedExpenseAmount(t)
    if (ca <= 0) return
    const cat = getCategoryById(t.categoryId)
    const key = cat?.id || '__none__'
    if (!bycat[key]) bycat[key] = { name: cat?.name || 'לא מסווג', color: cat?.color || '#64748b', total: 0 }
    bycat[key].total += ca
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
          <div class="cat-bar-fill" style="width:${expenses>0?Math.round(c.total/expenses*100):0}%;background:${c.color}"></div>
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
              <div class="recent-tx-name">${tx.vendor || tx.description || '—'}${badge}</div>
              <div class="recent-tx-meta">${formatDate(tx.date)} · ${cat?.name || 'לא מסווג'}</div>
            </div>
          </div>
          <span style="font-weight:700;color:${amountColor}">
            ${tx.amount>0?'+':''}${formatCurrency(tx.amount)}
          </span>
        </div>`
      }).join('')
}
