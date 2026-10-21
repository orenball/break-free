# Break Free

An installable web app that helps someone quit a bad habit. It has:
- a clean-time timer and daily check-in
- milestones
- articles
- anonymous community stats
- share links
- a real daily notification

It works in English and Hebrew.

## What's in this folder
| File | What it does |
|---|---|
| `index.html` | The whole app: setup questions plus the Home, Why, Learn, Community and Profile pages |
| `i18n.js` | All the app's text in English and Hebrew, including the daily quotes |
| `articles.js` | The Learn page's reading list: links to real articles (English for everyone, plus Hebrew for Hebrew users) |
| `firebase-config.js` | The Firebase settings you paste in (public, not secret) |
| `firebase-messaging-sw.js` | Receives the daily notification when the app is closed |
| `manifest.webmanifest`, `icons/` | Make the app installable ("Add to Home Screen") |
| `firestore.rules` | Who may read or write which data |
| `scripts/`, `.github/workflows/` | The job that sends the daily reminders and calculates the community stats |
| `scripts/apps-script-timer.gs` | A copy of the free Google Apps Script timer that starts the job every 5 minutes |

## Privacy
- **Stays only on the phone:**
  - name, age and "about me"
  - the why sentence
  - your answers
  - your history
- **Sent to the server**, under a random anonymous ID and never with a name:
  - habit type
  - streak numbers
  - check-in count
  - language
  - reminder time and time zone
  - the notification token
- **Share links** show the first name, the habit, the timer, the best streak and milestones. Age and "about me" are never shared.
- **The Community page** shows only totals.

## Setup, step by step (once)

### 1. Firebase (about 10 minutes, free, no credit card)
1. Go to https://console.firebase.google.com and click **Create a project**. Name it `break-free`. You can turn Google Analytics off.
2. Turn on anonymous sign-in: **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save**.
3. Create the database: **Build → Firestore Database → Create database**. Choose a location near you (e.g. `eur3`) and **Start in production mode**.
4. In Firestore, open the **Rules** tab. Replace everything with the contents of `firestore.rules` and click **Publish**.
5. Get the web settings: **Project settings (⚙️) → General → Your apps → Web (`</>`)**. Register an app called `Break Free` (no hosting needed). Copy the `firebaseConfig` values into `firebase-config.js`.
6. Get the push key: **Project settings → Cloud Messaging → Web Push certificates → Generate key pair**. Copy the key into `self.BF_VAPID_KEY` in `firebase-config.js`.
7. Get the private key for the daily job: **Project settings → Service accounts → Generate new private key**. A `.json` file downloads.
   **This file is secret.** Don't put it in this folder and don't share it. You'll paste it into GitHub in step 3.

### 2. Put the app online (GitHub Pages)
Claude creates the `break-free` repository and pushes the files after you approve. Then, on github.com:
1. Open the repository and go to **Settings → Pages**.
2. Under Source choose **Deploy from a branch**, then branch `main`, folder `/ (root)`, and click **Save**.
3. The app's address will be `https://orenball.github.io/break-free/`.

### 3. Turn on the daily notifications
In the repository on github.com, go to **Settings → Secrets and variables → Actions**:
1. On the **Secrets** tab, click **New repository secret**. Name it `FIREBASE_SERVICE_ACCOUNT` and paste the whole content of the `.json` file from step 1.7.
2. On the **Variables** tab, click **New repository variable**. Name it `APP_URL` and set it to `https://orenball.github.io/break-free/`.
3. Go to **Actions → Daily push → Run workflow** once to test it.

### 3b. A reliable timer (free, Google Apps Script)
GitHub's own timer often runs hours late, so a small script in your Google account starts the job every 5 minutes.
1. Create a GitHub key at https://github.com/settings/personal-access-tokens/new: only the **break-free** repository, **Actions: Read and write**. Note its expiry date — reminders stop when it expires, until you make a new one.
2. At https://script.google.com create a project, paste `scripts/apps-script-timer.gs`, and save.
3. **Project Settings → Script Properties:** add `GITHUB_TOKEN` with the key as its value, then **Save script properties**.
4. Run **startJob** once (allow access when asked; the log should say *GitHub answered 204*), then run **createTimer** once.

**Testing one phone:** in GitHub, **Actions → Daily push → Run workflow**, fill in the device code shown at the bottom of the app's Profile page. That sends one test notification to that phone.

### 4. Install it on a phone
- **iPhone (iOS 16.4 or newer):**
  1. Open the address in **Safari**.
  2. Tap **Share ⬆️ → Add to Home Screen**.
  3. Open Break Free from the Home Screen, then go to **Profile → Turn on daily reminders**.
- **Android:**
  1. Open the address in **Chrome**.
  2. Tap **Install app** (or menu ⋮ → Add to Home screen).
  3. Go to **Profile → Turn on daily reminders**.

## Trying it on this computer
In Claude Code, start the `break-free` preview, which opens http://localhost:8800. Without Firebase settings, the app runs in offline mode: everything works except notifications, share links and community stats.
