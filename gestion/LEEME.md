# Sistema de gestión Tolvar

Página: `/gestion/` (no está linkeada desde el sitio y tiene `noindex`).

- Sin servidor ni base de datos: los datos se guardan en el navegador (localStorage).
- **Exportar a Excel** (botón superior): libro de caja con saldo acumulado, balances por día/semana/mes,
  rentabilidad, métricas de empleados, una hoja por cada módulo y gráficos.
- **Respaldo y datos**: descargar/restaurar JSON, cargar datos de ejemplo, borrar todo.
- Librerías incluidas en `vendor/` (Chart.js y ExcelJS, licencia MIT).

Recomendado: proteger la carpeta `/gestion/` con contraseña desde el panel de Hostinger.
