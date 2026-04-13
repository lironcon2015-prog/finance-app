let _parsedTx = []

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
  parseWithGemini(file, accountId, apiKey)
}

async function parseWithGemini(file, accountId, apiKey) {
  document.getElementById('importStep1').style.display = 'none'
  document.getElementById('importStep2').style.display = 'block'
  document.getElementById('importFilename').textContent = file.name

  try {
    const isExcel = /\.xlsx?$/i.test(file.name)
    let parts

    const prompt = `אתה מנתח דוחות בנק ישראלים. נתח את הקובץ והחזר JSON בלבד – ללא טקסט נוסף, ללא backticks.

מערך עסקאות בפורמט:
[{"date":"YYYY-MM-DD","amount":250.00,"vendor":"שם הספק","description":"תיאור מלא","type":"expense"}]

חוקים:
- amount: חיובי להכנסה, שלילי להוצאה
- type: income | expense | transfer | refund
- vendor: שם נקי ללא מספרים מיותרים
- אל תכלול יתרות חשבון כעסקאות
- חיובי כרטיס אשראי מרוכזים (כגון ויזה, מסטרקארד, ישראכרט, כאל, אמריקן אקספרס, דיינרס, לאומי קארד, מקס) – סמן כ-transfer ולא כ-expense, כי הפירוט מגיע מדף כרטיס האשראי
- מיין לפי תאריך עולה`

    if (isExcel) {
      const csv = await excelToCSV(file)
      parts = [{ text: prompt + '\n\nנתוני הקובץ:\n' + csv }]
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
      generationConfig: { temperature: 0.1 }
    }

    const data = await callGemini(apiKey, body)

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    text = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()
    const parsed = JSON.parse(text)

    // בדוק כפילויות
    const existing = getTransactions()
    const existingHashes = new Set(existing.map(t => t.sourceHash))

    _parsedTx = parsed.map(t => ({
      ...t,
      _hash: hashTx(t, accountId),
      _keep: true,
      _accountId: accountId,
    })).map(t => ({ ...t, _duplicate: existingHashes.has(t._hash), _keep: !existingHashes.has(t._hash) }))

    document.getElementById('importStep2').style.display = 'none'
    showImportReview()
  } catch (err) {
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

  const rows = _parsedTx.map((t, i) => `
    <tr style="opacity:${t._duplicate?'.4':'1'}">
      <td><input type="checkbox" ${t._keep&&!t._duplicate?'checked':''} ${t._duplicate?'disabled':''}
        onchange="_parsedTx[${i}]._keep=this.checked;_updateSaveBtn()" style="width:auto;cursor:pointer"></td>
      <td>${formatDate(t.date)}</td>
      <td style="font-weight:500">${t.vendor}</td>
      <td style="font-weight:700;color:${t.amount>0?'var(--income)':'var(--expense)'}">${t.amount>0?'+':''}${formatCurrency(t.amount)}</td>
      <td><span class="type-badge ${t.type==='income'?'type-income':'type-expense'}">${t._duplicate?'קיים':t.type==='income'?'הכנסה':t.type==='refund'?'החזר':t.type==='transfer'?'העברה':'הוצאה'}</span></td>
    </tr>`).join('')

  document.getElementById('importTable').innerHTML = `
    <thead><tr><th>ייבא</th><th>תאריך</th><th>ספק</th><th>סכום</th><th>סוג</th></tr></thead>
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
  const newTx = toSave.map(t => ({
    id:          genId(),
    accountId:   t._accountId,
    date:        t.date,
    amount:      t.amount,
    vendor:      t.vendor,
    description: t.description || '',
    type:        t.type,
    categoryId:  '',
    notes:       '',
    sourceHash:  t._hash,
    createdAt:   Date.now(),
  }))
  DB.set('finTransactions', [...existing, ...newTx])
  document.getElementById('importStep3').style.display = 'none'
  document.getElementById('importStep4').style.display = 'block'
  document.getElementById('importDoneMsg').textContent = `${newTx.length} עסקאות נשמרו בהצלחה`
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
  if (filename.endsWith('.csv')) return 'text/plain'
  return 'application/octet-stream'
}
