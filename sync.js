// Cloud sync: Firebase email/password accounts + Firestore.
// Loaded only when firebase-config.js has an apiKey, so the app still runs if this fails.
const BASE = "https://www.gstatic.com/firebasejs/10.12.2/";

const clean = (o) => JSON.parse(JSON.stringify(o)); // Firestore rejects undefined values

export async function createSync(config) {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(BASE + "firebase-app.js"),
    import(BASE + "firebase-auth.js"),
    import(BASE + "firebase-firestore.js"),
  ]);
  const { initializeApp } = appMod;
  const {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword,
    createUserWithEmailAndPassword, sendPasswordResetEmail, signOut,
  } = authMod;
  const {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    doc, collection, setDoc, deleteDoc, onSnapshot, writeBatch,
  } = fsMod;

  const app = initializeApp(config);
  const auth = getAuth(app);

  // Offline-first: writes queue locally and upload when the device is back online.
  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    db = initializeFirestore(app, {});
  }

  const itemRef = (uid, id) => doc(db, "users", uid, "items", id);

  return {
    onAuth: (cb) => onAuthStateChanged(auth, cb),
    signIn: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
    signUp: (email, pw) => createUserWithEmailAndPassword(auth, email, pw),
    reset: (email) => sendPasswordResetEmail(auth, email),
    signOut: () => signOut(auth),

    watch(uid, onData, onError) {
      return onSnapshot(
        collection(db, "users", uid, "items"),
        { includeMetadataChanges: true },
        (snap) => onData(snap.docs.map((d) => ({ ...d.data(), id: d.id })), snap.metadata),
        onError,
      );
    },
    put(uid, item) {
      const { id, ...body } = item;
      return setDoc(itemRef(uid, id), clean(body));
    },
    remove(uid, id) {
      return deleteDoc(itemRef(uid, id));
    },
    async putMany(uid, list) {
      for (let i = 0; i < list.length; i += 400) {
        const batch = writeBatch(db);
        for (const { id, ...body } of list.slice(i, i + 400)) batch.set(itemRef(uid, id), clean(body));
        await batch.commit();
      }
    },
  };
}
