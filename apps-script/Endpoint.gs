/**
 * Fatty: share sheet endpoint.
 * Deploy: Deploy > New deployment > Web app.
 *   Execute as: Me. Who has access: Anyone.
 * The iOS Shortcut POSTs JSON: {"link": "...", "score": "4.5", "note": "..."}
 */
const FATTY_TAB = ''; // Tab name. Blank = first tab.
const FATTY_HEADERS = ['Link', 'Score', 'Note', 'Date', 'Name', 'Area', 'Cuisine', 'Price', 'Hours', 'Map link', 'Tags', 'Lat', 'Lng', 'Open'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = FATTY_TAB ? ss.getSheetByName(FATTY_TAB) : ss.getSheets()[0];
    if (sh.getLastRow() === 0) sh.appendRow(FATTY_HEADERS);

    let body = {};
    try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
    const p = Object.assign({}, e.parameter || {}, body);

    const link = String(p.link || p.url || '').trim();
    if (!link) return fattyJson({ ok: false, error: 'Missing link' });
    const score = parseFloat(String(p.score || '').replace(',', '.'));
    const note = String(p.note || '').trim();

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).trim().toLowerCase(); });
    const row = headers.map(function (h) {
      if (h === 'link') return link;
      if (h === 'score') return isNaN(score) ? '' : Math.max(0, Math.min(5, score));
      if (h === 'note') return note;
      if (h === 'date') return new Date();
      return '';
    });
    sh.appendRow(row);
    return fattyJson({ ok: true, row: sh.getLastRow() });
  } finally {
    lock.releaseLock();
  }
}

function fattyJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
