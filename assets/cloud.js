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
         collection, doc, onSnapshot, writeBatch, getDocsFromServer, setDoc, deleteDoc } from "./vendor/firebase-firestore.js";

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
// Notificaciones: servicio en Cloudflare (worker/) + clave pública VAPID.
const PUSH_URL = "https://home-push.javattjones.workers.dev";
const VAPID_PUBLIC = "BHd9H9Z9z1g828NBC-9Hm9c182keELq3guJXpzJ1TwuuWCSTkB3hd01vxI9L3Svp0-2sQNHWoncdqA8NTG2TZC8";

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
  const changes = [];
  let n = 0;
  for (const k in next) {
    const s = JSON.stringify(next[k]);
    if (known[k] !== s) {
      if (k.startsWith("movements/")) changes.push({ kind: "mov", op: known[k] ? "edit" : "add", data: next[k] });
      if (k === "config/prices") changes.push({ kind: "price", list: next[k].list });
      batch.set(doc(db, HOME + "/" + k), next[k]); known[k] = s; n++;
    }
  }
  for (const k in known) {
    if (!(k in next)) {
      if (k.startsWith("movements/")) changes.push({ kind: "mov", op: "del", data: JSON.parse(known[k]) });
      batch.delete(doc(db, HOME + "/" + k)); delete known[k]; n++;
    }
  }
  if (!n) return true;
  if (changes.length) notifyOthers(changes);
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

/* ============================================================
   NOTIFICACIONES (Web Push)
   homes/main/push/{uid} = { who, sub } · suscripción de cada móvil
   ============================================================ */
let pushSubs = {};   // uid → { who, sub }
function listenPush(){
  unsubs.push(onSnapshot(collection(db, HOME + "/push"), snap => {
    const m = {}; snap.forEach(d => { m[d.id] = d.data(); }); pushSubs = m;
    App.pushChanged();
  }, err => console.error("push", err)));
}
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function notifyOthers(changes){
  const me = auth.currentUser; if (!me || PUSH_URL.startsWith("__")) return;
  const subs = Object.entries(pushSubs).filter(([uid]) => uid !== me.uid).map(([, v]) => v.sub).filter(Boolean);
  if (!subs.length) return;
  const msg = App.describeChanges(changes); if (!msg) return;
  await sendTo(subs, msg).catch(e => console.warn("notify", e));   // sin conexión: ese aviso se pierde, los datos no
}
async function sendTo(subs, msg){
  const me = auth.currentUser;
  {
    const token = await me.getIdToken();
    const r = await fetch(PUSH_URL + "/notify", { method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ subs }, msg)) });
    const j = await r.json().catch(() => null);
    // Suscripción caducada (el otro desinstaló o revocó): se limpia.
    if (j && j.results) j.results.forEach((res, i) => {
      if (res.gone) { const uid = Object.keys(pushSubs).find(u => pushSubs[u].sub === subs[i]); if (uid) deleteDoc(doc(db, HOME + "/push/" + uid)).catch(() => {}); }
    });
    if (!r.ok) throw new Error("servicio de avisos: " + r.status);
    return j;
  }
}
async function testPush(){
  const mine = pushSubs[auth.currentUser.uid]; if (!mine) throw new Error("Activa primero los avisos.");
  const j = await sendTo([mine.sub], { title: "Home", body: "Aviso de prueba ✓ — los avisos funcionan en este móvil", tag: "home-test" });
  const res = j && j.results && j.results[0];
  if (!res || !(res.status >= 200 && res.status < 300)) throw new Error("El servicio respondió " + (res ? res.status : "?"));
}

async function currentSub(){
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function enablePush(who){
  if (!pushSupported()) throw new Error(isStandalone() ? "Este móvil no admite avisos (hace falta iOS 16.4 o superior)." : "Abre Home desde el icono de la pantalla de inicio para activar los avisos.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Has denegado los avisos. Actívalos en Ajustes del iPhone → Notificaciones → Home.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC });
  await setDoc(doc(db, HOME + "/push/" + auth.currentUser.uid), { who, sub: JSON.parse(JSON.stringify(sub)), updatedAt: new Date().toISOString() });
}
async function disablePush(){
  const sub = await currentSub(); if (sub) await sub.unsubscribe().catch(() => {});
  await deleteDoc(doc(db, HOME + "/push/" + auth.currentUser.uid));
}
// Al abrir: si los avisos están activos, refresca la suscripción (iOS a veces la renueva).
async function refreshPush(){
  try {
    const mine = pushSubs[auth.currentUser.uid]; if (!mine || Notification.permission !== "granted") return;
    const sub = await currentSub(); if (!sub) return;
    const s = JSON.parse(JSON.stringify(sub));
    if (JSON.stringify(s) !== JSON.stringify(mine.sub)) await setDoc(doc(db, HOME + "/push/" + auth.currentUser.uid), { who: mine.who, sub: s, updatedAt: new Date().toISOString() });
  } catch (e) {}
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
  listenPush();
  setTimeout(refreshPush, 4000);
});

window.HomeCloud = {
  save,
  get status(){ return status; },
  get email(){ return auth.currentUser ? auth.currentUser.email : null; },
  async login(email, pass){ await signInWithEmailAndPassword(auth, email, pass); },
  async reset(email){ await sendPasswordResetEmail(auth, email); },
  async logout(){ await signOut(auth); },
  enablePush, disablePush, testPush,
  pushInfo(){
    const me = auth.currentUser;
    return { supported: pushSupported(), standalone: isStandalone(), configured: !PUSH_URL.startsWith("__"),
      mine: me ? pushSubs[me.uid] || null : null,
      others: me ? Object.entries(pushSubs).filter(([u]) => u !== me.uid).map(([, v]) => v.who) : [] };
  },
};
App.cloudReady();
