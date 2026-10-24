/* ============================================================
   HOME · sincronización con Firebase (Auth + Firestore).
   - Cada movimiento es un documento propio: si los dos añadís cosas
     a la vez, se juntan (no se pisan).
   - Caché local de Firestore: funciona sin conexión y sube al volver.
   - Cambios del otro móvil llegan al momento (onSnapshot).
   Estructura:  homes/main/config/{people,settings,categories,prices}
                homes/main/movements/{id}
   ============================================================ */
import { initializeApp } from "./vendor/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
         sendPasswordResetEmail } from "./vendor/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
         collection, doc, onSnapshot, writeBatch, getDocsFromServer } from "./vendor/firebase-firestore.js";

// No es secreto: identifica el proyecto. Lo que protege los datos son las reglas de Firestore.
const firebaseConfig = {
  apiKey: "AIzaSyB8UCZn959JWqmUatsk4vFDdLtgdKS-koc",
  authDomain: "home-app-e7e7e.firebaseapp.com",
  projectId: "home-app-e7e7e",
  storageBucket: "home-app-e7e7e.firebasestorage.app",
  messagingSenderId: "523480911843",
  appId: "1:523480911843:web:0ce07ebf38d4225b765ad6"
};
const HOME = "homes/main";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
let db;
try {
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = initializeFirestore(fbApp, {});   // navegador sin IndexedDB: funciona, pero sin caché offline
}

const App = window.HomeApp;
let known = {};            // lo último que sabemos que hay en la nube: ruta → JSON
let remote = { config: null, movements: null };
let unsubs = [];
let status = "";

function setStatus(s){ status = s; App.setSyncStatus(s); }
const clean = o => JSON.parse(JSON.stringify(o));   // Firestore no admite undefined

/* Estado de la app → documentos */
function toDocs(d){
  const out = {
    "config/people":     { javi: { name: d.people.javi.name }, andrea: { name: d.people.andrea.name } },
    "config/settings":   { targetJavi: d.settings.targetJavi, mortgage: d.settings.mortgage || null },
    "config/categories": { list: d.categories },
    "config/prices":     { list: d.priceHistory },
  };
  d.movements.forEach(m => { out["movements/" + m.id] = m; });
  for (const k in out) out[k] = clean(out[k]);
  return out;
}

/* Documentos → estado de la app */
function fromRemote(){
  const c = remote.config, d = { movements: remote.movements.map(x => x.data) };
  if (c.people)     d.people = c.people;
  if (c.settings)   d.settings = c.settings;
  if (c.categories) d.categories = c.categories.list;
  d.priceHistory = c.prices ? (c.prices.list || []) : [];
  return d;
}

/* Guardar: sube solo lo que ha cambiado (y borra lo eliminado). */
function save(data){
  if (!auth.currentUser) return false;
  // Hasta recibir la nube no subimos nada: evitaría pisar datos del otro con una copia vieja.
  if (!remote.config || !remote.movements) { App.toast("Conectando… inténtalo en un segundo"); return false; }
  const next = toDocs(data);
  const batch = writeBatch(db);
  let n = 0;
  for (const k in next) {
    const s = JSON.stringify(next[k]);
    if (known[k] !== s) { batch.set(doc(db, HOME + "/" + k), next[k]); known[k] = s; n++; }
  }
  for (const k in known) {
    if (!(k in next)) { batch.delete(doc(db, HOME + "/" + k)); delete known[k]; n++; }
  }
  if (!n) return true;
  batch.commit().catch(err => { console.error(err); App.toast("⚠ No se pudo guardar en la nube"); setStatus("⚠ error al subir: " + (err.code || err.message)); });
  return true;
}

function snapStatus(snap){
  if (snap.metadata.hasPendingWrites) setStatus("⏳ cambios pendientes de subir (sin conexión)");
  else if (snap.metadata.fromCache)   setStatus("📴 sin conexión · mostrando lo guardado");
  else                                setStatus("✓ sincronizado");
}

function onRemoteChange(){
  if (!remote.config || !remote.movements) return;   // esperar a tener las dos partes
  const k = {};
  for (const id in remote.configRaw) k["config/" + id] = JSON.stringify(remote.configRaw[id]);
  remote.movements.forEach(m => { k["movements/" + m.id] = JSON.stringify(m.data); });
  known = k;
  App.applyRemote(fromRemote());
}

function listen(){
  unsubs.forEach(u => u()); unsubs = [];
  unsubs.push(onSnapshot(collection(db, HOME + "/config"), { includeMetadataChanges: true }, snap => {
    const c = {}; snap.forEach(d => { c[d.id] = d.data(); });
    remote.config = c; remote.configRaw = c;
    snapStatus(snap); onRemoteChange();
  }, onListenError));
  unsubs.push(onSnapshot(collection(db, HOME + "/movements"), { includeMetadataChanges: true }, snap => {
    remote.movements = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    snapStatus(snap); onRemoteChange();
  }, onListenError));
}
function onListenError(err){
  console.error(err);
  if (err.code === "permission-denied") {
    setStatus("⛔ este correo no tiene acceso a los datos");
    App.toast("Este correo no tiene acceso");
  } else setStatus("⚠ " + (err.code || err.message));
}

/* Primera vez en cada móvil: lo que hubiera guardado aquí (de la versión
   GitHub) se junta con la nube sin duplicar ni pisar nada. */
async function mergeLocalOnce(uid){
  const local = App.legacyData();   // copia de la versión GitHub (si queda alguna en este móvil)
  if (!local) return;
  try {
    const [cfgSnap, movSnap] = await Promise.all([
      getDocsFromServer(collection(db, HOME + "/config")),
      getDocsFromServer(collection(db, HOME + "/movements")),
    ]);
    {
      const batch = writeBatch(db);
      let n = 0;
      const sig = m => [m.type, m.date, m.payer, m.to || "", Number(m.amount).toFixed(2), (m.concept || "").trim().toLowerCase()].join("|");
      const remoteSigs = new Set(movSnap.docs.map(d => sig(d.data())));
      const remoteIds = new Set(movSnap.docs.map(d => d.id));
      (local.movements || []).forEach(m => {
        if (remoteSigs.has(sig(m))) return;                 // ya está en la nube
        const mm = Object.assign({}, m);
        if (remoteIds.has(String(mm.id))) mm.id = App.newId();   // mismo id, otro movimiento
        batch.set(doc(db, HOME + "/movements/" + mm.id), clean(mm)); n++;
      });
      if (cfgSnap.empty && local.people) {                  // nube vacía: subir también la configuración
        const docs = toDocs(Object.assign({ categories: [], priceHistory: [] }, local, { movements: [] }));
        for (const k in docs) { batch.set(doc(db, HOME + "/" + k), docs[k]); n++; }
      }
      if (n) await batch.commit();
      if (n) App.toast("Datos de este móvil subidos a la nube");
    }
    App.legacyDone();               // subida OK: ya no hace falta la copia antigua
  } catch (err) {
    console.error("merge", err);   // sin conexión: se reintenta la próxima vez
  }
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    unsubs.forEach(u => u()); unsubs = []; known = {}; remote = { config: null, movements: null };
    App.showLogin(true);
    return;
  }
  App.showLogin(false);
  App.setAccount(user.email);
  setStatus("↻ conectando…");
  await mergeLocalOnce(user.uid);
  listen();
});

window.HomeCloud = {
  save,
  get status(){ return status; },
  get email(){ return auth.currentUser ? auth.currentUser.email : null; },
  async login(email, pass){ await signInWithEmailAndPassword(auth, email, pass); },
  async reset(email){ await sendPasswordResetEmail(auth, email); },
  async logout(){ await signOut(auth); },
};
App.cloudReady();
