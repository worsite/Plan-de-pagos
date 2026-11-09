import { CONFIG } from './config.js';

export class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const MENSAJES = {
  clave_incorrecta: 'Contraseña incorrecta.',
  bloqueado: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.',
  no_autorizado: 'Tu sesión terminó. Entra de nuevo.',
  solo_lectura: 'Este perfil es de solo lectura.',
  monto_excede_saldo: 'Ese monto es mayor a lo que falta por pagar de esta deuda.',
  monto_invalido: 'Escribe un monto mayor a cero.',
  llave_requerida: 'Escribe la llave a la que enviaste el dinero.',
  deuda_no_existe: 'Esa deuda ya no existe.',
  ya_no_se_puede_deshacer: 'Ya pasaron más de 10 minutos, no se puede deshacer.',
  sin_conexion: 'No hay conexión. Revisa tu internet.',
};
export const mensajeError = (e) => MENSAJES[e?.code] ?? 'Algo salió mal. Inténtalo de nuevo.';

async function rpc(fn, args = {}) {
  let res;
  try {
    res = await fetch(`${CONFIG.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: CONFIG.anonKey, Authorization: `Bearer ${CONFIG.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch {
    throw new ApiError('sin_conexion', 0);
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(body?.message ?? 'desconocido', res.status);
  return body;
}

export const api = {
  login: (rol, clave) => rpc('app_login', { p_rol: rol, p_clave: clave }),
  logout: (t) => rpc('app_cerrar_sesion', { p_token: t }),
  datos: (t) => rpc('app_datos', { p_token: t }),
  guardarDeuda: (t, d) =>
    rpc('app_guardar_deuda', { p_token: t, p_id: d.id ?? null, p_nombre: d.nombre, p_valor: d.valor, p_inicio: d.inicio, p_meta: d.meta }),
  borrarDeuda: (t, id) => rpc('app_borrar_deuda', { p_token: t, p_id: id }),
  marcarObjetivo: (t, id) => rpc('app_marcar_objetivo', { p_token: t, p_id: id }),
  pagar: (t, p) => rpc('app_pagar', { p_token: t, p_deuda: p.deuda, p_monto: p.monto, p_llave: p.llave, p_banco: 'Nu' }),
  deshacerPago: (t, id) => rpc('app_deshacer_pago', { p_token: t, p_id: id }),
};
