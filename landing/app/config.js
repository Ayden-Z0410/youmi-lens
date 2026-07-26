/**
 * Youmi Lens Website — PUBLIC runtime configuration.
 *
 * These three values are PUBLIC-safe (the SAME shared Supabase project + public
 * anon key + production API origin already shipped in the Desktop app bundle and
 * committed in .env.production). The anon key is RLS-protected and designed to be
 * public. NO server secret (service-role key, Stripe secret, OAuth client secret,
 * Apple private key, SMTP/Brevo secret) belongs here.
 *
 * Source: .env.production → VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_API_BASE_URL.
 * Same account identity as Desktop and iPad — no separate account system.
 */
window.YOUMI_CONFIG = {
  supabaseUrl: "https://lbwsrnjbiayepshrdult.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxid3NybmpiaWF5ZXBzaHJkdWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNjk5MjEsImV4cCI6MjA5MDk0NTkyMX0.3RDacj9feMyJBPW59cbres8fi4YLdPrbtJQUeUiVfXs", // PUBLIC anon key (RLS-protected) — NOT the service-role key
  apiBaseOrigin: "https://youmi-lens-production.up.railway.app", // client uses `${origin}/api`
  // OAuth / password-reset return targets (relative; client builds an absolute
  // same-origin URL). MUST be in the Supabase Auth "Redirect URLs" allow-list.
  authReturnPath: "/account/",
  resetReturnPath: "/reset-password/",
};

/** True only when every required public value is present for this deploy. */
window.YOUMI_CONFIG.isConfigured = function () {
  const c = window.YOUMI_CONFIG;
  return (
    typeof c.supabaseUrl === "string" && c.supabaseUrl.startsWith("https://") &&
    typeof c.supabaseAnonKey === "string" && c.supabaseAnonKey.length > 20 &&
    typeof c.apiBaseOrigin === "string" && c.apiBaseOrigin.startsWith("https://")
  );
};
