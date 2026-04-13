let _txPage = 0
const TX_PAGE_SIZE = 40

function renderTransactions() {
  _txPage = 0
  _buildTxMonthFilter()
  _drawTxTable()
}

function _buildTxMonthFilter() {
  const all = getTransactions()
  const months = [...new Set(all.map(t => t.date?.slice(0,7)).filter(Boolean))].sort((a,b)=>b.localeCompare(a))
  const sel = document.getElementById('txMonthFilter')
  const cur = sel.value
  sel.innerHTML = '<option value="">כל החודשים</option>' +
    months.map(m => `<option value="${m}" ${m===cur?'selected':''}>${m}</option>`).join('')
}

function _getFiltered() {
  const search = document.getElementById('txSearch')?.value.toLowerCase() || ''
  const type   = document.getElementById('txTypeFilter')?.value || 'all'
  const month  = document.getElementById('txMonthFilter')?.value || ''
  return getTransactions()
    .filter(t => {
      if (type !== 'all' && t.type !== type) return false
      if (month && !t.date?.startsWith(month)) return false
      if (search && !((t.vendor||'')+(t.description||'')).toLowerCase().includes(search)) return false
      return true
    })
    .sort((a,b) => (b.date||'').localeCompare(a.date||''))
}

function _drawTxTable() {
  const filtered = _getFiltered()
  const totalInc = filtered.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0)
  const totalExp = filtered.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0)
  const net = totalInc - totalExp

  document.getElementById('txSummary').innerHTML = `
    <span>${filtered.length} עסקאות</span>
    <span class="income">+${formatCurrency(totalInc)}</span>
    <span class="expense">-${formatCurrency(totalExp)}</span>
    <span class="${net>=0?'net-pos':'net-neg'}">נטו: ${formatCurrency(net)}</span>`

  const page = filtered.slice(_txPage * TX_PAGE_SIZE, (_txPage+1) * TX_PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / TX_PAGE_SIZE)

  const TYPE_LABEL = { income:'הכנסה', expense:'הוצאה', transfer:'העברה', refund:'החזר' }

  document.getElementById('txTable').innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>תאריך</th><th>ספק</th><th>קטגוריה</th>
        <th>סכום</th><th>סוג</th><th>הערות</th><th></th>
      </tr></thead>
      <tbody>
      ${page.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:3rem;color:var(--text-muted)">אין עסקאות</td></tr>` :
        page.map(tx => {
          const cat = getCategoryById(tx.categoryId)
          const catBadge = cat
            ? `<span class="cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${cat.name}</span>`
            : `<span style="color:var(--text-muted);font-size:.8rem">לא מסווג</span>`
          return `<tr>
            <td>${formatDate(tx.date)}</td>
            <td><div style="font-weight:500">${tx.vendor||'—'}</div>${tx.description&&tx.description!==tx.vendor?`<div style="font-size:.75rem;color:var(--text-muted)">${tx.description}</div>`:''}</td>
            <td>${catBadge}</td>
            <td class="${tx.amount>0?'amount-inc':'amount-exp'}">${tx.amount>0?'+':''}${formatCurrency(tx.amount)}</td>
            <td><span class="type-badge ${tx.type==='income'?'type-income':'type-expense'}">${TYPE_LABEL[tx.type]||tx.type}</span></td>
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
