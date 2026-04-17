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
  const apiKey = getApiKey()
  if (!apiKey) { document.getElementById('importError').textContent = 'חסר מפתח Gemini API – הזן בהגדרות'; return }
  _importFileName = file.name
  parseWithGemini(file, accountId, apiKey)
}

async function parseWithGemini(file, accountId, apiKey) {
  document.getElementById('importStep1').style.display = 'none'
  document.getElementById('importStep2').style.display = 'block'
  document.getElementById('importFilename').textContent = file.name

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

    // מיפוי קטגוריות
    const cats = getCategories()
    const matchCategory = (t) => {
      const catName = (t.category || '').trim()
      if (!catName) return ''
      const match = cats.find(c => c.name === catName || catName.includes(c.name) || c.name.includes(catName))
      return match?.id || ''
    }

    // בדוק כפילויות
    const existing = getTransactions()
    const existingHashes = new Set(existing.map(t => t.sourceHash))

    const importAccount = getAccounts().find(a => a.id === accountId)
    const isPatternBearing = ['credit_card','savings','investment'].includes(importAccount?.type)

    _parsedTx = parsed.map(t => {
      // Auto-detect transfer target only when importing into a liquid source account
      let match = null
      if (!isPatternBearing && t.amount < 0) {
        match = findMatchingAccountByPattern(t.vendor, t.description)
      }
      return {
        ...t,
        _categoryId: matchCategory(t),
        _hash: hashTx(t, accountId),
        _keep: true,
        _accountId: accountId,
        _matchAccountId:   match?.id || '',
        _matchAccountName: match?.name || '',
        _matchAccountType: match?.type || '',
        // Override type suggestion if matched
        type: match ? 'transfer' : t.type,
      }
    }).map(t => ({ ...t, _duplicate: existingHashes.has(t._hash), _keep: !existingHashes.has(t._hash) }))

    document.getElementById('importStep2').style.display = 'none'
    showImportReview()
  } catch (err) {
    console.error('Import error:', err)
    document.getElementById('importStep2').style.display = 'none'
    document.getElementById('importStepError').style.display = 'block'
    document.getElementById('importErrMsg').textContent = err.message
  }
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
