
// Configuration Supabase pour EDUCONNECT CI.

const SUPABASE_URL = "https://lsgyjcpfpdnhxrafaobq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5f6sMUAdH1vzyCP07xM8Pg_NALsBmMM";

if (!window.supabase) {
  console.error("La bibliothèque Supabase n'est pas chargée.");
} else {
  window.eduSupabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

  console.log("EDUCONNECT CI : Supabase est initialisé.");
}

