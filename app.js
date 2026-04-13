// ===== STORAGE =====
const DB = {
  get: (key, def = []) => { try { return JSON.parse(localStorage.getItem(key)) ?? def } catch { return def } },
  set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
  getObj: (key, def = {}) => { try { return JSON.parse(localStorage.getItem(key)) ?? def } catch { return def } },
}

// ===== UTILS =====
function formatCurrency(n) {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2 }).format(n)
}
function formatDate(str) {
  if (!str) return ''
  const [y, m, d] = str.split('-')
  return `${d}/${m}/${y}`
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
function hashTx(tx, accountId) {
  const raw = `${accountId}|${tx.date}|${tx.amount}|${tx.vendor}`
  let h = 0
  for (let i = 0; i < raw.length; i++) { h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0 }
  return Math.abs(h).toString(36)
}

// ===== NAVIGATION =====
function navigate(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'))
  const el = document.getElementById('screen-' + screen)
  if (el) el.classList.add('active')
  document.querySelectorAll(`[data-screen="${screen}"]`).forEach(l => l.classList.add('active'))
  closeMobileMenu()

  if (screen === 'dashboard') renderDashboard()
  if (screen === 'transactions') renderTransactions()
  if (screen === 'import') initImport()
  if (screen === 'analysis') renderAnalysis()
  if (screen === 'settings') renderSettings()
}

function toggleMobileMenu() {
  document.getElementById('sidebar').classList.toggle('open')
  document.getElementById('sidebarOverlay').classList.toggle('open')
}
function closeMobileMenu() {
  document.getElementById('sidebar').classList.remove('open')
  document.getElementById('sidebarOverlay').classList.remove('open')
}

// ===== DEFAULT DATA =====
const DEFAULT_CATEGORIES = [
  { id: 'cat_food',      name: 'מזון וסופרמרקט',  type: 'expense', color: '#ef4444', icon: '🛒', system: true },
  { id: 'cat_rest',      name: 'מסעדות ובתי קפה',  type: 'expense', color: '#f97316', icon: '🍽️', system: true },
  { id: 'cat_transport', name: 'תחבורה',            type: 'expense', color: '#eab308', icon: '🚗', system: true },
  { id: 'cat_fuel',      name: 'דלק',               type: 'expense', color: '#84cc16', icon: '⛽', system: true },
  { id: 'cat_rent',      name: 'דיור ושכירות',      type: 'expense', color: '#06b6d4', icon: '🏠', system: true },
  { id: 'cat_bills',     name: 'חשבונות וחשמל',    type: 'expense', color: '#3b82f6', icon: '💡', system: true },
  { id: 'cat_health',    name: 'בריאות ורפואה',     type: 'expense', color: '#a855f7', icon: '🏥', system: true },
  { id: 'cat_clothing',  name: 'ביגוד והנעלה',      type: 'expense', color: '#ec4899', icon: '👕', system: true },
  { id: 'cat_leisure',   name: 'בידור ופנאי',       type: 'expense', color: '#14b8a6', icon: '🎮', system: true },
  { id: 'cat_insurance', name: 'ביטוח',              type: 'expense', color: '#6366f1', icon: '🛡️', system: true },
  { id: 'cat_bank',      name: 'עמלות בנק',         type: 'expense', color: '#64748b', icon: '🏦', system: true },
  { id: 'cat_online',    name: 'קניות אונליין',     type: 'expense', color: '#0ea5e9', icon: '📦', system: true },
  { id: 'cat_other_exp', name: 'אחר – הוצאה',       type: 'expense', color: '#9ca3af', icon: '📋', system: true },
  { id: 'cat_salary',    name: 'משכורת',             type: 'income',  color: '#22c55e', icon: '💼', system: true },
  { id: 'cat_extra',     name: 'הכנסה נוספת',       type: 'income',  color: '#10b981', icon: '💰', system: true },
  { id: 'cat_taxback',   name: 'החזר מס',            type: 'income',  color: '#34d399', icon: '📑', system: true },
  { id: 'cat_invest',    name: 'ריבית והשקעות',     type: 'income',  color: '#6ee7b7', icon: '📈', system: true },
  { id: 'cat_other_inc', name: 'אחר – הכנסה',       type: 'income',  color: '#a7f3d0', icon: '📋', system: true },
  { id: 'cat_transfer',  name: 'העברה',              type: 'transfer',color: '#94a3b8', icon: '🔄', system: true },
]

function initDefaultData() {
  if (!localStorage.getItem('finCategories')) {
    DB.set('finCategories', DEFAULT_CATEGORIES)
  }
}

// ===== GETTERS =====
function getTransactions() { return DB.get('finTransactions', []) }
function getAccounts()    { return DB.get('finAccounts', []) }
function getCategories()  { return DB.get('finCategories', DEFAULT_CATEGORIES) }
function getCategoryById(id) { return getCategories().find(c => c.id === id) }
function getApiKey()      { return localStorage.getItem('geminiApiKey') || '' }

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']

async function callGemini(apiKey, body) {
  for (const model of GEMINI_MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    )
    const data = await res.json()
    if (res.ok) return data
    const isQuota = res.status === 429 || data.error?.status === 'RESOURCE_EXHAUSTED'
    if (!isQuota) throw new Error(data.error?.message || 'שגיאת API')
  }
  throw new Error('כל המודלים חרגו מהמכסה – נסה שוב מאוחר יותר')
}

// ===== EXPORT / IMPORT =====
function exportData() {
  const data = {
    transactions: getTransactions(),
    accounts: getAccounts(),
    categories: getCategories(),
    exportedAt: new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `כספים-גיבוי-${new Date().toLocaleDateString('he-IL').replace(/\//g, '-')}.json`
  a.click()
}
function importData(input) {
  const file = input.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result)
      if (data.transactions) DB.set('finTransactions', data.transactions)
      if (data.accounts)     DB.set('finAccounts', data.accounts)
      if (data.categories)   DB.set('finCategories', data.categories)
      alert('הנתונים יובאו בהצלחה!')
      renderSettings()
    } catch { alert('שגיאה בקריאת הקובץ') }
  }
  reader.readAsText(file)
  input.value = ''
}

// ===== EDIT MODAL =====
let _editId = null
function openEditModal(id) {
  const txs = getTransactions()
  const tx = txs.find(t => t.id === id)
  if (!tx) return
  _editId = id
  const cats = getCategories()
  const catOptions = cats.map(c => `<option value="${c.id}" ${tx.categoryId === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')
  document.getElementById('editModalBody').innerHTML = `
    <div class="modal-row"><label class="form-label">ספק</label><input id="editVendor" value="${tx.vendor || ''}"></div>
    <div class="modal-row"><label class="form-label">תאריך</label><input id="editDate" type="date" value="${tx.date}"></div>
    <div class="modal-row"><label class="form-label">סכום (חיובי=הכנסה)</label><input id="editAmount" type="number" step="0.01" value="${tx.amount}"></div>
    <div class="modal-row"><label class="form-label">קטגוריה</label><select id="editCategory"><option value="">ללא קטגוריה</option>${catOptions}</select></div>
    <div class="modal-row"><label class="form-label">הערות</label><input id="editNotes" value="${tx.notes || ''}"></div>
  `
  document.getElementById('editModal').classList.add('open')
}
function closeEditModal() { document.getElementById('editModal').classList.remove('open'); _editId = null }
function saveEditModal() {
  if (!_editId) return
  const txs = getTransactions()
  const idx = txs.findIndex(t => t.id === _editId)
  if (idx < 0) return
  txs[idx].vendor     = document.getElementById('editVendor').value
  txs[idx].date       = document.getElementById('editDate').value
  txs[idx].amount     = parseFloat(document.getElementById('editAmount').value) || txs[idx].amount
  txs[idx].categoryId = document.getElementById('editCategory').value
  txs[idx].notes      = document.getElementById('editNotes').value
  txs[idx].type       = txs[idx].amount > 0 ? 'income' : 'expense'
  DB.set('finTransactions', txs)
  closeEditModal()
  renderTransactions()
}
function deleteFromModal() {
  if (!_editId) return
  if (!confirm('האם למחוק עסקה זו?')) return
  DB.set('finTransactions', getTransactions().filter(t => t.id !== _editId))
  closeEditModal()
  renderTransactions()
}

// ===== VERSION CHECK =====
async function checkForUpdates() {
  try {
    const res = await fetch('./version.json?t=' + Date.now())
    const remote = await res.json()
    const local = localStorage.getItem('appCache')
    if (local && local !== remote.cache) {
      localStorage.setItem('appCache', remote.cache)
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration()
        if (reg?.waiting) reg.waiting.postMessage('SKIP_WAITING')
      }
      location.reload()
      return
    }
    localStorage.setItem('appCache', remote.cache)
  } catch {}
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  checkForUpdates()
  initDefaultData()
  navigate('dashboard')

  const dz = document.getElementById('dropZone')
  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over') })
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'))
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over')
      const f = e.dataTransfer.files[0]
      if (f) { document.getElementById('fileInput').files = e.dataTransfer.files; handleFileSelect({ files: [f] }) }
    })
  }
})
