// ===== AI BUDGET GENERATOR (v1.11) =====
// Proposes a monthly budget per category (expense + expected income) from the
// last 3 *complete* calendar months. All math runs locally so the user can
// audit every number; the Gemini advisor (optional) only produces narrative
// commentary, never changes numbers.
//
// Outlier rule (user spec): if one month is >25% above the mean of the
// *other* months, treat it as a one-off and exclude it from the baseline.
// Applied symmetrically for expenses and income (an unusually low or
// unusually high month are both handled — ratio uses abs values).
//
// Recurring overlay: non-monthly recurring items (bi-monthly, quarterly,
// annual, dividends) are surfaced per-category with whether they're
// expected to hit the current month, so the user can adjust the suggested
// number when a line like ארנונה is due.

let _budgetGenProposals = null
let _budgetGenAdvice = ''

function _bgMean(arr) {
  if (arr.length === 0) return 0
  return arr.reduce((s,v)=>s+v,0) / arr.length
}

function _bgMedian(arr) {
  if (arr.length === 0) return 0
  const s = arr.slice().sort((a,b)=>a-b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid-1] + s[mid]) / 2 : s[mid]
}

// For each value v_i, compare to mean-of-others. If ratio >1.25 → outlier.
// Returns trimmed mean (kept values only) and the set of outlier indices.
function _bgTrimmedMean25(values) {
  if (values.length <= 1) return { trimmed: values[0] || 0, outliers: [], wasTrimmed: false }
  const outliers = []
  for (let i = 0; i < values.length; i++) {
    const others = values.filter((_, j) => j !== i)
    const othersMean = _bgMean(others)
    if (Math.abs(othersMean) < 0.01) continue
    const ratio = Math.abs(values[i]) / Math.abs(othersMean)
    if (ratio > 1.25) outliers.push(i)
  }
  const kept = values.filter((_, i) => !outliers.includes(i))
  const trimmed = kept.length > 0 ? _bgMean(kept) : _bgMean(values)
  return { trimmed, outliers, wasTrimmed: outliers.length > 0 }
}

// Last N *complete* calendar months ending with the month just before today.
// For Apr 19 2026 with n=3 → ['2026-01', '2026-02', '2026-03'].
function _bgLastCompleteMonths(n) {
  const now = new Date()
  const out = []
  for (let i = n; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)
  }
  return out
}

function _bgCurrentMonthKey() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`
}

// Amount contributed by a tx to a category's baseline, by category type.
// Expense categories use countedExpenseAmount (P&L magnitude).
// Income categories use the raw positive amount when counted income.
function _bgCategoryAmount(t, type) {
  if (type === 'income') return isCountedIncome(t) ? t.amount : 0
  return countedExpenseAmount(t)
}

// A recurring item counts as "hitting this month" if nextExpected lands
// within the current month. Monthly cadence always hits.
function _bgIsExpectedThisMonth(r) {
  if (r.cadence === 'monthly') return true
  const cm = _bgCurrentMonthKey()
  return !!(r.nextExpected && r.nextExpected.startsWith(cm))
}

function generateBudgetProposals() {
  const months = _bgLastCompleteMonths(3)
  const cats = getCategories()
  const recurring = getRecurring() || []
  const txs = getTransactions()
  const now = new Date()

  const startISO = `${months[0]}-01`
  // end of the *previous* month
  const endDate = new Date(now.getFullYear(), now.getMonth(), 0)
  const endISO = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`

  const periodTx = txs.filter(t => t.date && t.date >= startISO && t.date <= endISO)

  const proposals = []
  for (const cat of cats) {
    const type = cat.type
    if (type !== 'expense' && type !== 'income') continue
    const catTxs = periodTx.filter(t => t.categoryId === cat.id)
    const perMonth = months.map(m =>
      catTxs
        .filter(t => t.date.startsWith(m))
        .reduce((s, t) => s + _bgCategoryAmount(t, type), 0)
    )
    const { trimmed, outliers, wasTrimmed } = _bgTrimmedMean25(perMonth)
    const median = _bgMedian(perMonth)
    const mean = _bgMean(perMonth)
    // Round suggestion to nearest 10 (Shekel)
    const suggested = Math.max(0, Math.round(trimmed / 10) * 10)

    // Non-monthly recurring in this category
    const recForCat = recurring.filter(r => r.categoryId === cat.id)
    const nonMonthlyRec = recForCat.filter(r => r.cadence !== 'monthly')
    const notes = nonMonthlyRec.map(r => ({
      vendor: r.vendor,
      cadence: r.cadenceLabel,
      cadenceKey: r.cadence,
      avgAmount: r.avgAmount,
      expectedThisMonth: _bgIsExpectedThisMonth(r),
    }))

    // Skip truly-empty categories (no activity and no non-monthly expected flow)
    const totalAbs = perMonth.reduce((s,v)=>s+Math.abs(v),0)
    if (totalAbs === 0 && notes.length === 0) continue

    proposals.push({
      categoryId: cat.id,
      category: cat,
      type,
      perMonth,
      months,
      mean,
      median,
      trimmedMean: trimmed,
      suggested,
      outliers,
      wasTrimmed,
      recurringNotes: notes,
      include: suggested > 0,
    })
  }

  // Sort: expenses first by magnitude, then income by magnitude
  proposals.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'expense' ? -1 : 1
    return Math.abs(b.suggested) - Math.abs(a.suggested)
  })

  _budgetGenProposals = proposals
  return proposals
}

// ===== UI =====

function openBudgetGenModal() {
  _budgetGenAdvice = ''
  generateBudgetProposals()
  _renderBudgetGenModal()
  document.getElementById('budgetGenModal').classList.add('open')
}

function closeBudgetGenModal() {
  document.getElementById('budgetGenModal').classList.remove('open')
}

function _renderBudgetGenModal() {
  const body = document.getElementById('budgetGenBody')
  if (!body) return
  const props = _budgetGenProposals || []
  if (props.length === 0) {
    body.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center">אין מספיק נתונים ב-3 החודשים האחרונים להצעת תקציב.</p>'
    return
  }
  const expProps = props.filter(p => p.type === 'expense')
  const incProps = props.filter(p => p.type === 'income')

  const renderRow = (p) => {
    const idx = props.indexOf(p)
    const monthsCols = p.perMonth.map((v, i) => {
      const isOut = p.outliers.includes(i)
      const title = p.months[i] + (isOut ? ' (חריג — הוחרג)' : '')
      return `<span class="bgen-mo ${isOut?'bgen-mo-out':''}" title="${title}">${formatCurrency(v)}</span>`
    }).join('')
    const notesHTML = p.recurringNotes.length === 0 ? '' :
      '<div class="bgen-notes">' +
      p.recurringNotes.map(n => `
        <span class="bgen-note ${n.expectedThisMonth?'bgen-note-hot':''}" title="ממוצע ${formatCurrency(n.avgAmount)}">
          ${n.vendor} · ${n.cadence}${n.expectedThisMonth?' · צפוי החודש':''}
        </span>`).join('') + '</div>'
    const outBadge = p.wasTrimmed ? '<span class="bgen-badge">חריג הוחרג</span>' : ''
    return `
      <tr>
        <td><input type="checkbox" onchange="_toggleBudgetProposal(${idx})" ${p.include?'checked':''}></td>
        <td><span class="budget-cat-name">${p.category.icon||''} ${p.category.name}</span>${notesHTML}</td>
        <td class="bgen-months">${monthsCols}</td>
        <td class="bgen-stats">
          <div>חציון: ${formatCurrency(p.median)}</div>
          <div>ממוצע: ${formatCurrency(p.mean)}</div>
          ${outBadge}
        </td>
        <td>
          <div class="budget-input-wrap">
            <span class="budget-currency">₪</span>
            <input type="number" min="0" step="10" value="${p.suggested}" class="budget-input" onchange="_updateBudgetProposal(${idx}, this.value)">
          </div>
        </td>
      </tr>`
  }

  const table = (rows, title, sectionKey) => rows.length === 0 ? '' : `
    <h4 style="margin:1.25rem 0 .5rem">${title}</h4>
    <div style="overflow-x:auto">
      <table class="data-table bgen-table">
        <thead>
          <tr>
            <th style="width:2.2rem"><input type="checkbox" onchange="_toggleAllBudgetProposals('${sectionKey}', this.checked)" ${rows.every(r => r.include)?'checked':''}></th>
            <th>קטגוריה</th>
            <th>3 חודשים אחרונים</th>
            <th>סטטיסטיקה</th>
            <th>תקציב מוצע</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(renderRow).join('')}
        </tbody>
      </table>
    </div>`

  const advice = _budgetGenAdvice ? `
    <div class="bgen-advice">
      <strong>💡 המלצת AI</strong>
      <div style="white-space:pre-wrap;margin-top:.5rem">${_budgetGenAdvice}</div>
    </div>` : ''

  body.innerHTML = `
    <div style="color:var(--text-muted);font-size:.85rem;margin-bottom:.75rem">
      התבסס על 3 חודשים אחרונים (מלאים). ערכים חריגים — מעל 25% מעל ממוצע החודשים האחרים — הוחרגו מהבסיס.
      הערות של הוצאות דו-חודשיות/רבעוניות מוצגות לצד הקטגוריה.
    </div>
    ${advice}
    ${table(expProps, 'הוצאות', 'expense')}
    ${table(incProps, 'הכנסות צפויות', 'income')}
  `
}

function _toggleBudgetProposal(idx) {
  if (!_budgetGenProposals) return
  const p = _budgetGenProposals[idx]
  p.include = !p.include
}

function _toggleAllBudgetProposals(sectionKey, checked) {
  if (!_budgetGenProposals) return
  _budgetGenProposals.forEach(p => { if (p.type === sectionKey) p.include = checked })
  _renderBudgetGenModal()
}

function _updateBudgetProposal(idx, value) {
  if (!_budgetGenProposals) return
  const v = parseFloat(value)
  _budgetGenProposals[idx].suggested = (!isFinite(v) || v < 0) ? 0 : v
}

function applyBudgetProposals() {
  if (!_budgetGenProposals) return
  let applied = 0
  for (const p of _budgetGenProposals) {
    if (!p.include) continue
    if (!p.suggested || p.suggested <= 0) { deleteBudget(p.categoryId); continue }
    setBudget(p.categoryId, p.suggested, false, p.type)
    applied++
  }
  closeBudgetGenModal()
  renderBudgetSettings()
  alert(`${applied} תקציבים הוחלו.`)
}

async function adviseBudgetWithGemini() {
  const apiKey = (typeof getApiKey === 'function') ? getApiKey() : localStorage.getItem('geminiApiKey')
  if (!apiKey) { alert('חסר מפתח Gemini API – הזן בהגדרות'); return }
  if (!_budgetGenProposals || _budgetGenProposals.length === 0) return
  const btn = document.getElementById('bgenAdviceBtn')
  if (btn) { btn.disabled = true; btn.textContent = 'טוען…' }
  try {
    const snapshot = _budgetGenProposals.map(p => ({
      category: p.category.name,
      type: p.type,
      months: p.months,
      perMonth: p.perMonth.map(v => Math.round(v)),
      mean: Math.round(p.mean),
      median: Math.round(p.median),
      trimmed: Math.round(p.trimmedMean),
      suggested: p.suggested,
      outliersRemoved: p.wasTrimmed,
      recurringNotes: p.recurringNotes.map(n => `${n.vendor}:${n.cadence}${n.expectedThisMonth?'(צפוי החודש)':''}`),
    }))
    const prompt = `אתה יועץ פיננסי אישי דובר עברית. לפניך הצעות לתקציב חודשי לפי קטגוריה, שחושבו מקומית על סמך 3 חודשים אחרונים, עם החרגת ערכים חריגים (יותר מ-25% מעל ממוצע האחרים).
ענה בעברית, קצר ותמציתי (עד 10 שורות): האם ההצעות נראות סבירות? אילו קטגוריות מומלץ לבחון שוב (למשל כי יש הוצאה דו-חודשית צפויה החודש, או חריגות שחוזרות)? אל תמציא מספרים — התייחס רק לנתון שלפניך.

נתונים:
${JSON.stringify(snapshot)}`
    const data = await callGemini(apiKey, { contents:[{ parts:[{ text: prompt }] }], generationConfig:{ temperature: 0.3 } })
    const parts = data.candidates?.[0]?.content?.parts || []
    let text = ''
    for (const p of parts) { if (!p.thought && p.text) { text = p.text; break } }
    if (!text) text = parts[0]?.text || 'לא התקבלה תשובה'
    _budgetGenAdvice = text
  } catch (e) {
    _budgetGenAdvice = 'שגיאה: ' + (e.message || e)
  }
  if (btn) { btn.disabled = false; btn.textContent = '💡 ייעוץ AI' }
  _renderBudgetGenModal()
}
