let _monthlyChart = null

function renderDashboard() {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const monthStr = `${y}-${String(m+1).padStart(2,'0')}`

  document.getElementById('dashMonth').textContent =
    now.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })

  const all = getTransactions()
  const monthTx = all.filter(t => t.date && t.date.startsWith(monthStr))

  const income   = monthTx.filter(t => t.amount > 0).reduce((s,t) => s + t.amount, 0)
  const expenses = monthTx.filter(t => t.amount < 0).reduce((s,t) => s + Math.abs(t.amount), 0)
  const net = income - expenses

  // Stats
  document.getElementById('dashStats').innerHTML = [
    { label: 'הכנסות החודש', value: income,   color: 'var(--income)',  icon: '📈', bg: 'var(--income-bg)' },
    { label: 'הוצאות החודש', value: expenses, color: 'var(--expense)', icon: '📉', bg: 'var(--expense-bg)' },
    { label: 'נטו החודש',    value: net,      color: net >= 0 ? 'var(--income)' : 'var(--expense)', icon: '💳', bg: net >= 0 ? 'var(--income-bg)' : 'var(--expense-bg)' },
  ].map(s => `
    <div class="stat-card">
      <div class="stat-icon" style="background:${s.bg}">${s.icon}</div>
      <div>
        <div class="stat-label">${s.label}</div>
        <div class="stat-value" style="color:${s.color}">${formatCurrency(s.value)}</div>
      </div>
    </div>`).join('')

  // Monthly bar chart (6 months)
  const months = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)
  }
  const incomes   = months.map(mo => all.filter(t => t.date?.startsWith(mo) && t.amount > 0).reduce((s,t) => s+t.amount,0))
  const exps      = months.map(mo => all.filter(t => t.date?.startsWith(mo) && t.amount < 0).reduce((s,t) => s+Math.abs(t.amount),0))
  const labels    = months.map(mo => mo.slice(5) + '/' + mo.slice(2,4))

  if (_monthlyChart) _monthlyChart.destroy()
  const ctx = document.getElementById('monthlyChart').getContext('2d')
  _monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'הכנסות', data: incomes, backgroundColor: 'rgba(34,197,94,.7)', borderRadius: 5 },
        { label: 'הוצאות', data: exps,    backgroundColor: 'rgba(239,68,68,.7)', borderRadius: 5 },
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

  // Category breakdown
  const bycat = {}
  monthTx.filter(t => t.amount < 0).forEach(t => {
    const cat = getCategoryById(t.categoryId)
    const key = cat?.id || '__none__'
    if (!bycat[key]) bycat[key] = { name: cat?.name || 'לא מסווג', color: cat?.color || '#64748b', total: 0 }
    bycat[key].total += Math.abs(t.amount)
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
          <div class="cat-bar-fill" style="width:${Math.round(c.total/expenses*100)}%;background:${c.color}"></div>
        </div>
      </div>`).join('')

  // Recent transactions
  const recent = [...all].sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 8)
  document.getElementById('recentTx').innerHTML = recent.length === 0
    ? '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:2rem">אין עסקאות. התחל בייבוא קובץ.</p>'
    : recent.map(tx => {
        const cat = getCategoryById(tx.categoryId)
        return `
        <div class="recent-tx-item">
          <div class="recent-tx-left">
            <div class="recent-tx-icon">${cat?.icon || '📋'}</div>
            <div>
              <div class="recent-tx-name">${tx.vendor || tx.description || '—'}</div>
              <div class="recent-tx-meta">${formatDate(tx.date)} · ${cat?.name || 'לא מסווג'}</div>
            </div>
          </div>
          <span style="font-weight:700;color:${tx.amount>0?'var(--income)':'var(--expense)'}">
            ${tx.amount>0?'+':''}${formatCurrency(tx.amount)}
          </span>
        </div>`
      }).join('')
}
