# 🚦 EigenKoers

EigenKoers is een webapp voor cliënten in de ambulante begeleiding en hun netwerk. De cliënt houdt zelf de regie:

- **Stoplicht (Groen / Oranje / Rood)** met een **verplichte reflectie-check** bij elke wissel:
  1. signalen aantikken, 2. context voor het netwerk, 3. eigen herstelactie kiezen.
- **Signaleringsplan per kleur**: beschrijving, korte signalen, eigen acties en netwerk-tips. Elk item kan worden toegevoegd, gewijzigd (✏️) en verwijderd (🗑️).
- **Leerdoelen per kleur**: toevoegen, wijzigen, verplaatsen naar een andere kleur, afvinken en verwijderen.
- **Keuze-Tafel**: 🛵 Kopen op krediet, 🛑 Werk stoppen, 💸 Geld uitlenen en ✏️ Eigen keuze. Pad A (impuls) en Pad B (slimme stap) staan naast elkaar, met balkjes (blijdschap, weekgeld, rust) en een tijdlijn met iconen. Er is geen ECD-export.
- **Opdrachten** (15-30 min tot een heel dagdeel): vraag het één persoon of zet de opdracht open voor de hele groep. Opdrachten kun je wijzigen en verwijderen. Netwerkleden accepteren de opdracht of doen een **tegenvoorstel**. De cliënt keurt dat voorstel met één tik goed.
- **Twee dashboards**:
  - *1. Mijn Dashboard* (cliënt/begeleider): volledig beheer en **kijkrechten per netwerklid** (Stoplicht, Opdrachten, Keuzes).
  - *2. Netwerk Weergave*: wat het ingelogde netwerklid ziet. Dit wordt in de database gefilterd op de vinkjes van de cliënt.
- **Uitnodigingen per e-mail**: met een persoonlijke link of code via de eigen mail-app, WhatsApp of kopiëren.
- **Nieuwe profielen starten 100% blanco**. Met één knop laad je los daarvan het voorbeeldprofiel *Daan Vermeulen*.
- Overal staat een **(?)-knop** met uitleg in eenvoudige B1-taal.

## Techniek

| Onderdeel | Keuze |
| --- | --- |
| Frontend | Vite + vanilla JavaScript + Tailwind CSS 3 |
| Backend | Supabase (Postgres + Row Level Security, Auth, Realtime, Edge Function) |
| Hosting | GitHub Pages (automatisch via GitHub Actions bij elke push naar `main`) |

```
index.html                 App-schermen en modals
src/main.js                Logica, Supabase-koppeling en weergave
src/help-texts.js          Alle (?)-uitlegteksten in B1-taal
src/scenarios.js           Keuze-Tafel scenario's
src/util.js                Hulpfuncties (escapen, meldingen, modals)
src/config.js              Supabase-URL en publishable key (publiek)
supabase/migrations/       Databaseschema + RLS + functies
supabase/functions/register  Edge Function voor het aanmaken van accounts
```

## Beveiliging (kort)

- Alle tabellen hebben **RLS**. Een eigenaar ziet en beheert alleen de eigen profielen.
- Netwerkleden hebben **geen directe tabeltoegang**. Ze lezen en reageren alleen via `SECURITY DEFINER`-functies (`get_network_view`, `network_accept_task`, `network_counter_task`). Die functies controleren de vinkjes `can_see_mood`, `can_see_tasks` en `can_see_finance`.
- Koppelen gaat met een **persoonlijke uitnodigingscode** én het e-mailadres waarmee iemand is ingelogd. Het e-mailadres alleen is dus niet genoeg.
- Kolomrechten voorkomen dat een gebruiker zelf `owner_id`, `user_id`, `invite_code` of `is_demo` instelt.
- Alle gebruikerstekst wordt ge-escaped voordat die op het scherm komt.

## Lokaal draaien

```bash
npm install
npm run dev
```

## Database en functies (Supabase)

1. Voer `supabase/migrations/20261106100000_eigenkoers_schema.sql` uit op het project.
2. Deploy de Edge Function `register` met **verify_jwt uit**. De functie controleert zelf de invoer:
   ```bash
   supabase functions deploy register --no-verify-jwt
   ```
3. Zet de project-URL en de publishable key in `src/config.js`.

> **Waarom een eigen registratiefunctie?** De standaard mailserver van Supabase stuurt alleen mail naar leden van het eigen Supabase-team. Gewone e-mailbevestiging werkt daardoor niet voor cliënten. De functie maakt accounts direct bevestigd aan. De koppeling met een cliënt loopt altijd via een uitnodigingscode, dus dat blijft veilig.

## Deploy

Elke push naar `main` bouwt de app en zet hem op GitHub Pages (`.github/workflows/deploy.yml`).
