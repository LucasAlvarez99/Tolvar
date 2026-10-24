/* Configuración de Supabase.
 * Con ambos campos vacíos el sistema funciona en "modo local" (datos solo en este navegador).
 * Completalos con los datos de Supabase → Project Settings → API:
 *   SUPABASE_URL      → "Project URL"           (https://xxxxxxxx.supabase.co)
 *   SUPABASE_ANON_KEY → "anon" / "public" key   (es pública por diseño; la seguridad la da RLS)
 * NUNCA pegues acá la clave "service_role".
 */
window.TOLVAR_CONFIG = {
    SUPABASE_URL: 'https://oamlzwynepmlrovcofud.supabase.co',
    INACTIVITY_MINUTES: 10,   // cierra la sesión tras estos minutos sin tocar la pantalla
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hbWx6d3luZXBtbHJvdmNvZnVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MTkzMTgsImV4cCI6MjEwODI5NTMxOH0.kcaQZ8kRUVVUtwCJSQjdo6evzlKjPT2r2SZKZJZrs-c'
};
