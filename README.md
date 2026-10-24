# Margin

A minimalist notes and to-do app that runs on Windows and Android and keeps both in sync.

- **Notes**: title and body, saved as you type, searchable.
- **Tasks**: add, tick off, edit inline, clear completed. Deletes can be undone.
- **Sync**: sign up with an email and password; sign in with the same email on every device.
- **Offline**: works with no connection. Changes upload when you're back online.
- **Installable**: it's a web app (PWA), so it installs like a normal app on Windows and Android.
- Light and dark mode follow your system.

Without sync set up, the app still works and saves to the device you're using.

## Use it

Live at **https://abhiseksarmah-code.github.io/NotesApp/** (deployed by GitHub Actions on every push to `main`).

**Windows (Edge or Chrome):** open the link, then click the install icon in the address bar, or *Install app* in the app's sidebar. It gets its own window and a Start menu entry.

**Android (Chrome):** open the link, then menu ⋮ → *Add to Home screen* / *Install app*.

Tap the status label in the top corner (it says *Sign in to sync*) to create your account. Then sign in with the same email on your other device.

## Turn on sync (one-time, about 5 minutes)

Sync uses Firebase, Google's free backend. The free Spark plan is far more than one person's notes need.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Create a project** → name it `margin`. Google Analytics is not needed.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
3. **Build → Firestore Database → Create database.** Pick the location closest to you and start in **production mode**.
4. In Firestore, open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**. This makes sure each account can only see its own notes.
5. **Project settings** (gear icon) → **General** → **Your apps** → click the web icon `</>` → register an app called `margin` (no hosting needed). Copy the values from the `firebaseConfig` it shows into [`firebase-config.js`](firebase-config.js), then commit and push.
6. **Authentication → Settings → Authorized domains → Add domain** → `abhiseksarmah-code.github.io`.

After the push deploys, reload the app. The status label changes from *This device* to *Sign in to sync*.

The values in `firebase-config.js` are meant to be public; the Firestore rules are what protect your data.

## How sync works

Each account's items live at `users/{uid}/items/{id}` in Firestore. Writes are debounced while you type and queued locally when offline (Firestore's offline cache), so nothing is lost if the connection drops. Notes you made before signing in are moved into your account on first sign-in.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `styles.css` | Layout and look |
| `app.js` | Notes, tasks, local storage, account sheet |
| `sync.js` | Firebase sign-in and Firestore sync (loaded only when configured) |
| `firebase-config.js` | Your Firebase project details |
| `firestore.rules` | Security rules to paste into Firebase |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and app install |

## Run locally

Any static server works:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

Shortcut: **Ctrl+Alt+N** starts a new note.
