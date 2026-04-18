// ===== CORE HELPERS =====
// Source of truth for counting income/expenses (fixes double-counting)
//
// P&L PHILOSOPHY: the checking account (and cash) is the authoritative source
// of real income/expenses. Credit-card and savings/investment account transactions
// are detail lines — they move money around but don't represent a fresh expense
// from the user's perspective. Only the bank-level debit to a CC counts as an
// expense; the detailed CC statement rows are informational (category breakdown,
// balance tracking) but excluded from P&L totals to avoid double counting.
//
// Transfers never count in P&L (they're movements between owned accounts).
// Refunds reduce expenses, never count as income.

const PL_ACCOUNT_TYPES = new Set(['checking', 'cash'])

let _plAcctIdsCache = null
let _plAcctIdsCacheTs = 0
function _getPLAccountIds() {
  const now = Date.now()
  if (!_plAcctIdsCache || now - _plAcctIdsCacheTs > 500) {
    _plAcctIdsCache = new Set(getAccounts().filter(a => PL_ACCOUNT_TYPES.has(a.type)).map(a => a.id))
    _plAcctIdsCacheTs = now
  }
  return _plAcctIdsCache
}
function invalidatePLCache() { _plAcctIdsCache = null }

function isPLTransaction(t) { return _getPLAccountIds().has(t.accountId) }

function isCountedIncome(t)  { return isPLTransaction(t) && t.amount > 0 && t.type !== 'transfer' && t.type !== 'refund' }
function isCountedExpense(t) { return isPLTransaction(t) && ((t.amount < 0 && t.type !== 'transfer') || (t.type === 'refund' && t.amount > 0)) }

function countedExpenseAmount(t) {
  if (!isPLTransaction(t)) return 0
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
// "Liquid" accounts are those whose balance represents immediate purchasing power
// (checking, cash, credit_card debt). Savings & investments are tracked separately.
const NON_LIQUID_ACCOUNT_TYPES = new Set(['savings', 'investment'])
function isLiquidAccount(a) { return !NON_LIQUID_ACCOUNT_TYPES.has(a.type) }

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

function getLiquidBalance(uptoDateISO = null) {
  return getAccounts().filter(isLiquidAccount).reduce((s, a) => s + getAccountBalance(a.id, uptoDateISO), 0)
}

function getLiquidBalanceTrend(months) {
  return months.map(mo => {
    const [y, m] = mo.split('-').map(Number)
    const endIso = _iso(new Date(y, m, 0))
    return { month: mo, balance: getLiquidBalance(endIso) }
  })
}

// Flow to/from a specific account during a period.
// Deposited = positive balance deltas entering the account (including mirror side of transfers)
// Withdrawn = negative balance deltas leaving the account
function getAccountFlow(accountId, period) {
  const txs = filterByPeriod(getTransactions(), period)
  let deposited = 0, withdrawn = 0
  txs.forEach(t => {
    let delta = 0
    if (t.accountId === accountId) {
      delta = t.amount
    } else if (t.type === 'transfer' && (t.transferAccountId === accountId || t.ccPaymentForAccountId === accountId)) {
      delta = -t.amount
    }
    if (delta > 0) deposited += delta
    else if (delta < 0) withdrawn += -delta
  })
  return { deposited, withdrawn, net: deposited - withdrawn }
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

// ===== TRANSFER AUTO-MATCHING =====
// Matches a bank transaction against accounts that define paymentVendorPatterns
// (credit_card, savings, or investment). Returns the matched account or null.
const PATTERN_MATCHABLE_TYPES = new Set(['credit_card', 'savings', 'investment'])
function findMatchingAccountByPattern(vendor, description) {
  const text = ((vendor || '') + ' ' + (description || '')).toLowerCase().trim()
  if (!text) return null
  const candidates = getAccounts().filter(a => PATTERN_MATCHABLE_TYPES.has(a.type))
  for (const acc of candidates) {
    const patterns = acc.paymentVendorPatterns || []
    for (const p of patterns) {
      if (!p) continue
      if (text.includes(p.toLowerCase().trim())) return acc
    }
  }
  return null
}

// Scan all transactions on liquid source accounts and link matching transfers
// to their destination (CC / savings / investment). Returns count of updates.
function autoLinkTransfersByPattern() {
  const txs = getTransactions()
  const accs = getAccounts()
  const srcAccIds = new Set(accs.filter(a => !PATTERN_MATCHABLE_TYPES.has(a.type)).map(a => a.id))
  let changed = 0
  txs.forEach(t => {
    if (!srcAccIds.has(t.accountId)) return
    if (t.amount >= 0) return
    if (t.transferAccountId) return
    const match = findMatchingAccountByPattern(t.vendor, t.description)
    if (match) {
      t.type = 'transfer'
      t.transferAccountId = match.id
      if (match.type === 'credit_card') t.ccPaymentForAccountId = match.id
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

// ===== CATEGORY RULES =====
// Deterministic vendor→category matching. Priority:
//   1. User-defined rules (finCategoryRules)
//   2. Account-derived rules (savings/investment accounts auto-contribute)
//   3. Default seed rules for common Israeli merchants
// First substring match (case-insensitive) wins.

const DEFAULT_CATEGORY_RULES = [
  { patterns: ['שופרסל','רמי לוי','ויקטורי','יוחננוף','יינות ביתן','מגה','קרפור','אושר עד','טיב טעם','מחסני השוק','האחים דהן','shufersal','rami levy'], categoryId: 'cat_food' },
  { patterns: ['סופרפארם','super-pharm','סופר פארם','בי אנד לייף','ניובר','ליפמן פארם'], categoryId: 'cat_health' },
  { patterns: ['מכבי','כללית','מאוחדת','לאומית','רופא','קופת חולים','בית מרקחת','מרפאה','רנטגן'], categoryId: 'cat_health' },
  { patterns: ['פז ','דור אלון','סונול','פנגו','טן ','delek','paz','דלק חברה'], categoryId: 'cat_fuel' },
  { patterns: ['רכבת ישראל','אגד','דן תחבורה','קווים','רב-קו','רב קו','סופרבוס','מוניות','egged','dan tnu','moovit','גט טקסי','יאנגו','gett'], categoryId: 'cat_transport' },
  { patterns: ['חברת החשמל','חב החשמל','חברת חשמל','בזק','הוט','סלקום','פרטנר','פלאפון','012','019','015'], categoryId: 'cat_bills' },
  { patterns: ['מי אביבים','הגיחון','מיתב','מי רעננה','מי שבע','תאגיד מים','מקורות'], categoryId: 'cat_bills' },
  { patterns: ['פז גז','סופרגז','דור גז','אמישראגז','גזטל'], categoryId: 'cat_bills' },
  { patterns: ['ארנונה','עיריית','מועצה מקומית'], categoryId: 'cat_bills' },
  { patterns: ['netflix','נטפליקס','spotify','ספוטיפיי','youtube','disney','apple.com','icloud','itunes','hbo','stan','paramount'], categoryId: 'cat_leisure' },
  { patterns: ['קולנוע','הכרטיס','יס פלאנט','סינמה סיטי','רב-חן','היכל התרבות','פסטיבל','גלילאו','bookme','ticketim','ticmate'], categoryId: 'cat_leisure' },
  { patterns: ['aliexpress','amazon','amzn','ebay','shein','asos','terminal x','next direct','wish','lightinthebox','temu','zara','h&m'], categoryId: 'cat_online' },
  { patterns: ['מגדל','הראל','מנורה','הפניקס','כלל ביטוח','איילון ביטוח','ביטוח ישיר','שומרה','clal'], categoryId: 'cat_insurance' },
  { patterns: ['ביטוח לאומי','מס הכנסה','רשות המסים','משרד התחבורה'], categoryId: 'cat_bills' },
  { patterns: ['ארומה','ארקפה','גרג','roladin','רולדין','מקדונלד','בורגר','פיצה','דומינוס','kfc','wolt','10bis','tenbis','ten bis','גולדה','starbucks','bbb','japanika','humus'], categoryId: 'cat_rest' },
  { patterns: ['עמלה','עמלת','ריבית חובה','ריבית זכות','ניהול חשבון','דמי ניהול','דמי כרטיס','שורות','התראות','דמי שורה'], categoryId: 'cat_bank' },
  { patterns: ['משכורת','שכר עבודה','תלוש שכר'], categoryId: 'cat_salary' },
  { patterns: ['החזר מס','מס הכנסה החזר','זיכוי מס'], categoryId: 'cat_taxback' },
]

function getCategoryRules() { return DB.get('finCategoryRules', []) }
function saveCategoryRules(list) { DB.set('finCategoryRules', list) }

function addCategoryRule(pattern, categoryId) {
  const rules = getCategoryRules()
  rules.push({ id: genId(), pattern: String(pattern).trim(), categoryId, createdAt: Date.now() })
  saveCategoryRules(rules)
}

function deleteCategoryRule(id) {
  saveCategoryRules(getCategoryRules().filter(r => r.id !== id))
}

// Rules derived from savings/investment accounts' paymentVendorPatterns:
// every pattern auto-categorizes matching bank transactions as "חסכונות והשקעות".
function _accountDerivedRules() {
  const rules = []
  getAccounts().forEach(a => {
    if (!['savings', 'investment'].includes(a.type)) return
    ;(a.paymentVendorPatterns || []).forEach(p => {
      if (p && String(p).trim()) rules.push({ patterns: [p], categoryId: 'cat_invest_out', source: 'account:' + a.id })
    })
  })
  return rules
}

function matchVendorToCategory(vendor, description) {
  const text = ((vendor || '') + ' ' + (description || '')).toLowerCase().trim()
  if (!text) return ''

  const userRules    = getCategoryRules().map(r => ({ patterns: [r.pattern], categoryId: r.categoryId }))
  const accountRules = _accountDerivedRules()
  const allRules     = [...userRules, ...accountRules, ...DEFAULT_CATEGORY_RULES]

  for (const rule of allRules) {
    const patterns = rule.patterns || (rule.pattern ? [rule.pattern] : [])
    for (const p of patterns) {
      const needle = String(p).toLowerCase().trim()
      if (!needle) continue
      if (text.includes(needle)) return rule.categoryId
    }
  }
  return ''
}
