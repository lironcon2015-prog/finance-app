const DRIVE_CLIENT_ID = '702808266000-m1gro990l5uflm9o5jj56ut6n0b760il.apps.googleusercontent.com'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_FILE_NAME = 'finance-app-backup.json'

let _pendingDriveAction = null
let _driveToken = null
let _driveTokenClient = null
let _driveSilentMode = false

function _initDriveClient() {
  if (_driveTokenClient) return
  _driveTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: resp => {
      const wasSilent = _driveSilentMode
      _driveSilentMode = false
      if (resp.error) {
        _renderDriveBootCTA('נדרש חיבור מחדש ל-Google')
        return
      }
      _driveToken = resp.access_token
      localStorage.setItem('driveAutoConnect', '1')
      _renderDriveUI()
      
      // טיפול בפעולות שהמתינו לאישור ההתחברות
      if (_pendingDriveAction === 'backup') {
        _pendingDriveAction = null
        driveBackup()
      } else if (_pendingDriveAction === 'restore') {
        _pendingDriveAction = null
        driveRestore()
      } else {
        _showDriveBoot('☁️ מחובר — שואב גיבוי…', 'info', null)
        _driveAutoRestoreLatest()
      }
    },
  })
}

function driveSignIn() {
  _initDriveClient()
  _driveTokenClient.requestAccessToken()
}

function driveSignOut() {
  if (_driveToken) google.accounts.oauth2.revoke(_driveToken)
  _driveToken = null
  // Disable auto-connect so we don't immediately re-authenticate next load.
  localStorage.removeItem('driveAutoConnect')
  _renderDriveUI()
}

// Called once on app boot; if the user has connected before, silently
// re-authenticates against Google (no popup if their Google session is live)
// and pulls the latest backup. First-time users still need the manual
// "התחבר עם Google" click — Google's consent flow requires a user gesture.
function driveAutoConnectOnBoot() {
  if (localStorage.getItem('driveAutoConnect') !== '1') {
    if (localStorage.getItem('driveBackupFileId') || localStorage.getItem('driveBackupAt')) {
      localStorage.setItem('driveAutoConnect', '1')
    } else {
      return
    }
  }
  _showDriveBoot('☁️ מתחבר ל-Drive…', 'info', null)
  let tries = 0
  const tick = () => {
    if (window.google && google.accounts && google.accounts.oauth2) {
      _initDriveClient()
      _driveSilentMode = true
      try {
        _driveTokenClient.requestAccessToken({ prompt: '' })
        setTimeout(() => {
          if (_driveSilentMode && !_driveToken) {
            _driveSilentMode = false
            _renderDriveBootCTA('זמן ההמתנה לחיבור שקט אזל')
          }
        }, 3500)
      } catch (e) {
        _driveSilentMode = false
        _renderDriveBootCTA(e?.message || '')
      }
    } else if (tries++ < 50) {
      setTimeout(tick, 200)
    } else {
      _showDriveBoot('⚠️ ספריית Google לא נטענה — בדוק חיבור אינטרנט', 'err', 8000)
    }
  }
  tick()
}
// CTA banner shown when no automatic path can complete the connection — the
// user has to tap to grant the popup permission. Stays sticky until they
// click or dismiss; a tap on "התחבר" reuses driveSignIn (interactive request)
// which then runs through the same auto-restore flow on success.
function _renderDriveBootCTA(reason) {
  let el = document.getElementById('driveBanner')
  if (!el) { el = document.createElement('div'); el.id = 'driveBanner'; document.body.appendChild(el) }
  el.className = 'drive-banner drive-banner-err'
  const detail = reason ? ` <span style="opacity:.7;font-size:.8rem">(${reason})</span>` : ''
  el.innerHTML = `<span>🔑 נדרשת התחברות ל-Google כדי לסנכרן גיבוי${detail}</span>` +
    `<button onclick="driveSignIn()">התחבר עכשיו</button>` +
    `<button onclick="this.closest('.drive-banner').remove()" aria-label="סגור" style="background:transparent;border:none;color:inherit;cursor:pointer;font-size:1rem;padding:0 .25rem">✕</button>`
}

function _renderDriveUI() {
  const on = !!_driveToken
  document.getElementById('driveNotSignedIn').style.display = on ? 'none' : ''
  const si = document.getElementById('driveSignedIn')
  si.style.display = on ? 'flex' : 'none'
  if (on) _updateDriveLastInfo()
}

function _updateDriveLastInfo() {
  const el = document.getElementById('driveLastBackupInfo')
  if (!el) return
  const at = localStorage.getItem('driveBackupAt')
  el.textContent = at ? 'גיבוי אחרון: ' + new Date(at).toLocaleString('he-IL') : 'טרם גובה לענן'
}

async function _driveReq(method, url, body, contentType) {
  const headers = { Authorization: 'Bearer ' + _driveToken }
  if (contentType) headers['Content-Type'] = contentType
  const resp = await fetch(url, { method, headers, body })
  if (resp.status === 401) {
    _driveToken = null
    _renderDriveUI()
    throw new Error('פג תוקף החיבור — התחבר מחדש.')
  }
  return resp
}

async function _driveFindFile() {
  const saved = localStorage.getItem('driveBackupFileId')
  if (saved) {
    const r = await _driveReq('GET', `https://www.googleapis.com/drive/v3/files/${saved}?fields=id,modifiedTime`)
    if (r.ok) return r.json()
  }
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`)
  const r = await _driveReq('GET', `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime+desc&pageSize=1`)
  const data = await r.json()
  return data.files?.[0] || null
}

async function driveBackup() {
  if (!_driveToken) { 
    _pendingDriveAction = 'backup'
    driveSignIn()
    return 
  }
  _showDriveStatus('מגבה…', false)
  try {
    const payload = JSON.stringify({
      transactions:        getTransactions(),
      accounts:            getAccounts(),
      categories:          getCategories(),
      budgets:             getBudgets(),
      rules:               getCategoryRules(),
      templates:           getTemplates(),
      aliases:             getVendorAliases(),
      recurringGroups:     DB.get('finManualRecurringGroups', []),
      recurringHidden:     DB.get('finRecurringHidden', []),
      recurringIgnoreOut:  DB.get('finRecurringIgnoreOutliers', []),
      property:                DB.get('finProperty', null),
      propertyPayments:        DB.get('finPropertyPayments', []),
      propertyManualMortgage:  DB.get('finPropertyManualMortgage', []),
      exportedAt:              new Date().toISOString(),
    }, null, 2)

    const existing = await _driveFindFile()
    let fileId

    if (existing) {
      const r = await _driveReq(
        'PATCH',
        `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`,
        payload,
        'application/json'
      )
      if (!r.ok) throw new Error(await r.text())
      fileId = existing.id
    } else {
      const meta = JSON.stringify({ name: DRIVE_FILE_NAME, mimeType: 'application/json' })
      const boundary = 'fb_boundary'
      const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--`
      const r = await _driveReq(
        'POST',
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        body,
        `multipart/related; boundary=${boundary}`
      )
      if (!r.ok) throw new Error(await r.text())
      fileId = (await r.json()).id
    }

    localStorage.setItem('driveBackupFileId', fileId)
    localStorage.setItem('driveBackupAt', new Date().toISOString())
    _updateDriveLastInfo()
    _showDriveStatus('✅ גובה בהצלחה', false)
  } catch (e) {
    _showDriveStatus('שגיאה: ' + e.message, true)
  }
}
async function driveRestore() {
  if (!_driveToken) { 
    _pendingDriveAction = 'restore'
    driveSignIn()
    return 
  }
  if (!confirm('שחזור יחליף את כל הנתונים הנוכחיים. להמשיך?')) return
  _showDriveStatus('משחזר…', false)
  try {
    const file = await _driveFindFile()
    if (!file) throw new Error('לא נמצא קובץ גיבוי בגוגל דרייב.')
    const r = await _driveReq('GET', `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`)
    if (!r.ok) throw new Error(await r.text())
    const data = await r.json()
    if (data.transactions)       DB.set('finTransactions',            data.transactions)
    if (data.accounts)           DB.set('finAccounts',                data.accounts)
    if (data.categories)         DB.set('finCategories',              data.categories)
    if (data.budgets)            DB.set('finBudgets',                 data.budgets)
    if (data.rules)              DB.set('finCategoryRules',           data.rules)
    if (data.templates)          DB.set('finImportTemplates',         data.templates)
    if (data.aliases)            DB.set('finVendorAliases',           data.aliases)
    if (data.recurringGroups)    DB.set('finManualRecurringGroups',   data.recurringGroups)
    if (data.recurringHidden)    DB.set('finRecurringHidden',         data.recurringHidden)
    if (data.recurringIgnoreOut) DB.set('finRecurringIgnoreOutliers', data.recurringIgnoreOut)
    if (data.property)           DB.set('finProperty',                data.property)
    if (data.propertyPayments)   DB.set('finPropertyPayments',        data.propertyPayments)
    if (data.propertyManualMortgage) DB.set('finPropertyManualMortgage', data.propertyManualMortgage)
    localStorage.setItem('driveBackupFileId', file.id)
    localStorage.setItem('driveBackupAt', new Date(file.modifiedTime).toISOString())
    _showDriveStatus('✅ שוחזר — מרענן…', false)
    setTimeout(() => location.reload(), 1500)
  } catch (e) {
    _showDriveStatus('שגיאה: ' + e.message, true)
  }
}

async function _driveCheckNewBackup() {
  try {
    const file = await _driveFindFile()
    if (!file) return
    localStorage.setItem('driveBackupFileId', file.id)
    const localAt = localStorage.getItem('driveBackupAt')
    if (!localAt || new Date(file.modifiedTime) > new Date(localAt)) {
      _showDriveBanner(file.modifiedTime)
    }
  } catch {}
}

// Silent restore on boot — only runs after a successful auto-reconnect, and
// only when the cloud copy is strictly newer than the local one. Reloads
// after writing so every screen renders against the freshly restored data.
async function _driveAutoRestoreLatest() {
  try {
    const file = await _driveFindFile()
    if (!file) {
      _showDriveBoot('☁️ מחובר ל-Drive · אין עדיין גיבוי בענן', 'info', 5000)
      return
    }
    localStorage.setItem('driveBackupFileId', file.id)
    const localAt = localStorage.getItem('driveBackupAt')
    if (localAt && new Date(file.modifiedTime) <= new Date(localAt)) {
      _updateDriveLastInfo()
      const dt = new Date(file.modifiedTime).toLocaleString('he-IL')
      _showDriveBoot(`✅ מחובר ל-Drive · גיבוי עדכני (${dt})`, 'ok', 5000)
      return
    }
    const r = await _driveReq('GET', `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`)
    if (!r.ok) {
      _showDriveBoot('⚠️ שגיאה בקריאת הגיבוי מ-Drive', 'err', 7000)
      return
    }
    const data = await r.json()
    if (data.transactions)       DB.set('finTransactions',            data.transactions)
    if (data.accounts)           DB.set('finAccounts',                data.accounts)
    if (data.categories)         DB.set('finCategories',              data.categories)
    if (data.budgets)            DB.set('finBudgets',                 data.budgets)
    if (data.rules)              DB.set('finCategoryRules',           data.rules)
    if (data.templates)          DB.set('finImportTemplates',         data.templates)
    if (data.aliases)            DB.set('finVendorAliases',           data.aliases)
    if (data.recurringGroups)    DB.set('finManualRecurringGroups',   data.recurringGroups)
    if (data.recurringHidden)    DB.set('finRecurringHidden',         data.recurringHidden)
    if (data.recurringIgnoreOut) DB.set('finRecurringIgnoreOutliers', data.recurringIgnoreOut)
    if (data.property)           DB.set('finProperty',                data.property)
    if (data.propertyPayments)   DB.set('finPropertyPayments',        data.propertyPayments)
    if (data.propertyManualMortgage) DB.set('finPropertyManualMortgage', data.propertyManualMortgage)
    localStorage.setItem('driveBackupAt', new Date(file.modifiedTime).toISOString())
    const dt = new Date(file.modifiedTime).toLocaleString('he-IL')
    _showDriveBoot(`☁️ סונכרן גיבוי חדש מ-Drive (${dt}) — מרענן…`, 'ok', null)
    setTimeout(() => location.reload(), 1800)
  } catch (e) {
    _showDriveBoot('⚠️ שגיאת סנכרון Drive: ' + (e.message || e), 'err', 7000)
  }
}

// Boot-time toast for Drive auto-sync. variant: 'info'|'ok'|'err'.
// autoHideMs=null → sticky (used while we're about to reload).
function _showDriveBoot(msg, variant, autoHideMs) {
  let el = document.getElementById('driveBanner')
  if (!el) { el = document.createElement('div'); el.id = 'driveBanner'; document.body.appendChild(el) }
  el.className = 'drive-banner drive-banner-' + (variant || 'info')
  el.innerHTML = `<span>${msg}</span><button onclick="this.closest('.drive-banner').remove()" aria-label="סגור" style="background:transparent;border:none;color:inherit;cursor:pointer;font-size:1rem;padding:0 .25rem">✕</button>`
  if (autoHideMs) {
    setTimeout(() => { if (el && el.isConnected && el.textContent.includes(msg.slice(0,10))) el.remove() }, autoHideMs)
  }
}

function _showDriveBanner(modifiedTime) {
  let el = document.getElementById('driveBanner')
  if (!el) { el = document.createElement('div'); el.id = 'driveBanner'; document.body.appendChild(el) }
  el.className = 'drive-banner'
  const dt = new Date(modifiedTime).toLocaleString('he-IL')
  el.innerHTML = `☁️ נמצא גיבוי חדש יותר בגוגל דרייב (${dt}) <button onclick="driveRestore()">שחזר</button> <button onclick="this.closest('.drive-banner').remove()">✕</button>`
}

function _showDriveStatus(msg, isErr) {
  const el = document.getElementById('driveStatus')
  if (!el) return
  el.textContent = msg
  el.style.color = isErr ? 'var(--expense)' : '#4ade80'
  if (!isErr) setTimeout(() => { if (el.textContent === msg) el.textContent = '' }, 4000)
}
