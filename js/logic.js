// Lógica pura (sin DOM ni red): quincenas, cuotas, atraso y formato.
// Todas las fechas son strings 'YYYY-MM-DD'.

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const diasDelMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function esFechaISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= diasDelMes(y, m);
}

export function hoyISO(now = new Date()) {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Fechas límite: quincenas (15 y último día) en (inicio, meta]; la meta se agrega si no es quincena. */
export function quincenaDates(inicio, meta) {
  if (meta <= inicio) return [meta];
  const [y0, m0] = inicio.split('-').map(Number);
  const [y1, m1] = meta.split('-').map(Number);
  const out = [];
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, (m = 1)) : m++) {
    for (const d of [15, diasDelMes(y, m)]) {
      const f = iso(y, m, d);
      if (f > inicio && f <= meta) out.push(f);
    }
  }
  if (out[out.length - 1] !== meta) out.push(meta);
  return out;
}

/**
 * Estado de una deuda frente a su meta.
 * @param deuda {valor, fecha_inicio, fecha_meta}
 * @param pagado total abonado hasta hoy
 */
export function planDeuda(deuda, pagado, hoy) {
  const valor = Number(deuda.valor);
  const pag = Math.max(0, Number(pagado) || 0);
  const fechas = quincenaDates(deuda.fecha_inicio, deuda.fecha_meta);
  const cuotas = fechas.length;
  const cuota = Math.round(valor / cuotas);
  const vencidas = fechas.filter((f) => f <= hoy).length;
  const esperado = vencidas === cuotas ? valor : Math.round((valor * vencidas) / cuotas);
  const pct = valor > 0 ? Math.min(100, Math.floor((pag / valor) * 100)) : 100;
  const proximaFecha = fechas.find((f) => f > hoy) ?? null;
  const base = { cuotas, cuota, esperado, pagado: pag, pct, fechas, proximaFecha };

  if (pag >= valor) {
    return { ...base, estado: 'completada', diferencia: pag - esperado, atraso: 0, atrasoCuotas: 0, paraProxima: 0 };
  }
  const diferencia = pag - esperado;
  const idx = proximaFecha ? fechas.indexOf(proximaFecha) + 1 : cuotas;
  const acumProxima = idx === cuotas ? valor : Math.round((valor * idx) / cuotas);
  const paraProxima = Math.max(0, acumProxima - pag);
  if (diferencia >= 0) {
    return { ...base, estado: 'al_dia', diferencia, atraso: 0, atrasoCuotas: 0, paraProxima };
  }
  const atraso = -diferencia;
  return {
    ...base,
    estado: 'atrasada',
    diferencia,
    atraso,
    atrasoCuotas: Math.round((atraso / (valor / cuotas)) * 10) / 10,
    paraProxima,
  };
}

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const formatCOP = (n) => cop.format(Math.round(Number(n) || 0));

export function formatFecha(f) {
  if (!f) return '—';
  const [y, m, d] = f.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : 'numeric' })
    .format(new Date(y, m - 1, d));
}

/** Resumen global para Inicio. deudas: [{...deuda, pagado}] */
export function resumenGlobal(deudas, hoy) {
  let total = 0, pagado = 0, atraso = 0;
  for (const d of deudas) {
    const p = planDeuda(d, d.pagado, hoy);
    total += Number(d.valor);
    pagado += Math.min(p.pagado, Number(d.valor));
    atraso += p.atraso;
  }
  return { total, pct: total > 0 ? Math.min(100, Math.floor((pagado / total) * 100)) : 0, atraso };
}
