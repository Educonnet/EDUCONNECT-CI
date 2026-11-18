window.eduSupabase

// Configuration Supabase pour EDUCONNECT CI.

const SUPABASE_URL = "https://rdhcrbdhzyrraavfscyh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_03BXbRMZCHVX7xuZn8F2ww_YCiIm51X";

if (!window.supabase) {
  console.error("La bibliothèque Supabase n'est pas chargée.");
} else {
  window.eduSupabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

  console.log("EDUCONNECT CI : Supabase est initialisé.");
}

