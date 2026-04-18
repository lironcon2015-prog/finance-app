let _txPage = 0
const TX_PAGE_SIZE = 40

function renderTransactions() {
  _txPage = 0
  _buildTxMonthFilter()
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

function _buildTxMonthFilter() {
  const all = getTransactions()
  const months = [...new Set(all.map(t => t.date?.slice(0,7)).filter(Boolean))].sort((a,b)=>b.localeCompare(a))
  const sel = document.getElementById('txMonthFilter')
  const cur = sel.value
  sel.innerHTML = '<option value="">כל החודשים</option>' +
    months.map(m => `<option value="${m}" ${m===cur?'selected':''}>${m}</option>`).join('')
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
  const month  = document.getElementById('txMonthFilter')?.value || ''
  const account = document.getElementById('txAccountFilter')?.value || ''
  const category = document.getElementById('txCategoryFilter')?.value || ''
  const flowAcc = document.getElementById('txFlowFilter')?.value || ''
  // Treat a tx as uncategorized if it has no categoryId, or if its
  // categoryId points at a category that was deleted.
  const validCatIds = new Set(getCategories().map(c => c.id))
  const isUncat = t => !t.categoryId || !validCatIds.has(t.categoryId)
  return getTransactions()
    .filter(t => {
      if (type !== 'all') {
        if (type === 'uncategorized') { if (!isUncat(t)) return false }
        else if (t.type !== type) return false
      }
      if (month && !t.date?.startsWith(month)) return false
      if (account && t.accountId !== account) return false
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
      if (search && !((t.vendor||'')+(t.description||'')).toLowerCase().includes(search)) return false
      return true
    })
    .sort((a,b) => (b.date||'').localeCompare(a.date||''))
}

function _drawTxTable() {
  const filtered = _getFiltered()
  const totalInc = sumIncome(filtered)
  const totalExp = sumExpenses(filtered)
  const net = totalInc - totalExp

  const accountId = document.getElementById('txAccountFilter')?.value || ''
  const showRunningBalance = !!accountId
  let runningBalanceInfo = ''
  if (showRunningBalance) {
    const acc = getAccounts().find(a => a.id === accountId)
    const bal = getAccountBalance(accountId)
    runningBalanceInfo = `<span style="color:${bal>=0?'var(--income)':'var(--expense)'};font-weight:600">יתרה: ${formatCurrency(bal)}</span>`
  }

  document.getElementById('txSummary').innerHTML = `
    <span>${filtered.length} עסקאות</span>
    <span class="income">+${formatCurrency(totalInc)}</span>
    <span class="expense">-${formatCurrency(totalExp)}</span>
    <span class="${net>=0?'net-pos':'net-neg'}">נטו: ${formatCurrency(net)}</span>
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
    const accTxs = getTransactions().filter(t => t.accountId === accountId)
      .sort((a,b) => (a.date||'').localeCompare(b.date||''))
    const acc = getAccounts().find(a => a.id === accountId)
    let run = acc?.openingBalance || 0
    for (const t of accTxs) {
      run += t.amount
      rowBalances[t.id] = run
    }
  }

  document.getElementById('txTable').innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>תאריך</th><th>ספק</th><th>קטגוריה</th>
        <th>סכום</th><th>סוג</th>
        ${showRunningBalance ? '<th>יתרה</th>' : ''}
        <th>הערות</th><th></th>
      </tr></thead>
      <tbody>
      ${page.length === 0 ? `<tr><td colspan="${showRunningBalance?8:7}" style="text-align:center;padding:3rem;color:var(--text-muted)">אין עסקאות</td></tr>` :
        page.map(tx => {
          const cat = getCategoryById(tx.categoryId)
          const catBadge = cat
            ? `<span class="cat-badge cat-badge-clickable" onclick="filterTxByCategory('${cat.id}')" title="סנן לפי קטגוריה זו" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${cat.name}</span>`
            : `<span class="cat-badge-clickable" onclick="filterTxByCategory('__none__')" title="סנן לפי לא־מסווג" style="color:var(--text-muted);font-size:.8rem">לא מסווג</span>`
          const isNonCounted = tx.type === 'transfer' || tx.type === 'refund'
          const amountCls = isNonCounted ? 'amount-muted' : (tx.amount>0?'amount-inc':'amount-exp')
          const balCell = showRunningBalance ? `<td style="font-weight:500">${formatCurrency(rowBalances[tx.id] ?? 0)}</td>` : ''
          return `<tr ${isNonCounted?'class="tx-noncounted"':''}>
            <td>${formatDate(tx.date)}</td>
            <td><div style="font-weight:500">${tx.vendor||'—'}</div>${tx.description&&tx.description!==tx.vendor?`<div style="font-size:.75rem;color:var(--text-muted)">${tx.description}</div>`:''}</td>
            <td>${catBadge}</td>
            <td class="${amountCls}">${tx.amount>0?'+':''}${formatCurrency(tx.amount)}</td>
            <td><span class="type-badge ${TYPE_CLS[tx.type]||'type-expense'}">${TYPE_LABEL[tx.type]||tx.type}</span></td>
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
