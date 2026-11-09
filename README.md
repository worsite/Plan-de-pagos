# Plan de Pagos

App web (móvil primero) para registrar deudas, reportar pagos y ver si vas al día con la meta quincenal. Perfil admin de solo lectura.

## Puesta en marcha
1. **Supabase → SQL Editor**: pega y ejecuta `supabase/schema.sql` (se puede repetir sin perder datos).
2. En el mismo editor, define las dos contraseñas (cámbialas por las tuyas):
   ```sql
   select public.app_definir_clave('owner', 'tu-clave');
   select public.app_definir_clave('admin', 'clave-del-admin');
   ```
3. Publica esta carpeta como sitio estático (Netlify, GitHub Pages, Cloudflare Pages…). No hay build. Para probar local: `python3 -m http.server` y abre `http://localhost:8000` (los módulos ES no funcionan con `file://`).

## Cómo funciona
- `owner` (tú) crea deudas y registra pagos; `admin` solo ve. Cada dispositivo recuerda la sesión (1 año).
- Las tablas están bloqueadas para la clave anon pública; todo pasa por funciones `app_*` que exigen token. 5 contraseñas erróneas bloquean 15 min.
- Cuota quincenal = valor / número de quincenas (días 15 y fin de mes) hasta la meta. Estás "al día" si lo pagado ≥ cuotas vencidas × cuota.

## Pruebas
`npm test` (lógica de cuotas y atraso).
