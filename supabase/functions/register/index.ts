// EigenKoers – account aanmaken
//
// Waarom een eigen functie? De standaard e-mailserver van Supabase verstuurt
// alleen bevestigingsmails naar leden van het Supabase-team. Cliënten en
// netwerkleden zouden hun account dan nooit kunnen bevestigen. Deze functie
// maakt het account direct bevestigd aan. De koppeling met een cliënt loopt
// daarna altijd via een persoonlijke uitnodigingscode, dus een niet-geverifieerd
// e-mailadres geeft nooit toegang tot andermans gegevens.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function adminKey(): string {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (parsed?.default) return parsed.default;
    } catch (_) {
      // val terug op de legacy sleutel
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let payload: { email?: unknown; password?: unknown; full_name?: unknown };
  try {
    payload = await req.json();
  } catch (_) {
    return json(400, { error: "invalid_json", message: "Ongeldig verzoek." });
  }

  const email = String(payload.email ?? "").trim().toLowerCase();
  const password = String(payload.password ?? "");
  const fullName = String(payload.full_name ?? "").trim();

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json(400, { error: "invalid_email", message: "Vul een geldig e-mailadres in." });
  }
  if (password.length < 8 || password.length > 72) {
    return json(400, { error: "weak_password", message: "Kies een wachtwoord van minimaal 8 tekens." });
  }
  if (fullName.length < 1 || fullName.length > 120) {
    return json(400, { error: "invalid_name", message: "Vul je naam in (maximaal 120 tekens)." });
  }

  // Beheerdersadressen kunnen niet via de open registratie worden aangemaakt.
  // Zo kan niemand anders het beheerdersaccount claimen. De beheerder maakt het
  // account één keer aan in Supabase (Authentication → Users → Add user).
  const RESERVED = (Deno.env.get("RESERVED_EMAILS") ?? "y.lemaalem@gmail.com")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (RESERVED.includes(email)) {
    return json(403, {
      error: "reserved_email",
      message: "Dit e-mailadres is gereserveerd voor de beheerder. Maak dit account één keer aan in Supabase (Authentication → Users → Add user) en log daarna hier in.",
    });
  }

  const key = adminKey();
  const url = Deno.env.get("SUPABASE_URL");
  if (!key || !url) return json(500, { error: "server_config", message: "De server is niet goed ingesteld." });

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "email_exists" || code === "user_already_exists" || /already/i.test(error.message)) {
      return json(409, {
        error: "email_exists",
        message: "Er bestaat al een account met dit e-mailadres. Log in met je wachtwoord.",
      });
    }
    if (code === "weak_password") {
      return json(400, { error: "weak_password", message: "Dit wachtwoord is te zwak. Kies een langer of minder voorspelbaar wachtwoord." });
    }
    console.error("createUser failed", code, error.message);
    return json(500, { error: "create_failed", message: "Account aanmaken lukte niet. Probeer het later opnieuw." });
  }

  return json(200, { ok: true });
});
