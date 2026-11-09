-- =====================================================================
-- Plan de Pagos — esquema para Supabase
-- Pégalo completo en: Supabase → SQL Editor → New query → Run.
-- Es idempotente: puedes volver a ejecutarlo sin perder datos.
--
-- Seguridad: las tablas tienen RLS activado SIN políticas y sin permisos
-- para anon/authenticated → la clave anon (pública) no puede leer ni
-- escribir nada directamente. Todo pasa por las funciones app_* de abajo,
-- que exigen un token de sesión obtenido con la contraseña.
-- Roles: 'owner' (tú: lee y escribe) y 'admin' (solo lectura).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tablas ----------
create table if not exists public.deudas (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null check (char_length(btrim(nombre)) between 1 and 80),
  valor         numeric(14,0) not null check (valor > 0),
  fecha_inicio  date not null default current_date,
  fecha_meta    date not null,
  es_objetivo   boolean not null default false,
  created_at    timestamptz not null default now(),
  check (fecha_meta >= fecha_inicio)
);
create unique index if not exists deudas_un_objetivo on public.deudas (es_objetivo) where es_objetivo;

create table if not exists public.llaves (
  id          uuid primary key default gen_random_uuid(),
  llave       text not null unique check (char_length(btrim(llave)) between 1 and 80),
  alias       text,
  banco       text not null default 'Nu',
  created_at  timestamptz not null default now()
);

create table if not exists public.pagos (
  id          uuid primary key default gen_random_uuid(),
  deuda_id    uuid not null references public.deudas(id) on delete cascade,
  llave_id    uuid not null references public.llaves(id),
  monto       numeric(14,0) not null check (monto > 0),
  pagado_en   timestamptz not null default now()
);
create index if not exists pagos_deuda_idx on public.pagos (deuda_id);

create table if not exists public.app_claves (
  rol         text primary key check (rol in ('owner','admin')),
  clave_hash  text not null
);

create table if not exists public.app_sesiones (
  token_hash  text primary key,
  rol         text not null check (rol in ('owner','admin')),
  creada      timestamptz not null default now(),
  expira      timestamptz not null default (now() + interval '1 year')
);

create table if not exists public.app_intentos (
  id    bigserial primary key,
  rol   text not null,
  ok    boolean not null,
  at    timestamptz not null default now()
);
create index if not exists app_intentos_idx on public.app_intentos (rol, at);

-- ---------- Bloquear acceso directo ----------
alter table public.deudas        enable row level security;
alter table public.llaves        enable row level security;
alter table public.pagos         enable row level security;
alter table public.app_claves    enable row level security;
alter table public.app_sesiones  enable row level security;
alter table public.app_intentos  enable row level security;

revoke all on public.deudas, public.llaves, public.pagos,
              public.app_claves, public.app_sesiones, public.app_intentos
  from anon, authenticated;
revoke all on sequence public.app_intentos_id_seq from anon, authenticated;

-- ---------- Funciones internas ----------
create or replace function public._rol(p_token text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare r text;
begin
  select rol into r from public.app_sesiones
   where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex') and expira > now();
  if r is null then raise exception 'no_autorizado'; end if;
  return r;
end $$;

create or replace function public._solo_owner(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if public._rol(p_token) <> 'owner' then raise exception 'solo_lectura'; end if;
end $$;

-- Definir/cambiar contraseñas (solo desde el SQL Editor):
--   select public.app_definir_clave('owner', 'tu-clave');
--   select public.app_definir_clave('admin', 'clave-del-admin');
create or replace function public.app_definir_clave(p_rol text, p_clave text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_rol not in ('owner','admin') then raise exception 'rol_invalido'; end if;
  if char_length(coalesce(p_clave,'')) < 4 then raise exception 'clave_muy_corta (minimo 4)'; end if;
  insert into public.app_claves (rol, clave_hash) values (p_rol, crypt(p_clave, gen_salt('bf', 10)))
  on conflict (rol) do update set clave_hash = excluded.clave_hash;
  delete from public.app_sesiones where rol = p_rol;  -- cierra sesiones anteriores
end $$;

-- ---------- API pública (RPC) ----------
create or replace function public.app_login(p_rol text, p_clave text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare h text; tok text; fallos int;
begin
  if p_rol not in ('owner','admin') then return json_build_object('ok', false, 'error', 'rol_invalido'); end if;
  select count(*) into fallos from public.app_intentos
   where rol = p_rol and not ok and at > now() - interval '15 minutes';
  if fallos >= 5 then return json_build_object('ok', false, 'error', 'bloqueado'); end if;

  select clave_hash into h from public.app_claves where rol = p_rol;
  if h is null or crypt(coalesce(p_clave,''), h) <> h then
    insert into public.app_intentos (rol, ok) values (p_rol, false);
    return json_build_object('ok', false, 'error', 'clave_incorrecta');
  end if;

  delete from public.app_intentos where rol = p_rol;
  delete from public.app_sesiones where expira < now();
  tok := encode(gen_random_bytes(32), 'hex');
  insert into public.app_sesiones (token_hash, rol) values (encode(digest(tok, 'sha256'), 'hex'), p_rol);
  return json_build_object('ok', true, 'token', tok, 'rol', p_rol);
end $$;

create or replace function public.app_cerrar_sesion(p_token text)
returns void language sql security definer set search_path = public, extensions as $$
  delete from public.app_sesiones where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex');
$$;

-- Todo lo que la app necesita para pintarse. El admin recibe además el
-- detalle de depósitos; el owner solo recibe el total pagado por deuda.
create or replace function public.app_datos(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r text := public._rol(p_token); res json;
begin
  select json_build_object(
    'rol', r,
    'deudas', coalesce((
      select json_agg(json_build_object(
        'id', d.id, 'nombre', d.nombre, 'valor', d.valor,
        'fecha_inicio', d.fecha_inicio, 'fecha_meta', d.fecha_meta,
        'es_objetivo', d.es_objetivo,
        'pagado', coalesce((select sum(p.monto) from public.pagos p where p.deuda_id = d.id), 0)
      ) order by d.es_objetivo desc, d.fecha_meta, d.created_at) from public.deudas d), '[]'::json),
    'llaves', coalesce((
      select json_agg(json_build_object('id', l.id, 'llave', l.llave, 'alias', l.alias, 'banco', l.banco)
                      order by l.created_at) from public.llaves l), '[]'::json),
    'depositos', case when r = 'admin' then coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'monto', p.monto, 'pagado_en', p.pagado_en,
        'deuda', d.nombre, 'llave', l.llave, 'banco', l.banco) order by p.pagado_en desc)
      from public.pagos p
      join public.deudas d on d.id = p.deuda_id
      join public.llaves l on l.id = p.llave_id), '[]'::json) else null end
  ) into res;
  return res;
end $$;

create or replace function public.app_guardar_deuda(
  p_token text, p_id uuid, p_nombre text, p_valor numeric, p_inicio date, p_meta date)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare nid uuid;
begin
  perform public._solo_owner(p_token);
  if p_id is null then
    insert into public.deudas (nombre, valor, fecha_inicio, fecha_meta, es_objetivo)
    values (btrim(p_nombre), p_valor, coalesce(p_inicio, current_date), p_meta,
            not exists (select 1 from public.deudas))   -- la primera deuda queda como objetivo
    returning id into nid;
  else
    update public.deudas set nombre = btrim(p_nombre), valor = p_valor,
           fecha_inicio = coalesce(p_inicio, fecha_inicio), fecha_meta = p_meta
     where id = p_id returning id into nid;
    if nid is null then raise exception 'deuda_no_existe'; end if;
  end if;
  return nid;
end $$;

create or replace function public.app_borrar_deuda(p_token text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._solo_owner(p_token);
  delete from public.deudas where id = p_id;
end $$;

create or replace function public.app_marcar_objetivo(p_token text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._solo_owner(p_token);
  if not exists (select 1 from public.deudas where id = p_id) then raise exception 'deuda_no_existe'; end if;
  update public.deudas set es_objetivo = false where es_objetivo;
  update public.deudas set es_objetivo = true where id = p_id;
end $$;

create or replace function public.app_pagar(p_token text, p_deuda uuid, p_monto numeric, p_llave text, p_banco text default 'Nu')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v numeric; pag numeric; lid uuid; pid uuid; k text := btrim(coalesce(p_llave,''));
begin
  perform public._solo_owner(p_token);
  if p_monto is null or p_monto <= 0 then raise exception 'monto_invalido'; end if;
  if char_length(k) = 0 then raise exception 'llave_requerida'; end if;
  select valor into v from public.deudas where id = p_deuda for update;
  if v is null then raise exception 'deuda_no_existe'; end if;
  select coalesce(sum(monto), 0) into pag from public.pagos where deuda_id = p_deuda;
  if pag + p_monto > v then raise exception 'monto_excede_saldo'; end if;

  insert into public.llaves (llave, banco) values (k, coalesce(nullif(btrim(p_banco), ''), 'Nu'))
  on conflict (llave) do nothing;
  select id into lid from public.llaves where llave = k;
  insert into public.pagos (deuda_id, llave_id, monto) values (p_deuda, lid, p_monto) returning id into pid;
  return json_build_object('id', pid, 'pagado', pag + p_monto, 'valor', v);
end $$;

create or replace function public.app_deshacer_pago(p_token text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._solo_owner(p_token);
  delete from public.pagos where id = p_id and pagado_en > now() - interval '10 minutes';
  if not found then raise exception 'ya_no_se_puede_deshacer'; end if;
end $$;

-- ---------- Permisos: solo las funciones públicas ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.app_login(text, text),
  public.app_cerrar_sesion(text),
  public.app_datos(text),
  public.app_guardar_deuda(text, uuid, text, numeric, date, date),
  public.app_borrar_deuda(text, uuid),
  public.app_marcar_objetivo(text, uuid),
  public.app_pagar(text, uuid, numeric, text, text),
  public.app_deshacer_pago(text, uuid)
  to anon, authenticated;

-- ---------- Contraseñas (CÁMBIALAS antes de ejecutar) ----------
-- select public.app_definir_clave('owner', 'CAMBIA-ESTA');
-- select public.app_definir_clave('admin', 'CAMBIA-ESTA-ADMIN');
