let _pieChart = null
let _trendChart = null
let _yoyChart = null
let _liquidBalanceChart = null

function renderAnalysis() {
  renderPeriodSelector('analysisPeriodSelector', () => _drawAnalysis())
  _drawAnalysis()
}

function _drawAnalysis() {
  const period = getActivePeriod()
  document.getElementById('analysisPeriodLabel').textContent = period.label || `${period.start} → ${period.end}`

  const all = getTransactions()
  const periodTx = filterByPeriod(all, period)

  const income         = sumIncome(periodTx)
  const expenses       = sumExpenses(periodTx)
  const hiddenSavings  = sumHiddenSavings(periodTx)
  const capitalIncome  = sumCapitalIncome(periodTx)
  const net            = income - expenses
  // "True savings rate" treats hidden-savings expenses as kept money and
  // strips capital income (dividends, asset sales, savings withdrawals)
  // so it reflects only what we saved out of real earned income:
  //   realIncome   = income - capitalIncome
  //   realSavings  = net + hiddenSavings - capitalIncome
  //   savingsPct   = realSavings / realIncome
  const pnlPct       = income > 0 ? (net / income * 100) : 0
  const realIncome   = income - capitalIncome
  const realSavings  = net + hiddenSavings - capitalIncome
  const savingsPct   = realIncome > 0 ? (realSavings / realIncome * 100) : 0
  const hasHidden    = hiddenSavings > 0
  const hasCapital   = capitalIncome > 0
  const showSavingsCard = hasHidden || hasCapital

  const cards = [
    { label: 'סך הכנסות', value: income,   color: 'var(--income)',  icon: '📈', bg: 'var(--income-bg)' },
    { label: 'סך הוצאות', value: expenses, color: 'var(--expense)', icon: '📉', bg: 'var(--expense-bg)' },
    { label: 'רווח / הפסד', value: net,    color: net>=0?'var(--income)':'var(--expense)', icon: '⚖️', bg: net>=0?'var(--income-bg)':'var(--expense-bg)' },
    { label: showSavingsCard ? 'רווח/הפסד כאחוז מהכנסה' : 'אחוז חיסכון', value: pnlPct,
      color: pnlPct>=0?'var(--income)':'var(--expense)', icon: '🎯',
      bg: pnlPct>=0?'var(--income-bg)':'var(--expense-bg)', pct: true,
      tooltip: '(הכנסות − הוצאות) / הכנסות — רווח/הפסד מתוך סך ההכנסה' },
  ]
  if (showSavingsCard) {
    const parts = []
    if (hasHidden)  parts.push(`+ ${formatCurrency(hiddenSavings)} חסכונות חבויים`)
    if (hasCapital) parts.push(`− ${formatCurrency(capitalIncome)} הכנסה הונית`)
    cards.push({
      label: 'אחוז חיסכון אמיתי',
      value: savingsPct,
      color: savingsPct>=0?'var(--income)':'var(--expense)', icon: '🪙',
      bg: savingsPct>=0?'var(--income-bg)':'var(--expense-bg)', pct: true,
      tooltip: `(נטו ${parts.join(' ')}) / (הכנסות − הכנסה הונית)\n\nמוסיף בחזרה הוצאות שסומנו כחיסכון, ומנטרל הכנסות שהן למעשה שבירת חיסכון/דיבידנד.`
    })
  }
  document.getElementById('pnlStats').innerHTML = cards.map(s => `
    <div class="stat-card" ${s.tooltip?`title="${s.tooltip}"`:''}>
      <div class="stat-icon" style="background:${s.bg}">${s.icon}</div>
      <div>
        <div class="stat-label">${s.label}</div>
        <div class="stat-value" style="color:${s.color}">${s.pct ? s.value.toFixed(1) + '%' : formatCurrency(s.value)}</div>
      </div>
    </div>`).join('')

  // Expense pie (excludes CC-payment bank rows — details live in CC account)
  _renderExpensePie(periodTx)

  // Expense breakdown (same scope as pie, in list form)
  _renderExpenseBreakdown(periodTx)

  // Income breakdown
  _renderIncomeBreakdown(periodTx, income)

  // Trend chart: 12 months ending at period.end
  _renderTrendChart(all, period)

  // YoY comparison
  _renderYoY(all, period)

  // Cash flow statement
  _renderCashFlowStatement(all, period)

  // Liquid balance trend
  _renderLiquidBalanceChart(period)

  // Top vendors
  _renderTopVendors(periodTx)
}

function _renderExpensePie(periodTx) {
  const savingsInvestIds = analysisExpenseSavingsInvestIds()
  const expByCat = {}
  periodTx.forEach(t => {
    const ca = analysisExpenseAmount(t, savingsInvestIds)
    if (ca <= 0) return
    const cat = getCategoryById(t.categoryId)
    const key = cat?.id || '__none__'
    if (!expByCat[key]) expByCat[key] = { name: cat?.name||'לא מסווג', color: cat?.color||'#64748b', total: 0 }
    expByCat[key].total += ca
  })
  const expRows = Object.values(expByCat).sort((a,b)=>b.total-a.total)

  if (_pieChart) _pieChart.destroy()
  const ctx = document.getElementById('expensePieChart').getContext('2d')
  if (expRows.length > 0) {
    _pieChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: expRows.map(r=>r.name),
        datasets: [{ data: expRows.map(r=>r.total), backgroundColor: expRows.map(r=>r.color), borderWidth: 2, borderColor: '#111827' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#8aaccc', font: { family:'Heebo', size:11 }, padding: 10 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.raw)}` } }
        }
      }
    })
  }
}

function _renderExpenseBreakdown(periodTx) {
  const savingsInvestIds = analysisExpenseSavingsInvestIds()
  const expByCat = {}
  let totalForPct = 0
  periodTx.forEach(t => {
    const ca = analysisExpenseAmount(t, savingsInvestIds)
    if (ca <= 0) return
    const cat = getCategoryById(t.categoryId)
    const key = cat?.id || '__none__'
    if (!expByCat[key]) expByCat[key] = { name: cat?.name || 'לא מסווג', color: cat?.color || '#64748b', total: 0 }
    expByCat[key].total += ca
    totalForPct += ca
  })
  const rows = Object.values(expByCat).sort((a,b) => b.total - a.total)
  document.getElementById('expenseBreakdown').innerHTML = rows.length === 0
    ? '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:2rem">אין הוצאות לתקופה</p>'
    : rows.map(r => `
      <div class="cat-bar-item">
        <div class="cat-bar-header">
          <span>${r.name}</span>
          <span style="color:var(--expense);font-weight:600">${formatCurrency(r.total)}</span>
        </div>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:${totalForPct>0?Math.round(r.total/totalForPct*100):0}%;background:${r.color}"></div>
        </div>
      </div>`).join('')
}

function _renderIncomeBreakdown(periodTx, income) {
  const capIds = getCapitalIncomeCategoryIds()
  const incByCat = {}
  periodTx.filter(isCountedIncome).forEach(t => {
    const cat = getCategoryById(t.categoryId)
    const key = cat?.id || '__none__'
    if (!incByCat[key]) incByCat[key] = { name: cat?.name||'לא מסווג', color: cat?.color||'#22c55e', total: 0, isCapital: !!(cat && capIds.has(cat.id)) }
    incByCat[key].total += t.amount
  })
  const incRows = Object.values(incByCat).sort((a,b)=>b.total-a.total)
  document.getElementById('incomeBreakdown').innerHTML = incRows.length === 0
    ? '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:2rem">אין הכנסות לתקופה</p>'
    : incRows.map(r => `
      <div class="cat-bar-item">
        <div class="cat-bar-header">
          <span>${r.name}${r.isCapital ? ' <span class="cat-capital-badge" title="הכנסה הונית — מנוכה מאחוז החיסכון האמיתי">📉</span>' : ''}</span>
          <span style="color:var(--income);font-weight:600">${formatCurrency(r.total)}</span>
        </div>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:${income>0?Math.round(r.total/income*100):0}%;background:${r.color}"></div>
        </div>
      </div>`).join('')
}

function _renderTrendChart(all, period) {
  // Use period months, but if fewer than 3 months in period, show last 12 ending at period.end
  let months = monthsInPeriod(period)
  if (months.length < 3) {
    const [ey, em] = period.end.split('-').map(Number)
    months = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(ey, em - 1 - i, 1)
      months.push(_ym(d))
    }
  }
  const incomes = months.map(mo => sumIncome(all.filter(t => t.date?.startsWith(mo))))
  const exps    = months.map(mo => sumExpenses(all.filter(t => t.date?.startsWith(mo))))
  const nets    = incomes.map((v,i) => v - exps[i])
  const labels  = months.map(mo => mo.slice(5) + '/' + mo.slice(2,4))

  if (_trendChart) _trendChart.destroy()
  const ctx = document.getElementById('trendChart').getContext('2d')
  _trendChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar',  label: 'הכנסות', data: incomes, backgroundColor: 'rgba(34,197,94,.6)', borderRadius: 4 },
        { type: 'bar',  label: 'הוצאות', data: exps,    backgroundColor: 'rgba(239,68,68,.6)', borderRadius: 4 },
        { type: 'line', label: 'נטו',    data: nets,    borderColor: '#3b82f6', borderWidth: 2, tension: .3, pointRadius: 3 },
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

function _renderYoY(all, period) {
  const prevPeriod = shiftPeriodByYear(period, 1)
  const curTx = filterByPeriod(all, period)
  const prvTx = filterByPeriod(all, prevPeriod)

  const curInc = sumIncome(curTx),  prvInc = sumIncome(prvTx)
  const curExp = sumExpenses(curTx), prvExp = sumExpenses(prvTx)
  const curNet = curInc - curExp,    prvNet = prvInc - prvExp

  const delta = (c, p) => p === 0 ? (c === 0 ? 0 : 100) : ((c - p) / Math.abs(p) * 100)
  const dInc = delta(curInc, prvInc)
  const dExp = delta(curExp, prvExp)
  const dNet = delta(curNet, prvNet)

  document.getElementById('yoyTable').innerHTML = `
    <div class="yoy-grid">
      <div></div>
      <div class="yoy-head">תקופה נוכחית</div>
      <div class="yoy-head">שנה קודמת</div>
      <div class="yoy-head">שינוי</div>

      <div class="yoy-label">הכנסות</div>
      <div class="income-color">${formatCurrency(curInc)}</div>
      <div class="yoy-muted">${formatCurrency(prvInc)}</div>
      <div class="${dInc>=0?'income-color':'expense-color'}">${dInc>=0?'+':''}${dInc.toFixed(1)}%</div>

      <div class="yoy-label">הוצאות</div>
      <div class="expense-color">${formatCurrency(curExp)}</div>
      <div class="yoy-muted">${formatCurrency(prvExp)}</div>
      <div class="${dExp<=0?'income-color':'expense-color'}">${dExp>=0?'+':''}${dExp.toFixed(1)}%</div>

      <div class="yoy-label">נטו</div>
      <div class="${curNet>=0?'income-color':'expense-color'}">${formatCurrency(curNet)}</div>
      <div class="yoy-muted">${formatCurrency(prvNet)}</div>
      <div class="${dNet>=0?'income-color':'expense-color'}">${dNet>=0?'+':''}${dNet.toFixed(1)}%</div>
    </div>`

  if (_yoyChart) _yoyChart.destroy()
  const ctx = document.getElementById('yoyChart').getContext('2d')
  _yoyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['הכנסות', 'הוצאות', 'נטו'],
      datasets: [
        { label: 'שנה קודמת',   data: [prvInc, prvExp, prvNet], backgroundColor: 'rgba(100,116,139,.6)', borderRadius: 4 },
        { label: 'תקופה נוכחית', data: [curInc, curExp, curNet], backgroundColor: 'rgba(59,130,246,.7)', borderRadius: 4 },
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

function _renderCashFlowStatement(all, period) {
  const periodTx = filterByPeriod(all, period)
  const dayBefore = _iso(new Date(new Date(period.start).getTime() - 86400000))
  const startBal = getLiquidBalance(dayBefore)
  const endBal   = getLiquidBalance(period.end)
  const income   = sumIncome(periodTx)
  const expense  = sumExpenses(periodTx)
  const netOp    = income - expense

  // Net flow INTO non-liquid accounts (positive = liquid cash moved to savings/investment)
  const nonLiquid = getAccounts().filter(a => !isLiquidAccount(a))
  const netSavings = nonLiquid.reduce((s, a) => s + getAccountFlow(a.id, period).net, 0)
  const hasNonLiquid = nonLiquid.length > 0

  const savingsRow = hasNonLiquid ? `
    <div class="cf-row cf-savings"><span>− הועבר לחיסכון/השקעות</span><span>${formatCurrency(netSavings)}</span></div>` : ''

  document.getElementById('cashFlowStatement').innerHTML = `
    <div class="cf-row"><span>יתרה נזילה פותחת (${formatDate(period.start)})</span><span style="font-weight:700">${formatCurrency(startBal)}</span></div>
    <div class="cf-row cf-income"><span>+ הכנסות</span><span>${formatCurrency(income)}</span></div>
    <div class="cf-row cf-expense"><span>− הוצאות</span><span>${formatCurrency(expense)}</span></div>
    <div class="cf-row cf-net"><span>תזרים תפעולי נטו</span><span>${netOp >= 0 ? '+' : ''}${formatCurrency(netOp)}</span></div>
    ${savingsRow}
    <div class="cf-row cf-total"><span>יתרה נזילה סוגרת (${formatDate(period.end)})</span><span>${formatCurrency(endBal)}</span></div>
  `
}

function _renderLiquidBalanceChart(period) {
  let months = monthsInPeriod(period)
  if (months.length < 3) {
    const [ey, em] = period.end.split('-').map(Number)
    months = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(ey, em - 1 - i, 1)
      months.push(_ym(d))
    }
  }
  const trend = getLiquidBalanceTrend(months)
  const labels = trend.map(t => t.month.slice(5) + '/' + t.month.slice(2,4))
  const data = trend.map(t => t.balance)

  if (_liquidBalanceChart) _liquidBalanceChart.destroy()
  const ctx = document.getElementById('liquidBalanceChart').getContext('2d')
  _liquidBalanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'יתרות נזילות',
        data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,.15)',
        fill: true,
        tension: .3,
        pointRadius: 3,
      }]
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

function _renderTopVendors(periodTx) {
  const byVendor = {}
  periodTx.forEach(t => {
    const ca = countedExpenseAmount(t)
    if (ca <= 0) return
    const v = (t.vendor || '—').trim()
    if (!byVendor[v]) byVendor[v] = { vendor: v, total: 0, count: 0 }
    byVendor[v].total += ca
    byVendor[v].count++
  })
  const rows = Object.values(byVendor).sort((a,b) => b.total - a.total).slice(0, 10)
  document.getElementById('topVendors').innerHTML = rows.length === 0
    ? '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1.5rem">אין נתונים</p>'
    : `<table class="data-table" style="font-size:.85rem">
        <thead><tr><th>ספק</th><th>עסקאות</th><th style="text-align:left">סה"כ</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr><td style="font-weight:500">${r.vendor}</td><td>${r.count}</td><td class="amount-exp">${formatCurrency(r.total)}</td></tr>
        `).join('')}</tbody>
      </table>`
}

// ===== CHAT =====
let _chatMessages = []

async function sendChat() {
  const input = document.getElementById('chatInput')
  const msg = input.value.trim()
  if (!msg) return
  const apiKey = getApiKey()
  if (!apiKey) { alert('חסר מפתח Gemini API – הזן בהגדרות'); return }

  input.value = ''
  _chatMessages.push({ role: 'user', text: msg })
  _renderChat(true)

  const period = getActivePeriod()
  const all = getTransactions()
  const periodTx = filterByPeriod(all, period).slice(0, 100)
  const income = sumIncome(periodTx)
  const expenses = sumExpenses(periodTx)
  const liquidBalance = getLiquidBalance()

  const context = `אתה יועץ פיננסי אישי דובר עברית. ענה תמיד בעברית, בצורה תמציתית ומקצועית.
תקופה: ${period.label || period.start + ' → ' + period.end}
הכנסות ${formatCurrency(income)}, הוצאות ${formatCurrency(expenses)}, נטו ${formatCurrency(income-expenses)}, יתרות נזילות ${formatCurrency(liquidBalance)}.
עסקאות לדוגמה (ללא העברות): ${JSON.stringify(periodTx.filter(t => t.type !== 'transfer').slice(0,20))}
שאלה: ${msg}`

  try {
    const data = await callGemini(apiKey, { contents:[{ parts:[{ text: context }] }], generationConfig:{ temperature:0.3 } })
    const resParts = data.candidates?.[0]?.content?.parts || []
    let answer = ''
    for (const p of resParts) { if (!p.thought && p.text) { answer = p.text; break } }
    if (!answer) answer = resParts[0]?.text || 'לא התקבלה תשובה'
    _chatMessages.push({ role: 'ai', text: answer })
  } catch(e) {
    _chatMessages.push({ role: 'ai', text: 'שגיאה: ' + e.message })
  }
  _renderChat()
}

function _renderChat(loading = false) {
  const container = document.getElementById('chatMessages')
  if (_chatMessages.length === 0) {
    container.innerHTML = '<div class="chat-empty">שאל שאלה על הנתונים הפיננסיים שלך<br><small>לדוגמה: "מה הקטגוריה היקרה ביותר?"</small></div>'
    return
  }
  container.innerHTML = _chatMessages.map(m => `
    <div class="chat-msg ${m.role}">
      <div class="chat-avatar">${m.role==='user'?'👤':'🤖'}</div>
      <div class="chat-bubble">${m.text}</div>
    </div>`).join('')
  if (loading) container.innerHTML += `
    <div class="chat-msg ai">
      <div class="chat-avatar">🤖</div>
      <div class="chat-bubble"><span class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle"></span></div>
    </div>`
  container.scrollTop = container.scrollHeight
}
