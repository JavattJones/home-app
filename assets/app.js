/* ============================================================
   HOME · aportaciones a la casa y balance de la pareja.
   Datos: Firebase (Firestore) vía assets/cloud.js + caché localStorage
   para pintar al instante al abrir.
   ============================================================ */
const LS_CACHE = "home:cache";
const LS_LEGACY = "home:data", LEGACY_KEYS = ["home:data","home:gh","home:sha","home:dirty"];   // versión GitHub
const DEFAULT_CATS = ['Entrada','Cuota cooperativa','Derrama','Notaría/Gestoría','Mobiliario','Otros'];

const PEOPLE = {
  javi:   { name:'Persona A', color:'var(--javi)',   soft:'var(--javi-soft)',   hex:'#2E6B5E' },
  andrea: { name:'Persona B', color:'var(--andrea)', soft:'var(--andrea-soft)', hex:'#C16544' }
};
let settings = { targetJavi: 50, mortgage: { down:null, interest:null, years:null, community:0, insurance:0, ibi:0 } };

// Revisiones del precio de compra de la casa (vacío hasta que se fija el precio real).
// La última es el precio actual; la primera, el inicial pactado.
let priceHistory = [];
let categories = DEFAULT_CATS.slice();

const CAT_ICON = {
  'Entrada':'ph-key', 'Cuota cooperativa':'ph-arrows-clockwise', 'Derrama':'ph-wrench',
  'Notaría/Gestoría':'ph-stamp', 'Mobiliario':'ph-armchair', 'Otros':'ph-tag'
};
const CAT_COLOR = {
  'Entrada':'#2E6B5E', 'Cuota cooperativa':'#C16544', 'Derrama':'#D6A24E',
  'Notaría/Gestoría':'#8C9A6B', 'Mobiliario':'#9C6B4F', 'Otros':'#CBB89A'
};
const FALLBACK_COLORS = ['#7E9B8E','#D78A6B','#C2A878','#A2876B','#6E8C7E','#D2B48C'];
function catIcon(c){ return CAT_ICON[c] || 'ph-tag'; }
function catColor(c){ if(CAT_COLOR[c]) return CAT_COLOR[c];
  let i = categories.indexOf(c); return FALLBACK_COLORS[Math.abs(i)%FALLBACK_COLORS.length]; }

let movements = [];
let nextId = 100;

/* ---------------- helpers ---------------- */
const MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const MES_L = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const eurFmt = new Intl.NumberFormat('es-ES',{maximumFractionDigits:0});
const eur = n => eurFmt.format(Math.round(n)) + '\u00A0€';
const pct = n => Math.round(n) + '%';
function fechaCorta(iso){ const [y,m,d]=iso.split('-').map(Number); return `${d} ${MES[m-1]}`; }
function fechaLarga(iso){ const [y,m,d]=iso.split('-').map(Number); return `${d} de ${MES_L[m-1]} de ${y}`; }
function todayISO(){ const t=new Date(); return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); }
function sortedMovs(){ return movements.slice().sort((a,b)=> a.date<b.date?1:a.date>b.date?-1:b.id-a.id); }
const $ = (s,r=document)=>r.querySelector(s);

/* ---------------- cálculo del balance ---------------- */
function stats(){
  const aport = movements.filter(m=>m.type==='aportacion');
  const liq   = movements.filter(m=>m.type==='liquidacion');
  const totalAport = aport.reduce((s,m)=>s+m.amount,0);
  const aportBy = {javi:0,andrea:0};
  aport.forEach(m=>aportBy[m.payer]+=m.amount);

  const tJavi = settings.targetJavi/100;
  const share = { javi: totalAport*tJavi, andrea: totalAport*(1-tJavi) };

  const liqPaid={javi:0,andrea:0}, liqRecv={javi:0,andrea:0};
  liq.forEach(m=>{ liqPaid[m.payer]+=m.amount; liqRecv[m.to]+=m.amount; });

  // balance = aportado − lo que le toca + liquidaciones pagadas − liquidaciones recibidas
  const bal = {
    javi:   aportBy.javi   - share.javi   + liqPaid.javi   - liqRecv.javi,
    andrea: aportBy.andrea - share.andrea + liqPaid.andrea - liqRecv.andrea
  };
  let owe = null;
  if(Math.round(Math.abs(bal.javi)) >= 1){
    owe = bal.javi > 0 ? {from:'andrea',to:'javi',amount:Math.round(bal.javi)}
                       : {from:'javi',to:'andrea',amount:Math.round(-bal.javi)};
  }
  const splitReal = totalAport>0
    ? {javi:aportBy.javi/totalAport*100, andrea:aportBy.andrea/totalAport*100}
    : {javi:50,andrea:50};

  // meses (de las aportaciones)
  const monthsSet = [...new Set(aport.map(m=>m.date.slice(0,7)))].sort();
  const monthly = { javi: monthsSet.map(()=>0), andrea: monthsSet.map(()=>0) };
  aport.forEach(m=>{ const i=monthsSet.indexOf(m.date.slice(0,7)); monthly[m.payer][i]+=m.amount; });
  const perMonth = monthsSet.length ? totalAport/monthsSet.length : 0;

  const byCategory = categories.map(c=>({cat:c, amount: aport.filter(m=>m.category===c).reduce((s,m)=>s+m.amount,0)}));

  // ---- la casa ----
  const priceInitial = priceHistory.length ? priceHistory[0].price : 0;
  const priceNow = priceHistory.length ? priceHistory[priceHistory.length-1].price : 0;
  const variance = priceNow - priceInitial;
  const variancePct = priceInitial ? variance/priceInitial*100 : 0;
  const remaining = Math.max(0, priceNow - totalAport);   // ≈ lo que falta por aportar
  const fundedPct = priceNow>0 ? totalAport/priceNow*100 : 0;

  // ---- hipoteca y gasto mensual estimado ----
  const mg = settings.mortgage || {};
  const num = v => (v==null || v==='') ? null : Number(v);
  const resto = Math.max(0, priceNow - totalAport);              // lo que queda por cubrir (precio − aportado)
  const downExtra = num(mg.down) || 0;                           // entrada extra al firmar, sobre el resto
  const financed = Math.max(0, resto - downExtra);               // capital a financiar = precio − aportado − entrada
  const interest = num(mg.interest) || 0;                        // TIN anual %
  const years = num(mg.years) || 0;                              // plazo en años
  const im = interest/100/12, nm = years*12;                     // tipo mensual y nº de cuotas
  let monthlyMortgage = 0;
  if(financed>0 && nm>0) monthlyMortgage = im>0 ? financed*im/(1-Math.pow(1+im,-nm)) : financed/nm;
  const community = num(mg.community) || 0;                      // comunidad €/mes
  const insurance = num(mg.insurance) || 0;                      // seguros €/mes
  const ibiMonthly = (num(mg.ibi) || 0)/12;                      // IBI anual → €/mes
  const monthlyTotal = monthlyMortgage + community + insurance + ibiMonthly;
  const totalInterest = monthlyMortgage>0 ? monthlyMortgage*nm - financed : 0;
  const hasMortgage = financed>0 && nm>0 && interest>0;
  const monthlyByPerson = { javi: monthlyTotal*tJavi, andrea: monthlyTotal*(1-tJavi) };

  return { totalAport, aportBy, share, bal, owe, splitReal,
           count:movements.length, months:monthsSet, monthly, perMonth, byCategory,
           priceInitial, priceNow, variance, variancePct, remaining, fundedPct,
           resto, downExtra, financed, interest, years, monthlyMortgage, community, insurance, ibiMonthly,
           monthlyTotal, totalInterest, hasMortgage, monthlyByPerson };
}
const cum = arr => { let t=0; return arr.map(v=>t+=v); };

/* ---------------- avatar / row markup ---------------- */
function inicialDe(key){ const n=((PEOPLE[key]&&PEOPLE[key].name)||'').trim(); return n?n.charAt(0).toUpperCase():'·'; }
function avatar(key,cls=''){ const p=PEOPLE[key];
  return `<span class="av ${cls}" style="background:${p.color}">${inicialDe(key)}</span>`; }

function movRow(m){
  if(m.type==='aportacion'){
    const p=PEOPLE[m.payer];
    return `<button class="mov" data-mov="${m.id}">
      <span class="mov-ic" style="background:${p.soft};color:${p.color}"><i class="ph ${catIcon(m.category)}"></i></span>
      <span class="mov-mid">
        <span class="mov-title"><span class="t">${m.concept}</span></span>
        <span class="mov-meta"><span class="dot dot-sm" style="background:${p.color}"></span>${p.name} · ${m.category} · ${fechaCorta(m.date)}</span>
      </span>
      <span class="mov-amt tnum">${eur(m.amount)}</span>
    </button>`;
  }
  const from=PEOPLE[m.payer], to=PEOPLE[m.to];
  return `<button class="mov mov-liq" data-mov="${m.id}">
    <span class="mov-ic liq-ic"><i class="ph ph-handshake"></i></span>
    <span class="mov-mid">
      <span class="mov-title"><span class="t">${m.concept}</span><span class="chip-liq">Liquidación</span></span>
      <span class="mov-meta">${from.name} → ${to.name} · ${fechaCorta(m.date)}</span>
    </span>
    <span class="mov-amt liq-amt tnum">${eur(m.amount)}</span>
  </button>`;
}

/* ============================================================
   APP BAR
   ============================================================ */
function renderAppbar(tab){
  const bar = $('#appbar');
  if(tab==='resumen'){
    bar.innerHTML = `<div class="brand">
      <div class="brand-l">
        <div class="brand-logo"><i class="ph-fill ph-house"></i></div>
        <div><div class="brand-name">Home</div><div class="brand-sub">Vuestra casa</div></div>
      </div>
      <div class="avatars">${avatar('javi')}${avatar('andrea')}</div>
    </div>`;
  } else {
    const map = {
      anadir:{t:'Añadir', s:'Una aportación o una liquidación'},
      movimientos:{t:'Movimientos', s:`${movements.length} en total`},
      hipoteca:{t:'Hipoteca', s:'Vuestra cuota y gasto mensual estimado'},
      ajustes:{t:'Ajustes', s:'A vuestra manera'}
    };
    const m = map[tab];
    bar.innerHTML = `<div class="title"><div><h1 class="serif">${m.t}</h1><div class="sub">${m.s}</div></div></div>`;
  }
}

/* ============================================================
   RESUMEN
   ============================================================ */
let monthlyChart=null, donutChart=null, priceChart=null, monthlyMode='mensual', priceMode='precio';

function renderOnboarding(){
  $('#s-resumen').innerHTML = `
    <div class="card" style="text-align:center;padding:36px 22px;margin-top:8px">
      <div class="house-icon" style="margin:0 auto 14px;width:62px;height:62px;border-radius:18px;font-size:31px"><i class="ph-fill ph-house"></i></div>
      <h2 class="serif" style="font-size:27px;margin:0 0 8px">Bienvenidos a vuestra casa</h2>
      <p class="muted" style="font-size:14px;line-height:1.55;margin:0 auto;max-width:290px">Llevad juntos el dinero que aportáis a la casa y ved en todo momento cómo va la compra y quién debe a quién.</p>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="eyebrow">Para empezar</div>
      <button class="hero-cta" data-action="ir-precio" style="margin-top:14px"><i class="ph ph-house-line"></i> 1 · Fijad el precio de la casa</button>
      <button class="hero-cta" data-action="ir-anadir" style="margin-top:10px;background:var(--javi-soft);color:var(--javi-deep)"><i class="ph ph-plus-circle"></i> 2 · Apuntad el primer pago</button>
      <p class="form-hint" style="margin-top:14px;text-align:center">También podéis conectar GitHub en Ajustes para sincronizar entre vuestros móviles.</p>
    </div>`;
  const ip=$('[data-action="ir-precio"]'); if(ip) ip.onclick=()=>switchTab('ajustes');
  const ia=$('[data-action="ir-anadir"]'); if(ia) ia.onclick=()=>switchTab('anadir');
}

function renderResumen(){
  const s = stats();
  if(!movements.length && !priceHistory.length) return renderOnboarding();
  const hasPrice = priceHistory.length > 0;
  const hasMovs  = movements.length > 0;

  const vUp = s.variance > 0, vDown = s.variance < 0;
  const vClass = vUp ? 'up' : vDown ? 'down' : 'flat';
  const vIcon = vUp ? 'ph-trend-up' : vDown ? 'ph-trend-down' : 'ph-minus';
  const vTxt = `${s.variance>=0?'+':'−'}${eur(Math.abs(s.variance))} · ${s.variance>=0?'+':'−'}${Math.abs(s.variancePct).toFixed(1).replace('.',',')}% desde el inicial`;

  const houseHero = hasPrice ? `
    <div class="card house-hero">
      <div class="row-between" style="align-items:flex-start">
        <div>
          <div class="eyebrow">Precio de compra de la casa</div>
          <div class="house-price serif tnum">${eur(s.priceNow)}</div>
          <div class="var-chip ${vClass}"><i class="ph ${vIcon}"></i> ${vTxt}</div>
        </div>
        <div class="house-icon"><i class="ph-fill ph-house-line"></i></div>
      </div>
      <div class="fund-bar"><div class="fund-fill" style="width:${Math.max(2,s.fundedPct)}%"></div></div>
      <div class="fund-legend"><span>Aportado <b class="tnum">${eur(s.totalAport)}</b></span><span><b class="tnum">${pct(s.fundedPct)}</b> cubierto</span></div>
    </div>

    <div class="house-stats">
      <div class="hstat"><div class="lab"><i class="ph ph-coins"></i> Aportado entre los dos</div><div class="val tnum">${eur(s.totalAport)}</div></div>
      <div class="hstat accent"><div class="lab"><i class="ph ph-bank"></i> Falta por aportar</div><div class="val tnum">${eur(s.remaining)}</div></div>
    </div>` : `
    <div class="card house-hero">
      <div class="row-between" style="align-items:flex-start">
        <div>
          <div class="eyebrow">Precio de compra de la casa</div>
          <div class="house-price serif" style="color:var(--ink3)">Sin fijar</div>
          <div class="muted" style="margin-top:8px">Añade el precio de vuestra casa para ver desviación e hipoteca estimada.</div>
        </div>
        <div class="house-icon"><i class="ph-fill ph-house-line"></i></div>
      </div>
      <button class="hero-cta" data-action="ir-precio" style="margin-top:16px"><i class="ph ph-house-line"></i> Fijar el precio de la casa</button>
    </div>`;

  const priceSection = hasPrice ? `
    <div class="sec-title serif">La casa: precio y aportado</div>
    <div class="card">
      <div class="chart-head"><div class="legend-people" id="price-legend"></div></div>
      <div class="chart-wrap"><canvas id="chart-price"></canvas></div>
      <div class="chart-cap" id="price-cap"></div>
    </div>` : '';

  const balHTML = s.owe ? (()=>{ const from=PEOPLE[s.owe.from], to=PEOPLE[s.owe.to];
    return `<div class="row-between">
        <div class="bm-text"><div class="eyebrow">Entre vosotros</div>
          <div class="bm-phrase">${avatar(s.owe.from)} ${from.name} le debe <b>${eur(s.owe.amount)}</b> a ${to.name}</div></div>
        <button class="bm-btn" data-action="liquidar"><i class="ph ph-handshake"></i> Saldar</button>
      </div>`; })()
    : `<div class="row-between"><div class="bm-text"><div class="eyebrow">Entre vosotros</div>
        <div class="bm-phrase"><span class="paz-ic"><i class="ph-fill ph-check-circle"></i></span> No os debéis nada</div></div></div>`;

  const movsSection = hasMovs ? `
    <div class="sec-title serif">Vuestra casa, mes a mes</div>
    <div class="card">
      <div class="chart-head">
        <div class="legend-people">
          <span><span class="dot" style="background:var(--javi)"></span>${PEOPLE.javi.name}</span>
          <span><span class="dot" style="background:var(--andrea)"></span>${PEOPLE.andrea.name}</span>
        </div>
        <div class="seg" id="monthly-toggle">
          <button data-mode="mensual" class="${monthlyMode==='mensual'?'on':''}">Mensual</button>
          <button data-mode="acumulado" class="${monthlyMode==='acumulado'?'on':''}">Acumulado</button>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chart-monthly"></canvas></div>
    </div>

    <div class="sec-title serif">En qué se va el dinero</div>
    <div class="card">
      <div class="donut-wrap">
        <canvas id="chart-donut"></canvas>
        <div class="donut-center"><div class="t">Total</div><div class="n tnum">${eur(s.totalAport)}</div></div>
      </div>
      <div class="cat-legend">${s.byCategory.filter(c=>c.amount>0).map(c=>`
        <div class="row"><span class="dot" style="background:${catColor(c.cat)}"></span>
          <span class="name">${c.cat}</span>
          <span class="amt tnum">${eur(c.amount)}</span>
          <span class="pct tnum">${pct(c.amount/s.totalAport*100)}</span></div>`).join('')}
      </div>
    </div>

    <div class="sec-title serif" style="display:flex;justify-content:space-between;align-items:baseline">
      <span>Lo último en casa</span>
      <button class="linkish" data-action="ver-todos">Ver todos</button>
    </div>
    <div class="mov-card">${sortedMovs().slice(0,5).map(movRow).join('')}</div>` : `
    <div class="card" style="text-align:center;padding:30px 20px;margin-top:14px">
      <div class="muted">Aún no habéis apuntado ningún pago.</div>
      <button class="hero-cta" data-action="ir-anadir" style="margin-top:14px"><i class="ph ph-plus-circle"></i> Añadir el primero</button>
    </div>`;

  $('#s-resumen').innerHTML = `
    ${houseHero}
    ${priceSection}

    <div class="sec-title serif">Entre vosotros</div>
    <div class="card balance-mini">
      ${balHTML}
      <div class="splitbar mini">
        <div class="seg-j" style="width:${s.splitReal.javi}%"></div>
        <div class="seg-a" style="width:${s.splitReal.andrea}%"></div>
        <div class="mark" style="left:${settings.targetJavi}%"></div>
      </div>
      <div class="split-legend">
        <span><span class="dot" style="background:var(--javi)"></span>${PEOPLE.javi.name} <b>${pct(s.splitReal.javi)}</b></span>
        <span class="muted-strong">Objetivo ${pct(settings.targetJavi)}/${pct(100-settings.targetJavi)}</span>
        <span><b>${pct(s.splitReal.andrea)}</b> ${PEOPLE.andrea.name} <span class="dot" style="background:var(--andrea)"></span></span>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="lab"><span class="dot dot-sm" style="background:var(--javi)"></span>Aporta ${PEOPLE.javi.name}</div><div class="val tnum">${eur(s.aportBy.javi)}</div></div>
      <div class="kpi"><div class="lab"><span class="dot dot-sm" style="background:var(--andrea)"></span>Aporta ${PEOPLE.andrea.name}</div><div class="val tnum">${eur(s.aportBy.andrea)}</div></div>
      <div class="kpi"><div class="lab">Movimientos</div><div class="val tnum">${s.count}</div></div>
      <div class="kpi"><div class="lab">Media / mes</div><div class="val tnum">${eur(s.perMonth)}</div></div>
    </div>

    ${movsSection}
    <div style="height:8px"></div>
  `;

  // wire
  const mt = $('#monthly-toggle');
  if(mt) mt.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    monthlyMode=b.dataset.mode;
    mt.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.mode===monthlyMode));
    buildMonthly();
  });
  const cta = $('[data-action="liquidar"]'); if(cta) cta.onclick=()=>startLiquidacion(s.owe);
  const vt = $('[data-action="ver-todos"]'); if(vt) vt.onclick=()=>switchTab('movimientos');
  $('#s-resumen').querySelectorAll('[data-action="ir-precio"]').forEach(b=>b.onclick=()=>switchTab('ajustes'));
  $('#s-resumen').querySelectorAll('[data-action="ir-anadir"]').forEach(b=>b.onclick=()=>switchTab('anadir'));
  bindMovRows($('#s-resumen'));
  requestAnimationFrame(()=>{ if(hasPrice) buildPrice(); if(hasMovs){ buildMonthly(); buildDonut(); } });
}

function buildMonthly(){
  const c = document.getElementById('chart-monthly'); if(!c) return;
  if(monthlyChart) monthlyChart.destroy();
  const s = stats();
  const labels = s.months.map(m=>MES[parseInt(m.slice(5,7))-1]);
  let dj=s.monthly.javi.slice(), da=s.monthly.andrea.slice();
  if(monthlyMode==='acumulado'){ dj=cum(dj); da=cum(da); }
  monthlyChart = new Chart(c,{ type:'bar',
    data:{ labels, datasets:[
      { label:PEOPLE.javi.name,   data:dj, backgroundColor:'#2E6B5E', stack:'s', borderRadius:6, borderSkipped:false, maxBarThickness:34 },
      { label:PEOPLE.andrea.name, data:da, backgroundColor:'#C16544', stack:'s', borderRadius:6, borderSkipped:false, maxBarThickness:34 }
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{ backgroundColor:'#2B2521', padding:10, cornerRadius:10, titleFont:{family:'Hanken Grotesk',weight:'700'}, bodyFont:{family:'Hanken Grotesk'},
          callbacks:{ label:(ctx)=>` ${ctx.dataset.label}: ${eur(ctx.raw)}` } } },
      scales:{
        x:{ stacked:true, grid:{display:false}, border:{display:false}, ticks:{color:'#A89A8C',font:{family:'Hanken Grotesk',size:11,weight:'600'}} },
        y:{ stacked:true, grid:{color:'#F3ECE1'}, border:{display:false}, ticks:{color:'#A89A8C',font:{family:'Hanken Grotesk',size:10}, maxTicksLimit:5, callback:v=> v>=1000?(v/1000)+'k':v } }
      } }
  });
}
function buildDonut(){
  const c = document.getElementById('chart-donut'); if(!c) return;
  if(donutChart) donutChart.destroy();
  const s = stats();
  const cats = s.byCategory.filter(x=>x.amount>0);
  donutChart = new Chart(c,{ type:'doughnut',
    data:{ labels:cats.map(x=>x.cat), datasets:[{ data:cats.map(x=>x.amount),
      backgroundColor:cats.map(x=>catColor(x.cat)), borderColor:'#fff', borderWidth:3, hoverOffset:6 }]},
    options:{ cutout:'66%', responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{ backgroundColor:'#2B2521', padding:10, cornerRadius:10, bodyFont:{family:'Hanken Grotesk'},
          callbacks:{ label:(ctx)=>` ${ctx.label}: ${eur(ctx.raw)}` } } } }
  });
}

function buildPrice(){
  const c = document.getElementById('chart-price'); if(!c) return;
  if(!priceHistory.length) return;
  if(priceChart) priceChart.destroy();
  const s = stats();
  const legend = document.getElementById('price-legend');
  const cap = document.getElementById('price-cap');

  // Eje X común: meses (unión de aportaciones y revisiones de precio), ordenados.
  const aportMonths = movements.filter(m=>m.type==='aportacion').map(m=>m.date.slice(0,7));
  const months = [...new Set([...aportMonths, ...priceHistory.map(p=>p.date.slice(0,7))])].sort();
  if(!months.length) return;
  const labels = months.map(m=>{ const [y,mo]=m.split('-'); return MES[+mo-1]+" '"+y.slice(2); });

  const priceAt = (ym)=>{ let v=priceHistory[0].price; for(const p of priceHistory){ if(p.date.slice(0,7)<=ym) v=p.price; } return v; };
  const aportAt = (ym)=> movements.filter(m=>m.type==='aportacion' && m.date.slice(0,7)<=ym).reduce((a,m)=>a+m.amount,0);
  const priceSerie = months.map(priceAt);
  const initialSerie = months.map(()=>s.priceInitial);
  const aportSerie = months.map(aportAt);

  if(legend) legend.innerHTML =
    `<span><span class="line-key" style="border-top-color:var(--andrea)"></span>Precio</span>`+
    `<span><span class="line-key dash"></span>Inicial</span>`+
    `<span><span class="line-key" style="border-top-color:var(--javi)"></span>Aportado</span>`;
  if(cap){
    let txt = `Habéis aportado <b>${eur(s.totalAport)}</b> de <b>${eur(s.priceNow)}</b>`;
    txt += s.remaining>0 ? ` · faltan <b>${eur(s.remaining)}</b>` : ` · ¡ya está cubierto!`;
    if(priceHistory.length>1 && Math.round(s.variance)!==0)
      txt += ` · el precio ha ${s.variance>0?'subido':'bajado'} <b>${eur(Math.abs(s.variance))}</b> desde el inicial`;
    cap.innerHTML = `<i class="ph ph-bank" style="color:var(--javi)"></i> ${txt}.`;
  }

  priceChart = new Chart(c,{ type:'line',
    data:{ labels, datasets:[
      { label:'Precio', data:priceSerie, borderColor:'#C16544', backgroundColor:'rgba(193,101,68,0.10)', fill:1, tension:0.25, borderWidth:3, pointRadius:3, pointHoverRadius:6, pointBackgroundColor:'#C16544', pointBorderColor:'#fff', pointBorderWidth:2, order:1 },
      { label:'Inicial', data:initialSerie, borderColor:'#C9B79F', borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false, order:3 },
      { label:'Aportado', data:aportSerie, borderColor:'#2E6B5E', backgroundColor:'rgba(46,107,94,0.16)', fill:'origin', tension:0.35, borderWidth:3, pointRadius:2, pointHoverRadius:6, pointBackgroundColor:'#2E6B5E', pointBorderColor:'#fff', pointBorderWidth:2, order:2 }
    ]},
    options:{ responsive:true, maintainAspectRatio:false, interaction:{intersect:false,mode:'index'},
      plugins:{ legend:{display:false},
        tooltip:{ backgroundColor:'#2B2521', padding:11, cornerRadius:10, titleFont:{family:'Hanken Grotesk',weight:'700'}, bodyFont:{family:'Hanken Grotesk'},
          callbacks:{ label:(ctx)=>` ${ctx.dataset.label}: ${eur(ctx.raw)}`,
            afterBody:(it)=>{ const idx=it[0].dataIndex; return 'Falta por aportar: '+eur(Math.max(0, priceSerie[idx]-aportSerie[idx])); } } } },
      scales:{ x:{ grid:{display:false}, border:{display:false}, ticks:{color:'#A89A8C',font:{family:'Hanken Grotesk',size:11,weight:'600'}, maxTicksLimit:7} },
        y:{ min:0, max:s.priceNow*1.06, grid:{color:'#F3ECE1'}, border:{display:false}, ticks:{color:'#A89A8C',font:{family:'Hanken Grotesk',size:10}, maxTicksLimit:5, callback:v=>(v/1000)+'k €'} } } }
  });
}

/* ============================================================
   AÑADIR
   ============================================================ */
let form = { type:'aportacion', payer:'javi', to:'andrea', category:'Cuota cooperativa', editId:null };

function renderAnadir(){
  $('#s-anadir').innerHTML = `
    <form id="form-add" autocomplete="off">
      <div class="field" style="margin-top:8px">
        <label>Tipo de movimiento</label>
        <div class="seg-full" id="seg-tipo">
          <button type="button" data-tipo="aportacion"><i class="ph ph-house-line"></i> Aportación</button>
          <button type="button" data-tipo="liquidacion"><i class="ph ph-handshake"></i> Liquidación</button>
        </div>
        <p class="form-hint" id="tipo-hint"></p>
      </div>

      <div class="field"><label>Fecha</label><input class="input" type="date" id="f-fecha" value="${todayISO()}"></div>

      <div class="field"><label id="lab-payer">Quién paga</label>
        <div class="seg-full" id="seg-payer">
          <button type="button" data-payer="javi">${avatar('javi')} ${PEOPLE.javi.name}</button>
          <button type="button" data-payer="andrea">${avatar('andrea')} ${PEOPLE.andrea.name}</button>
        </div>
      </div>

      <div class="field" id="row-to" hidden><label>A quién se lo paga</label>
        <div class="seg-full" id="seg-to">
          <button type="button" data-to="javi">${avatar('javi')} ${PEOPLE.javi.name}</button>
          <button type="button" data-to="andrea">${avatar('andrea')} ${PEOPLE.andrea.name}</button>
        </div>
      </div>

      <div class="field" id="row-cat"><label>Categoría</label>
        <div class="chips" id="cat-chips"></div>
      </div>

      <div class="field"><label>Concepto</label>
        <input class="input" type="text" id="f-concepto" placeholder="p. ej. Cuota de junio" maxlength="48"></div>

      <div class="field"><label>Importe</label>
        <div class="amount-field"><input type="number" id="f-importe" placeholder="0" min="0" step="0.01" inputmode="decimal"><span class="cur">€</span></div></div>

      <button type="submit" class="btn-primary" id="btn-save"><i class="ph ph-check"></i> Guardar movimiento</button>
      <div style="height:10px"></div>
    </form>`;

  renderCatChips();
  syncFormUI();

  $('#seg-tipo').querySelectorAll('button').forEach(b=>b.onclick=()=>{ form.type=b.dataset.tipo; syncFormUI(); });
  $('#seg-payer').querySelectorAll('button').forEach(b=>b.onclick=()=>{ form.payer=b.dataset.payer;
    if(form.type==='liquidacion') form.to = form.payer==='javi'?'andrea':'javi'; syncFormUI(); });
  $('#seg-to').querySelectorAll('button').forEach(b=>b.onclick=()=>{ form.to=b.dataset.to;
    if(form.to===form.payer) form.payer = form.to==='javi'?'andrea':'javi'; syncFormUI(); });
  $('#form-add').onsubmit = onSaveMovement;
}
function renderCatChips(){
  $('#cat-chips').innerHTML = categories.map(c=>`<button type="button" class="cat-chip" data-cat="${c}"><i class="ph ${catIcon(c)}"></i>${c}</button>`).join('');
  $('#cat-chips').querySelectorAll('button').forEach(b=>b.onclick=()=>{ form.category=b.dataset.cat; syncFormUI(); });
}
function syncFormUI(){
  $('#tipo-hint').textContent = form.type==='aportacion'
    ? 'Dinero que uno pone para la casa.' : 'Un pago de uno al otro para cuadrar el balance.';
  $('#seg-tipo').querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.tipo===form.type));
  $('#lab-payer').textContent = form.type==='liquidacion' ? 'Quién paga' : 'Quién lo paga';
  $('#row-to').hidden = form.type!=='liquidacion';
  $('#row-cat').hidden = form.type!=='aportacion';
  $('#seg-payer').querySelectorAll('button').forEach(b=>{
    const on=b.dataset.payer===form.payer; b.className=''; if(on) b.classList.add('on', b.dataset.payer==='javi'?'pj':'pa'); });
  $('#seg-to').querySelectorAll('button').forEach(b=>{
    const on=b.dataset.to===form.to; b.className=''; if(on) b.classList.add('on', b.dataset.to==='javi'?'pj':'pa'); });
  $('#cat-chips').querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.cat===form.category));
  $('#btn-save').innerHTML = form.editId
    ? '<i class="ph ph-check"></i> Guardar cambios' : '<i class="ph ph-check"></i> Guardar movimiento';
}
function onSaveMovement(e){
  e.preventDefault();
  const concept = $('#f-concepto').value.trim();
  const amount = parseFloat($('#f-importe').value);
  const date = $('#f-fecha').value || todayISO();
  if(!concept){ shake('#f-concepto'); return; }
  if(!amount || amount<=0){ shake('.amount-field'); return; }
  if(form.editId){
    const m = movements.find(x=>x.id===form.editId);
    m.type=form.type; m.date=date; m.payer=form.payer; m.concept=concept; m.amount=amount;
    if(form.type==='aportacion'){ m.category=form.category; delete m.to; } else { m.to=form.to; delete m.category; }
    toast('Movimiento actualizado');
  } else {
    const m = { id:newId(), type:form.type, date, payer:form.payer, concept, amount };
    if(form.type==='aportacion') m.category=form.category; else m.to=form.to;
    movements.push(m);
    toast(form.type==='aportacion'?'Aportación apuntada':'Liquidación apuntada');
  }
  save();
  form = { type:'aportacion', payer:'javi', to:'andrea', category:'Cuota cooperativa', editId:null };
  renderAnadir(); renderResumen(); renderMovimientos(); renderAppbar('movimientos');
  switchTab('movimientos');
}
function startLiquidacion(owe){
  form = { type:'liquidacion', payer:owe?owe.from:'andrea', to:owe?owe.to:'javi', category:'Cuota cooperativa', editId:null };
  renderAnadir();
  $('#f-concepto').value = 'Liquidación de saldo';
  $('#f-importe').value = owe?owe.amount:'';
  switchTab('anadir');
}
function editMovement(id){
  const m = movements.find(x=>x.id===id); if(!m) return;
  form = { type:m.type, payer:m.payer, to:m.to||'javi', category:m.category||'Cuota cooperativa', editId:id };
  renderAnadir();
  $('#f-concepto').value = m.concept;
  $('#f-importe').value = m.amount;
  $('#f-fecha').value = m.date;
  closeSheet(); switchTab('anadir');
}

/* ============================================================
   MOVIMIENTOS
   ============================================================ */
let filt = { person:'todos', cat:'todas' };
function renderMovimientos(){
  let list = sortedMovs();
  if(filt.person!=='todos') list = list.filter(m=> m.payer===filt.person || m.to===filt.person);
  if(filt.cat==='liquidaciones') list = list.filter(m=>m.type==='liquidacion');
  else if(filt.cat!=='todas') list = list.filter(m=> m.type==='aportacion' && m.category===filt.cat);

  const total = list.reduce((s,m)=>s+m.amount,0);

  // group by month
  const groups={};
  list.forEach(m=>{ const k=m.date.slice(0,7); (groups[k]=groups[k]||[]).push(m); });
  const keys = Object.keys(groups).sort().reverse();
  const groupHTML = keys.length ? keys.map(k=>{
    const [y,mo]=k.split('-'); const sub = groups[k].reduce((s,m)=>s+m.amount,0);
    return `<div class="mes-head"><span>${MES_L[parseInt(mo)-1].replace(/^./,c=>c.toUpperCase())} ${y}</span><span class="s tnum">${eur(sub)}</span></div>
      <div class="mov-card">${groups[k].map(movRow).join('')}</div>`;
  }).join('') : `<div class="empty"><i class="ph ph-tray"></i><p>No hay movimientos con estos filtros.</p></div>`;

  const catChips = ['todas','liquidaciones',...categories];
  $('#s-movimientos').innerHTML = `
    <div class="filters" style="margin-top:6px">
      <div class="seg-full" id="filt-person" style="margin-bottom:10px">
        <button type="button" data-p="todos">Todos</button>
        <button type="button" data-p="javi">${PEOPLE.javi.name}</button>
        <button type="button" data-p="andrea">${PEOPLE.andrea.name}</button>
      </div>
      <div class="chips" id="filt-cat">
        ${catChips.map(c=>{
          const label = c==='todas'?'Todas':c==='liquidaciones'?'Liquidaciones':c;
          const ic = c==='todas'?'':c==='liquidaciones'?'<i class="ph ph-handshake"></i>':`<i class="ph ${catIcon(c)}"></i>`;
          return `<button class="chip" data-c="${c}">${ic}${label}</button>`;}).join('')}
      </div>
    </div>
    <div class="mov-summary"><span class="n">${list.length} ${list.length===1?'movimiento':'movimientos'}</span><span class="v tnum">${eur(total)}</span></div>
    ${groupHTML}
    <div style="height:8px"></div>`;

  $('#filt-person').querySelectorAll('button').forEach(b=>{
    b.className='';
    if(b.dataset.p===filt.person){ b.classList.add('on'); if(b.dataset.p==='javi') b.classList.add('pj'); else if(b.dataset.p==='andrea') b.classList.add('pa'); }
    b.onclick=()=>{ filt.person=b.dataset.p; renderMovimientos(); };
  });
  $('#filt-cat').querySelectorAll('button').forEach(b=>{
    const on=b.dataset.c===filt.cat; b.classList.toggle('on',on);
    b.onclick=()=>{ filt.cat=b.dataset.c; renderMovimientos(); };
  });
  bindMovRows($('#s-movimientos'));
}

/* ============================================================
   HIPOTECA (pestaña propia: estimación + parámetros)
   ============================================================ */
function renderHipoteca(){
  const s = stats();
  const mgVal = k => { const v = settings.mortgage ? settings.mortgage[k] : null; return (v==null || v==='') ? '' : v; };
  if(!priceHistory.length){
    $('#s-hipoteca').innerHTML = `
      <div class="card" style="text-align:center;padding:36px 22px;margin-top:8px">
        <div class="house-icon" style="margin:0 auto 12px;width:60px;height:60px;border-radius:18px;font-size:30px"><i class="ph-fill ph-bank"></i></div>
        <h2 class="serif" style="font-size:24px;margin:0 0 6px">Aún no hay precio</h2>
        <p class="muted" style="max-width:280px;margin:0 auto">Fijad primero el precio de la casa para estimar la hipoteca y el gasto mensual.</p>
        <button class="hero-cta" data-action="ir-precio" style="margin-top:16px"><i class="ph ph-house-line"></i> Ir a Ajustes</button>
      </div>`;
    const ip=$('#s-hipoteca [data-action="ir-precio"]'); if(ip) ip.onclick=()=>switchTab('ajustes');
    return;
  }
  const gastoRow = (ic,label,val)=>`<div class="row-between" style="padding:8px 0"><span style="display:flex;align-items:center;gap:9px;font-weight:600"><i class="ph ${ic}" style="color:var(--ink2)"></i>${label}</span><span class="tnum" style="font-weight:800">${eur(val)}</span></div>`;
  const detRow = (label,val)=>`<div class="row-between" style="padding:6px 0"><span class="muted" style="font-size:13px">${label}</span><span class="tnum" style="font-weight:700;font-size:13.5px;color:var(--ink)">${val}</span></div>`;
  const result = s.hasMortgage ? `
    <div class="card">
      <div class="row-between" style="align-items:flex-start">
        <div>
          <div class="eyebrow">Gasto mensual estimado</div>
          <div class="house-price serif tnum" style="font-size:42px">${eur(s.monthlyTotal)}</div>
          <div class="muted" style="margin-top:2px">al mes entre los dos</div>
        </div>
        <div class="house-icon"><i class="ph-fill ph-bank"></i></div>
      </div>
      <div style="margin-top:12px;border-top:1px solid var(--line-soft);padding-top:6px">
        ${gastoRow('ph-bank','Hipoteca', s.monthlyMortgage)}
        ${s.community?gastoRow('ph-buildings','Comunidad', s.community):''}
        ${s.insurance?gastoRow('ph-shield-check','Seguros (hogar + vida)', s.insurance):''}
        ${s.ibiMonthly?gastoRow('ph-receipt','IBI (mensualizado)', s.ibiMonthly):''}
      </div>
      <div class="split-legend" style="margin-top:6px;border-top:1px solid var(--line-soft);padding-top:12px">
        <span><span class="dot" style="background:var(--javi)"></span>${PEOPLE.javi.name} <b>${eur(s.monthlyByPerson.javi)}</b>/mes</span>
        <span><b>${eur(s.monthlyByPerson.andrea)}</b>/mes ${PEOPLE.andrea.name} <span class="dot" style="background:var(--andrea)"></span></span>
      </div>
      <div class="eyebrow" style="margin-top:16px">Detalle del préstamo</div>
      <div style="margin-top:4px">
        ${detRow('Precio de la vivienda', eur(s.priceNow))}
        ${detRow('Ya aportado', '− '+eur(s.totalAport))}
        ${s.downExtra?detRow('Entrada al firmar', '− '+eur(s.downExtra)):''}
        <div style="border-top:1px solid var(--line-soft);margin-top:2px;padding-top:2px">${detRow('Capital a financiar', eur(s.financed))}</div>
        ${detRow('Interés (TIN)', String(s.interest).replace('.',',')+' %')}
        ${detRow('Plazo', s.years+' años')}
        ${detRow('Intereses totales', '≈ '+eur(s.totalInterest))}
      </div>
    </div>` : `
    <div class="card" style="text-align:center;padding:24px 20px">
      <div class="house-icon" style="margin:0 auto 12px"><i class="ph-fill ph-bank"></i></div>
      <div class="muted">Rellenad la entrada, el tipo de interés y los años para ver vuestra cuota y el gasto mensual.</div>
    </div>`;
  const amortCard = s.hasMortgage ? `
    <div class="sec-title serif">Intereses vs. capital por año</div>
    <div class="card">
      <div class="chart-head">
        <div class="legend-people">
          <span><span class="dot" style="background:#C16544"></span>Intereses</span>
          <span><span class="dot" style="background:#2E6B5E"></span>Capital</span>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chart-amort"></canvas></div>
      <div class="chart-cap"><i class="ph ph-trend-down" style="color:var(--javi)"></i> Al principio cada cuota es casi toda intereses; con los años amortizáis cada vez más capital.</div>
    </div>` : '';
  $('#s-hipoteca').innerHTML = `
    <div style="height:6px"></div>
    ${result}
    ${amortCard}
    <div class="sec-title serif">Parámetros</div>
    <div class="set-card" style="padding:16px">
      <div class="gh-field"><label><i class="ph ph-coins"></i> Entrada extra al firmar (€)</label><input id="mg-down" type="number" inputmode="numeric" placeholder="0 — además de lo aportado" value="${mgVal('down')}"></div>
      <div class="gh-field"><label><i class="ph ph-percent"></i> Tipo de interés anual — TIN (%)</label><input id="mg-interest" type="number" inputmode="decimal" step="0.01" placeholder="p. ej. 2,9" value="${mgVal('interest')}"></div>
      <div class="gh-field"><label><i class="ph ph-calendar-blank"></i> Plazo (años)</label><input id="mg-years" type="number" inputmode="numeric" placeholder="p. ej. 30" value="${mgVal('years')}"></div>
      <div class="gh-field"><label><i class="ph ph-buildings"></i> Comunidad (€/mes)</label><input id="mg-community" type="number" inputmode="decimal" placeholder="0" value="${mgVal('community')}"></div>
      <div class="gh-field"><label><i class="ph ph-shield-check"></i> Seguros: hogar + vida (€/mes)</label><input id="mg-insurance" type="number" inputmode="decimal" placeholder="0" value="${mgVal('insurance')}"></div>
      <div class="gh-field"><label><i class="ph ph-receipt"></i> IBI (€/año)</label><input id="mg-ibi" type="number" inputmode="decimal" placeholder="0" value="${mgVal('ibi')}"></div>
      <p class="set-note">El <b>capital a financiar</b> = precio − lo aportado (${eur(s.totalAport)}) − entrada. La <b>entrada</b> es el dinero extra que pongáis al firmar, sobre lo que ya queda. Cuota por sistema francés (constante); el reparto sigue el objetivo de Ajustes.</p>
    </div>
    <div style="height:8px"></div>`;
  const mgBind=(id,key)=>{ const el=$('#'+id); if(!el) return; el.onchange=()=>{
    settings.mortgage = settings.mortgage || {};
    const v = el.value.trim();
    settings.mortgage[key] = (v==='') ? null : Number(v);
    save(); renderHipoteca(); }; };
  mgBind('mg-down','down'); mgBind('mg-interest','interest'); mgBind('mg-years','years');
  mgBind('mg-community','community'); mgBind('mg-insurance','insurance'); mgBind('mg-ibi','ibi');
  requestAnimationFrame(buildAmort);
}

let amortChart=null;
function buildAmort(){
  const c = document.getElementById('chart-amort'); if(!c) return;
  if(amortChart) amortChart.destroy();
  const s = stats();
  if(!s.hasMortgage) return;
  const im = s.interest/100/12, M = s.monthlyMortgage, nm = s.years*12;
  let saldo = s.financed;
  const yInterest = new Array(s.years).fill(0), yPrincipal = new Array(s.years).fill(0), labels = [];
  for(let k=0;k<nm;k++){
    const interes = saldo*im;
    let capital = M - interes;
    if(capital>saldo) capital = saldo;   // ajuste de la última cuota
    saldo -= capital;
    const yr = Math.floor(k/12);
    if(yr<s.years){ yInterest[yr]+=interes; yPrincipal[yr]+=capital; }
  }
  for(let y=0;y<s.years;y++) labels.push(String(y+1));
  amortChart = new Chart(c,{ type:'bar',
    data:{ labels, datasets:[
      { label:'Intereses', data:yInterest.map(v=>Math.round(v)), backgroundColor:'#C16544', stack:'a', borderRadius:3, maxBarThickness:28 },
      { label:'Capital',   data:yPrincipal.map(v=>Math.round(v)), backgroundColor:'#2E6B5E', stack:'a', borderRadius:3, maxBarThickness:28 }
    ]},
    options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{ legend:{display:false},
        tooltip:{ backgroundColor:'#2B2521', padding:11, cornerRadius:10, titleFont:{family:'Hanken Grotesk',weight:'700'}, bodyFont:{family:'Hanken Grotesk'}, footerFont:{family:'Hanken Grotesk',weight:'700'},
          callbacks:{ title:(it)=>'Año '+it[0].label, label:(ctx)=>` ${ctx.dataset.label}: ${eur(ctx.raw)}`,
            footer:(it)=>'Pagado ese año: '+eur(it.reduce((a,x)=>a+x.raw,0)) } } },
      scales:{ x:{ stacked:true, grid:{display:false}, border:{display:false}, ticks:{color:'#A89A8C',font:{family:'Hanken Grotesk',size:10,weight:'600'}, maxTicksLimit:10, autoSkip:true} },
        y:{ stacked:true, grid:{color:'#F3ECE1'}, border:{display:false}, ticks:{color:'#A89A8C',font:{family:'Hanken Grotesk',size:10}, maxTicksLimit:5, callback:v=> v>=1000?(v/1000)+'k €':v+' €' } } } }
  });
}

/* ============================================================
   AJUSTES
   ============================================================ */
let priceEditIdx = null;   // índice de la revisión del precio en edición (o null)
function renderAjustes(){
  const s = stats();
  const pe = (priceEditIdx!=null && priceHistory[priceEditIdx]) ? priceHistory[priceEditIdx] : null;
  const aV = s.variance, aCls = aV>0?'up':aV<0?'down':'flat', aIc = aV>0?'ph-trend-up':aV<0?'ph-trend-down':'ph-minus';
  $('#s-ajustes').innerHTML = `
    <div class="sec-title serif" style="margin-top:10px">Personas</div>
    <div class="set-card">
      <div class="set-row"><span class="swatch" style="background:var(--javi)">${inicialDe('javi')}</span>
        <input class="name" id="name-javi" value="${PEOPLE.javi.name}" maxlength="18"></div>
      <div class="set-row"><span class="swatch" style="background:var(--andrea)">${inicialDe('andrea')}</span>
        <input class="name" id="name-andrea" value="${PEOPLE.andrea.name}" maxlength="18"></div>
    </div>

    <div class="sec-title serif">Reparto objetivo</div>
    <div class="set-card split-set">
      <div class="labels"><span style="color:var(--javi)">${PEOPLE.javi.name} <span id="lbl-j" class="tnum">${settings.targetJavi}%</span></span>
        <span style="color:var(--andrea)"><span id="lbl-a" class="tnum">${100-settings.targetJavi}%</span> ${PEOPLE.andrea.name}</span></div>
      <input type="range" min="0" max="100" step="5" value="${settings.targetJavi}" class="split-range" id="split-range">
      <p class="form-hint" style="margin-top:12px">Por defecto repartís al 50 / 50. Mueve el control si pactáis otra proporción.</p>
    </div>

    <div class="sec-title serif">Precio de la casa</div>
    <div class="set-card">
      <div class="price-head">
        <div><div class="price-head-lab">Precio actual</div><div class="price-head-val serif tnum">${eur(s.priceNow)}</div></div>
        <div class="var-chip ${aCls}" style="margin-top:4px"><i class="ph ${aIc}"></i> ${aV>=0?'+':'−'}${eur(Math.abs(aV))}</div>
      </div>
      <div class="price-rows" id="price-rows">${priceHistory.map((p,i)=>{ const delta=i>0?p.price-priceHistory[i-1].price:0;
        return `<div class="price-row"${priceEditIdx===i?' style="background:var(--javi-soft);border-radius:12px;padding-left:10px;padding-right:10px"':''}>
          <div class="pr-l"><div class="pr-note">${i===0?'Inicial pactado':p.note}</div><div class="pr-date">${fechaLarga(p.date)}</div></div>
          <div class="pr-r"><div class="pr-price tnum">${eur(p.price)}</div>${i>0?`<div class="pr-delta ${delta>=0?'up':'down'}">${delta>=0?'+':'−'}${eur(Math.abs(delta))}</div>`:''}</div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="pr-del" data-pedit="${i}" title="Editar"><i class="ph ph-pencil-simple"></i></button>
            ${i>0?`<button class="pr-del" data-pdel="${i}" title="Eliminar"><i class="ph ph-x"></i></button>`:''}
          </div>
        </div>`; }).join('')}</div>
      <div class="price-add">
        <input type="date" id="pr-date" class="pr-date-i" value="${pe?pe.date:todayISO()}">
        <input type="number" id="pr-amount" class="pr-amount-i" placeholder="Precio €" inputmode="numeric" value="${pe?pe.price:''}">
        <input type="text" id="pr-note" class="pr-note-i" placeholder="Motivo (p. ej. derrama placas)" maxlength="30" value="${pe?(pe.note||'').replace(/"/g,'&quot;'):''}">
        <button id="pr-add-btn" class="pr-add-btn"><i class="ph ${pe?'ph-check':'ph-plus'}"></i> ${pe?'Guardar cambios':'Añadir revisión del precio'}</button>
        ${pe?'<button id="pr-cancel-btn" class="pr-add-btn" style="background:var(--bg);color:var(--ink2)"><i class="ph ph-x"></i> Cancelar</button>':''}
      </div>
      <p class="set-note">El precio puede cambiar (derramas, ajustes de la cooperativa…). Cada revisión actualiza la desviación y la hipoteca estimada en el Resumen.</p>
    </div>

    <div class="sec-title serif">Categorías</div>
    <div class="set-card">
      <div class="set-cats" id="set-cats">${categories.map(c=>`<span class="set-cat"><i class="ph ${catIcon(c)}" style="color:${catColor(c)}"></i>${c}<button data-del="${c}"><i class="ph ph-x"></i></button></span>`).join('')}</div>
      <div class="add-cat"><input id="new-cat" placeholder="Nueva categoría" maxlength="24"><button id="add-cat-btn"><i class="ph ph-plus"></i></button></div>
    </div>

    <div class="sec-title serif">Cuenta y sincronización</div>
    <div class="set-card set-pad">
      <div class="acct-row"><i class="ph ph-user-circle"></i><span id="acct-email">${account||'—'}</span></div>
      <p id="sync-msg" class="sync-msg">${syncStatus||''}</p>
      <button class="btn-primary ghost" id="logout-btn" style="margin-top:10px;height:46px"><i class="ph ph-sign-out"></i> Cerrar sesión</button>
      <p class="set-note">Los cambios se guardan solos y aparecen al momento en el otro móvil. Sin conexión también funciona: se sube al volver la cobertura.</p>
    </div>

    <div class="sec-title serif">Copia de seguridad</div>
    <div class="set-card set-pad">
      <div class="backup-row">
        <button class="btn-primary ghost" id="exp-btn"><i class="ph ph-download-simple"></i> Exportar</button>
        <button class="btn-primary ghost" id="imp-btn"><i class="ph ph-upload-simple"></i> Importar</button>
      </div>
      <input type="file" id="imp-file" accept="application/json" hidden>
    </div>
    <div style="height:10px"></div>`;

  $('#name-javi').oninput = e=>{ PEOPLE.javi.name=e.target.value||'Javi'; save(); refreshAll(); };
  $('#name-andrea').oninput = e=>{ PEOPLE.andrea.name=e.target.value||'Andrea'; save(); refreshAll(); };
  const range=$('#split-range');
  paintRange(range);
  range.oninput=()=>{ settings.targetJavi=parseInt(range.value);
    $('#lbl-j').textContent=settings.targetJavi+'%'; $('#lbl-a').textContent=(100-settings.targetJavi)+'%';
    paintRange(range); save(); renderResumen(); };
  $('#set-cats').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
    if(categories.length<=1) return;
    categories=categories.filter(c=>c!==b.dataset.del);
    if(form.category===b.dataset.del) form.category=categories[0];
    save(); renderAjustes(); renderAnadir(); renderResumen(); toast('Categoría eliminada'); });
  $('#add-cat-btn').onclick=()=>{ const v=$('#new-cat').value.trim();
    if(v && !categories.includes(v)){ categories.push(v); save(); renderAjustes(); renderAnadir(); toast('Categoría añadida'); } };
  $('#price-rows').querySelectorAll('[data-pedit]').forEach(b=>b.onclick=()=>{
    priceEditIdx=parseInt(b.dataset.pedit); renderAjustes();
    const amt=$('#pr-amount'); if(amt&&amt.focus) amt.focus(); });
  $('#price-rows').querySelectorAll('[data-pdel]').forEach(b=>b.onclick=()=>{
    if(priceHistory.length<=1) return;
    const i=parseInt(b.dataset.pdel);
    priceHistory.splice(i,1);
    if(priceEditIdx===i) priceEditIdx=null; else if(priceEditIdx!=null && i<priceEditIdx) priceEditIdx--;
    save(); renderAjustes(); renderResumen(); toast('Revisión eliminada'); });
  $('#pr-add-btn').onclick=()=>{
    const d=$('#pr-date').value||todayISO();
    const a=parseFloat($('#pr-amount').value);
    const n=$('#pr-note').value.trim()||'Ajuste de precio';
    if(!a||a<=0){ shake('#pr-amount'); return; }
    if(priceEditIdx!=null && priceHistory[priceEditIdx]){ priceHistory[priceEditIdx]={date:d,price:a,note:n}; priceEditIdx=null; }
    else { priceHistory.push({date:d,price:a,note:n}); }
    priceHistory.sort((x,y)=> x.date<y.date?-1:x.date>y.date?1:0);
    save(); renderAjustes(); renderResumen(); toast(d?'Revisión guardada':'Precio actualizado'); };
  { const cb=$('#pr-cancel-btn'); if(cb) cb.onclick=()=>{ priceEditIdx=null; renderAjustes(); }; }
  $('#logout-btn').onclick=async()=>{ if(!confirm('¿Cerrar sesión en este móvil?')) return;
    if(window.HomeCloud) await window.HomeCloud.logout(); };
  $('#exp-btn').onclick=exportBackup;
  $('#imp-btn').onclick=()=>$('#imp-file').click();
  $('#imp-file').onchange=importBackup;
}
function paintRange(r){ const v=r.value;
  r.style.background=`linear-gradient(90deg, var(--javi) 0% ${v}%, var(--andrea) ${v}% 100%)`; }

function exportBackup(){
  const data=buildData();
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='home-copia-'+todayISO()+'.json'; a.click(); URL.revokeObjectURL(a.href);
  toast('Copia exportada');
}
function importBackup(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{ applyData(JSON.parse(r.result));
    save(); refreshAll(); renderAnadir(); renderAjustes(); toast('Copia importada');
  }catch(err){ toast('Archivo no válido'); } };
  r.readAsText(f); e.target.value='';
}

/* ============================================================
   BOTTOM SHEET (detalle / editar / eliminar)
   ============================================================ */
function bindMovRows(root){
  root.querySelectorAll('[data-mov]').forEach(b=>b.onclick=()=>openSheet(parseInt(b.dataset.mov)));
}
function openSheet(id){
  const m=movements.find(x=>x.id===id); if(!m) return;
  const back=$('#sheet-back'), sheet=$('#sheet');
  let icHTML, title, metaHTML, rows;
  if(m.type==='aportacion'){ const p=PEOPLE[m.payer];
    icHTML=`<span class="mov-ic" style="background:${p.soft};color:${p.color}"><i class="ph ${catIcon(m.category)}"></i></span>`;
    title=m.concept; metaHTML=`Aportación · ${m.category}`;
    rows=`<div class="r"><span class="k">Quién</span><span class="v">${avatar(m.payer)} ${p.name}</span></div>
          <div class="r"><span class="k">Categoría</span><span class="v">${m.category}</span></div>
          <div class="r"><span class="k">Fecha</span><span class="v">${fechaLarga(m.date)}</span></div>`;
  } else { const from=PEOPLE[m.payer], to=PEOPLE[m.to];
    icHTML=`<span class="mov-ic liq-ic"><i class="ph ph-handshake"></i></span>`;
    title=m.concept; metaHTML='Liquidación entre vosotros';
    rows=`<div class="r"><span class="k">Paga</span><span class="v">${avatar(m.payer)} ${from.name}</span></div>
          <div class="r"><span class="k">Recibe</span><span class="v">${avatar(m.to)} ${to.name}</span></div>
          <div class="r"><span class="k">Fecha</span><span class="v">${fechaLarga(m.date)}</span></div>`;
  }
  sheet.innerHTML=`<div class="sheet-grab"></div>
    <div class="sheet-head">${icHTML}<div><div class="sheet-title">${title}</div><div class="sheet-meta">${metaHTML}</div></div></div>
    <div class="sheet-amt serif tnum" style="color:${m.type==='liquidacion'?'var(--andrea)':'var(--ink)'}">${eur(m.amount)}</div>
    <div class="sheet-rows">${rows}</div>
    <div class="sheet-actions">
      <button class="edit" data-edit="${m.id}"><i class="ph ph-pencil-simple"></i> Editar</button>
      <button class="del" data-del="${m.id}"><i class="ph ph-trash"></i> Eliminar</button>
    </div>`;
  sheet.querySelector('[data-edit]').onclick=()=>editMovement(m.id);
  sheet.querySelector('[data-del]').onclick=()=>{ deleteMovement(m.id); };
  back.classList.add('show');
}
function closeSheet(){ $('#sheet-back').classList.remove('show'); }
function deleteMovement(id){
  movements=movements.filter(m=>m.id!==id);
  save(); closeSheet(); refreshAll(); toast('Movimiento eliminado');
}

/* ============================================================
   NAV / TOAST / util
   ============================================================ */
function switchTab(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $('#s-'+name).classList.add('active');
  document.querySelectorAll('.tab').forEach(t=>{
    const on=t.dataset.tab===name; t.classList.toggle('on',on);
    t.querySelector('i').className = on
      ? 'ph-fill '+({resumen:'ph-house',anadir:'ph-plus-circle',movimientos:'ph-arrows-left-right',hipoteca:'ph-bank',ajustes:'ph-gear-six'}[name])
      : 'ph '+({resumen:'ph-house',anadir:'ph-plus-circle',movimientos:'ph-arrows-left-right',hipoteca:'ph-bank',ajustes:'ph-gear-six'}[t.dataset.tab]);
  });
  renderAppbar(name);
  $('#main').scrollTop=0;
}
let toastTimer;
function toast(msg){
  const t=$('#toast'); t.innerHTML=`<i class="ph-fill ph-check-circle"></i> ${msg}`;
  t.classList.add('show'); clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),2200);
}
function shake(sel){ const el=$(sel); if(!el)return;
  el.animate([{transform:'translateX(0)'},{transform:'translateX(-6px)'},{transform:'translateX(6px)'},{transform:'translateX(0)'}],{duration:280});
  el.style.borderColor='var(--andrea)'; setTimeout(()=>el.style.borderColor='',900);
}
function refreshAll(){ renderResumen(); renderMovimientos(); renderHipoteca(); renderAppbar(document.querySelector('.tab.on').dataset.tab); }

/* ---------------- init ---------------- */
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  const name=t.dataset.tab;
  if(name==='anadir' && !form.editId){ form={type:'aportacion',payer:'javi',to:'andrea',category:'Cuota cooperativa',editId:null}; renderAnadir(); }
  if(name==='hipoteca') renderHipoteca();
  switchTab(name);
});
$('#sheet-back').onclick=(e)=>{ if(e.target===$('#sheet-back')) closeSheet(); };

/* ============================================================
   PERSISTENCIA (caché local) + SINCRONIZACIÓN (Firebase, ver cloud.js)
   ============================================================ */
let account = null, syncStatus = '';

function buildData(){
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    people: { javi:{name:PEOPLE.javi.name}, andrea:{name:PEOPLE.andrea.name} },
    settings: { targetJavi: settings.targetJavi, mortgage: settings.mortgage || null },
    priceHistory, categories, movements, nextId
  };
}
function personName(v, def){ return (v && typeof v==='object') ? (v.name||def) : (typeof v==='string'? v : def); }
function applyData(d){
  if(!d) return;
  if(d.people){ PEOPLE.javi.name=personName(d.people.javi,'Persona A'); PEOPLE.andrea.name=personName(d.people.andrea,'Persona B'); }
  if(d.settings){
    if(d.settings.targetJavi!=null) settings.targetJavi=d.settings.targetJavi;
    settings.mortgage = Object.assign({down:null,interest:null,years:null,community:0,insurance:0,ibi:0}, d.settings.mortgage||{});
  }
  priceHistory = Array.isArray(d.priceHistory) ? d.priceHistory.slice() : [];
  categories = (Array.isArray(d.categories) && d.categories.length) ? d.categories.slice() : DEFAULT_CATS.slice();
  movements = Array.isArray(d.movements) ? d.movements.slice() : (Array.isArray(d.movimientos) ? d.movimientos.slice() : []);
  movements.forEach(m=>{ m.id=+m.id; });
  nextId = d.nextId || (movements.length ? Math.max(99, ...movements.map(m=>+m.id||0))+1 : 100);
}
// Id único entre móviles (milisegundos + azar): dos altas a la vez nunca chocan.
function newId(){ return Date.now()*1000 + Math.floor(Math.random()*1000); }
function persistLocal(){ try{ localStorage.setItem(LS_CACHE, JSON.stringify(buildData())); }catch(e){} }
function readJSON(k){ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch(e){ return null; } }
function load(){ const d=readJSON(LS_CACHE)||readJSON(LS_LEGACY); if(d) applyData(d); }
function save(){ persistLocal(); if(window.HomeCloud) window.HomeCloud.save(buildData()); }
function setSyncStatus(txt){ syncStatus=txt; const el=$('#sync-msg'); if(el) el.textContent=txt; }

/* ---------------- pantalla de acceso ---------------- */
function showLogin(on){
  let el=$('#login');
  if(!on){ if(el) el.remove(); return; }
  if(el) return;
  el=document.createElement('div'); el.id='login'; el.className='login';
  el.innerHTML=`<div class="login-card">
    <div class="login-ic"><i class="ph-fill ph-house"></i></div>
    <h1 class="serif">Home</h1>
    <p class="login-sub">Entra con tu correo para ver y guardar los datos de la casa.</p>
    <form id="login-form" autocomplete="on">
      <input id="lg-email" type="email" placeholder="Correo" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
      <input id="lg-pass" type="password" placeholder="Contraseña" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required>
      <button class="btn-primary" type="submit" id="lg-btn"><i class="ph ph-sign-in"></i> Entrar</button>
    </form>
    <button class="login-link" id="lg-reset">¿Olvidaste la contraseña?</button>
    <p class="login-msg" id="lg-msg"></p>
  </div>`;
  document.body.appendChild(el);
  const msg=t=>{ $('#lg-msg').textContent=t; };
  $('#login-form').onsubmit=async e=>{ e.preventDefault();
    if(!window.HomeCloud){ msg('Cargando… vuelve a intentarlo.'); return; }
    $('#lg-btn').disabled=true; msg('Entrando…');
    try{ await window.HomeCloud.login($('#lg-email').value.trim(), $('#lg-pass').value); }
    catch(err){ msg(/invalid|wrong|not-found|credential/.test(err.code||'')?'Correo o contraseña incorrectos. Si no la recuerdas, pulsa «¿Olvidaste la contraseña?».':
      err.code==='auth/network-request-failed'?'Sin conexión. Prueba de nuevo.':'No se pudo entrar ('+(err.code||err.message)+').'); }
    finally{ const b=$('#lg-btn'); if(b) b.disabled=false; }
  };
  $('#lg-reset').onclick=async()=>{ const em=$('#lg-email').value.trim();
    if(!em){ msg('Escribe tu correo arriba y vuelve a pulsar.'); return; }
    try{ await window.HomeCloud.reset(em); msg('Te hemos enviado un correo para crear una contraseña nueva (mira también en spam).'); }
    catch(err){ msg('No se pudo enviar ('+(err.code||err.message)+').'); }
  };
}

/* ---------------- puente con cloud.js ---------------- */
window.HomeApp = {
  toast: t=>toast(t),
  setSyncStatus,
  showLogin,
  newId,
  setAccount(email){ account=email; const el=$('#acct-email'); if(el) el.textContent=email; },
  legacyData(){ return readJSON(LS_LEGACY); },
  legacyDone(){ LEGACY_KEYS.forEach(k=>localStorage.removeItem(k)); },
  applyRemote(d){
    const sig=()=>{ const b=buildData(); delete b.updatedAt; delete b.nextId; return JSON.stringify(b); };
    const before=sig(), catsBefore=JSON.stringify(categories);
    applyData(d);
    if(sig()===before) return;          // eco de nuestro propio cambio: nada que repintar
    persistLocal();
    // No repintar la pantalla donde alguien está escribiendo (perdería el cursor).
    const ae=document.activeElement, typing=ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName);
    const busy=id=>typing && $('#'+id).contains(ae);
    if(!busy('s-resumen')) renderResumen();
    if(!busy('s-movimientos')) renderMovimientos();
    if(!busy('s-hipoteca')) renderHipoteca();
    if(JSON.stringify(categories)!==catsBefore && !busy('s-anadir')) renderAnadir();   // si no, no borramos lo que estés tecleando
    if(!busy('s-ajustes')) renderAjustes();
    renderAppbar(document.querySelector('.tab.on').dataset.tab);
  },
  cloudReady(){}
};

/* ---------------- arranque ---------------- */
load();
renderAppbar('resumen');
renderResumen();
renderAnadir();
renderMovimientos();
renderHipoteca();
renderAjustes();
if('serviceWorker' in navigator){
  const hadController = !!navigator.serviceWorker.controller;   // ya había una versión instalada
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{
    if(refreshing) return; refreshing = true;
    if(hadController) location.reload();   // hay versión nueva activa → recarga sola (no en la 1ª instalación)
  });
  const reg = navigator.serviceWorker.register('./sw.js');
  reg.then(r=>{ if(r){ r.update(); setInterval(()=>r.update(), 60*60*1000); } }).catch(()=>{});
}
