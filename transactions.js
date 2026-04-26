let _txPage = 0
const TX_PAGE_SIZE = 40

// When viewing from a specific account, mirror-side transactions
// (CC payments / transfers to savings) affect the account's balance
// with the opposite sign. These helpers flip the perspective.
function _txIsMirrorFor(t, accountId) {
  return !!accountId && t.accountId !== accountId &&
    (t.ccPaymentForAccountId === accountId || t.transferAccountId === accountId)
}
function _txViewAmount(t, accountId) {
  return _txIsMirrorFor(t, accountId) ? -t.amount : t.amount
}

function renderTransactions() {
  _txPage = 0
  renderPeriodSelector('txPeriodSelector', () => { _txPage = 0; _drawTxTable() })
  _buildTxAccountFilter()
  _buildTxCategoryFilter()
  _buildTxFlowFilter()
  _drawTxTable()
}

function _buildTxCategoryFilter() {
  const sel = document.getElementById('txCategoryFilter')
  if (!sel) return
  const cur = sel.value
  const cats = getCategories()
  const expCats = cats.filter(c => c.type === 'expense')
  const incCats = cats.filter(c => c.type === 'income')
  const opt = c => `<option value="${c.id}" ${c.id===cur?'selected':''}>${c.icon||''} ${c.name}</option>`
  sel.innerHTML = `
    <option value="">כל הקטגוריות</option>
    <option value="__none__" ${cur==='__none__'?'selected':''}>— ללא קטגוריה —</option>
    <optgroup label="הוצאות">${expCats.map(opt).join('')}</optgroup>
    <optgroup label="הכנסות">${incCats.map(opt).join('')}</optgroup>`
}

function _buildTxAccountFilter() {
  const accs = getAccounts()
  const sel = document.getElementById('txAccountFilter')
  if (!sel) return
  const cur = sel.value
  sel.innerHTML = '<option value="">כל החשבונות</option>' +
    accs.map(a => `<option value="${a.id}" ${a.id===cur?'selected':''}>${a.name}</option>`).join('')
}

function _buildTxFlowFilter() {
  const sel = document.getElementById('txFlowFilter')
  if (!sel) return
  const nonLiquid = getAccounts().filter(a => !isLiquidAccount(a))
  const cur = sel.value
  sel.innerHTML = '<option value="">תזרים חיסכון/השקעות: הכל</option>' +
    nonLiquid.map(a => `<option value="${a.id}" ${a.id===cur?'selected':''}>תזרים ל/מ ${a.name}</option>`).join('')
  sel.style.display = nonLiquid.length === 0 ? 'none' : ''
}

function _getFiltered() {
  const search = document.getElementById('txSearch')?.value.toLowerCase() || ''
  const type   = document.getElementById('txTypeFilter')?.value || 'all'
  const account = document.getElementById('txAccountFilter')?.value || ''
  const category = document.getElementById('txCategoryFilter')?.value || ''
  const flowAcc = document.getElementById('txFlowFilter')?.value || ''
  const period = getActivePeriod()
  // Treat a tx as uncategorized if it has no categoryId, or if its
  // categoryId points at a category that was deleted.
  const validCatIds = new Set(getCategories().map(c => c.id))
  const isUncat = t => !t.categoryId || !validCatIds.has(t.categoryId)
  return filterByEffectivePeriod(getTransactions(), period)
    .filter(t => {
      if (type !== 'all') {
        if (type === 'uncategorized') { if (!isUncat(t)) return false }
        else if (t.type !== type) return false
      }
      if (account) {
        const touchesAcc = t.accountId === account
          || t.ccPaymentForAccountId === account
          || t.transferAccountId === account
        if (!touchesAcc) return false
      }
      if (category) {
        if (category === '__none__') { if (!isUncat(t)) return false }
        else if (t.categoryId !== category) return false
      }
      if (flowAcc) {
        // Match either side of a transfer involving the selected non-liquid account
        const touches = t.accountId === flowAcc
          || (t.type === 'transfer' && (t.transferAccountId === flowAcc || t.ccPaymentForAccountId === flowAcc))
        if (!touches) return false
      }
      if (search) {
        const hay = ((t.vendor||'') + (t.description||'') + (resolveVendor(t.vendor, t.amount)||'')).toLowerCase()
        if (!hay.includes(search)) return false
      }
      return true
    })
    .sort((a,b) => (b.date||'').localeCompare(a.date||''))
}

function _drawTxTable() {
  const filtered = _getFiltered()
  const accountId = document.getElementById('txAccountFilter')?.value || ''
  const showRunningBalance = !!accountId
  // Raw sums of visible rows (not P&L scope) so the summary matches
  // the table — CC detail and transactions on non-liquid accounts must
  // be counted here even though they're excluded from the dashboard P&L.
  // When viewing a single account, flip sign for mirror-side rows so a
  // CC payment (bank -5,000) shows as +5,000 credit against the CC.
  const viewAmt = t => _txViewAmount(t, accountId)
  const nonTransfer = filtered.filter(t => t.type !== 'transfer')
  const totalInc = nonTransfer.filter(t => viewAmt(t) > 0).reduce((s,t) => s + viewAmt(t), 0)
  const totalExp = nonTransfer.filter(t => viewAmt(t) < 0).reduce((s,t) => s + Math.abs(viewAmt(t)), 0)
  const net = totalInc - totalExp
  let runningBalanceInfo = ''
  if (showRunningBalance) {
    const acc = getAccounts().find(a => a.id === accountId)
    const bal = getAccountBalance(accountId)
    runningBalanceInfo = `<span style="color:${bal>=0?'var(--income)':'var(--expense)'};font-weight:600">יתרה: ${formatCurrency(bal)}</span>`
  }

  const categoryId = document.getElementById('txCategoryFilter')?.value || ''
  let categoryBalanceInfo = ''
  if (categoryId && categoryId !== '__none__') {
    const cat = getCategoryById(categoryId)
    const catBal = net
    const label = cat ? `${cat.icon||''} ${cat.name}` : 'קטגוריה'
    categoryBalanceInfo = `<span style="color:${catBal>=0?'var(--income)':'var(--expense)'};font-weight:600">יתרת ${label}: ${formatCurrency(catBal)}</span>`
  }

  document.getElementById('txSummary').innerHTML = `
    <span>${filtered.length} עסקאות</span>
    <span class="income">+${formatCurrency(totalInc)}</span>
    <span class="expense">-${formatCurrency(totalExp)}</span>
    <span class="${net>=0?'net-pos':'net-neg'}">נטו: ${formatCurrency(net)}</span>
    ${categoryBalanceInfo}
    ${runningBalanceInfo}`

  const page = filtered.slice(_txPage * TX_PAGE_SIZE, (_txPage+1) * TX_PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / TX_PAGE_SIZE)

  const TYPE_LABEL = { income:'הכנסה', expense:'הוצאה', transfer:'העברה', refund:'החזר' }
  const TYPE_CLS = { income:'type-income', expense:'type-expense', transfer:'type-transfer', refund:'type-refund' }

  // Compute running balance (only when single account filtered)
  // We need to compute balance at each row. Since table is date desc, we:
  // - get balance up to & including each row's date (but only for transactions on/before that row)
  let rowBalances = {}
  if (showRunningBalance) {
    // Include mirror-side txs (CC payments from bank / deposits to savings)
    // so the running balance reconciles with getAccountBalance.
    const accTxs = getTransactions().filter(t =>
      t.accountId === accountId
      || t.ccPaymentForAccountId === accountId
      || t.transferAccountId === accountId
    ).sort((a,b) => (a.date||'').localeCompare(b.date||''))
    const acc = getAccounts().find(a => a.id === accountId)
    let run = acc?.openingBalance || 0
    for (const t of accTxs) {
      run += _txViewAmount(t, accountId)
      rowBalances[t.id] = run
    }
  }

  document.getElementById('txTable').innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>תאריך</th><th>חודש חיוב</th><th>ספק</th><th>קטגוריה</th>
        <th>סכום</th><th>סוג</th>
        ${showRunningBalance ? '<th>יתרה</th>' : ''}
        <th>הערות</th><th></th>
      </tr></thead>
      <tbody>
      ${page.length === 0 ? `<tr><td colspan="${showRunningBalance?9:8}" style="text-align:center;padding:3rem;color:var(--text-muted)">אין עסקאות</td></tr>` :
        page.map(tx => {
          const cat = getCategoryById(tx.categoryId)
          const catBadge = cat
            ? `<span class="cat-badge cat-badge-clickable" onclick="filterTxByCategory('${cat.id}')" title="סנן לפי קטגוריה זו" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${cat.name}</span>`
            : `<span class="cat-badge-clickable" onclick="filterTxByCategory('__none__')" title="סנן לפי לא־מסווג" style="color:var(--text-muted);font-size:.8rem">לא מסווג</span>`
          const isMirror = _txIsMirrorFor(tx, accountId)
          const dispAmt = isMirror ? -tx.amount : tx.amount
          const isNonCounted = tx.type === 'transfer' || tx.type === 'refund'
          const amountCls = isNonCounted ? 'amount-muted' : (dispAmt>0?'amount-inc':'amount-exp')
          const balCell = showRunningBalance ? `<td style="font-weight:500">${formatCurrency(rowBalances[tx.id] ?? 0)}</td>` : ''
          const mirrorLabel = isMirror
            ? (tx.ccPaymentForAccountId === accountId ? 'תשלום לכרטיס' : 'הפקדה')
            : null
          const typeBadge = mirrorLabel
            ? `<span class="type-badge type-transfer" title="עסקה מחשבון אחר שמשפיעה על היתרה">${mirrorLabel}</span>`
            : `<span class="type-badge ${TYPE_CLS[tx.type]||'type-expense'}">${TYPE_LABEL[tx.type]||tx.type}</span>`
          const effMonth = getTxEffectiveMonth(tx)
          const effMonthDisplay = effMonth ? effMonth.slice(5) + '/' + effMonth.slice(0,4) : '—'
          const effMonthMismatch = effMonth && tx.date && effMonth !== tx.date.slice(0,7)
          const effCell = `<td style="font-size:.8rem;color:${effMonthMismatch?'var(--accent)':'var(--text-muted)'}">${effMonthDisplay}</td>`
          return `<tr ${isNonCounted||isMirror?'class="tx-noncounted"':''}>
            <td>${formatDate(tx.date)}</td>
            ${effCell}
            <td><div style="font-weight:500">${resolveVendor(tx.vendor, tx.amount)||'—'}</div>${tx.description&&tx.description!==tx.vendor?`<div style="font-size:.75rem;color:var(--text-muted)">${tx.description}</div>`:''}</td>
            <td>${catBadge}</td>
            <td class="${amountCls}">${dispAmt>0?'+':''}${formatCurrency(dispAmt)}</td>
            <td>${typeBadge}</td>
            ${balCell}
            <td style="color:var(--text-muted);font-size:.8rem">${tx.notes||''}</td>
            <td><button class="edit-btn" onclick="openEditModal('${tx.id}')">✏️</button></td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`

  // Pagination
  const pag = document.getElementById('txPagination')
  if (totalPages <= 1) { pag.innerHTML = ''; return }
  pag.innerHTML = `
    <button class="btn-ghost" onclick="_txPage=Math.max(0,_txPage-1);_drawTxTable()" ${_txPage===0?'disabled':''}>הקודם</button>
    <span class="page-info">${_txPage+1} / ${totalPages}</span>
    <button class="btn-ghost" onclick="_txPage=Math.min(${totalPages-1},_txPage+1);_drawTxTable()" ${_txPage===totalPages-1?'disabled':''}>הבא</button>`
}

// Click-to-filter from a category badge inside the table.
function filterTxByCategory(catId) {
  const sel = document.getElementById('txCategoryFilter')
  if (!sel) return
  sel.value = catId
  _txPage = 0
  _drawTxTable()
}
