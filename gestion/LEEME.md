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
