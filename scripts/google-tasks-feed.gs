// Google Apps Script that publishes your open Google Tasks (the ones with a due date) as JSON, for the
// dashboard's Events panel (see app/personalTasks.ts), and marks a task complete when the dashboard's "Done"
// button is pressed. It runs inside your own Google account, so there is no OAuth token to expire: authorize it
// once and the web-app link keeps working.
//
// Setup (one time):
//   1. script.google.com -> New project. Replace the contents of Code.gs with this file.
//   2. Left sidebar: Services (+) -> Google Tasks API -> Add (keep the identifier "Tasks").
//   3. Deploy -> New deployment -> type "Web app". Execute as: Me. Who has access: Anyone. Deploy, then Authorize.
//   4. Copy the web app URL (ends in /exec) into .env.local as PERSONAL_TASKS_URL=<url>.
//   5. Marking tasks done needs the full Tasks scope, which Google's granular consent won't grant on its own:
//      Project Settings -> show "appsscript.json", add "oauthScopes": ["https://www.googleapis.com/auth/tasks"],
//      then run checkPermission() below from the editor and use "Click here to provide permissions".
//      The log should then say "invalid argument" (the fake ids), not "permission". Redeploy a new version.
// After editing the script: Deploy -> Manage deployments -> Edit (pencil) -> Version: New version -> Deploy,
// which keeps the same URL.
// Treat that URL like the private calendar ICS link: anyone who has it can read your task titles and due dates,
// and mark tasks complete.

function doGet() {
  const tasks = [];
  let listPage;
  do {
    listPage = Tasks.Tasklists.list({ maxResults: 100, pageToken: listPage && listPage.nextPageToken });
    for (const list of listPage.items || []) {
      let taskPage;
      do {
        taskPage = Tasks.Tasks.list(list.id, {
          showCompleted: false,
          showHidden: false,
          maxResults: 100,
          pageToken: taskPage && taskPage.nextPageToken,
        });
        for (const task of taskPage.items || []) {
          if (!task.due || task.status === 'completed') continue;
          tasks.push({
            id: task.id,
            listId: list.id,
            title: task.title || '',
            due: task.due,
            list: list.title || '',
            webViewLink: task.webViewLink || '',
          });
        }
      } while (taskPage.nextPageToken);
    }
  } while (listPage.nextPageToken);
  return json({ tasks });
}

// Body: {"action":"complete","listId":"...","id":"..."}. Completing (not deleting) keeps it undoable in Google Tasks.
function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json({ ok: false, error: 'Invalid JSON.' }); }
  if (body.action !== 'complete' || typeof body.listId !== 'string' || typeof body.id !== 'string') {
    return json({ ok: false, error: 'Expected action "complete" with listId and id.' });
  }
  try {
    Tasks.Tasks.patch({ status: 'completed' }, body.listId, body.id);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  }
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

// Run from the editor to request any missing permission; the fake ids mean it never changes a real task.
function checkPermission() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  try { Tasks.Tasks.patch({ status: 'completed' }, 'bogus', 'bogus'); }
  catch (e) { Logger.log(e.message); }
}
