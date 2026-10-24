import config from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const LOCAL_KEY = "margin:local";
const PREFS_KEY = "margin:prefs";
const WELCOMED_KEY = "margin:welcomed";

const S = {
  items: new Map(),   // what's on screen (local items, or cloud items when signed in)
  mode: "local",      // "local" | "cloud"
  user: null,
  meta: { fromCache: true, hasPendingWrites: false },
  view: "notes", pane: "list", active: null, q: "",
};
let sync = null, unwatch = null, migrated = false;
const timers = new Map(); // pending debounced writes, by item id

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const notes = () => [...S.items.values()].filter((i) => i.kind === "note").sort((a, b) => b.updated - a.updated);
const tasks = () => [...S.items.values()].filter((i) => i.kind === "task");

/* ---------------- storage ---------------- */
function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); } catch { return []; }
}
function writeLocal() {
  if (S.mode !== "local") return;
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify([...S.items.values()])); } catch {}
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ view: S.view })); } catch {}
}
function loadPrefs() {
  try { Object.assign(S, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}")); } catch {}
}

// Save one item. Cloud writes are debounced per item so typing doesn't write every keystroke.
function save(item, delay = 600) {
  item.sample = false;
  S.items.set(item.id, item);
  if (S.mode === "local") { writeLocal(); return; }
  clearTimeout(timers.get(item.id));
  timers.set(item.id, setTimeout(() => push(item.id), delay));
  setStatus();
}
function push(id) {
  timers.delete(id);
  const it = S.items.get(id);
  if (!it || !S.user) return;
  sync.put(S.user.uid, it).catch(writeError);
  setStatus();
}
function remove(id) {
  clearTimeout(timers.get(id)); timers.delete(id);
  S.items.delete(id);
  if (S.mode === "local") writeLocal();
  else sync.remove(S.user.uid, id).catch(writeError);
}
function flushAll() { for (const id of [...timers.keys()]) { clearTimeout(timers.get(id)); push(id); } }
function writeError(e) {
  toast(e && e.code === "permission-denied"
    ? "Sync was refused. Check the Firestore rules from the README."
    : "Couldn’t sync that change. It will retry when you’re back online.");
}

/* ---------------- status ---------------- */
function setStatus() {
  const el = $("sync");
  let s, t;
  if (S.mode === "local") {
    s = "local"; t = sync ? "Sign in to sync" : "This device";
  } else if (!navigator.onLine) {
    s = "offline"; t = "Offline";
  } else if (timers.size || S.meta.hasPendingWrites) {
    s = "saving"; t = "Saving";
  } else if (S.meta.fromCache) {
    s = "connecting"; t = "Connecting";
  } else {
    s = "live"; t = "Synced";
  }
  el.dataset.s = s; el.textContent = t;
  $("foot-msg").textContent = S.mode === "cloud"
    ? (s === "offline" ? "Offline. Changes upload when you reconnect." : "Synced to your account.")
    : "Saved on this device.";
}
addEventListener("online", setStatus);
addEventListener("offline", setStatus);

/* ---------------- auth + cloud ---------------- */
async function startSync() {
  if (!config || !config.apiKey) return;
  try {
    const mod = await import("./sync.js");
    sync = await mod.createSync(config);
  } catch (e) {
    console.warn("Sync unavailable", e);
    sync = null; setStatus(); return;
  }
  setStatus();
  sync.onAuth((user) => (user ? enterCloud(user) : leaveCloud()));
}

function enterCloud(user) {
  S.user = user; S.mode = "cloud"; migrated = false;
  S.meta = { fromCache: true, hasPendingWrites: false };
  closeSheet();
  if (unwatch) unwatch();
  unwatch = sync.watch(user.uid, onCloud, () => toast("Lost connection to sync. Reload to reconnect."));
  render();
}

function leaveCloud() {
  flushAll();
  if (unwatch) { unwatch(); unwatch = null; }
  S.user = null; S.mode = "local";
  S.items = new Map(readLocal().map((i) => [i.id, i]));
  S.active = null; S.pane = "list";
  render();
}

function onCloud(list, meta) {
  S.meta = meta;
  const next = new Map();
  for (const it of list) next.set(it.id, it);
  // Keep the on-screen version of anything still waiting to upload.
  for (const id of timers.keys()) if (S.items.has(id)) next.set(id, S.items.get(id));
  // And a just-created note that has no text yet (it isn't saved until you type).
  const open = S.active && S.items.get(S.active);
  if (open && !next.has(open.id) && isBlank(open)) next.set(open.id, open);
  S.items = next;

  // First answer from the server: move anything made on this device into the account.
  if (!migrated && !meta.fromCache) {
    migrated = true;
    const local = readLocal();
    const toMove = list.length ? local.filter((i) => !i.sample) : local;
    if (toMove.length) {
      for (const it of toMove) S.items.set(it.id, it);
      sync.putMany(S.user.uid, toMove)
        .then(() => { try { localStorage.removeItem(LOCAL_KEY); } catch {} })
        .catch(writeError);
    } else {
      try { localStorage.removeItem(LOCAL_KEY); } catch {}
    }
  }
  if (S.active && !S.items.has(S.active)) { S.active = null; S.pane = "list"; }
  render(true);
}

/* ---------------- account sheet ---------------- */
let signingUp = false;
function openSheet() {
  const sheet = $("sheet");
  $("auth-form").hidden = !(sync && S.mode === "local");
  $("acct").hidden = S.mode !== "cloud";
  $("nosync").hidden = !!sync;
  if (S.user) $("who").textContent = S.user.email;
  $("auth-err").textContent = "";
  if (!sheet.open) sheet.showModal();
  if (!$("auth-form").hidden) $("email").focus();
}
function closeSheet() { if ($("sheet").open) $("sheet").close(); }
function setAuthMode(up) {
  signingUp = up;
  $("auth-h").textContent = up ? "Create your account" : "Sync your notes";
  $("auth-go").textContent = up ? "Create account" : "Sign in";
  $("auth-toggle").textContent = up ? "Have an account? Sign in" : "New here? Create an account";
  $("pw").autocomplete = up ? "new-password" : "current-password";
  $("auth-reset").hidden = up;
  $("auth-err").textContent = "";
}
const AUTH_MSG = {
  "auth/invalid-email": "That email address doesn’t look right.",
  "auth/missing-password": "Enter a password.",
  "auth/weak-password": "Use at least 6 characters for the password.",
  "auth/email-already-in-use": "There’s already an account with that email. Sign in instead.",
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/user-not-found": "No account with that email. Create one instead.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
  "auth/network-request-failed": "No connection. Check your internet and try again.",
  "auth/operation-not-allowed": "Email sign-in is turned off in Firebase. See the README setup steps.",
};
$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim(), pw = $("pw").value;
  const btn = $("auth-go");
  btn.disabled = true; $("auth-err").textContent = "";
  try {
    await (signingUp ? sync.signUp(email, pw) : sync.signIn(email, pw));
    $("pw").value = "";
  } catch (err) {
    $("auth-err").textContent = AUTH_MSG[err.code] || "Something went wrong. Try again.";
  } finally { btn.disabled = false; }
});
$("auth-toggle").onclick = () => setAuthMode(!signingUp);
$("auth-reset").onclick = async () => {
  const email = $("email").value.trim();
  if (!email) { $("auth-err").textContent = "Enter your email first, then tap Forgot password."; return; }
  try { await sync.reset(email); $("auth-err").textContent = ""; toast("Password reset email sent to " + email); }
  catch (err) { $("auth-err").textContent = AUTH_MSG[err.code] || "Couldn’t send the reset email."; }
};
$("signout").onclick = async () => { flushAll(); closeSheet(); await sync.signOut(); toast("Signed out. Your notes stay in your account."); };
$("sheet-x").onclick = closeSheet;
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });
$("sync").onclick = openSheet;

/* ---------------- helpers ---------------- */
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 45) return "Just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  const d = new Date(t), y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  const o = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
  return d.toLocaleDateString(undefined, o);
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
let toastT, undoFn = null;
function toast(msg, undo) {
  $("tmsg").textContent = msg; undoFn = undo || null; $("tact").hidden = !undo;
  $("toast").classList.add("on"); clearTimeout(toastT);
  toastT = setTimeout(() => { $("toast").classList.remove("on"); undoFn = null; }, undo ? 5000 : 3500);
}
$("tact").onclick = () => { if (undoFn) undoFn(); undoFn = null; $("toast").classList.remove("on"); };

/* ---------------- render ---------------- */
function render(remote) {
  document.body.dataset.view = S.view;
  document.body.dataset.pane = S.pane;
  $("tab-notes").setAttribute("aria-selected", S.view === "notes");
  $("tab-tasks").setAttribute("aria-selected", S.view === "tasks");
  const ns = notes(), ts = tasks();
  $("cn").textContent = ns.length;
  $("ct").textContent = ts.filter((t) => !t.done).length;
  renderList(ns); renderEditor(remote); renderTasks(ts); setStatus();
}

function renderList(ns) {
  const ul = $("list");
  ul.replaceChildren();
  const q = S.q.trim().toLowerCase();
  const shown = q ? ns.filter((n) => ((n.title || "") + " " + (n.body || "")).toLowerCase().includes(q)) : ns;
  if (!shown.length) {
    ul.append(el("li", "empty", q ? "No notes match that search." : "No notes yet. Press + to start one."));
    return;
  }
  for (const n of shown) {
    const li = el("li"), b = el("button");
    b.setAttribute("aria-current", n.id === S.active);
    const title = (n.title || "").trim();
    const firstLine = (n.body || "").split("\n").find((l) => l.trim()) || "";
    b.append(el("span", "t", title || firstLine.slice(0, 60) || "Untitled"));
    if (title) b.append(el("span", "s", firstLine || "No text"));
    b.append(el("span", "d", ago(n.updated)));
    b.onclick = () => openNote(n.id);
    li.append(b); ul.append(li);
  }
}

function renderEditor(remote) {
  const n = S.active && S.items.get(S.active);
  const has = !!n;
  $("blank").hidden = has; $("ttl").hidden = !has; $("body").hidden = !has; $("del").hidden = !has;
  $("meta").textContent = has ? "Edited " + ago(n.updated).toLowerCase() : "";
  if (!has) return;
  const t = $("ttl"), b = $("body");
  if (t.dataset.id !== n.id) {
    t.value = n.title || ""; b.value = n.body || ""; t.dataset.id = n.id;
  } else if (remote) {
    // Pick up edits from another device, but never under the cursor.
    if (document.activeElement !== t && t.value !== (n.title || "")) t.value = n.title || "";
    if (document.activeElement !== b && b.value !== (n.body || "")) b.value = n.body || "";
  }
}

const CHECK = '<svg viewBox="0 0 12 12" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2 5 8.5l4.5-5"/></svg>';
function taskRow(t) {
  const li = el("li", "ti" + (t.done ? " done" : ""));
  const ck = el("button", "ck");
  ck.innerHTML = CHECK;
  ck.setAttribute("aria-label", t.done ? "Mark as not done" : "Mark as done");
  ck.onclick = () => {
    const done = !t.done;
    save({ ...t, done, doneAt: done ? Date.now() : null, updated: Date.now() }, 150);
    render();
  };
  const inp = el("input");
  inp.value = t.text || ""; inp.id = "task-" + t.id; inp.setAttribute("aria-label", "Task");
  inp.onchange = () => {
    const v = inp.value.trim();
    if (!v) { removeWithUndo(t.id); return; }
    if (v !== t.text) save({ ...t, text: v, updated: Date.now() });
  };
  inp.onkeydown = (e) => { if (e.key === "Enter") inp.blur(); };
  const x = el("button", "x", "×");
  x.setAttribute("aria-label", "Delete task");
  x.onclick = () => removeWithUndo(t.id);
  li.append(ck, inp, x);
  return li;
}
function renderTasks(ts) {
  const openT = ts.filter((t) => !t.done).sort((a, b) => b.created - a.created);
  const doneT = ts.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const focused = document.activeElement?.id?.startsWith("task-") ? document.activeElement.id : null;
  $("open").replaceChildren(...openT.map(taskRow));
  $("done").replaceChildren(...doneT.map(taskRow));
  if (focused && $(focused)) $(focused).focus();
  $("dh").hidden = !doneT.length;
  $("dhl").textContent = "Completed · " + doneT.length;
  $("tsub").textContent = !ts.length ? "Nothing here yet. Add your first task below."
    : openT.length ? openT.length + " to do" + (doneT.length ? ", " + doneT.length + " done" : "")
    : "All clear.";
  const sum = $("tsum");
  sum.replaceChildren(el("b", null, String(openT.length)), document.createTextNode(" open · "),
    el("b", null, String(doneT.length)), document.createTextNode(" done"));
}

/* ---------------- actions ---------------- */
function openNote(id) { leaveNote(id); S.active = id; S.pane = "editor"; render(); }
function newNote() {
  const now = Date.now();
  const n = { id: newId(), kind: "note", title: "", body: "", created: now, updated: now };
  S.items.set(n.id, n); // not saved until something is typed
  S.active = n.id; S.pane = "editor"; S.view = "notes"; S.q = ""; $("q").value = "";
  render(); $("ttl").focus();
}
const isBlank = (n) => n && n.kind === "note" && !(n.title || "").trim() && !(n.body || "").trim();
function leaveNote(nextId) {
  const n = S.active && S.items.get(S.active);
  if (n && n.id !== nextId && isBlank(n)) remove(n.id);
}
function removeWithUndo(id) {
  const it = S.items.get(id);
  if (!it) return;
  remove(id);
  if (S.active === id) { S.active = null; S.pane = "list"; }
  render();
  toast(it.kind === "note" ? "Note deleted" : "Task deleted", () => { save({ ...it, updated: Date.now() }, 50); render(); });
}
function editNote() {
  const cur = S.items.get(S.active);
  if (!cur) return;
  const n = { ...cur, title: $("ttl").value, body: $("body").value, updated: Date.now() };
  if (isBlank(n)) S.items.set(n.id, n); else save(n);
  renderList(notes());
  $("meta").textContent = "Edited just now";
}

$("tab-notes").onclick = () => { S.view = "notes"; savePrefs(); render(); };
$("tab-tasks").onclick = () => { leaveNote(); S.view = "tasks"; savePrefs(); render(); };
$("new").onclick = () => { leaveNote(); newNote(); };
$("new2").onclick = newNote;
$("back").onclick = () => { leaveNote(); S.pane = "list"; S.active = null; render(); };
$("del").onclick = () => S.active && removeWithUndo(S.active);
$("q").oninput = (e) => { S.q = e.target.value; renderList(notes()); };
$("ttl").oninput = editNote;
$("body").oninput = editNote;
$("ttl").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("body").focus(); } };
$("addf").onsubmit = (e) => {
  e.preventDefault();
  const v = $("addi").value.trim();
  if (!v) return;
  const now = Date.now();
  save({ id: newId(), kind: "task", text: v, done: false, doneAt: null, created: now, updated: now }, 100);
  $("addi").value = ""; render();
};
$("clear").onclick = () => {
  const done = tasks().filter((t) => t.done);
  if (!done.length) return;
  done.forEach((t) => remove(t.id));
  render();
  toast(done.length + " cleared", () => { done.forEach((t) => save({ ...t, updated: Date.now() }, 50)); render(); });
};
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); leaveNote(); newNote(); }
  if (e.key === "Escape" && S.pane === "editor" && innerWidth <= 760) $("back").click();
});
document.addEventListener("visibilitychange", () => { if (document.hidden) flushAll(); });
addEventListener("pagehide", flushAll);
setInterval(() => {
  renderList(notes());
  const n = S.active && S.items.get(S.active);
  if (n) $("meta").textContent = "Edited " + ago(n.updated).toLowerCase();
}, 60000);

/* ---------------- install (Windows / Android) ---------------- */
let installEvt = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("install").hidden = false; });
addEventListener("appinstalled", () => { $("install").hidden = true; installEvt = null; });
$("install").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("install").hidden = true; };
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ---------------- boot ---------------- */
function welcome() {
  const now = Date.now();
  const items = [
    { id: newId(), kind: "note", sample: true, created: now, updated: now, title: "Welcome to Margin",
      body: "A quiet place for notes and to-dos.\n\nEverything saves as you type. Tap the status in the top corner to sign in with your email, then sign in with the same email on your phone or PC and everything stays in sync.\n\nInstall it from your browser menu (Install app / Add to Home screen) so it opens like a regular app.\n\nDelete this note whenever you like." },
    { id: newId(), kind: "task", sample: true, text: "Add your first real task above", done: false, doneAt: null, created: now - 1, updated: now },
    { id: newId(), kind: "task", sample: true, text: "Tick this one off", done: false, doneAt: null, created: now, updated: now },
  ];
  for (const it of items) S.items.set(it.id, it);
  writeLocal();
  try { localStorage.setItem(WELCOMED_KEY, "1"); } catch {}
}

loadPrefs();
S.items = new Map(readLocal().map((i) => [i.id, i]));
let seen = false;
try { seen = !!localStorage.getItem(WELCOMED_KEY); } catch {}
if (!seen && !S.items.size) welcome();
if (innerWidth > 760 && S.view === "notes") { const first = notes()[0]; if (first) S.active = first.id; }
setAuthMode(false);
render();
if (new URLSearchParams(location.search).get("new") === "note") newNote();
startSync();
