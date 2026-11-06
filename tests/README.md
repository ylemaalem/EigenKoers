# Tests

Alle tests staan hier, zodat ze bij elke wijziging opnieuw kunnen draaien.

| Commando | Wat het test | Database |
| --- | --- | --- |
| `npm run test:db` | Schema, beveiliging (RLS), netwerkfuncties, demo-profiel, admin en impact-logboek, pakket A | PGlite: een echte Postgres in Node, met alle migraties uit `supabase/migrations`. Geen internet, nooit productie. |
| `npm run test:ui-a` | Pakket A in de browser: kleurwissel, 112-tekst, terugblik, voorlezen (15 controles) | Nagebootste database (de test beantwoordt zelf alle verzoeken) |
| `npm run test:e2e` | Hele app via internet: registreren, inloggen, netwerk koppelen, opdrachten | Een Supabase-**test**project. Weigert productie. |

## Benodigd

- Node 20 of nieuwer, `npm install`
- Voor `test:ui-a`: Python 3 met `pip install playwright` en Google Chrome. Ander Chrome-pad? Zet `EK_CHROME`.

## Tests tegen een testproject (`test:e2e`)

1. Maak een apart Supabase-project en voer alle migraties uit. Deploy de functie `register`.
2. Zet de gegevens van dat project:
   ```bash
   export EK_SUPABASE_URL=https://<test-ref>.supabase.co
   export EK_SUPABASE_KEY=sb_publishable_...
   ```
3. Start de app tegen hetzelfde project:
   ```bash
   VITE_SUPABASE_URL=$EK_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY=$EK_SUPABASE_KEY npx vite --port 5199
   ```
4. Draai `npm run test:e2e`. De testaccounts komen in `tests/e2e/.creds.json` (staat niet in git).
