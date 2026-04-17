function renderSettings() {
  renderAccountList()
  renderCategoryList()
  renderBudgetSettings()
  const key = getApiKey()
  document.getElementById('apiKeyInput').value = key
  document.getElementById('apiKeyMsg').textContent = key ? '✅ מפתח שמור' : ''
  document.getElementById('apiKeyMsg').style.color = 'var(--income)'
  document.getElementById('accCount').textContent = `${getAccounts().length} חשבונות`
  document.getElementById('promptInput').value = getPrompt()
  document.getElementById('promptMsg').textContent = ''
  renderImportBatches()
  renderTemplatesList()
  document.getElementById('appVersion').textContent = 'גרסה ' + APP_VERSION
}

function renderTemplatesList() {
  const el = document.getElementById('templatesList')
  if (!el) return
  const list = getTemplates()
  if (list.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:.9rem">אין תבניות שמורות. ייבא קובץ מובנה (Excel/CSV/TXT) כדי ליצור תבנית ראשונה.</div>'
    return
  }
  const accs = getAccounts()
  el.innerHTML = list.map(t => {
    const acc = t.accountId ? accs.find(a => a.id === t.accountId) : null
    const lastUsed = t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString('he-IL') : '—'
    const headerPreview = (t.headerPreview || []).join(' · ').slice(0, 80) || '(ללא תצוגה)'
    return `
      <div class="template-row">
        <div class="template-main">
          <div class="template-name">${t.name}</div>
          <div class="template-meta">${headerPreview}</div>
          <div class="template-meta">
            ${acc ? `חשבון: ${acc.name} · ` : 'כל חשבון · '}
            שימוש אחרון: ${lastUsed} ·
            סה"כ תנועות שחולצו: ${t.txCount || 0}
          </div>
        </div>
        <div class="template-actions">
          <button class="btn-ghost" onclick="renameTemplate('${t.id}')">שנה שם</button>
          <button class="btn-danger" onclick="confirmDeleteTemplate('${t.id}')">מחק</button>
        </div>
      </div>`
  }).join('')
}

function renameTemplate(id) {
  const list = getTemplates()
  const t = list.find(x => x.id === id)
  if (!t) return
  const newName = prompt('שם חדש לתבנית:', t.name)
  if (!newName || newName === t.name) return
  t.name = newName.trim()
  saveTemplates(list)
  renderTemplatesList()
}

function confirmDeleteTemplate(id) {
  if (!confirm('למחוק את התבנית? ייבוא עתידי מאותו מקור ידרוש מיפוי מחדש.')) return
  deleteTemplate(id)
  renderTemplatesList()
}

function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none')
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('tab-' + name).style.display = 'block'
  btn.classList.add('active')
}

// ===== ACCOUNTS =====
function toggleAccForm() {
  const f = document.getElementById('accForm')
  f.style.display = f.style.display === 'none' ? 'block' : 'none'
}

const PATTERN_BEARING_TYPES = ['credit_card', 'savings', 'investment']
function _onAccTypeChange() {
  const t = document.getElementById('accType').value
  document.getElementById('accPatternsRow').style.display = PATTERN_BEARING_TYPES.includes(t) ? 'block' : 'none'
}

function saveAccount() {
  const name = document.getElementById('accName').value.trim()
  if (!name) { alert('שם החשבון חובה'); return }
  const accounts = getAccounts()
  const type = document.getElementById('accType').value
  const patternsRaw = document.getElementById('accPatterns')?.value || ''
  const patterns = PATTERN_BEARING_TYPES.includes(type)
    ? patternsRaw.split('\n').map(s => s.trim()).filter(Boolean)
    : undefined
  accounts.push({
    id:             genId(),
    name,
    type,
    institution:    document.getElementById('accInstitution').value.trim(),
    openingBalance: parseFloat(document.getElementById('accBalance').value) || 0,
    currency:       'ILS',
    paymentVendorPatterns: patterns,
    createdAt:      Date.now(),
  })
  DB.set('finAccounts', accounts)
  document.getElementById('accName').value = ''
  document.getElementById('accInstitution').value = ''
  document.getElementById('accBalance').value = '0'
  if (document.getElementById('accPatterns')) document.getElementById('accPatterns').value = ''
  toggleAccForm()
  renderSettings()
}

function editAccountPatterns(id) {
  const accs = getAccounts()
  const acc = accs.find(a => a.id === id)
  if (!acc) return
  const current = (acc.paymentVendorPatterns || []).join('\n')
  const v = prompt(`דפוסי זיהוי לחשבון "${acc.name}":\n(שורה לכל ביטוי - משמש לזיהוי העברות אל החשבון בדפי הבנק)`, current)
  if (v === null) return
  acc.paymentVendorPatterns = v.split('\n').map(s => s.trim()).filter(Boolean)
  DB.set('finAccounts', accs)
  renderSettings()
}

function runAutoLinkTransfers() {
  const n = autoLinkTransfersByPattern()
  alert(n === 0 ? 'לא נמצאו העברות חדשות להתאמה' : `זוהו וסומנו ${n} העברות לפי דפוסים`)
  renderSettings()
}

function deleteAccount(id) {
  if (!confirm('האם למחוק חשבון זה?')) return
  DB.set('finAccounts', getAccounts().filter(a => a.id !== id))
  renderSettings()
}

function renderAccountList() {
  const accounts = getAccounts()
  document.getElementById('accCount').textContent = `${accounts.length} חשבונות`
  const TYPE = { checking:'עו"ש', savings:'חיסכון', credit_card:'כרטיס אשראי', cash:'מזומן', investment:'ני"ע / השקעות' }
  document.getElementById('accList').innerHTML = accounts.length === 0
    ? '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:2rem">אין חשבונות. לחץ "חשבון חדש" להוסיף.</p>'
    : accounts.map(a => {
        const bal = getAccountBalance(a.id)
        const balColor = bal >= 0 ? 'var(--income)' : 'var(--expense)'
        const patternsBtn = PATTERN_BEARING_TYPES.includes(a.type)
          ? `<button class="btn-ghost" style="font-size:.75rem;padding:.3rem .7rem" onclick="editAccountPatterns('${a.id}')">דפוסי זיהוי (${(a.paymentVendorPatterns||[]).length})</button>`
          : ''
        return `
        <div class="list-item">
          <div style="flex:1">
            <div class="list-item-name">${a.name}</div>
            <div class="list-item-sub">${TYPE[a.type]||a.type}${a.institution?' · '+a.institution:''} · יתרה: <span style="color:${balColor}">${formatCurrency(bal)}</span></div>
          </div>
          <div style="display:flex;gap:.4rem;align-items:center">
            ${patternsBtn}
            <button class="list-item-del" onclick="deleteAccount('${a.id}')">🗑️</button>
          </div>
        </div>`
      }).join('')
}

// ===== CATEGORIES =====
function toggleCatForm() {
  const f = document.getElementById('catForm')
  f.style.display = f.style.display === 'none' ? 'block' : 'none'
}

function saveCategory() {
  const name = document.getElementById('catName').value.trim()
  if (!name) { alert('שם הקטגוריה חובה'); return }
  const cats = getCategories()
  cats.push({
    id:     genId(),
    name,
    type:   document.getElementById('catType').value,
    icon:   document.getElementById('catIcon').value || '📋',
    color:  document.getElementById('catColor').value,
    system: false,
  })
  DB.set('finCategories', cats)
  document.getElementById('catName').value = ''
  toggleCatForm()
  renderSettings()
}

function deleteCategory(id) {
  const cat = getCategories().find(c => c.id === id)
  if (cat?.system) { alert('לא ניתן למחוק קטגוריית מערכת'); return }
  if (!confirm('האם למחוק קטגוריה זו?')) return
  DB.set('finCategories', getCategories().filter(c => c.id !== id))
  renderSettings()
}

function renderCategoryList() {
  const cats = getCategories()
  const expCats = cats.filter(c => c.type === 'expense')
  const incCats = cats.filter(c => c.type === 'income')

  document.getElementById('catList').innerHTML = [
    ['הוצאות', expCats],
    ['הכנסות', incCats],
  ].map(([label, list]) => `
    <div style="margin-bottom:1.5rem">
      <div style="font-size:.82rem;color:var(--text-muted);margin-bottom:.6rem;font-weight:500">${label} (${list.length})</div>
      <div class="cat-grid">
        ${list.map(c => `
          <div class="cat-chip">
            <div class="cat-chip-left">
              <span class="cat-dot" style="background:${c.color}"></span>
              ${c.icon} ${c.name}
            </div>
            ${!c.system ? `<button class="list-item-del" onclick="deleteCategory('${c.id}')">✕</button>` : ''}
          </div>`).join('')}
      </div>
    </div>`).join('')
}

// ===== PROMPT =====
function savePrompt() {
  const val = document.getElementById('promptInput').value.trim()
  if (!val) { alert('ההנחיות לא יכולות להיות ריקות'); return }
  localStorage.setItem('geminiPrompt', val)
  document.getElementById('promptMsg').textContent = '✅ ההנחיות נשמרו'
  document.getElementById('promptMsg').style.color = 'var(--income)'
}
function resetPrompt() {
  if (!confirm('לאפס את ההנחיות לברירת המחדל?')) return
  localStorage.removeItem('geminiPrompt')
  document.getElementById('promptInput').value = DEFAULT_PROMPT
  document.getElementById('promptMsg').textContent = '✅ אופס לברירת מחדל'
  document.getElementById('promptMsg').style.color = 'var(--income)'
}

// ===== DATA MANAGEMENT =====
function renderImportBatches() {
  const txs = getTransactions()
  const batches = {}
  txs.forEach(t => {
    const key = t.importBatch || '_manual'
    if (!batches[key]) batches[key] = { file: t.sourceFile || 'לא ידוע', importedAt: t.importedAt || t.createdAt, count: 0, total: 0 }
    batches[key].count++
    batches[key].total += t.amount || 0
  })

  const list = Object.entries(batches).sort((a, b) => (b[1].importedAt || 0) - (a[1].importedAt || 0))
  const container = document.getElementById('importBatchList')

  if (list.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:2rem">אין עסקאות במערכת</p>'
    return
  }

  container.innerHTML = list.map(([batchId, b]) => {
    const date = b.importedAt ? new Date(b.importedAt).toLocaleString('he-IL') : '—'
    return `
    <div class="list-item" style="flex-wrap:wrap;gap:.5rem">
      <div style="flex:1;min-width:200px">
        <div class="list-item-name">${b.file}</div>
        <div class="list-item-sub">${date} · ${b.count} עסקאות · ${formatCurrency(b.total)}</div>
      </div>
      <button class="btn-danger" style="font-size:.8rem;padding:.35rem .75rem" onclick="deleteImportBatch('${batchId}')">מחק ייבוא</button>
    </div>`
  }).join('')
}

function deleteImportBatch(batchId) {
  const txs = getTransactions()
  const batchTxs = txs.filter(t => (t.importBatch || '_manual') === batchId)
  const file = batchTxs[0]?.sourceFile || 'לא ידוע'
  if (!confirm(`למחוק ${batchTxs.length} עסקאות מהקובץ "${file}"?`)) return
  DB.set('finTransactions', txs.filter(t => (t.importBatch || '_manual') !== batchId))
  renderImportBatches()
}

function deleteAllTransactions() {
  const count = getTransactions().length
  if (count === 0) { alert('אין עסקאות למחיקה'); return }
  if (!confirm(`האם למחוק ${count} עסקאות? פעולה זו בלתי הפיכה!`)) return
  if (!confirm('האם אתה בטוח? מומלץ לגבות קודם.')) return
  DB.set('finTransactions', [])
  localStorage.removeItem('migration_cc_transfers')
  renderImportBatches()
  alert('כל העסקאות נמחקו')
}

// ===== API KEY =====
function saveApiKey() {
  const key = document.getElementById('apiKeyInput').value.trim()
  if (!key) { alert('הזן מפתח API'); return }
  localStorage.setItem('geminiApiKey', key)
  document.getElementById('apiKeyMsg').textContent = '✅ מפתח נשמר בהצלחה'
  document.getElementById('apiKeyMsg').style.color = 'var(--income)'
}
