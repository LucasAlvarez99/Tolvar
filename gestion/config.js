/* Configuración de Supabase.
 * Con ambos campos vacíos el sistema funciona en "modo local" (datos solo en este navegador).
 * Completalos con los datos de Supabase → Project Settings → API:
 *   SUPABASE_URL      → "Project URL"           (https://xxxxxxxx.supabase.co)
 *   SUPABASE_ANON_KEY → "anon" / "public" key   (es pública por diseño; la seguridad la da RLS)
 * NUNCA pegues acá la clave "service_role".
 */
window.TOLVAR_CONFIG = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: ''
};
