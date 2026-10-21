// Break Free — free timer that starts the reminder job on GitHub every 5 minutes.
// Lives in Google Apps Script (script.google.com) under the owner's Google account.
// The GitHub key is NOT written here: it's stored in Project Settings → Script Properties
// as GITHUB_TOKEN, so the code can be shared safely.

const JOB_URL = 'https://api.github.com/repos/orenball/break-free/actions/workflows/daily-push.yml/dispatches';

// Starts the reminder job once. The timer below runs this every 5 minutes.
function startJob() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Add GITHUB_TOKEN in Project Settings → Script Properties.');
  const res = UrlFetchApp.fetch(JOB_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token.trim(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  console.log('GitHub answered ' + code + (code === 204 ? ' — OK, the job started.' : ': ' + res.getContentText()));
  if (code !== 204) throw new Error('GitHub answered ' + code + ' (see the log above).');
}

// Run this ONCE to switch on the 5-minute timer (running it again replaces the old timer).
function createTimer() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'startJob'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('startJob').timeBased().everyMinutes(5).create();
  console.log('Timer is on: startJob will run every 5 minutes.');
}
