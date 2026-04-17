let _parsedTx = []
let _importFileName = ''

function initImport() {
  resetImport()
  const accounts = getAccounts()
  const sel = document.getElementById('importAccount')
  sel.innerHTML = accounts.length === 0
    ? '<option value="">אין חשבונות – צור חשבון בהגדרות</option>'
    : accounts.map(a => `<option value="${a.id}">${a.name}${a.institution?' – '+a.institution:''}</option>`).join('')
}

function resetImport() {
  _parsedTx = []
  ;['importStep2','importStep3','importStep4','importStepError'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.style.display = 'none'
  })
  const s1 = document.getElementById('importStep1')
  if (s1) s1.style.display = 'block'
  document.getElementById('importError').textContent = ''
  const fi = document.getElementById('fileInput')
  if (fi) fi.value = ''
}

function handleFileSelect(input) {
  const file = input.files?.[0]
  if (!file) return
  const accountId = document.getElementById('importAccount')?.value
  if (!accountId) { document.getElementById('importError').textContent = 'יש לבחור חשבון תחילה'; return }
  _importFileName = file.name

  const isStructured = /\.(xlsx?|csv|txt)$/i.test(file.name)
  if (isStructured) {
    handleStructuredFile(file, accountId)
  } else {
    const apiKey = getApiKey()
    if (!apiKey) { document.getElementById('importError').textContent = 'חסר מפתח Gemini API – הזן בהגדרות'; return }
    parseWithGemini(file, accountId, apiKey)
  }
}

async function handleStructuredFile(file, accountId) {
  document.getElementById('importStep1').style.display = 'none'
  document.getElementById('importStep2').style.display = 'block'
  document.getElementById('importFilename').textContent = file.name
  const msgEl = document.getElementById('importLoadingMsg')
  if (msgEl) msgEl.textContent = 'קורא את הקובץ...'
  try {
    const rows = await extractRowsFromFile(file)
    // Try existing template (try each plausible header row 0..min(10,rows-1))
    const maxTry = Math.min(rows.length, 15)
    let matched = null
    for (let i = 0; i < maxTry; i++) {
      const sig = computeHeaderSignature(rows[i] || [])
      const tpl = findTemplateForSignature(sig)
      if (tpl) {
        // Template saved with a specific header row? Respect it.
        matched = { ...tpl, headerRowIndex: tpl.headerRowIndex ?? i }
        break
      }
    }
    if (matched) {
      continueImportWithTemplate(file, accountId, rows, matched)
    } else {
      document.getElementById('importStep2').style.display = 'none'
      openTplWizard(file, accountId, rows)
    }
  } catch (err) {
    console.error('Structured import error:', err)
    document.getElementById('importStep2').style.display = 'none'
    document.getElementById('importStepError').style.display = 'block'
    document.getElementById('importErrMsg').textContent = err.message
  }
}

function continueImportWithTemplate(file, accountId, rows, template) {
  try {
    document.getElementById('importStep2').style.display = 'block'
    const msgEl = document.getElementById('importLoadingMsg')
    if (msgEl) msgEl.textContent = `פרסור דטרמיניסטי לפי תבנית "${template.name}"...`
    const { transactions, stats } = parseWithTemplate(rows, template)
    _lastParseStats = stats
    _lastTemplateName = template.name
    bumpTemplateUsage(template.id, transactions.length)
    _finalizeParsedTransactions(transactions, accountId)
  } catch (err) {
    console.error('Template parse error:', err)
    document.getElementById('importStep2').style.display = 'none'
    document.getElementById('importStepError').style.display = 'block'
    document.getElementById('importErrMsg').textContent = err.message
  }
}

let _lastParseStats = null
let _lastTemplateName = ''

async function parseWithGemini(file, accountId, apiKey) {
  document.getElementById('importStep1').style.display = 'none'
  document.getElementById('importStep2').style.display = 'block'
  document.getElementById('importFilename').textContent = file.name
  const msgEl = document.getElementById('importLoadingMsg')
  if (msgEl) msgEl.textContent = 'מנתח עם Gemini AI...'

  try {
    const isExcel = /\.xlsx?$/i.test(file.name)
    const isText = /\.(csv|txt)$/i.test(file.name)
    let parts

    const prompt = getPrompt()

    if (isExcel) {
      const csv = await excelToCSV(file)
      parts = [{ text: prompt + '\n\nנתוני הקובץ:\n' + csv }]
    } else if (isText) {
      const text = await readTextFile(file)
      parts = [{ text: prompt + '\n\nנתוני הקובץ:\n' + text }]
    } else {
      const base64 = await fileToBase64(file)
      const mimeType = getMimeType(file.name)
      parts = [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }

    const body = {
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 65536 }
    }

    const data = await callGemini(apiKey, body)

    const candidate = data.candidates?.[0]
    console.log('Gemini finishReason:', candidate?.finishReason)
    console.log('Gemini parts count:', candidate?.content?.parts?.length)

    // Gemini 2.5 models return thinking + response in separate parts
    const allParts = candidate?.content?.parts || []
    let text = ''
    for (const p of allParts) {
      if (!p.thought && p.text) { text = p.text; break }
    }
    // fallback: concatenate all non-thought text
    if (!text) text = allParts.filter(p => !p.thought).map(p => p.text || '').join('')
    // last resort: any text at all
    if (!text) text = allParts.map(p => p.text || '').join('')
    console.log('Gemini extracted text:', text.slice(0, 500))

    text = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()
    if (!text) {
      const reason = candidate?.finishReason || 'unknown'
      throw new Error(`תשובה ריקה מ-AI (סיבה: ${reason}) – נסה שוב`)
    }
    const parsed = tryParseJSON(text)
    _lastParseStats = null
    _lastTemplateName = ''
    _finalizeParsedTransactions(parsed, accountId)
  } catch (err) {
    console.error('Import error:', err)
    document.getElementById('importStep2').style.display = 'none'
    document.getElementById('importStepError').style.display = 'block'
    document.getElementById('importErrMsg').textContent = err.message
  }
}

function _finalizeParsedTransactions(parsed, accountId) {
  const cats = getCategories()
  const matchCategory = (t) => {
    const catName = (t.category || '').trim()
    if (!catName) return ''
    const match = cats.find(c => c.name === catName || catName.includes(c.name) || c.name.includes(catName))
    return match?.id || ''
  }

  // Autocat: learn from user's prior categorizations by vendor (uncategorized only)
  const existing = getTransactions()
  const autocatRules = (typeof _buildVendorCategoryRules === 'function')
    ? _buildVendorCategoryRules(existing) : {}
  const suggestFromAutocat = (vendor) => {
    if (!vendor) return ''
    const k = (typeof normalizeVendorForAutocat === 'function') ? normalizeVendorForAutocat(vendor) : ''
    if (!k || !autocatRules[k]) return ''
    const entries = Object.entries(autocatRules[k])
    const total = entries.reduce((s, [, n]) => s + n, 0)
    entries.sort((a, b) => b[1] - a[1])
    const [topCat, topN] = entries[0]
    return (topN / total) >= 0.8 ? topCat : ''
  }

  const existingHashes = new Set(existing.map(t => t.sourceHash))

  // Auto-transfer detection on import is DISABLED: the bank statement is the
  // authoritative P&L source. A "כאל 5000" line on the bank is a real expense,
  // not a transfer. Users can manually mark a row as transfer in the edit modal,
  // or run "זהה אוטומטית חיובי אשראי" in settings to bulk-link after the fact.

  _parsedTx = parsed.map(t => {
    const catFromName = matchCategory(t)
    const catFromAutocat = catFromName ? '' : suggestFromAutocat(t.vendor)
    return {
      ...t,
      _categoryId: catFromName || catFromAutocat,
      _hash: hashTx(t, accountId),
      _keep: true,
      _accountId: accountId,
      _matchAccountId:   '',
      _matchAccountName: '',
      _matchAccountType: '',
    }
  }).map(t => ({ ...t, _duplicate: existingHashes.has(t._hash), _keep: !existingHashes.has(t._hash) }))

  document.getElementById('importStep2').style.display = 'none'
  showImportReview()
}

function showImportReview() {
  const toImport = _parsedTx.filter(t => t._keep).length
  const dups = _parsedTx.filter(t => t._duplicate).length

  document.getElementById('importChips').innerHTML = [
    { label: 'עסקאות שנמצאו', value: _parsedTx.length, color: 'var(--accent)' },
    { label: 'לייבוא',         value: toImport,          color: 'var(--income)' },
    ...(dups > 0 ? [{ label: 'כפילויות (מדולגות)', value: dups, color: 'var(--text-muted)' }] : []),
  ].map(c => `
    <div class="import-chip">
      <div class="chip-label">${c.label}</div>
      <div class="chip-value" style="color:${c.color}">${c.value}</div>
    </div>`).join('')

  const summaryEl = document.getElementById('importParseSummary')
  if (summaryEl) summaryEl.innerHTML = _buildParseSummary()

  const cats = getCategories()
  const typeLabel = tp => ({ income:'הכנסה', expense:'הוצאה', transfer:'העברה', refund:'החזר' }[tp] || tp)
  const typeCls = tp => ({ income:'type-income', expense:'type-expense', transfer:'type-transfer', refund:'type-refund' }[tp] || 'type-expense')
  const rows = _parsedTx.map((t, i) => {
    const cat = cats.find(c => c.id === t._categoryId)
    const ccNote = t._matchAccountName ? `<div style="font-size:.72rem;color:var(--accent);margin-top:.15rem">→ ${t._matchAccountName}</div>` : ''
    return `
    <tr style="opacity:${t._duplicate?'.4':'1'}">
      <td><input type="checkbox" ${t._keep&&!t._duplicate?'checked':''} ${t._duplicate?'disabled':''}
        onchange="_parsedTx[${i}]._keep=this.checked;_updateSaveBtn()" style="width:auto;cursor:pointer"></td>
      <td>${formatDate(t.date)}</td>
      <td style="font-weight:500">${t.vendor}${ccNote}</td>
      <td style="font-weight:700;color:${t.amount>0?'var(--income)':'var(--expense)'}">${t.amount>0?'+':''}${formatCurrency(t.amount)}</td>
      <td>${cat ? `<span style="font-size:.8rem">${cat.icon} ${cat.name}</span>` : '<span style="color:var(--text-muted);font-size:.8rem">—</span>'}</td>
      <td><span class="type-badge ${typeCls(t.type)}">${t._duplicate?'קיים':typeLabel(t.type)}</span></td>
    </tr>`}).join('')

  document.getElementById('importTable').innerHTML = `
    <thead><tr><th>ייבא</th><th>תאריך</th><th>ספק</th><th>סכום</th><th>קטגוריה</th><th>סוג</th></tr></thead>
    <tbody>${rows}</tbody>`

  document.getElementById('importStep3').style.display = 'block'
  _updateSaveBtn()
}

function _buildParseSummary() {
  const txs = _parsedTx.filter(t => !t._duplicate)
  if (txs.length === 0) return ''
  const incomeSum   = txs.filter(t => t.amount > 0).reduce((s,t)=>s+t.amount, 0)
  const expenseSum  = txs.filter(t => t.amount < 0).reduce((s,t)=>s+t.amount, 0)
  const dates = txs.map(t => t.date).filter(Boolean).sort()
  const minDate = dates[0], maxDate = dates[dates.length - 1]
  const tplBadge = _lastTemplateName
    ? `<span class="parse-summary-badge">תבנית: ${_lastTemplateName}</span>`
    : `<span class="parse-summary-badge parse-summary-ai">AI</span>`
  const stats = _lastParseStats
  const skippedNote = stats && stats.skipped > 0
    ? ` · דולגו ${stats.skipped} שורות (${Object.entries(stats.skippedReasons).map(([r,n])=>`${r}: ${n}`).join(', ')})`
    : ''
  return `
    <div class="parse-summary">
      ${tplBadge}
      <span>הכנסות: <b style="color:var(--income)">+${Math.round(incomeSum).toLocaleString('he-IL')}</b></span>
      <span>הוצאות: <b style="color:var(--expense)">${Math.round(expenseSum).toLocaleString('he-IL')}</b></span>
      <span>טווח: ${minDate || '—'} → ${maxDate || '—'}</span>
      ${skippedNote ? `<span style="color:var(--text-muted)">${skippedNote}</span>` : ''}
    </div>`
}

function _updateSaveBtn() {
  const n = _parsedTx.filter(t => t._keep).length
  const btn = document.getElementById('importSaveBtn')
  btn.textContent = `שמור ${n} עסקאות`
  btn.disabled = n === 0
}

function saveImport() {
  const toSave = _parsedTx.filter(t => t._keep)
  const existing = getTransactions()
  const batchId = genId()
  const importedAt = Date.now()
  const newTx = toSave.map(t => ({
    id:          genId(),
    accountId:   t._accountId,
    date:        t.date,
    amount:      t.amount,
    vendor:      t.vendor,
    description: t.description || '',
    type:        t.type,
    categoryId:  t._categoryId || '',
    notes:       '',
    sourceHash:  t._hash,
    sourceFile:  _importFileName,
    importBatch: batchId,
    importedAt:  importedAt,
    createdAt:   importedAt,
    transferAccountId: t._matchAccountId || undefined,
    ccPaymentForAccountId: t._matchAccountType === 'credit_card' ? t._matchAccountId : undefined,
  }))
  DB.set('finTransactions', [...existing, ...newTx])
  document.getElementById('importStep3').style.display = 'none'
  document.getElementById('importStep4').style.display = 'block'
  document.getElementById('importDoneMsg').textContent = `${newTx.length} עסקאות נשמרו בהצלחה`
}

// ===== JSON PARSER =====
function tryParseJSON(text) {
  // ניסיון ישיר
  try { return JSON.parse(text) } catch {}

  // חילוץ מערך JSON מתוך הטקסט
  const start = text.indexOf('[')
  if (start < 0) throw new Error('תשובת AI לא הכילה נתונים – נסה שוב')
  let jsonPart = text.slice(start)

  // הסרת טקסט אחרי סוף המערך
  const end = jsonPart.lastIndexOf(']')
  if (end > 0) {
    jsonPart = jsonPart.slice(0, end + 1)
    try { return JSON.parse(jsonPart) } catch {}
  }

  // JSON חתוך – מוצא את האובייקט השלם האחרון
  const lastBrace = jsonPart.lastIndexOf('}')
  if (lastBrace > 0) {
    let fixed = jsonPart.slice(0, lastBrace + 1)
    // הסרת פסיק מיותר לפני סגירה
    fixed = fixed.replace(/,\s*$/, '') + ']'
    try { return JSON.parse(fixed) } catch {}
  }

  throw new Error('שגיאה בפרסור תשובת AI – נסה שוב')
}

// ===== HELPERS =====
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result.split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
}
function excelToCSV(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        res(XLSX.utils.sheet_to_csv(ws))
      } catch (err) { rej(err) }
    }
    r.onerror = rej
    r.readAsArrayBuffer(file)
  })
}
function getMimeType(filename) {
  if (filename.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}

// Read a text file with encoding detection: UTF-8 first, fallback to windows-1255 (Hebrew)
// if the UTF-8 decode produced replacement characters (U+FFFD).
function readTextFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = e => {
      try {
        const buf = e.target.result
        const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf)
        if (!utf8.includes('\uFFFD')) { res(utf8); return }
        try {
          const heb = new TextDecoder('windows-1255', { fatal: false }).decode(buf)
          res(heb)
        } catch {
          res(utf8)
        }
      } catch (err) { rej(err) }
    }
    r.onerror = rej
    r.readAsArrayBuffer(file)
  })
}
