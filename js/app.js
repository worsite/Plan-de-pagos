import { api, mensajeError, ApiError } from './api.js';
import { planDeuda, resumenGlobal, formatCOP, formatFecha, hoyISO, esFechaISO } from './logic.js';

/* ---------- Utilidades ---------- */
const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* noop */ } },
};
const digits = (s) => Number(String(s ?? '').replace(/\D/g, '')) || 0;
const fmtNum = (n) => (n ? new Intl.NumberFormat('es-CO').format(n) : '');
const nf1 = (n) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(n);
const fechaHora = (iso) => new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  home: I('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  debts: I('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M7 15h4"/>'),
  send: I('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  target: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  refresh: I('<path d="M20 11a8 8 0 0 0-14-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4l2-2"/><path d="M20 20v-5h-5"/>'),
  logout: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
  eye: I('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  wallet: I('<path d="M20 7H5a2 2 0 0 1 0-4h13v4z"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><circle cx="16.5" cy="14" r="1.2"/>'),
};
const LOGO = `<svg class="logo" viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" rx="24" fill="#DDF3E8"/><circle cx="48" cy="48" r="26" fill="none" stroke="#B9E4CF" stroke-width="10"/><path d="M48 22a26 26 0 0 1 24.7 18" fill="none" stroke="#277A58" stroke-width="10" stroke-linecap="round"/><path d="M40 49l6 6 12-13" fill="none" stroke="#277A58" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let toastTimer;
function toast(msg, actionLabel, onAction, ms = 6000) {
  clearTimeout(toastTimer);
  $toast.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button type="button" id="toast-act">${esc(actionLabel)}</button>` : ''}`;
  $toast.hidden = false;
  if (actionLabel) document.getElementById('toast-act').onclick = () => { $toast.hidden = true; onAction?.(); };
  toastTimer = setTimeout(() => ($toast.hidden = true), ms);
}

/* ---------- Estado ---------- */
const state = {
  session: null,       // { token, rol }
  data: null,          // respuesta de app_datos
  tab: 'inicio',
  loading: false,
  loginRol: store.get('pdp.loginRol') || 'owner',
  loginError: '',
  sheet: null,         // { id? } formulario de deuda
  pay: { deudaId: null, monto: 0, llave: store.get('pdp.llave') || '', busy: false, error: '', done: null },
  hoy: hoyISO(),
};
try { state.session = JSON.parse(store.get('pdp.session') || 'null'); } catch { state.session = null; }

const deudas = () => (state.data?.deudas ?? []).map((d) => ({ ...d, valor: Number(d.valor), pagado: Number(d.pagado) }));
const planDe = (d) => planDeuda(d, d.pagado, state.hoy);

function cerrarSesionLocal(msg = '') {
  store.del('pdp.session');
  state.session = null; state.data = null; state.sheet = null; state.loginError = msg;
  render();
}

async function cargar({ silencioso = false } = {}) {
  if (!state.session) return;
  if (!silencioso) { state.loading = true; render(); }
  state.hoy = hoyISO();
  try {
    state.data = await api.datos(state.session.token);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'no_autorizado') return cerrarSesionLocal(mensajeError(e));
    if (!silencioso || !state.data) toast(mensajeError(e));
  } finally {
    state.loading = false;
    if (!state.sheet || !silencioso) render();
  }
}

/* ---------- Componentes ---------- */
function bar(pct, { thin = false, from = 0 } = {}) {
  return `<div class="bar ${thin ? 'thin' : ''} ${pct >= 100 ? 'done' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="--pct:${pct}%;--from:${from}%"></i></div>`;
}

function chipEstado(p, { detalle = false } = {}) {
  if (p.estado === 'completada') return `<span class="chip ok">${ICON.check}Pagada</span>`;
  if (p.estado === 'atrasada') return `<span class="chip late">${ICON.clock}${detalle ? `Atraso ${esc(formatCOP(p.atraso))}` : 'Con atraso'}</span>`;
  return `<span class="chip ok">${ICON.check}${p.diferencia > 0 ? 'Adelantado' : 'Al día'}</span>`;
}

function lineaCuota(p) {
  if (p.estado === 'completada') return '<span class="muted small">¡Deuda saldada!</span>';
  if (p.estado === 'atrasada') {
    return `<span class="small">Atraso de <b>${esc(formatCOP(p.atraso))}</b> (${nf1(p.atrasoCuotas)} ${p.atrasoCuotas === 1 ? 'cuota' : 'cuotas'}). Para ponerte al día: <b>${esc(formatCOP(p.atraso))}</b>.</span>`;
  }
  if (!p.proximaFecha) return '';
  return p.paraProxima > 0
    ? `<span class="small muted">Para la quincena del ${esc(formatFecha(p.proximaFecha))}: <b>${esc(formatCOP(p.paraProxima))}</b>.</span>`
    : `<span class="small muted">Ya cubriste lo de la quincena del ${esc(formatFecha(p.proximaFecha))}.</span>`;
}

const vacio = (msg, accion = '') => `<div class="empty">${ICON.wallet}<p>${esc(msg)}</p>${accion}</div>`;

/* ---------- Vistas: login ---------- */
function vistaLogin() {
  const admin = state.loginRol === 'admin';
  return `<main class="login"><form class="card" data-form="login" autocomplete="off">
    ${LOGO}
    <div><h1 class="title">Plan de Pagos</h1><p class="muted">${admin ? 'Vista de solo lectura' : 'Tus deudas, quincena a quincena'}</p></div>
    <div class="seg" role="group" aria-label="Perfil">
      <button type="button" data-act="rol" data-rol="owner" aria-pressed="${!admin}">Soy yo</button>
      <button type="button" data-act="rol" data-rol="admin" aria-pressed="${admin}">Admin</button>
    </div>
    <div class="field" style="text-align:left">
      <label for="clave">Contraseña</label>
      <input class="input" id="clave" name="clave" type="password" autocomplete="current-password" required autofocus>
      ${state.loginError ? `<p class="error" role="alert">${esc(state.loginError)}</p>` : '<p class="hint">Solo la primera vez: este dispositivo se acuerda de ti.</p>'}
    </div>
    <button class="btn block" type="submit">Entrar</button>
  </form></main>`;
}

/* ---------- Vistas: dueño ---------- */
function topbar(sub = '') {
  return `<header class="topbar"><div class="brand">${LOGO.replace('class="logo"', '')}<div><div>Plan de Pagos</div>${sub ? `<div class="small muted" style="font-weight:600">${sub}</div>` : ''}</div></div>
    <div class="row"><button class="icon-btn" data-act="refrescar" aria-label="Actualizar">${ICON.refresh}</button><button class="icon-btn" data-act="salir" aria-label="Cerrar sesión en este dispositivo">${ICON.logout}</button></div></header>`;
}

function vistaInicio() {
  const ds = deudas();
  const obj = ds.find((d) => d.es_objetivo);
  const g = resumenGlobal(ds, state.hoy);
  let hero;
  if (obj) {
    const p = planDe(obj);
    hero = `<section class="card hero stack" aria-labelledby="h-obj">
      <div class="row between"><h2 id="h-obj" style="margin:0">Deuda objetivo</h2><span class="chip goal">${ICON.target}Foco</span></div>
      <div class="title">${esc(obj.nombre)}</div>
      <div>${bar(p.pct)}<div class="row between" style="margin-top:8px"><span class="pct num">${p.pct}% completado</span>${chipEstado(p, { detalle: true })}</div></div>
      <div>${lineaCuota(p)}</div>
      ${p.estado !== 'completada' ? `<button class="btn block" data-act="pagar-a" data-id="${obj.id}">${ICON.send}Registrar un pago</button>` : ''}
    </section>`;
  } else {
    hero = `<section class="card hero"><h2>Deuda objetivo</h2>${vacio(ds.length ? 'Elige en Deudas cuál vas a atacar primero.' : 'Agrega tu primera deuda para empezar.', `<button class="btn" data-act="nueva">${ICON.plus}Agregar deuda</button>`)}</section>`;
  }
  const lista = ds.length
    ? `<div class="list">${ds.map((d) => {
        const p = planDe(d);
        return `<button class="linkish item" data-act="ir" data-tab="deudas"><div class="row between"><span class="name">${esc(d.nombre)}${d.es_objetivo ? ` <span class="chip goal">${ICON.target}Objetivo</span>` : ''}</span><span class="num"><b>${esc(formatCOP(d.valor))}</b></span></div>
          ${bar(p.pct, { thin: true })}<div class="row between"><span class="small muted">${p.pct}% pagado</span>${chipEstado(p)}</div></button>`;
      }).join('')}</div>`
    : '';
  const total = `<section class="card stack" aria-labelledby="h-tot">
    <h2 id="h-tot" style="margin:0">Total de deudas</h2>
    <div class="big num">${esc(formatCOP(g.total))}</div>
    ${ds.length ? `<div>${bar(g.pct, { thin: true })}<div class="small muted" style="margin-top:6px">${ds.length} ${ds.length === 1 ? 'deuda suma' : 'deudas suman'} este total · ${g.pct}% pagado</div></div>` : ''}
    ${lista}
  </section>`;
  return `${topbar(hoyLargo())}<div class="stack">${hero}${total}</div>`;
}

const hoyLargo = () => new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

function vistaDeudas() {
  const ds = deudas();
  const cards = ds.map((d) => {
    const p = planDe(d);
    return `<article class="card stack">
      <div class="row between"><div class="grow"><div class="title">${esc(d.nombre)}</div><div class="small muted">Meta: ${esc(formatFecha(d.fecha_meta))}</div></div>${chipEstado(p, { detalle: true })}</div>
      <div class="stat-grid"><div class="stat"><span class="small muted">Valor</span><b class="num">${esc(formatCOP(d.valor))}</b></div>
        <div class="stat"><span class="small muted">Cuota quincenal</span><b class="num">${esc(formatCOP(p.cuota))}</b></div></div>
      <div>${bar(p.pct)}<div class="row between" style="margin-top:6px"><span class="pct num">${p.pct}%</span><span class="small muted">${p.cuotas} ${p.cuotas === 1 ? 'quincena' : 'quincenas'} en total</span></div></div>
      <div>${lineaCuota(p)}</div>
      <div class="row">
        ${d.es_objetivo ? `<span class="chip goal">${ICON.target}Deuda objetivo</span>` : `<button class="btn soft sm" data-act="objetivo" data-id="${d.id}">${ICON.target}Hacer objetivo</button>`}
        <span class="grow"></span><button class="btn ghost sm" data-act="editar" data-id="${d.id}">Editar</button>
      </div></article>`;
  }).join('');
  return `${topbar('Mis deudas')}<div class="stack">
    <button class="btn block" data-act="nueva">${ICON.plus}Nueva deuda</button>
    ${cards || `<section class="card">${vacio('Aún no hay deudas registradas.')}</section>`}</div>`;
}

function vistaPagar() {
  const ds = deudas().filter((d) => planDe(d).estado !== 'completada');
  const pay = state.pay;
  if (pay.done) return vistaPagoHecho();
  if (!ds.some((d) => d.id === pay.deudaId)) pay.deudaId = (ds.find((d) => d.es_objetivo) ?? ds[0])?.id ?? null;
  const sel = ds.find((d) => d.id === pay.deudaId);
  const p = sel ? planDe(sel) : null;
  const llaves = (state.data?.llaves ?? []);
  const ultima = store.get('pdp.llave');
  const orden = [...llaves].sort((a, b) => (b.llave === ultima) - (a.llave === ultima));

  if (!ds.length) return `${topbar('Registrar pago')}<section class="card">${vacio('No tienes deudas pendientes por pagar.')}</section>`;
  return `${topbar('Registrar pago')}<form class="stack" data-form="pagar" autocomplete="off">
    <section class="card stack"><div class="lbl" style="font-weight:800">¿Qué deuda pagaste?</div>
      ${ds.map((d) => { const q = planDe(d); return `<button type="button" class="choice" data-act="elegir" data-id="${d.id}" aria-pressed="${d.id === pay.deudaId}">
        <div class="row between"><span class="name">${esc(d.nombre)}${d.es_objetivo ? ` <span class="chip goal">${ICON.target}Objetivo</span>` : ''}</span><span class="pct num">${q.pct}%</span></div>${bar(q.pct, { thin: true })}</button>`; }).join('')}
    </section>
    <section class="card stack">
      <div class="field"><label for="monto">Monto a abonar</label>
        <input class="input money num" id="monto" data-input="monto" inputmode="numeric" placeholder="$ 0" value="${pay.monto ? esc(fmtNum(pay.monto)) : ''}" required></div>
      <div class="chips-row" aria-label="Montos rápidos">
        <button type="button" class="pill" data-act="monto" data-v="${p.cuota}">Cuota ${esc(formatCOP(p.cuota))}</button>
        ${p.estado === 'atrasada' ? `<button type="button" class="pill" data-act="monto" data-v="${p.atraso}">Ponerme al día ${esc(formatCOP(p.atraso))}</button>` : ''}
      </div>
      <div class="field"><label for="llave">Llave a la que enviaste</label>
        <input class="input" id="llave" data-input="llave" value="${esc(pay.llave)}" placeholder="Ej. 3001234567 o @mi.llave" autocapitalize="off" required>
        ${orden.length ? `<div class="chips-row">${orden.map((l) => `<button type="button" class="pill" data-act="llave" data-v="${esc(l.llave)}" aria-pressed="${l.llave === pay.llave}">${esc(l.alias || l.llave)}</button>`).join('')}</div>` : '<p class="hint">Se guardará para la próxima vez.</p>'}
      </div>
      ${pay.error ? `<p class="error" role="alert">${esc(pay.error)}</p>` : ''}
      <button class="btn block" type="submit" ${pay.busy ? 'disabled' : ''}>${ICON.send}${pay.busy ? 'Enviando…' : 'Marcar como enviado'}</button>
    </section></form>`;
}

function vistaPagoHecho() {
  const d = state.pay.done;
  return `${topbar('Registrar pago')}<section class="card hero stack celebrate">
    <div class="chip ok" style="justify-self:start">${ICON.check}Pago registrado</div>
    <div class="title">${esc(d.nombre)}</div>
    ${bar(d.to, { from: d.from })}
    <div class="row between"><span class="pct num">${d.to}% completado</span>${d.to >= 100 ? '<span class="chip ok">¡Deuda saldada!</span>' : `<span class="chip info">+${d.to - d.from}%</span>`}</div>
    <div class="row"><button class="btn block" data-act="otro">Registrar otro pago</button></div>
    <button class="btn ghost block" data-act="deshacer" data-id="${esc(d.pagoId)}">Me equivoqué, deshacer</button>
  </section>`;
}

function navegacion() {
  const item = (tab, icon, txt) => `<button data-act="ir" data-tab="${tab}" ${state.tab === tab ? 'aria-current="page"' : ''}>${icon}<span>${txt}</span></button>`;
  return `<nav class="nav" aria-label="Principal"><div class="nav-inner">${item('inicio', ICON.home, 'Inicio')}${item('deudas', ICON.debts, 'Deudas')}${item('pagar', ICON.send, 'Pagar')}</div></nav>`;
}

/* ---------- Hoja: nueva / editar deuda ---------- */
function vistaSheet() {
  if (!state.sheet) return '';
  const ed = state.sheet.id ? deudas().find((d) => d.id === state.sheet.id) : null;
  const v = { nombre: ed?.nombre ?? '', valor: ed?.valor ?? 0, inicio: ed?.fecha_inicio ?? state.hoy, meta: ed?.fecha_meta ?? '' };
  return `<div class="scrim" data-act="cerrar-sheet-fondo"><form class="sheet stack" data-form="deuda" role="dialog" aria-modal="true" aria-label="${ed ? 'Editar deuda' : 'Nueva deuda'}" autocomplete="off">
    <div class="row between"><h2 class="title" style="margin:0;text-transform:none;letter-spacing:0;font-size:1.35rem;color:var(--ink)">${ed ? 'Editar deuda' : 'Nueva deuda'}</h2><button type="button" class="btn ghost sm" data-act="cerrar-sheet">Cerrar</button></div>
    <div class="field"><label for="d-nombre">Nombre</label><input class="input" id="d-nombre" name="nombre" maxlength="80" value="${esc(v.nombre)}" placeholder="Ej. Tarjeta, Moto, Préstamo" required></div>
    <div class="field"><label for="d-valor">Valor de la deuda</label><input class="input money num" id="d-valor" name="valor" inputmode="numeric" value="${v.valor ? esc(fmtNum(v.valor)) : ''}" placeholder="$ 0" required>
      <p class="hint">Lo que debes hoy.</p></div>
    <div class="field"><label for="d-meta">Fecha meta para terminar de pagarla</label><input class="input" id="d-meta" name="meta" type="date" value="${esc(v.meta)}" required></div>
    <details><summary class="hint" style="cursor:pointer;min-height:32px">Cambiar fecha de inicio</summary><div class="field" style="margin-top:8px"><label for="d-inicio">Fecha de inicio</label><input class="input" id="d-inicio" name="inicio" type="date" value="${esc(v.inicio)}" required></div></details>
    <div class="card" style="padding:14px;background:var(--mint-50);box-shadow:none"><div class="small muted">Cuota quincenal estimada</div><div class="big num" id="d-prev" style="font-size:1.6rem">—</div><div class="small muted" id="d-prev2">Pon el valor y la fecha meta.</div></div>
    <p class="error" id="d-err" role="alert" hidden></p>
    <button class="btn block" type="submit">${ed ? 'Guardar cambios' : 'Guardar deuda'}</button>
    ${ed ? `<button type="button" class="btn danger block" data-act="borrar" data-id="${ed.id}">Eliminar deuda</button>` : ''}
  </form></div>`;
}

function actualizarPreview(form) {
  const valor = digits(form.valor.value), meta = form.meta.value, inicio = form.inicio.value;
  const $p = document.getElementById('d-prev'), $p2 = document.getElementById('d-prev2');
  if (!valor || !esFechaISO(meta) || !esFechaISO(inicio)) { $p.textContent = '—'; $p2.textContent = 'Pon el valor y la fecha meta.'; return; }
  const p = planDeuda({ valor, fecha_inicio: inicio, fecha_meta: meta }, 0, '0000-00-00');
  $p.textContent = formatCOP(p.cuota);
  $p2.textContent = `${p.cuotas} ${p.cuotas === 1 ? 'quincena' : 'quincenas'} (días 15 y fin de mes) hasta el ${formatFecha(meta)}`;
}

/* ---------- Vista: admin (solo lectura) ---------- */
function vistaAdmin() {
  const ds = deudas();
  const dep = state.data?.depositos ?? [];
  const total = dep.reduce((s, x) => s + Number(x.monto), 0);
  const nu = dep.filter((x) => (x.banco || 'Nu') === 'Nu').reduce((s, x) => s + Number(x.monto), 0);
  const porLlave = new Map();
  for (const x of dep) {
    const k = x.llave; const r = porLlave.get(k) ?? { llave: k, banco: x.banco, total: 0, n: 0 };
    r.total += Number(x.monto); r.n++; porLlave.set(k, r);
  }
  const g = resumenGlobal(ds, state.hoy);
  return `<header class="topbar"><div class="brand">${LOGO.replace('class="logo"', '')}<div><div>Plan de Pagos</div><div class="small muted" style="font-weight:600">Admin · solo lectura</div></div></div>
    <div class="row"><button class="icon-btn" data-act="refrescar" aria-label="Actualizar">${ICON.refresh}</button><button class="icon-btn" data-act="salir" aria-label="Cerrar sesión en este dispositivo">${ICON.logout}</button></div></header>
    <div class="stack">
    <section class="card hero stack" aria-labelledby="a-nu"><div class="row between"><h2 id="a-nu" style="margin:0">Depositado en Nu</h2><span class="chip info">${ICON.eye}Solo ver</span></div>
      <div class="big num">${esc(formatCOP(nu))}</div>
      <div class="small muted">${dep.length} ${dep.length === 1 ? 'depósito' : 'depósitos'}${dep.length ? ` · último ${esc(fechaHora(dep[0].pagado_en))}` : ''}${total !== nu ? ` · Total en otros bancos: ${esc(formatCOP(total - nu))}` : ''}</div></section>
    <section class="card" aria-labelledby="a-ll"><h2 id="a-ll">Llave de destino</h2>
      ${porLlave.size ? `<div class="list">${[...porLlave.values()].map((r) => `<div class="item"><div class="row between"><span class="name num">${esc(r.llave)}</span><span class="chip info">${esc(r.banco || 'Nu')}</span></div><div class="row between"><span class="small muted">${r.n} ${r.n === 1 ? 'envío' : 'envíos'}</span><b class="num">${esc(formatCOP(r.total))}</b></div></div>`).join('')}</div>` : vacio('Aún no hay envíos.')}</section>
    <section class="card stack" aria-labelledby="a-de"><h2 id="a-de" style="margin:0">Deudas existentes</h2>
      <div class="stat-grid"><div class="stat"><span class="small muted">Total</span><b class="num">${esc(formatCOP(g.total))}</b></div><div class="stat"><span class="small muted">Avance</span><b class="num">${g.pct}%</b></div></div>
      ${ds.length ? `<div class="list">${ds.map((d) => { const p = planDe(d); return `<div class="item"><div class="row between"><span class="name">${esc(d.nombre)}${d.es_objetivo ? ` <span class="chip goal">${ICON.target}Objetivo</span>` : ''}</span>${chipEstado(p, { detalle: true })}</div>
        ${bar(p.pct, { thin: true })}<div class="row between"><span class="small num"><b>${esc(formatCOP(p.pagado))}</b> de ${esc(formatCOP(d.valor))}</span><span class="small muted">Meta ${esc(formatFecha(d.fecha_meta))}</span></div></div>`; }).join('')}</div>` : vacio('Sin deudas registradas.')}</section>
    <section class="card" aria-labelledby="a-hi"><h2 id="a-hi">Últimos depósitos</h2>
      ${dep.length ? `<div class="list">${dep.slice(0, 30).map((x) => `<div class="item"><div class="row between"><b class="num">${esc(formatCOP(x.monto))}</b><span class="small muted">${esc(fechaHora(x.pagado_en))}</span></div><div class="small muted">${esc(x.deuda)} → <span class="num">${esc(x.llave)}</span> · ${esc(x.banco || 'Nu')}</div></div>`).join('')}</div>` : vacio('Todavía no hay depósitos.')}</section>
    </div>`;
}

/* ---------- Render ---------- */
function render() {
  const s = state.session;
  if (!s) { $app.innerHTML = vistaLogin(); return; }
  if (state.loading && !state.data) { $app.innerHTML = `<div class="shell no-nav"><div class="loading"><div class="spin" role="status" aria-label="Cargando"></div></div></div>`; return; }
  if (s.rol === 'admin') { $app.innerHTML = `<div class="shell no-nav">${vistaAdmin()}</div>`; return; }
  const vista = { inicio: vistaInicio, deudas: vistaDeudas, pagar: vistaPagar }[state.tab]();
  $app.innerHTML = `<div class="shell">${vista}</div>${navegacion()}${vistaSheet()}`;
}

/* ---------- Acciones ---------- */
const token = () => state.session?.token;
async function conToken(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return { ok: true, r };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'no_autorizado') { cerrarSesionLocal(mensajeError(e)); return { ok: false }; }
    return { ok: false, e };
  }
}

const acciones = {
  rol: (el) => { state.loginRol = el.dataset.rol; store.set('pdp.loginRol', state.loginRol); state.loginError = ''; render(); },
  ir: (el) => { state.tab = el.dataset.tab; state.pay.done = null; window.scrollTo(0, 0); render(); },
  refrescar: () => cargar(),
  salir: async () => { const t = token(); cerrarSesionLocal(); try { await api.logout(t); } catch { /* ya se cerró localmente */ } },
  nueva: () => { state.sheet = {}; render(); document.getElementById('d-nombre')?.focus(); },
  editar: (el) => { state.sheet = { id: el.dataset.id }; render(); actualizarPreview(document.querySelector('[data-form=deuda]')); },
  'cerrar-sheet': () => { state.sheet = null; render(); },
  'cerrar-sheet-fondo': (el, ev) => { if (ev.target === el) acciones['cerrar-sheet'](); },
  objetivo: async (el) => {
    const { ok, e } = await conToken(() => api.marcarObjetivo(token(), el.dataset.id), 'Deuda objetivo actualizada');
    if (!ok && e) return toast(mensajeError(e));
    if (ok) { state.tab = 'inicio'; await cargar({ silencioso: true }); }
  },
  borrar: async (el) => {
    if (el.dataset.seguro !== '1') { el.dataset.seguro = '1'; el.textContent = '¿Seguro? Toca otra vez para eliminar'; return; }
    const { ok, e } = await conToken(() => api.borrarDeuda(token(), el.dataset.id), 'Deuda eliminada');
    if (!ok && e) return toast(mensajeError(e));
    if (ok) { state.sheet = null; await cargar({ silencioso: true }); }
  },
  'pagar-a': (el) => { state.pay.deudaId = el.dataset.id; state.pay.done = null; state.tab = 'pagar'; render(); },
  elegir: (el) => { state.pay.deudaId = el.dataset.id; state.pay.error = ''; render(); },
  monto: (el) => { state.pay.monto = Number(el.dataset.v); render(); },
  llave: (el) => { state.pay.llave = el.dataset.v; render(); },
  otro: () => { state.pay.done = null; state.pay.monto = 0; render(); },
  deshacer: async (el) => {
    const { ok, e } = await conToken(() => api.deshacerPago(token(), el.dataset.id), 'Pago deshecho');
    if (!ok && e) return toast(mensajeError(e));
    if (ok) { state.pay.done = null; state.pay.monto = 0; await cargar({ silencioso: true }); }
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (el && acciones[el.dataset.act]) acciones[el.dataset.act](el, ev);
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.input === 'monto' || t.name === 'valor') {
    const n = digits(t.value); t.value = fmtNum(n);
    if (t.dataset.input === 'monto') state.pay.monto = n;
  } else if (t.dataset.input === 'llave') state.pay.llave = t.value;
  const form = t.closest('[data-form=deuda]');
  if (form) actualizarPreview(form);
});

document.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const tipo = form.dataset.form;
  if (tipo === 'login') return enviarLogin(form);
  if (tipo === 'deuda') return guardarDeuda(form);
  if (tipo === 'pagar') return enviarPago();
});

async function enviarLogin(form) {
  const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    const r = await api.login(state.loginRol, form.clave.value);
    if (!r?.ok) { state.loginError = mensajeError({ code: r?.error }); render(); return; }
    state.session = { token: r.token, rol: r.rol };
    store.set('pdp.session', JSON.stringify(state.session));
    state.loginError = '';
    await cargar();
  } catch (e) { state.loginError = mensajeError(e); render(); }
}

async function guardarDeuda(form) {
  const err = document.getElementById('d-err');
  const valor = digits(form.valor.value), nombre = form.nombre.value.trim();
  const meta = form.meta.value, inicio = form.inicio.value;
  const falla = (m) => { err.textContent = m; err.hidden = false; };
  if (!nombre) return falla('Ponle un nombre a la deuda.');
  if (!valor) return falla('Escribe el valor de la deuda.');
  if (!esFechaISO(meta) || !esFechaISO(inicio)) return falla('Revisa las fechas.');
  if (meta < inicio) return falla('La fecha meta debe ser posterior al inicio.');
  const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
  const { ok, e } = await conToken(() => api.guardarDeuda(token(), { id: state.sheet.id, nombre, valor, inicio, meta }), 'Deuda guardada');
  if (ok) { state.sheet = null; await cargar({ silencioso: true }); return; }
  btn.disabled = false; if (e) falla(mensajeError(e));
}

async function enviarPago() {
  const pay = state.pay;
  const d = deudas().find((x) => x.id === pay.deudaId);
  if (!d || pay.busy) return;
  pay.error = '';
  if (!pay.monto) { pay.error = mensajeError({ code: 'monto_invalido' }); return render(); }
  if (!pay.llave.trim()) { pay.error = mensajeError({ code: 'llave_requerida' }); return render(); }
  pay.busy = true; render();
  const antes = planDe(d).pct;
  const { ok, r, e } = await conToken(() => api.pagar(token(), { deuda: d.id, monto: pay.monto, llave: pay.llave.trim() }));
  pay.busy = false;
  if (!ok) { if (e) pay.error = mensajeError(e); return render(); }
  store.set('pdp.llave', pay.llave.trim());
  const despues = Math.min(100, Math.floor((Number(r.pagado) / Number(r.valor)) * 100));
  pay.done = { nombre: d.nombre, from: antes, to: despues, pagoId: r.id };
  pay.monto = 0;
  await cargar({ silencioso: true });
  toast('Pago marcado como enviado');
}

/* ---------- Arranque ---------- */
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.session) cargar({ silencioso: true }); });
setInterval(() => { if (state.session?.rol === 'admin' && !document.hidden) cargar({ silencioso: true }); }, 30000);
render();
if (state.session) cargar();
