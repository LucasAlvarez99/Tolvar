# Sistema de gestión Tolvar

Página: `/gestion/` (no está linkeada desde el sitio, tiene `noindex` y está en `robots.txt`).

- **Exportar a Excel** (botón superior): libro de caja con saldo acumulado, balances por día/semana/mes,
  rentabilidad, métricas de empleados, una hoja por cada módulo y gráficos.
- **Respaldo y datos**: descargar/restaurar JSON, cargar datos de ejemplo, borrar todo.
- Librerías en `vendor/` (Chart.js, ExcelJS y supabase-js; licencia MIT).

## Conectar a Supabase (para verlo desde cualquier navegador)

Sin configurar nada funciona en **modo local** (los datos quedan solo en ese navegador).
Para guardar en la nube:

1. **Proyecto**: en supabase.com creá un proyecto (o usá uno existente).
2. **Tablas**: *SQL Editor → New query*, pegá todo `supabase.sql` y ejecutalo.
3. **Tu usuario**: *Authentication → Users → Add user → Create new user* (email + contraseña, tildá "Auto confirm user").
4. **Autorizarlo**: en el SQL Editor ejecutá
   `insert into public.tolvar_usuarios (email) values ('tu-email@ejemplo.com');`
   (solo los emails de esa tabla pueden leer/escribir datos, aunque alguien se registre).
5. **Cerrar registros**: *Authentication → Sign In / Providers → desactivar "Allow new users to sign up"*.
6. **Claves**: *Project Settings → API* → copiá **Project URL** y la clave **anon public** y pegalas en `config.js`.
   Nunca uses la clave `service_role`.
7. Subí los cambios. Al abrir `/gestion/` pide email y contraseña.

La primera vez, si había datos cargados en modo local en ese navegador, pregunta si querés subirlos a la nube.

Para sumar otra persona: crear su usuario (paso 3) y agregar su email a `tolvar_usuarios` (paso 4).

## Que la base nunca se pause (UptimeRobot)

El plan gratis de Supabase pausa el proyecto si pasa una semana sin actividad. Para evitarlo,
UptimeRobot (plan gratis, chequeo cada 5 minutos) llama a la función pública `tolvar_ping`
(ya incluida en `supabase.sql`; no lee ni devuelve datos, solo confirma que la base responde).

1. En uptimerobot.com → **Add New Monitor** → tipo **HTTP(s)**.
2. **URL**: `https://TU-PROYECTO.supabase.co/rest/v1/rpc/tolvar_ping?apikey=TU_CLAVE_ANON`
   (la misma URL y clave anon de `config.js`). Probala primero en el navegador: tiene que mostrar `{"ok":true,...}`.
3. **Interval**: 5 minutos. Dejá activadas las alertas por email.
4. Si el navegador no la acepta con `?apikey=` en la URL, el monitor necesita enviar la clave en un
   header `apikey` (UptimeRobot permite headers personalizados según el plan); la alternativa gratuita es
   un workflow programado de GitHub Actions que haga el mismo pedido una vez por día.

## Cierre de sesión por inactividad

Con Supabase conectado, la sesión se cierra sola a los **10 minutos sin tocar la pantalla**
(a los 9 avisa que se cierra en 1 minuto). Se calcula con la última actividad (clics, teclas, scroll, toques),
así que también vale si cerrás la pestaña y la volvés a abrir pasado ese tiempo. Antes de salir
se termina de guardar lo pendiente. El tiempo se cambia en `config.js` → `INACTIVITY_MINUTES`.
