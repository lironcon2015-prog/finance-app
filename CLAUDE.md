# הנחיות לפרויקט finance-app

## Git workflow

- **ברירת המחדל: דחיפה ל-`main`.** לאחר סיום עבודה על branch פיצ'ר, מזגו אותו ל-`main` (fast-forward מועדף) ודחפו את `main` ל-origin. אין צורך לפתוח PR אלא אם התבקש במפורש.
- אם הוגדר branch פיצ'ר ייעודי למשימה, פתחו עליו את הקומיטים — אבל **הדחיפה הסופית חייבת להגיע ל-`main`**.
- קומיטים אטומיים לפי שלב לוגי; הודעות קומיט באנגלית.
- לעולם לא `--no-verify`, `--force` ל-`main`, או שינוי של קומיטים שכבר נדחפו.

## App version / release flow

בכל שינוי משמעותי בקוד ה-UI/לוגיקה:

1. בומפ `APP_VERSION` ב-`app.js:1`.
2. עדכון `version.json` (`version` + `cache`).
3. עדכון `CACHE_VERSION` ב-`sw.js:1`.
4. עדכון `_v` ו-`?v=` בכל תגי ה-`<script>`/`<link>` ב-`index.html`.
5. אם נוסף קובץ JS חדש — להוסיף גם למערך `ASSETS` ב-`sw.js`.

לוגיקת העדכון: ה-SW ב-`sw.js` מחזיר network-first ל-HTML ול-`version.json`. רישום ה-SW ב-`index.html` מאזין ל-`updatefound` ומציג `#updateToast`. כפתור "🔄 בדוק עדכון" בהגדרות קורא ל-`checkForUpdate()` שמשווה ל-`APP_VERSION` ודוחף SKIP_WAITING + reload.

## Architecture notes

- Vanilla JS, scripts קלאסיים (לא modules). משתנים ברמת הקובץ חשופים גלובלית — שימו לב להתנגשויות שמות.
- אחסון: `localStorage` בלבד דרך `DB.get/set` ב-`app.js`.
- `core.js` הוא source-of-truth לחישובי הכנסות/הוצאות/יתרות. אל תספרו `amount` ישירות ב-UI — השתמשו ב-`isCountedIncome`/`isCountedExpense`/`countedExpenseAmount`/`sumIncome`/`sumExpenses`.
- Transfers משפיעים על יתרת שני הצדדים (ראו `getAccountBalance`), אבל לא נספרים כהכנסה/הוצאה ב-P&L.
- Refund עם `amount > 0` מקטין הוצאות, לא נספר כהכנסה.
- UI בעברית RTL, מטבע ILS, Chart.js לגרפים, Gemini 2.5 ל-parsing של דוחות.

## Testing

אין test suite אוטומטי. בדיקה ידנית:

```bash
cd /home/user/finance-app
python3 -m http.server 8000
```

פתח `http://localhost:8000`, DevTools → Application → LocalStorage לניטור מיגרציות (`migration_*`).
