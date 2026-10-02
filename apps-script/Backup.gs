/**
 * Fatty: weekly backup.
 * Run setup() once. It makes a backup now and then every Monday around 3am.
 * The Drive folder keeps two copies: "latest" and "previous".
 */
const FATTY_FOLDER_ID = 'PASTE_FOLDER_ID_HERE';
const FATTY_LATEST = 'Fatty backup (latest)';
const FATTY_PREVIOUS = 'Fatty backup (previous)';

function setup() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'weeklyBackup'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('weeklyBackup')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(3)
    .create();
  weeklyBackup();
}

function weeklyBackup() {
  const folder = DriveApp.getFolderById(FATTY_FOLDER_ID);
  const source = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());

  // Copy first so a failure never leaves the folder without a backup.
  const fresh = source.makeCopy(FATTY_LATEST + ' (new)', folder);

  const previous = folder.getFilesByName(FATTY_PREVIOUS);
  while (previous.hasNext()) previous.next().setTrashed(true);

  const latest = folder.getFilesByName(FATTY_LATEST);
  while (latest.hasNext()) latest.next().setName(FATTY_PREVIOUS);

  fresh.setName(FATTY_LATEST);
}
