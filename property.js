// ===== PROPERTY / MORTGAGE TRACKER =====
// Single property for now (קוד מבנה תומך בהרחבה עתידית). הנתונים הם פרטיים
// ולכן לא מאוכלסים בקוד — המשתמש מזין דרך ה-UI; ה-storage הוא localStorage
// ולכן עובר אוטומטית עם הגיבוי ל-Drive (drive.js).

const PROPERTY_TRACKS = {
  '':         { label: '—',           color: 'var(--text-muted)' },
  'fixed':    { label: 'קבוע',        color: '#3b82f6' },
  'prime':    { label: 'פריים',       color: '#22c55e' },
  'variable': { label: 'משתנה',       color: '#f59e0b' },
  'mixed':    { label: 'מעורב',       color: '#a855f7' },
}

const PROPERTY_TYPES = {
  signing: { label: 'חתימה',     icon: '✍️' },
  payment: { label: 'תשלום',     icon: '💸' },
  tax:     { label: 'מס רכישה',  icon: '🧾' },
  other:   { label: 'אחר',       icon: '•'  },
}

function getProperty() {
  return DB.get('finProperty', { name: 'דירה בנתניה', signedAt: '', basePrice: 0, mortgageCategoryId: '' })
}
function saveProperty(p) { DB.set('finProperty', p) }

function getPropertyPayments() { return DB.get('finPropertyPayments', []) }
function savePropertyPayments(list) { DB.set('finPropertyPayments', list) }

function _propEmptyPayment() {
  return {
    id: genId(),
    dueDate: '', paidDate: '',
    type: 'payment', paymentNumber: null,
    amount: 0, paidAmount: 0, equity: 0, mortgage: 0,
    track: '', notes: '',
  }
}

// ===== TOTALS / DERIVED STATE =====
function _propertyTotals() {
  const p = getProperty()
  const pays = getPropertyPayments()
  const totalDue        = pays.reduce((s, x) => s + (Number(x.amount) || 0), 0)
  const totalPaid       = pays.reduce((s, x) => s + (Number(x.paidAmount) || 0), 0)
  const totalEquity     = pays.reduce((s, x) => s + (Number(x.equity) || 0), 0)
  const totalMortgage   = pays.reduce((s, x) => s + (Number(x.mortgage) || 0), 0)
  const purchaseTax     = pays.filter(x => x.type === 'tax').reduce((s, x) => s + (Number(x.amount) || 0), 0)
  const priceExclTax    = totalDue - purchaseTax
  // Equity ratio: out of money actually deployed (equity + mortgage), how much
  // came from the user's own pocket. This is the meaningful KPI for the bank.
  const denominator     = totalEquity + totalMortgage
  const equityRatio     = denominator > 0 ? totalEquity / denominator : 0
  const remaining       = totalDue - totalPaid
  // "Next payment due" = nearest unpaid by dueDate (today or future first; if
  // none, the closest overdue).
  const today = _iso(new Date())
  const unpaid = pays.filter(x => !x.paidDate && (Number(x.amount) || 0) > 0)
  const future = unpaid.filter(x => x.dueDate && x.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const overdue = unpaid.filter(x => x.dueDate && x.dueDate < today).sort((a, b) => b.dueDate.localeCompare(a.dueDate))
  const nextPayment = future[0] || overdue[0] || null
  return { p, pays, totalDue, totalPaid, purchaseTax, priceExclTax, totalEquity, totalMortgage, equityRatio, remaining, nextPayment }
}

function _propertyStatus(row) {
  const today = _iso(new Date())
  const paid = (Number(row.paidAmount) || 0) > 0 && row.paidDate
  if (paid) return { key: 'paid', label: 'שולם', cls: 'prop-st-paid' }
  if (!row.dueDate) return { key: 'tba', label: 'ללא מועד', cls: 'prop-st-tba' }
  if (row.dueDate < today) return { key: 'overdue', label: 'מאחר', cls: 'prop-st-overdue' }
  // 30-day window for "upcoming"
  const dueT = new Date(row.dueDate).getTime()
  const todT = new Date(today).getTime()
  const diffDays = Math.round((dueT - todT) / 86400000)
  if (diffDays <= 30) return { key: 'upcoming', label: 'קרוב', cls: 'prop-st-upcoming' }
  return { key: 'future', label: 'עתידי', cls: 'prop-st-future' }
}

// ===== MORTGAGE PAYMENTS (pulled from existing tx) =====
// User picks a category; we sum all expense tx in it (negative) up to today,
// take their absolute value, and report.
function _mortgagePaid(catId) {
  if (!catId) return { total: 0, count: 0, monthlyAvg: 0, recurringMonthly: 0 }
  const today = _iso(new Date())
  const txs = getTransactions().filter(t =>
    t.categoryId === catId &&
    t.date && t.date <= today &&
    (Number(t.amount) || 0) < 0
  )
  const total = txs.reduce((s, t) => s + Math.abs(t.amount), 0)
  // last 3 months avg
  const now = new Date()
  const threeMoAgo = _iso(new Date(now.getFullYear(), now.getMonth() - 3, 1))
  const recent = txs.filter(t => t.date >= threeMoAgo)
  const monthlyAvg = recent.length > 0 ? recent.reduce((s, t) => s + Math.abs(t.amount), 0) / 3 : 0
  // recurring smoothed monthly
  const recurringMonthly = (typeof getRecurring === 'function' ? getRecurring() : [])
    .filter(r => r.categoryId === catId && r.smoothedMonthly < 0)
    .reduce((s, r) => s + Math.abs(r.smoothedMonthly), 0)
  return { total, count: txs.length, monthlyAvg, recurringMonthly }
}

// ===== RENDER =====
function renderProperty() {
  const container = document.getElementById('propertyBody')
  if (!container) return
  const t = _propertyTotals()
  const p = t.p
  const cats = (typeof getCategories === 'function' ? getCategories() : []).filter(c => c.type === 'expense')
  const mort = _mortgagePaid(p.mortgageCategoryId)
  const mortgageRemaining = Math.max(0, t.totalMortgage - mort.total)
  const monthsLeft = mort.recurringMonthly > 0 ? mortgageRemaining / mort.recurringMonthly : null

  container.innerHTML = `
    ${_propSetupCard(p, cats)}
    ${_propSummaryCards(t)}
    ${_propPaymentsTable(t)}
    ${_propMortgageCard(t, mort, mortgageRemaining, monthsLeft, p)}
  `
}

function _propSetupCard(p, cats) {
  const catOpts = ['<option value="">— בחר קטגוריה —</option>']
    .concat(cats.map(c => `<option value="${c.id}" ${p.mortgageCategoryId===c.id?'selected':''}>${c.icon||''} ${c.name}</option>`))
    .join('')
  return `
    <div class="card">
      <div class="card-title">פרטי הנכס</div>
      <div class="prop-setup-grid">
        <label class="form-row"><span class="form-label">שם הנכס</span>
          <input type="text" value="${p.name||''}" oninput="onPropertyMetaChange('name', this.value)" class="form-input"></label>
        <label class="form-row"><span class="form-label">תאריך חתימה</span>
          <input type="date" value="${p.signedAt||''}" onchange="onPropertyMetaChange('signedAt', this.value)" class="form-input"></label>
        <label class="form-row"><span class="form-label">קטגוריית תשלומי משכנתא חודשיים</span>
          <select onchange="onPropertyMetaChange('mortgageCategoryId', this.value)" class="form-input">${catOpts}</select></label>
      </div>
    </div>`
}

function _propSummaryCards(t) {
  const ratioPct = (t.equityRatio * 100).toFixed(1)
  const paidPct = t.totalDue > 0 ? Math.min(100, (t.totalPaid / t.totalDue) * 100) : 0
  const next = t.nextPayment
  const nextLine = next
    ? `<div class="prop-next-date">${formatDate(next.dueDate)}</div>
       <div class="prop-next-amt">${formatCurrency(next.amount)}</div>
       ${next.paymentNumber ? `<div style="font-size:.75rem;color:var(--text-muted)">תשלום #${next.paymentNumber}</div>` : ''}`
    : `<div class="prop-next-date" style="color:var(--text-muted)">אין תשלום פתוח</div>`
  return `
    <div class="prop-summary-grid">
      <div class="prop-summary-card">
        <div class="prop-summary-label">מחיר כולל (כולל מס רכישה)</div>
        <div class="prop-summary-val">${formatCurrency(t.totalDue)}</div>
        <div class="prop-summary-sub">בלי מס רכישה: ${formatCurrency(t.priceExclTax)}</div>
      </div>
      <div class="prop-summary-card">
        <div class="prop-summary-label">שולם בפועל</div>
        <div class="prop-summary-val income-color">${formatCurrency(t.totalPaid)}</div>
        <div class="prop-progress-track"><div class="prop-progress-fill" style="width:${paidPct}%"></div></div>
        <div class="prop-summary-sub">${paidPct.toFixed(1)}% מסך החוזה</div>
      </div>
      <div class="prop-summary-card">
        <div class="prop-summary-label">יתרה לתשלום</div>
        <div class="prop-summary-val expense-color">${formatCurrency(t.remaining)}</div>
      </div>
      <div class="prop-summary-card">
        <div class="prop-summary-label">הון עצמי</div>
        <div class="prop-summary-val">${formatCurrency(t.totalEquity)}</div>
        <div class="prop-summary-sub">${ratioPct}% מהמימון</div>
      </div>
      <div class="prop-summary-card">
        <div class="prop-summary-label">משכנתא</div>
        <div class="prop-summary-val">${formatCurrency(t.totalMortgage)}</div>
        <div class="prop-summary-sub">${(100 - parseFloat(ratioPct)).toFixed(1)}% מהמימון</div>
      </div>
      <div class="prop-summary-card prop-next-card">
        <div class="prop-summary-label">תשלום הבא</div>
        ${nextLine}
      </div>
    </div>`
}

function _propPaymentsTable(t) {
  const rows = t.pays.length === 0
    ? `<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:2rem">אין תשלומים. הוסף שורה ↓</td></tr>`
    : t.pays
        .slice()
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
        .map(_propRow).join('')

  const totalsRow = `
    <tr class="prop-totals-row">
      <td colspan="4" style="text-align:left;font-weight:600">סך הכל</td>
      <td>${formatCurrency(t.totalDue)}</td>
      <td>${formatCurrency(t.totalPaid)}</td>
      <td>${formatCurrency(t.totalEquity)}</td>
      <td>${formatCurrency(t.totalMortgage)}</td>
      <td colspan="3"></td>
    </tr>`

  return `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>טבלת תשלומים</span>
        <button class="btn-primary" onclick="addPropertyPayment()" style="padding:.4rem .9rem;font-size:.85rem">+ הוסף שורה</button>
      </div>
      <div style="overflow-x:auto">
        <table class="data-table prop-table">
          <thead><tr>
            <th>סטטוס</th>
            <th>מועד מתוכנן</th>
            <th>תאריך תשלום</th>
            <th>סוג</th>
            <th>סכום</th>
            <th>שולם בפועל</th>
            <th>הון עצמי</th>
            <th>משכנתא</th>
            <th>מסלול</th>
            <th>הערות</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${rows}
            ${totalsRow}
          </tbody>
        </table>
      </div>
      <div style="font-size:.75rem;color:var(--text-muted);margin-top:.6rem">
        💡 הזן את "שולם בפועל" + "הון עצמי" — חלק המשכנתא יחושב אוטומטית. אם הון+משכנתא ≠ שולם, השורה תודגש.
      </div>
    </div>`
}

function _propRow(row) {
  const st = _propertyStatus(row)
  const typeOpts = Object.entries(PROPERTY_TYPES)
    .map(([k, v]) => `<option value="${k}" ${row.type===k?'selected':''}>${v.icon} ${v.label}</option>`).join('')
  const trackOpts = Object.entries(PROPERTY_TRACKS)
    .map(([k, v]) => `<option value="${k}" ${row.track===k?'selected':''}>${v.label}</option>`).join('')

  // Mismatch warning: equity + mortgage ≠ paidAmount
  const sum = (Number(row.equity) || 0) + (Number(row.mortgage) || 0)
  const paid = Number(row.paidAmount) || 0
  const mismatch = paid > 0 && Math.abs(sum - paid) > 1

  // Date variance — paidDate vs dueDate
  let variance = ''
  if (row.dueDate && row.paidDate && row.dueDate !== row.paidDate) {
    const days = Math.round((new Date(row.paidDate) - new Date(row.dueDate)) / 86400000)
    if (days !== 0) {
      const sign = days > 0 ? '+' : ''
      variance = `<div style="font-size:.7rem;color:${days>0?'var(--expense)':'var(--income)'};margin-top:.15rem">${sign}${days} ימים</div>`
    }
  }

  const num = (k, val) => `<input type="number" class="prop-input" min="0" step="100" value="${val||''}" onchange="onPropertyRowChange('${row.id}','${k}',this.value)" placeholder="0">`
  const date = (k, val) => `<input type="date" class="prop-input" value="${val||''}" onchange="onPropertyRowChange('${row.id}','${k}',this.value)">`

  return `
    <tr class="${mismatch ? 'prop-row-mismatch' : ''}">
      <td><span class="prop-status ${st.cls}">${st.label}</span></td>
      <td>${date('dueDate', row.dueDate)}</td>
      <td>${date('paidDate', row.paidDate)}${variance}</td>
      <td>
        <select class="prop-input" onchange="onPropertyRowChange('${row.id}','type',this.value)">${typeOpts}</select>
        <input type="number" class="prop-input" min="0" step="1" value="${row.paymentNumber||''}" onchange="onPropertyRowChange('${row.id}','paymentNumber',this.value)" placeholder="#" style="margin-top:.2rem;width:4rem">
      </td>
      <td>${num('amount', row.amount)}</td>
      <td>${num('paidAmount', row.paidAmount)}</td>
      <td>${num('equity', row.equity)}</td>
      <td>${num('mortgage', row.mortgage)}</td>
      <td><select class="prop-input" onchange="onPropertyRowChange('${row.id}','track',this.value)">${trackOpts}</select></td>
      <td><input type="text" class="prop-input" value="${(row.notes||'').replace(/"/g,'&quot;')}" onchange="onPropertyRowChange('${row.id}','notes',this.value)" placeholder="הערה"></td>
      <td><button class="btn-ghost" onclick="deletePropertyPayment('${row.id}')" style="font-size:.75rem;padding:.25rem .55rem;color:var(--expense)">🗑</button></td>
    </tr>`
}

function _propMortgageCard(t, mort, mortgageRemaining, monthsLeft, p) {
  if (!p.mortgageCategoryId) {
    return `
      <div class="card">
        <div class="card-title">תשלומי משכנתא חודשיים</div>
        <p style="color:var(--text-muted);font-size:.85rem">בחר קטגוריה למעלה כדי לשלב את ההחזרים החודשיים מתוך מסך ההוצאות.</p>
      </div>`
  }
  const cat = getCategoryById(p.mortgageCategoryId)
  const paidPct = t.totalMortgage > 0 ? Math.min(100, (mort.total / t.totalMortgage) * 100) : 0
  const monthsLine = monthsLeft != null && isFinite(monthsLeft) && monthsLeft > 0
    ? `<div class="prop-summary-sub">~${Math.round(monthsLeft)} חודשים בקצב הנוכחי</div>`
    : ''
  return `
    <div class="card">
      <div class="card-title">תשלומי משכנתא חודשיים</div>
      <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:.75rem">
        מבוסס על קטגוריה: ${cat ? `<b>${cat.icon||''} ${cat.name}</b>` : '—'} (לא כולל את תשלומי הרכישה למעלה).
      </div>
      <div class="prop-summary-grid">
        <div class="prop-summary-card">
          <div class="prop-summary-label">סך ששולם עד היום</div>
          <div class="prop-summary-val expense-color">${formatCurrency(mort.total)}</div>
          <div class="prop-summary-sub">${mort.count} עסקאות</div>
        </div>
        <div class="prop-summary-card">
          <div class="prop-summary-label">החזר חודשי שקול</div>
          <div class="prop-summary-val">${formatCurrency(mort.recurringMonthly || mort.monthlyAvg)}</div>
          <div class="prop-summary-sub">${mort.recurringMonthly > 0 ? 'מזיהוי הוצאה קבועה' : 'ממוצע 3 חודשים'}</div>
        </div>
        <div class="prop-summary-card">
          <div class="prop-summary-label">יתרת קרן (ללא ריבית)</div>
          <div class="prop-summary-val">${formatCurrency(mortgageRemaining)}</div>
          <div class="prop-progress-track"><div class="prop-progress-fill" style="width:${paidPct}%"></div></div>
          ${monthsLine}
        </div>
      </div>
      <div style="font-size:.75rem;color:var(--text-muted);margin-top:.6rem">
        💡 "יתרת קרן" היא אומדן גס — היא לא מפרידה בין קרן לריבית. לחישוב מדויק נדרש לוח סילוקין מלא של כל מסלול.
      </div>
    </div>`
}

// ===== EVENT HANDLERS =====
function onPropertyMetaChange(field, value) {
  const p = getProperty()
  if (field === 'basePrice') p[field] = parseFloat(value) || 0
  else p[field] = value
  saveProperty(p)
  renderProperty()
}

function onPropertyRowChange(id, field, value) {
  const list = getPropertyPayments()
  const row = list.find(x => x.id === id)
  if (!row) return
  if (['amount', 'paidAmount', 'equity', 'mortgage'].includes(field)) {
    row[field] = parseFloat(value) || 0
    // Auto-fill mortgage = paid - equity when user enters paid + equity but
    // mortgage is empty/zero. Same logic in reverse for equity.
    if (field === 'paidAmount' || field === 'equity') {
      const paid = Number(row.paidAmount) || 0
      const eq = Number(row.equity) || 0
      if (paid > 0 && eq > 0 && (Number(row.mortgage) || 0) === 0) {
        row.mortgage = Math.max(0, paid - eq)
      }
    }
    if (field === 'paidAmount' || field === 'mortgage') {
      const paid = Number(row.paidAmount) || 0
      const mo = Number(row.mortgage) || 0
      if (paid > 0 && mo > 0 && (Number(row.equity) || 0) === 0) {
        row.equity = Math.max(0, paid - mo)
      }
    }
  } else if (field === 'paymentNumber') {
    row[field] = value === '' ? null : (parseInt(value, 10) || null)
  } else {
    row[field] = value
  }
  savePropertyPayments(list)
  renderProperty()
}

function addPropertyPayment() {
  const list = getPropertyPayments()
  // Default new row to next payment number if any prior payments exist.
  const maxNum = list.filter(x => x.type === 'payment' && x.paymentNumber)
    .reduce((m, x) => Math.max(m, x.paymentNumber), 0)
  const row = _propEmptyPayment()
  row.paymentNumber = maxNum + 1
  list.push(row)
  savePropertyPayments(list)
  renderProperty()
}

function deletePropertyPayment(id) {
  if (!confirm('למחוק את השורה?')) return
  const list = getPropertyPayments().filter(x => x.id !== id)
  savePropertyPayments(list)
  renderProperty()
}
