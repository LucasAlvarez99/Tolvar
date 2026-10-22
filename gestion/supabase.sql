-- ════════════════════════════════════════════════════════════════
-- TOLVAR · Sistema de gestión — esquema para Supabase
-- Pegar completo en: Supabase → SQL Editor → New query → Run
-- Se puede ejecutar más de una vez sin romper nada.
-- ════════════════════════════════════════════════════════════════

-- 1) Lista de usuarios autorizados (solo se administra desde el SQL Editor)
create table if not exists public.tolvar_usuarios (
    email text primary key
);
alter table public.tolvar_usuarios enable row level security;   -- sin políticas: la app no puede leerla
revoke all on public.tolvar_usuarios from anon, authenticated;

-- 2) Función que dice si el usuario logueado está autorizado
create or replace function public.tolvar_autorizado()
returns boolean
language sql stable security definer
set search_path = public
as $$
    select exists (
        select 1 from public.tolvar_usuarios u
        where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;
revoke all on function public.tolvar_autorizado() from public, anon;
grant execute on function public.tolvar_autorizado() to authenticated;

-- 3) Actualiza updated_at en cada modificación
create or replace function public.tolvar_touch()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- 4) Una tabla por módulo (id + datos en JSON) con seguridad por fila (RLS)
do $$
declare
    t text;
    tabla text;
begin
    foreach t in array array[
        'empleados', 'horas', 'herramientas', 'agenda', 'clientes',
        'proveedores', 'presupuestos', 'trabajos', 'movimientos', 'vencimientos'
    ] loop
        tabla := 'tolvar_' || t;
        execute format('create table if not exists public.%I (
                            id text primary key,
                            data jsonb not null,
                            updated_at timestamptz not null default now()
                        )', tabla);
        execute format('alter table public.%I enable row level security', tabla);
        execute format('revoke all on public.%I from anon', tabla);
        execute format('drop policy if exists tolvar_acceso on public.%I', tabla);
        execute format('create policy tolvar_acceso on public.%I
                            for all to authenticated
                            using (public.tolvar_autorizado())
                            with check (public.tolvar_autorizado())', tabla);
        execute format('drop trigger if exists tolvar_touch on public.%I', tabla);
        execute format('create trigger tolvar_touch before update on public.%I
                            for each row execute function public.tolvar_touch()', tabla);
    end loop;
end $$;

-- 5) AUTORIZAR TU USUARIO (cambiá el email por el tuyo y ejecutá esta línea)
-- insert into public.tolvar_usuarios (email) values ('tu-email@ejemplo.com') on conflict do nothing;
