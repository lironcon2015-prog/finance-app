// ===== CORE HELPERS =====
// Source of truth for counting income/expenses (fixes double-counting)
// Transfers do NOT count as income or expense (they move money between accounts)
// Refunds reduce expenses, never count as income

function isCountedIncome(t)  { return t.amount > 0 && t.type !== 'transfer' && t.type !== 'refund' }
function isCountedExpense(t) { return (t.amount < 0 && t.type !== 'transfer') || (t.type === 'refund' && t.amount > 0) }

function countedExpenseAmount(t) {
  // Refund with positive amount reduces expenses
  if (t.type === 'refund' && t.amount > 0) return -t.amount
  if (t.amount < 0 && t.type !== 'transfer') return Math.abs(t.amount)
  return 0
}

function sumIncome(txs)   { return txs.filter(isCountedIncome).reduce((s,t)=>s+t.amount,0) }
function sumExpenses(txs) { return txs.reduce((s,t)=>s+countedExpenseAmount(t),0) }
function sumNet(txs)      { return sumIncome(txs) - sumExpenses(txs) }

// ===== PERIOD PRESETS =====
function _ym(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
function _iso(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function _startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function _endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth()+1, 0) }

function periodPresets() {
  const now = new Date()
  const som = _startOfMonth(now)
  const lmS = new Date(now.getFullYear(), now.getMonth()-1, 1)
  const lmE = new Date(now.getFullYear(), now.getMonth(), 0)
  return [
    { key: 'this_month',  label: 'חודש נוכחי',        start: _iso(som),                                       end: _iso(now) },
    { key: 'last_month',  label: 'חודש קודם',          start: _iso(lmS),                                       end: _iso(lmE) },
    { key: 'last_3m',     label: '3 חודשים אחרונים',    start: _iso(new Date(now.getFullYear(), now.getMonth()-2, 1)), end: _iso(now) },
    { key: 'last_6m',     label: '6 חודשים אחרונים',    start: _iso(new Date(now.getFullYear(), now.getMonth()-5, 1)), end: _iso(now) },
    { key: 'last_12m',    label: '12 חודשים אחרונים',   start: _iso(new Date(now.getFullYear(), now.getMonth()-11,1)), end: _iso(now) },
    { key: 'ytd',         label: 'מתחילת השנה',        start: _iso(new Date(now.getFullYear(), 0, 1)),          end: _iso(now) },
    { key: 'this_year',   label: 'שנה נוכחית',          start: _iso(new Date(now.getFullYear(), 0, 1)),          end: _iso(new Date(now.getFullYear(), 11, 31)) },
    { key: 'last_year',   label: 'שנה קודמת',           start: _iso(new Date(now.getFullYear()-1, 0, 1)),        end: _iso(new Date(now.getFullYear()-1, 11, 31)) },
  ]
}

function getActivePeriod() {
  try {
    const raw = localStorage.getItem('finActivePeriod')
    if (raw) {
      const p = JSON.parse(raw)
      if (p?.start && p?.end) return p
    }
  } catch {}
  return periodPresets()[0]  // this_month
}
function setActivePeriod(p) { localStorage.setItem('finActivePeriod', JSON.stringify(p)) }

function filterByPeriod(txs, p) {
  return txs.filter(t => t.date && t.date >= p.start && t.date <= p.end)
}

function monthsInPeriod(p) {
  const out = []
  const [sy, sm] = p.start.split('-').map(Number)
  const [ey, em] = p.end.split('-').map(Number)
  let y = sy, m = sm
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2,'0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

function shiftPeriodByYear(p, years = 1) {
  const shift = iso => {
    const [y,m,d] = iso.split('-')
    return `${+y - years}-${m}-${d}`
  }
  return { ...p, start: shift(p.start), end: shift(p.end), key: 'shifted', label: p.label + ' (שנה קודמת)' }
}

// ===== BALANCES =====
function getAccountBalance(accountId, uptoDateISO = null) {
  const acc = getAccounts().find(a => a.id === accountId)
  if (!acc) return 0
  let balance = acc.openingBalance || 0
  getTransactions().forEach(t => {
    if (uptoDateISO && t.date > uptoDateISO) return
    if (t.accountId === accountId) {
      balance += t.amount
    } else if (t.type === 'transfer' && (t.transferAccountId === accountId || t.ccPaymentForAccountId === accountId)) {
      // Mirror side of the transfer: bank sends -5000 to CC → CC gets +5000
      balance -= t.amount
    }
  })
  return balance
}

function getNetWorth(uptoDateISO = null) {
  return getAccounts().reduce((s, a) => s + getAccountBalance(a.id, uptoDateISO), 0)
}

function getNetWorthTrend(months) {
  // Returns [{ month, netWorth }] for each YYYY-MM, measured at end of month
  return months.map(mo => {
    const [y, m] = mo.split('-').map(Number)
    const endIso = _iso(new Date(y, m, 0))
    return { month: mo, netWorth: getNetWorth(endIso) }
  })
}

// ===== PERIOD SELECTOR UI =====
function renderPeriodSelector(containerId, onChange) {
  const el = document.getElementById(containerId)
  if (!el) return
  const active = getActivePeriod()
  const presets = periodPresets()
  el.innerHTML = `
    <div class="period-selector">
      <div class="period-presets">
        ${presets.map(p => `<button class="period-btn ${active.key===p.key?'active':''}" data-key="${p.key}">${p.label}</button>`).join('')}
        <button class="period-btn ${active.key==='custom'?'active':''}" data-key="custom">טווח מותאם</button>
      </div>
      <div class="period-custom" style="display:${active.key==='custom'?'flex':'none'}">
        <label class="form-label" style="margin:0">מ:</label>
        <input type="date" id="periodCustomStart" value="${active.start||''}">
        <label class="form-label" style="margin:0">עד:</label>
        <input type="date" id="periodCustomEnd" value="${active.end||''}">
        <button class="btn-primary" id="periodCustomApply" style="padding:.4rem .9rem">החל</button>
      </div>
    </div>`
  el.querySelectorAll('.period-btn').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.key
    if (key === 'custom') {
      el.querySelector('.period-custom').style.display = 'flex'
      el.querySelectorAll('.period-btn').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      return
    }
    const p = presets.find(x => x.key === key)
    if (p) { setActivePeriod(p); renderPeriodSelector(containerId, onChange); onChange?.(p) }
  }))
  const applyBtn = el.querySelector('#periodCustomApply')
  if (applyBtn) applyBtn.addEventListener('click', () => {
    const s = el.querySelector('#periodCustomStart').value
    const e = el.querySelector('#periodCustomEnd').value
    if (!s || !e) return
    const p = { key: 'custom', label: `${s} → ${e}`, start: s, end: e }
    setActivePeriod(p); onChange?.(p)
  })
}

// ===== CC PAYMENT MATCHING =====
function findMatchingCcAccount(vendor, description) {
  const text = ((vendor || '') + ' ' + (description || '')).toLowerCase().trim()
  if (!text) return null
  const ccAccounts = getAccounts().filter(a => a.type === 'credit_card')
  for (const acc of ccAccounts) {
    const patterns = acc.paymentVendorPatterns || []
    for (const p of patterns) {
      if (!p) continue
      if (text.includes(p.toLowerCase().trim())) return acc
    }
  }
  return null
}

// Scan all transactions and link CC payments; returns count of updates
function autoLinkCcPayments() {
  const txs = getTransactions()
  const accs = getAccounts()
  const bankAccIds = new Set(accs.filter(a => a.type !== 'credit_card').map(a => a.id))
  let changed = 0
  txs.forEach(t => {
    if (!bankAccIds.has(t.accountId)) return
    if (t.amount >= 0) return
    if (t.ccPaymentForAccountId) return
    const match = findMatchingCcAccount(t.vendor, t.description)
    if (match) {
      t.type = 'transfer'
      t.ccPaymentForAccountId = match.id
      t.transferAccountId = match.id
      changed++
    }
  })
  if (changed > 0) DB.set('finTransactions', txs)
  return changed
}

// ===== CC PURCHASES FIX =====
// Bug fix: prior migration marked negative bank tx with CC-keyword vendor as transfer.
// But if a CC statement was imported, its ACTUAL purchases might also carry CC-keyword
// descriptions and get wrongly marked as transfer.
// Fix: for transactions on credit_card accounts, force type='expense' (amount<0) or 'income' (amount>0)
function fixCcStatementTypes() {
  const ccIds = new Set(getAccounts().filter(a => a.type === 'credit_card').map(a => a.id))
  if (ccIds.size === 0) return 0
  const txs = getTransactions()
  let changed = 0
  txs.forEach(t => {
    if (!ccIds.has(t.accountId)) return
    if (t.type === 'transfer' && !t.ccPaymentForAccountId) {
      // CC account transaction mistakenly marked as transfer - fix
      t.type = t.amount > 0 ? 'income' : 'expense'
      changed++
    }
  })
  if (changed > 0) DB.set('finTransactions', txs)
  return changed
}
