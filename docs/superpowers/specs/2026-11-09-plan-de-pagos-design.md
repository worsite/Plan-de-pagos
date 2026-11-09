# Plan de Pagos — diseño

## Intención
App web móvil para llevar el registro de deudas personales y reportar pagos, con un perfil admin de solo lectura que ve lo depositado (Nu + llave). Objetivo: motivación (barra de avance) y disciplina (cuota quincenal, al día / atraso).

## Metas
- Inicio: deuda objetivo arriba con barra de avance; total de deudas y lista de las que lo suman.
- Deudas: nombre, valor, fecha meta → cuota quincenal calculada; estado al día / atraso por deuda.
- Pagar: deuda, monto, llave destino, "marcar como enviado". El dueño solo ve el % subir (no montos).
- Admin: solo contraseña, el dispositivo la recuerda; solo lectura; ve total depositado en Nu, llave destino, depósitos y deudas.
- Supabase como backend; se entrega SQL listo.

## No metas
Multiusuario real, bancos reales (no se mueve dinero, solo se registra), build tooling.

## Anti-metas
Que cualquiera con la anon key (pública) pueda leer/escribir. Que el admin pueda modificar algo.

## Decisiones (usuario)
Pastel verde claro; contraseña simple para admin y recordada por dispositivo; uso de /diseno, /accion, superpowers.

## Decisiones (mías)
- Sitio estático sin build: HTML + CSS + JS (módulos ES), llamadas a Supabase por `fetch` a RPC (sin librerías externas).
- Seguridad: tablas con RLS sin políticas (anon no accede); todo por funciones `security definer` que validan un token de sesión; contraseñas con bcrypt (pgcrypto); bloqueo tras 5 intentos fallidos en 15 min. Dos roles: `owner` (dueño, contraseña propia) y `admin` (solo lectura).
- Cuotas: quincenas = día 15 y último día del mes; fechas límite = quincenas en (inicio, meta], más la meta si no cae en quincena. cuota = valor / nº de fechas. Esperado hoy = cuota × fechas vencidas. Diferencia = pagado − esperado → al día / atraso (en $ y en cuotas).
- "Valor" de una deuda = lo que se debe al registrarla; el % = pagado / valor.
- Inicio muestra total = suma de valores y % global (no revela montos pagados).
- El dueño no ve montos pagados en la UI (se ocultan en pantalla; los datos sí viajan al cliente porque se necesitan para el cálculo).
- Deshacer pago: solo en los 10 minutos siguientes, desde el aviso tras enviar.
