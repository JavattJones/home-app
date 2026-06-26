/* Home — gestión de pagos y aportaciones a la casa (cooperativa).
   Lleva quién aporta cuánto y quién debe a quién para cuadrar el reparto pactado.
   Datos: JSON en repo privado de GitHub (Contents API) + caché localStorage. */

"use strict";

// ---------- estado ----------
const LS_DATA = "home:data";
const LS_GH = "home:gh";
const LS_SHA = "home:sha";
const LS_DIRTY = "home:dirty";
const DATA_PATH = "home.json";

let data = loadLocal();
let gh = loadGh();
let remoteSha = localStorage.getItem(LS_SHA) || null;
let charts = {};
let chartMode = localStorage.getItem("home:chartmode") || "mensual";
let editandoId = null;        // id del movimiento en edición (vista Añadir)
let filtroPersona = "";
let filtroCategoria = "";

const PALETTE = ["#ffb000", "#25e0ff", "#3df98b", "#ff7a1a", "#7aa2ff", "#ff66b3", "#ffe14d", "#b3ff66"];
const CAT_DEFAULT = ["Entrada", "Cuota cooperativa", "Derrama", "Notaría / Gestoría", "Mobiliario", "Otros"];

function emptyData() {
  return {
    version: 1,
    updatedAt: null,
    personas: [
      { id: "javi", nombre: "Javi" },
      { id: "andrea", nombre: "Andrea" },
    ],
    config: { reparto: { javi: 50, andrea: 50 }, categorias: CAT_DEFAULT.slice() },
    movimientos: [],
  };
}
function loadLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_DATA) || "null");
    if (d && d.personas && d.movimientos) return normaliza(d);
  } catch (e) { /* caché corrupta: se parte de cero */ }
  return emptyData();
}
function normaliza(d) {
  d.config = d.config || {};
  d.config.reparto = d.config.reparto || {};
  d.config.categorias = d.config.categorias && d.config.categorias.length ? d.config.categorias : CAT_DEFAULT.slice();
  d.movimientos = d.movimientos || [];
  return d;
}
function persistLocal() {
  data.updatedAt = new Date().toISOString();
  localStorage.setItem(LS_DATA, JSON.stringify(data));
}

// ---------- utilidades ----------
const fmtEur = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtEur0 = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const fmtFecha = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const mesLargo = (ym) => {
  const [y, m] = ym.split("-");
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return meses[parseInt(m, 10) - 1] + " " + y;
};
const hoyISO = () => new Date().toISOString().slice(0, 10);
const uid = () => "m" + Math.random().toString(36).slice(2, 9);

function b64encodeUtf8(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function b64decodeUtf8(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
}
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : s;
  return d.innerHTML;
}
function iniciales(nombre) {
  const t = (nombre || "").trim();
  return t ? t.slice(0, 2).toUpperCase() : "··";
}
function nombrePersona(id) {
  const p = data.personas.find((x) => x.id === id);
  return p ? p.nombre : "—";
}
const MONO = 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace';

function chartOpts(fmt) {
  const tick = { color: "#9a8d5e", font: { family: MONO, size: 10, weight: 700 } };
  return {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(7,7,3,0.96)",
        borderColor: "rgba(255,176,0,0.35)",
        borderWidth: 1, padding: 10, cornerRadius: 4, displayColors: false,
        titleColor: "#ffb000", bodyColor: "#e9ddb9", footerColor: "#ffb000",
        titleFont: { family: MONO, size: 11 },
        bodyFont: { family: MONO, size: 11 },
        footerFont: { family: MONO, size: 11, weight: 700 },
        callbacks: { label: (ctx) => fmt(ctx.parsed.y) },
      },
    },
    scales: {
      x: { ticks: tick, grid: { display: false }, border: { color: "rgba(255,176,0,0.18)" } },
      y: {
        ticks: { ...tick, callback: (v) => fmtEur0(v), maxTicksLimit: 6 },
        grid: { color: "rgba(255,176,0,0.07)" },
        border: { display: false },
        beginAtZero: true,
      },
    },
  };
}
function drawChart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), cfg);
}

// ---------- cálculos ----------
function aportaciones() {
  return data.movimientos.filter((m) => m.tipo !== "liquidacion");
}
function liquidaciones() {
  return data.movimientos.filter((m) => m.tipo === "liquidacion");
}
function totalAportado() {
  return aportaciones().reduce((a, m) => a + Number(m.importe || 0), 0);
}
function aportadoPor(pid) {
  return aportaciones().filter((m) => m.pagador === pid).reduce((a, m) => a + Number(m.importe || 0), 0);
}
// balance > 0 → esa persona ha puesto de más; el resto le debe esa cantidad.
function balancePersona(pid) {
  const total = totalAportado();
  const pct = Number(data.config.reparto?.[pid] ?? 0) / 100;
  const cuota = total * pct;
  const pagadoLiq = liquidaciones().filter((m) => m.pagador === pid).reduce((a, m) => a + Number(m.importe || 0), 0);
  const recibidoLiq = liquidaciones().filter((m) => m.receptor === pid).reduce((a, m) => a + Number(m.importe || 0), 0);
  return aportadoPor(pid) - cuota + pagadoLiq - recibidoLiq;
}
function mesesConDatos() {
  const set = new Set(aportaciones().map((m) => (m.fecha || "").slice(0, 7)).filter(Boolean));
  return [...set].sort();
}

// ---------- sincronización GitHub (idéntico a Patrimonio) ----------
function loadGh() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_GH) || "null");
    if (!raw) return null;
    if (raw.enc) return { owner: raw.owner, repo: raw.repo, enc: raw.enc, token: null, locked: true };
    return raw; // legacy: token en claro
  } catch (e) { return null; }
}

async function ensureToken() {
  if (!gh) return false;
  if (gh.token) return true;
  if (gh.enc && window.SecureToken) {
    const pass = await SecureToken.askPassphrase();
    if (pass === null) return false;
    try {
      gh.token = await SecureToken.decrypt(gh.enc, pass);
      gh.locked = false;
      return true;
    } catch (e) {
      alert("Contraseña incorrecta. Vuelve a intentarlo.");
      return false;
    }
  }
  return false;
}

function setSyncStatus(txt, cls) {
  const el = document.getElementById("sync-status");
  el.textContent = txt;
  el.className = "sync-status " + (cls || "");
}
function ghHeaders() {
  return {
    Authorization: "Bearer " + gh.token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
function ghUrl() {
  return `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/${DATA_PATH}`;
}

async function pullRemote() {
  if (!gh) return "sin-config";
  const res = await fetch(ghUrl(), { headers: ghHeaders() });
  if (res.status === 404) return "no-file";
  if (!res.ok) throw new Error("GitHub " + res.status);
  const json = await res.json();
  remoteSha = json.sha;
  localStorage.setItem(LS_SHA, remoteSha);
  const remote = normaliza(JSON.parse(b64decodeUtf8(json.content)));
  const localDirty = localStorage.getItem(LS_DIRTY) === "1";
  const remoteNewer = !data.updatedAt || (remote.updatedAt && remote.updatedAt > data.updatedAt);
  if (remoteNewer && !localDirty) {
    data = remote;
    localStorage.setItem(LS_DATA, JSON.stringify(data));
    return "actualizado";
  }
  if (localDirty) return "pendiente-push";
  return "al-dia";
}

async function pushRemote() {
  if (!gh) return;
  const body = {
    message: "home: actualización " + hoyISO(),
    content: b64encodeUtf8(JSON.stringify(data, null, 2)),
  };
  if (remoteSha) body.sha = remoteSha;
  const res = await fetch(ghUrl(), { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (res.status === 409 || res.status === 422) {
    // sha desactualizado (p. ej. otro colaborador guardó antes): re-lee y reintenta una vez
    const cur = await fetch(ghUrl(), { headers: ghHeaders() });
    if (cur.ok) {
      remoteSha = (await cur.json()).sha;
      body.sha = remoteSha;
      const retry = await fetch(ghUrl(), { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
      if (!retry.ok) throw new Error("GitHub " + retry.status);
      remoteSha = (await retry.json()).content.sha;
    } else throw new Error("GitHub " + cur.status);
  } else if (!res.ok) {
    throw new Error("GitHub " + res.status);
  } else {
    remoteSha = (await res.json()).content.sha;
  }
  localStorage.setItem(LS_SHA, remoteSha);
  localStorage.setItem(LS_DIRTY, "0");
}

async function syncFull(interactive) {
  if (!gh) { setSyncStatus("sin configurar", ""); return; }
  if (!gh.token) {
    if (!interactive || !(await ensureToken())) { setSyncStatus("🔒 bloqueado", ""); return; }
  }
  setSyncStatus("↻ sincronizando…", "");
  try {
    const estado = await pullRemote();
    if (estado === "pendiente-push" || estado === "no-file") await pushRemote();
    setSyncStatus("✓ sincronizado", "ok");
    renderAll();
  } catch (e) {
    setSyncStatus("⚠ sin conexión", "err");
    if (interactive) alert("No se pudo sincronizar: " + e.message + "\nLos datos quedan guardados en este dispositivo.");
  }
}

async function saveAndSync(msgEl) {
  persistLocal();
  localStorage.setItem(LS_DIRTY, "1");
  renderAll();
  if (!gh) {
    if (msgEl) showMsg(msgEl, "Guardado en este dispositivo (configura GitHub para sincronizar).", "ok");
    return;
  }
  if (!gh.token && !(await ensureToken())) {
    setSyncStatus("🔒 bloqueado", "");
    if (msgEl) showMsg(msgEl, "Guardado local ✓ — desbloquea con tu contraseña para subirlo.", "ok");
    return;
  }
  try {
    await pushRemote();
    setSyncStatus("✓ sincronizado", "ok");
    if (msgEl) showMsg(msgEl, "Guardado y sincronizado ✓", "ok");
  } catch (e) {
    setSyncStatus("⚠ sin conexión", "err");
    if (msgEl) showMsg(msgEl, "Guardado local ✓ — se subirá en la próxima sincronización.", "ok");
  }
}

function showMsg(el, txt, cls) {
  if (!el) return;
  el.textContent = txt;
  el.className = "msg " + (cls || "");
  setTimeout(() => { el.textContent = ""; el.className = "msg"; }, 5000);
}

// ---------- render ----------
function renderAll() {
  poblarSelectsPersona();
  renderResumen();
  renderAddForm();
  renderMovs();
  renderAjustes();
}

function renderResumen() {
  const empty = document.getElementById("empty-state");
  const dash = document.getElementById("dash");
  if (!data.movimientos.length) {
    empty.classList.remove("hidden");
    dash.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  dash.classList.remove("hidden");

  const total = totalAportado();
  const aps = aportaciones();
  document.getElementById("hero-total").textContent = fmtEur0(total);
  const meses = mesesConDatos();
  document.getElementById("hero-sub").textContent =
    aps.length + " aportacion" + (aps.length === 1 ? "" : "es") +
    (meses.length ? " · desde " + mesLargo(meses[0]) : "");

  renderBalance();

  // KPIs por persona
  const [pa, pb] = data.personas;
  const apA = aportadoPor(pa.id), apB = aportadoPor(pb.id);
  document.getElementById("kpi-a-label").textContent = esc(pa.nombre);
  document.getElementById("kpi-b-label").textContent = esc(pb.nombre);
  document.getElementById("kpi-a").textContent = fmtEur0(apA);
  document.getElementById("kpi-b").textContent = fmtEur0(apB);
  document.getElementById("kpi-a-sub").textContent = total > 0 ? (apA / total * 100).toFixed(0) + " % del total" : "";
  document.getElementById("kpi-b-sub").textContent = total > 0 ? (apB / total * 100).toFixed(0) + " % del total" : "";
  document.getElementById("kpi-movs").textContent = data.movimientos.length;
  const nLiq = liquidaciones().length;
  document.getElementById("kpi-movs-sub").textContent = nLiq ? nLiq + " liquidación" + (nLiq === 1 ? "" : "es") : "aportaciones";
  const media = meses.length ? total / meses.length : 0;
  document.getElementById("kpi-media").textContent = fmtEur0(media);

  renderChartEvolucion(meses);
  renderChartCategorias();
  renderListaMovs(document.getElementById("lista-ultimos"), data.movimientos.slice().sort(ordFecha).reverse().slice(0, 5), false);
}

function renderBalance() {
  const [pa, pb] = data.personas;
  const balA = balancePersona(pa.id);
  const txt = document.getElementById("balance-txt");
  const card = document.getElementById("card-balance");
  if (Math.abs(balA) < 0.005) {
    txt.innerHTML = `<span class="paz">✓ Estáis en paz</span>`;
    card.className = "card balance ok";
  } else {
    // balA > 0 → pa ha puesto de más → pb le debe
    const acreedor = balA > 0 ? pa : pb;
    const deudor = balA > 0 ? pb : pa;
    txt.innerHTML = `<b>${esc(deudor.nombre)}</b> debe <span class="big">${fmtEur(Math.abs(balA))}</span> a <b>${esc(acreedor.nombre)}</b>`;
    card.className = "card balance debe";
  }

  // barra de reparto real vs objetivo
  const total = totalAportado();
  const apA = aportadoPor(pa.id), apB = aportadoPor(pb.id);
  const pctA = total > 0 ? apA / total * 100 : 50;
  document.getElementById("reparto-a").style.width = pctA.toFixed(1) + "%";
  document.getElementById("reparto-b").style.width = (100 - pctA).toFixed(1) + "%";
  const objA = Number(data.config.reparto?.[pa.id] ?? 50);
  document.getElementById("reparto-legend").innerHTML =
    `<span><i class="dot a"></i>${esc(pa.nombre)} ${pctA.toFixed(0)}%</span>` +
    `<span class="muted">objetivo ${objA}/${100 - objA}</span>` +
    `<span><i class="dot b"></i>${esc(pb.nombre)} ${(100 - pctA).toFixed(0)}%</span>`;
}

function ordFecha(a, b) {
  return (a.fecha || "").localeCompare(b.fecha || "") || (a.id || "").localeCompare(b.id || "");
}

function renderChartEvolucion(meses) {
  document.getElementById("seg-mensual").classList.toggle("active", chartMode === "mensual");
  document.getElementById("seg-acum").classList.toggle("active", chartMode === "acum");
  const [pa, pb] = data.personas;
  const porMes = (pid, mes) =>
    aportaciones().filter((m) => m.pagador === pid && (m.fecha || "").slice(0, 7) === mes)
      .reduce((a, m) => a + Number(m.importe || 0), 0);

  let serieA = meses.map((m) => porMes(pa.id, m));
  let serieB = meses.map((m) => porMes(pb.id, m));
  if (chartMode === "acum") {
    serieA = acumular(serieA);
    serieB = acumular(serieB);
  }
  const mk = (label, serie, col) => ({
    label, data: serie, backgroundColor: col + "cc", borderColor: col, borderWidth: 1,
    borderRadius: 2, maxBarThickness: 38,
  });
  const opts = chartOpts((v) => fmtEur0(v));
  opts.scales.x.stacked = true;
  opts.scales.y.stacked = true;
  opts.plugins.legend = {
    display: true, position: "bottom",
    labels: { color: "#9a8d5e", boxWidth: 10, boxHeight: 10, font: { family: MONO, size: 10 }, padding: 12 },
  };
  opts.interaction = { mode: "index", intersect: false };
  opts.plugins.tooltip.callbacks = {
    label: (ctx) => ` ${ctx.dataset.label}: ${fmtEur(ctx.parsed.y)}`,
    footer: (items) => "TOTAL: " + fmtEur(items.reduce((a, it) => a + it.parsed.y, 0)),
  };
  drawChart("chart-evolucion", {
    type: "bar",
    data: { labels: meses.map(mesLargo), datasets: [mk(pa.nombre, serieA, PALETTE[0]), mk(pb.nombre, serieB, PALETTE[1])] },
    options: opts,
  });
}
function acumular(arr) {
  let s = 0;
  return arr.map((v) => (s += v));
}

function renderChartCategorias() {
  const card = document.getElementById("card-categorias");
  const porCat = {};
  for (const m of aportaciones()) {
    const c = m.categoria || "Otros";
    porCat[c] = (porCat[c] || 0) + Number(m.importe || 0);
  }
  const labels = Object.keys(porCat);
  if (!labels.length) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const valores = labels.map((l) => porCat[l]);
  drawChart("chart-categorias", {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: valores,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length] + "cc"),
        borderColor: "#070703", borderWidth: 2,
      }],
    },
    options: {
      responsive: true, cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { color: "#9a8d5e", boxWidth: 10, boxHeight: 10, font: { family: MONO, size: 10 }, padding: 10 } },
        tooltip: {
          backgroundColor: "rgba(7,7,3,0.96)", borderColor: "rgba(255,176,0,0.35)", borderWidth: 1,
          padding: 10, cornerRadius: 4, displayColors: false,
          titleColor: "#ffb000", bodyColor: "#e9ddb9",
          titleFont: { family: MONO, size: 11 }, bodyFont: { family: MONO, size: 11 },
          callbacks: { label: (ctx) => ` ${ctx.label}: ${fmtEur(ctx.parsed)}` },
        },
      },
    },
  });
}

// ---------- lista de movimientos ----------
function renderListaMovs(cont, movs, conAcciones) {
  cont.innerHTML = "";
  if (!movs.length) { cont.innerHTML = `<p class="hint">Sin movimientos.</p>`; return; }
  for (const m of movs) {
    const row = document.createElement("div");
    const esLiq = m.tipo === "liquidacion";
    row.className = "mov-row" + (esLiq ? " liq" : "");
    const pagador = nombrePersona(m.pagador);
    const pcls = data.personas.findIndex((p) => p.id === m.pagador) === 0 ? "a" : "b";
    const sub = esLiq
      ? `liquidación → ${esc(nombrePersona(m.receptor))}`
      : esc(m.categoria || "Otros");
    const acciones = conAcciones
      ? `<button class="btn-mini accion" data-edit="${m.id}" title="Editar">✏️</button>
         <button class="btn-mini" data-del="${m.id}" title="Eliminar">✕</button>`
      : "";
    row.innerHTML = `
      <span class="avatar p-${pcls}">${esc(iniciales(pagador))}</span>
      <div class="mov-info">
        <span class="mov-concepto">${esc(m.concepto || (esLiq ? "Liquidación" : "Aportación"))}</span>
        <span class="mov-sub">${fmtFecha(m.fecha)} · ${esc(pagador)} · ${sub}</span>
      </div>
      <div class="mov-importe ${esLiq ? "liq" : ""}">${esLiq ? "" : ""}${fmtEur(m.importe)}</div>
      ${acciones}`;
    cont.appendChild(row);
  }
}

function renderMovs() {
  // selects de filtro
  const fp = document.getElementById("filtro-persona");
  const fc = document.getElementById("filtro-categoria");
  fp.innerHTML = `<option value="">Todos</option>` + data.personas.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
  fc.innerHTML = `<option value="">Todas las categorías</option>` + data.config.categorias.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  fp.value = filtroPersona; fc.value = filtroCategoria;

  let movs = data.movimientos.slice().sort(ordFecha).reverse();
  if (filtroPersona) movs = movs.filter((m) => m.pagador === filtroPersona || m.receptor === filtroPersona);
  if (filtroCategoria) movs = movs.filter((m) => (m.categoria || "Otros") === filtroCategoria);

  const totalFiltrado = movs.filter((m) => m.tipo !== "liquidacion").reduce((a, m) => a + Number(m.importe || 0), 0);
  document.getElementById("movs-total").textContent = `${movs.length} mov. · ${fmtEur0(totalFiltrado)}`;
  renderListaMovs(document.getElementById("lista-movs"), movs, true);
}

// ---------- vista Añadir ----------
function poblarSelectsPersona() {
  const optsP = data.personas.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
  document.getElementById("add-pagador").innerHTML = optsP;
  document.getElementById("add-receptor").innerHTML = optsP;
  document.getElementById("add-categoria").innerHTML =
    data.config.categorias.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
}

function renderAddForm() {
  const tipo = document.getElementById("add-tipo").value;
  const esLiq = tipo === "liquidacion";
  document.getElementById("field-receptor").classList.toggle("hidden", !esLiq);
  document.getElementById("field-categoria").classList.toggle("hidden", esLiq);
  document.getElementById("add-pagador-lbl").textContent = esLiq ? "Quién paga (de su bolsillo)" : "Quién lo paga";
  if (!document.getElementById("add-fecha").value) document.getElementById("add-fecha").value = hoyISO();
  const cancelar = document.getElementById("btn-add-cancelar");
  document.getElementById("add-titulo").textContent = editandoId ? "Editar movimiento" : "Registrar movimiento";
  document.getElementById("btn-add-guardar").textContent = editandoId ? "💾 Actualizar" : "💾 Guardar";
  cancelar.classList.toggle("hidden", !editandoId);
}

function guardarMovimiento() {
  const tipo = document.getElementById("add-tipo").value;
  const esLiq = tipo === "liquidacion";
  const fecha = document.getElementById("add-fecha").value;
  const pagador = document.getElementById("add-pagador").value;
  const receptor = document.getElementById("add-receptor").value;
  const concepto = document.getElementById("add-concepto").value.trim();
  const categoria = document.getElementById("add-categoria").value;
  const importe = Number(document.getElementById("add-importe").value);
  const msg = document.getElementById("add-msg");

  if (!fecha) return showMsg(msg, "Indica la fecha.", "err");
  if (!importe || importe <= 0) return showMsg(msg, "Indica un importe mayor que 0.", "err");
  if (esLiq && pagador === receptor) return showMsg(msg, "En una liquidación, el que paga y el que cobra deben ser distintos.", "err");

  const mov = {
    id: editandoId || uid(),
    fecha, tipo,
    pagador,
    receptor: esLiq ? receptor : null,
    concepto,
    categoria: esLiq ? null : categoria,
    importe,
  };
  if (editandoId) {
    const i = data.movimientos.findIndex((m) => m.id === editandoId);
    if (i >= 0) data.movimientos[i] = mov; else data.movimientos.push(mov);
    editandoId = null;
  } else {
    data.movimientos.push(mov);
  }
  // limpiar formulario (deja fecha y tipo)
  document.getElementById("add-id").value = "";
  document.getElementById("add-concepto").value = "";
  document.getElementById("add-importe").value = "";
  saveAndSync(msg);
  showMsg(msg, "Movimiento guardado ✓", "ok");
}

function editarMovimiento(id) {
  const m = data.movimientos.find((x) => x.id === id);
  if (!m) return;
  editandoId = id;
  document.getElementById("add-tipo").value = m.tipo === "liquidacion" ? "liquidacion" : "aportacion";
  document.getElementById("add-fecha").value = m.fecha || hoyISO();
  document.getElementById("add-pagador").value = m.pagador || data.personas[0].id;
  if (m.receptor) document.getElementById("add-receptor").value = m.receptor;
  if (m.categoria) document.getElementById("add-categoria").value = m.categoria;
  document.getElementById("add-concepto").value = m.concepto || "";
  document.getElementById("add-importe").value = m.importe || "";
  renderAddForm();
  switchView("add");
}

function borrarMovimiento(id) {
  const m = data.movimientos.find((x) => x.id === id);
  if (!m) return;
  if (!confirm(`¿Eliminar "${m.concepto || "movimiento"}" de ${fmtEur(m.importe)}?`)) return;
  data.movimientos = data.movimientos.filter((x) => x.id !== id);
  saveAndSync(null);
}

function cancelarEdicion() {
  editandoId = null;
  document.getElementById("add-concepto").value = "";
  document.getElementById("add-importe").value = "";
  renderAddForm();
  switchView("movs");
}

// ---------- vista Ajustes ----------
function renderAjustes() {
  const [pa, pb] = data.personas;
  document.getElementById("cfg-nombre-a").value = pa.nombre;
  document.getElementById("cfg-nombre-b").value = pb.nombre;
  const objA = Number(data.config.reparto?.[pa.id] ?? 50);
  document.getElementById("cfg-reparto-lbl").textContent = `Parte de ${pa.nombre} (%)`;
  document.getElementById("cfg-reparto-a").value = objA;
  document.getElementById("cfg-reparto-bar-a").style.width = objA + "%";
  document.getElementById("cfg-reparto-bar-b").style.width = (100 - objA) + "%";
  document.getElementById("cfg-reparto-legend").innerHTML =
    `<span><i class="dot a"></i>${esc(pa.nombre)} ${objA}%</span><span><i class="dot b"></i>${esc(pb.nombre)} ${100 - objA}%</span>`;

  // categorías
  const cont = document.getElementById("lista-categorias");
  cont.innerHTML = "";
  data.config.categorias.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "cat-row";
    row.innerHTML = `<span class="cat-nombre">${esc(c)}</span>
      <button class="btn-mini" data-delcat="${i}" title="Eliminar categoría">✕</button>`;
    cont.appendChild(row);
  });

  // GitHub
  if (gh) {
    document.getElementById("gh-owner").value = gh.owner || "";
    document.getElementById("gh-repo").value = gh.repo || "";
    document.getElementById("gh-token").value = gh.enc ? "" : (gh.token || "");
  }
  renderSeguridadToken();
}

function renderSeguridadToken() {
  const el = document.getElementById("gh-seguridad");
  if (!el) return;
  if (!gh) { el.className = "gh-seg hidden"; el.innerHTML = ""; return; }
  if (gh.enc && gh.token) {
    el.className = "gh-seg cifrado";
    el.innerHTML = `<span class="gh-seg-txt">🔒 Token cifrado · desbloqueado en esta sesión</span>`;
  } else if (gh.enc) {
    el.className = "gh-seg cifrado";
    el.innerHTML = `<span class="gh-seg-txt">🔒 Token cifrado · se pedirá la contraseña al sincronizar</span>` +
      `<button class="btn-mini" data-token="desbloquear">Desbloquear</button>`;
  } else if (gh.token) {
    el.className = "gh-seg claro";
    el.innerHTML = `<span class="gh-seg-txt">🔓 Token SIN cifrar en este dispositivo</span>` +
      `<button class="btn-mini" data-token="cifrar">Cifrar con contraseña</button>`;
  } else {
    el.className = "gh-seg hidden"; el.innerHTML = "";
  }
}

function guardarNombres() {
  const a = document.getElementById("cfg-nombre-a").value.trim();
  const b = document.getElementById("cfg-nombre-b").value.trim();
  if (a) data.personas[0].nombre = a;
  if (b) data.personas[1].nombre = b;
  saveAndSync(null);
}
function guardarReparto() {
  let v = Number(document.getElementById("cfg-reparto-a").value);
  if (isNaN(v)) return;
  v = Math.max(0, Math.min(100, Math.round(v)));
  data.config.reparto[data.personas[0].id] = v;
  data.config.reparto[data.personas[1].id] = 100 - v;
  saveAndSync(null);
}
function addCategoria() {
  const inp = document.getElementById("nueva-categoria");
  const c = inp.value.trim();
  if (!c) return;
  if (!data.config.categorias.includes(c)) data.config.categorias.push(c);
  inp.value = "";
  saveAndSync(null);
}
function delCategoria(i) {
  if (data.config.categorias.length <= 1) { alert("Deja al menos una categoría."); return; }
  data.config.categorias.splice(i, 1);
  saveAndSync(null);
}

// ---------- GitHub: conexión (idéntico a Patrimonio) ----------
async function crearRepoSiNoExiste(repo, msg) {
  showMsg(msg, "Repositorio no encontrado, intentando crearlo…", "");
  try {
    const res = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: repo, private: true, auto_init: false }),
    });
    if (res.ok) { showMsg(msg, "Repositorio creado ✓", "ok"); return true; }
    msg.textContent = "El repositorio no existe y no se pudo crear automáticamente. ";
    const link = document.createElement("a");
    link.href = "https://github.com/new?name=" + encodeURIComponent(repo) + "&visibility=private";
    link.target = "_blank"; link.rel = "noopener"; link.textContent = "Créalo en GitHub";
    msg.appendChild(link);
    msg.appendChild(document.createTextNode(" y vuelve a probar."));
    msg.className = "msg err";
    setSyncStatus("⚠ revisa GitHub", "err");
    return false;
  } catch (e) {
    showMsg(msg, "No se pudo crear el repositorio: " + e.message, "err");
    setSyncStatus("⚠ revisa GitHub", "err");
    return false;
  }
}

async function guardarGitHub() {
  const owner = document.getElementById("gh-owner").value.trim();
  const repo = document.getElementById("gh-repo").value.trim();
  const token = document.getElementById("gh-token").value.trim();
  const msg = document.getElementById("gh-msg");
  if (!owner || !repo || !token) { showMsg(msg, "Rellena usuario, repositorio y token.", "err"); return; }
  gh = { owner, repo, token };
  showMsg(msg, "Probando conexión…", "");
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: ghHeaders() });
    if (res.status === 404) {
      if (!(await crearRepoSiNoExiste(repo, msg))) return;
    } else if (!res.ok) {
      throw new Error("error " + res.status);
    }
  } catch (e) {
    showMsg(msg, "No conecta: " + e.message, "err");
    setSyncStatus("⚠ revisa GitHub", "err");
    return;
  }
  let cifrado = false;
  if (window.SecureToken) {
    const pass = await SecureToken.askNewPassphrase();
    if (pass) {
      try {
        const enc = await SecureToken.encrypt(token, pass);
        localStorage.setItem(LS_GH, JSON.stringify({ owner, repo, enc }));
        gh.enc = enc; cifrado = true;
        showMsg(msg, "Conectado y token cifrado ✓", "ok");
      } catch (e) { /* si el cifrado falla, cae al guardado en claro */ }
    }
  }
  if (!cifrado) {
    localStorage.setItem(LS_GH, JSON.stringify({ owner, repo, token }));
    showMsg(msg, "Conectado ✓ (token SIN cifrar)", "ok");
  }
  await syncFull(false);
  renderAjustes();
}

async function cifrarTokenExistente() {
  if (!gh || !gh.token || !window.SecureToken) return;
  const pass = await SecureToken.askNewPassphrase();
  if (!pass) return;
  const enc = await SecureToken.encrypt(gh.token, pass);
  localStorage.setItem(LS_GH, JSON.stringify({ owner: gh.owner, repo: gh.repo, enc }));
  gh.enc = enc;
  renderAjustes();
  showMsg(document.getElementById("gh-msg"), "Token cifrado ✓", "ok");
}

// ---------- exportar / importar ----------
function exportar() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "home-" + hoyISO() + ".json";
  a.click();
}
function importar(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d.personas || !d.movimientos) throw new Error("formato no reconocido");
      if (!confirm("Esto reemplaza los datos actuales por el archivo importado. ¿Continuar?")) return;
      data = normaliza(d);
      saveAndSync(null);
    } catch (e) { alert("No se pudo importar: " + e.message); }
  };
  r.readAsText(file);
}

// ---------- navegación y eventos ----------
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById("view-" + name).classList.remove("hidden");
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  window.scrollTo(0, 0);
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

// Añadir
document.getElementById("add-tipo").addEventListener("change", renderAddForm);
document.getElementById("btn-add-guardar").addEventListener("click", guardarMovimiento);
document.getElementById("btn-add-cancelar").addEventListener("click", cancelarEdicion);

// Movimientos
document.getElementById("filtro-persona").addEventListener("change", (e) => { filtroPersona = e.target.value; renderMovs(); });
document.getElementById("filtro-categoria").addEventListener("change", (e) => { filtroCategoria = e.target.value; renderMovs(); });
document.getElementById("lista-movs").addEventListener("click", (e) => {
  const ed = e.target.closest("[data-edit]");
  if (ed) return editarMovimiento(ed.dataset.edit);
  const del = e.target.closest("[data-del]");
  if (del) return borrarMovimiento(del.dataset.del);
});
document.getElementById("ver-todos").addEventListener("click", () => switchView("movs"));

// Resumen: selector de gráfica
document.getElementById("seg-mensual").addEventListener("click", () => { chartMode = "mensual"; localStorage.setItem("home:chartmode", chartMode); renderResumen(); });
document.getElementById("seg-acum").addEventListener("click", () => { chartMode = "acum"; localStorage.setItem("home:chartmode", chartMode); renderResumen(); });

// Ajustes
document.getElementById("cfg-nombre-a").addEventListener("change", guardarNombres);
document.getElementById("cfg-nombre-b").addEventListener("change", guardarNombres);
document.getElementById("cfg-reparto-a").addEventListener("change", guardarReparto);
document.getElementById("btn-add-categoria").addEventListener("click", addCategoria);
document.getElementById("lista-categorias").addEventListener("click", (e) => {
  const d = e.target.closest("[data-delcat]");
  if (d) delCategoria(Number(d.dataset.delcat));
});
document.getElementById("btn-gh-guardar").addEventListener("click", guardarGitHub);
document.getElementById("btn-gh-sync").addEventListener("click", () => syncFull(true));
document.getElementById("gh-seguridad").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-token]");
  if (!btn) return;
  if (btn.dataset.token === "cifrar") return cifrarTokenExistente();
  if (btn.dataset.token === "desbloquear" && (await ensureToken())) { renderAjustes(); syncFull(true); }
});
document.getElementById("btn-export").addEventListener("click", exportar);
document.getElementById("btn-import").addEventListener("click", () => document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change", (e) => {
  if (e.target.files[0]) importar(e.target.files[0]);
  e.target.value = "";
});

// ---------- arranque ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
renderAll();
syncFull(false);
