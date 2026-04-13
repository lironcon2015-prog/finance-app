let _pieChart = null

function renderAnalysis() {
  _buildPeriodFilter()
  _drawAnalysis()
}

function _buildPeriodFilter() {
  const all = getTransactions()
  const months = [...new Set(all.map(t => t.date?.slice(0,7)).filter(Boolean))].sort((a,b)=>b.localeCompare(a))
  const sel = document.getElementById('analysisPeriod')
  const cur = sel.value || months[0] || new Date().toISOString().slice(0,7)
  sel.innerHTML = months.length === 0
    ? `<option value="${cur}">${cur}</option>`
    : months.map(m => `<option value="${m}" ${m===cur?'selected':''}>${m}</option>`).join('')
}

function _drawAnalysis() {
  const period = document.getElementById('analysisPeriod').value
  const all = getTransactions()
  const periodTx = all.filter(t => t.date?.startsWith(period))

  const income   = periodTx.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0)
  const expenses = periodTx.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0)
  const net = income - expenses

  document.getElementById('pnlStats').innerHTML = [
    { label: 'סך הכנסות', value: income,   color: 'var(--income)',  icon: '📈', bg: 'var(--income-bg)' },
    { label: 'סך הוצאות', value: expenses, color: 'var(--expense)', icon: '📉', bg: 'var(--expense-bg)' },
    { label: 'רווח / הפסד', value: net,    color: net>=0?'var(--income)':'var(--expense)', icon: '⚖️', bg: net>=0?'var(--income-bg)':'var(--expense-bg)' },
  ].map(s => `
    <div class="stat-card">
      <div class="stat-icon" style="background:${s.bg}">${s.icon}</div>
      <div>
        <div class="stat-label">${s.label}</div>
        <div class="stat-value" style="color:${s.color}">${formatCurrency(s.value)}</div>
      </div>
    </div>`).join('')

  // Expense pie
  const expByCat = {}
  periodTx.filter(t=>t.amount<0).forEach(t => {
    const cat = getCategoryById(t.categoryId)
    const key = cat?.id || '__none__'
    if (!expByCat[key]) expByCat[key] = { name: cat?.name||'לא מסווג', color: cat?.color||'#64748b', total: 0 }
    expByCat[key].total += Math.abs(t.amount)
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

  // Income breakdown
  const incByCat = {}
  periodTx.filter(t=>t.amount>0).forEach(t => {
    const cat = getCategoryById(t.categoryId)
    const key = cat?.id || '__none__'
    if (!incByCat[key]) incByCat[key] = { name: cat?.name||'לא מסווג', color: cat?.color||'#22c55e', total: 0 }
    incByCat[key].total += t.amount
  })
  const incRows = Object.values(incByCat).sort((a,b)=>b.total-a.total)
  document.getElementById('incomeBreakdown').innerHTML = incRows.length === 0
    ? '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:2rem">אין הכנסות לתקופה</p>'
    : incRows.map(r => `
      <div class="cat-bar-item">
        <div class="cat-bar-header">
          <span>${r.name}</span>
          <span style="color:var(--income);font-weight:600">${formatCurrency(r.total)}</span>
        </div>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:${Math.round(r.total/income*100)}%;background:${r.color}"></div>
        </div>
      </div>`).join('')
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

  const period = document.getElementById('analysisPeriod').value
  const all = getTransactions()
  const periodTx = all.filter(t => t.date?.startsWith(period)).slice(0, 100)
  const income = periodTx.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0)
  const expenses = periodTx.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0)

  const context = `אתה יועץ פיננסי אישי דובר עברית. ענה תמיד בעברית, בצורה תמציתית ומקצועית.
נתוני תקופה ${period}: הכנסות ${formatCurrency(income)}, הוצאות ${formatCurrency(expenses)}, נטו ${formatCurrency(income-expenses)}.
עסקאות לדוגמה: ${JSON.stringify(periodTx.slice(0,20))}
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
