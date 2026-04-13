function renderSettings() {
  renderAccountList()
  renderCategoryList()
  const key = getApiKey()
  document.getElementById('apiKeyInput').value = key
  document.getElementById('apiKeyMsg').textContent = key ? '✅ מפתח שמור' : ''
  document.getElementById('apiKeyMsg').style.color = 'var(--income)'
  document.getElementById('accCount').textContent = `${getAccounts().length} חשבונות`
  document.getElementById('promptInput').value = getPrompt()
  document.getElementById('promptMsg').textContent = ''
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

function saveAccount() {
  const name = document.getElementById('accName').value.trim()
  if (!name) { alert('שם החשבון חובה'); return }
  const accounts = getAccounts()
  accounts.push({
    id:             genId(),
    name,
    type:           document.getElementById('accType').value,
    institution:    document.getElementById('accInstitution').value.trim(),
    openingBalance: parseFloat(document.getElementById('accBalance').value) || 0,
    currency:       'ILS',
    createdAt:      Date.now(),
  })
  DB.set('finAccounts', accounts)
  document.getElementById('accName').value = ''
  document.getElementById('accInstitution').value = ''
  document.getElementById('accBalance').value = '0'
  toggleAccForm()
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
  const TYPE = { checking:'עו"ש', savings:'חיסכון', credit_card:'כרטיס אשראי', cash:'מזומן' }
  document.getElementById('accList').innerHTML = accounts.length === 0
    ? '<p style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:2rem">אין חשבונות. לחץ "חשבון חדש" להוסיף.</p>'
    : accounts.map(a => `
      <div class="list-item">
        <div>
          <div class="list-item-name">${a.name}</div>
          <div class="list-item-sub">${TYPE[a.type]||a.type}${a.institution?' · '+a.institution:''} · ₪</div>
        </div>
        <button class="list-item-del" onclick="deleteAccount('${a.id}')">🗑️</button>
      </div>`).join('')
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

// ===== API KEY =====
function saveApiKey() {
  const key = document.getElementById('apiKeyInput').value.trim()
  if (!key) { alert('הזן מפתח API'); return }
  localStorage.setItem('geminiApiKey', key)
  document.getElementById('apiKeyMsg').textContent = '✅ מפתח נשמר בהצלחה'
  document.getElementById('apiKeyMsg').style.color = 'var(--income)'
}
