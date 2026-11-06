// Databasetests: Super Admin-rol en anoniem impact-logboek.
// Draait op PGlite met alle migraties. Gebruik: npm run test:db
import { createDb } from './_setup.mjs';

const { db, ok, as, expectError, done, U } = await createDb();

const allLogs = async () => (await db.query('select * from public.anonymous_impact_logs order by created_at, id')).rows;
const lastLog = async () => (await db.query('select * from public.anonymous_impact_logs order by created_at desc, id desc limit 1')).rows[0];
const countLogs = async () => (await db.query('select count(*)::int as n from public.anonymous_impact_logs')).rows[0].n;

console.log('\nBeheerder-rol');
const a1 = await as(U.client, 'select public.am_i_admin() as a');
ok(a1.rows[0].a === false, 'gewone gebruiker is geen admin');
const a2 = await as(U.admin, 'select public.am_i_admin() as a');
ok(a2.rows[0].a === true, 'y.lemaalem@gmail.com (hoofdletters in auth.users) is admin');
await db.exec(`insert into private.app_admins (email) values ('nietbevestigd@test.nl')`);
const a3 = await as(U.unconfirmed, 'select public.am_i_admin() as a');
ok(a3.rows[0].a === false, 'admin-adres zonder bevestigd account is geen admin');
await expectError(null, 'select public.am_i_admin()', [], 'anon kan am_i_admin niet aanroepen');
await expectError(U.client, 'select * from private.app_admins', [], 'gewone gebruiker kan beheerderslijst niet lezen');
await expectError(U.client, `insert into private.app_admins (email) values ('client@test.nl')`, [], 'gewone gebruiker kan zichzelf geen admin maken');
await expectError(U.client, 'select * from private.impact_settings', [], 'geheime sleutel is niet leesbaar');
await expectError(U.client, `select private.impact_hash('11111111-1111-1111-1111-111111111111')`, [], 'impact_hash niet aanroepbaar door gebruiker');
await expectError(U.client, `select private.log_impact('11111111-1111-1111-1111-111111111111', 'KEUZETAFEL_PAD_B', 'nep', 9999, 9999)`, [], 'log_impact niet aanroepbaar door gebruiker');

console.log('\nStoplicht-gebeurtenissen');
const prof = await as(U.client, `insert into public.profiles (full_name, supervisor_name, weekly_budget, savings_goal) values ('Sanne de Groot', 'Mark', 70, 'Laptop') returning *`);
const pid = prof.rows[0].id;
ok(await countLogs() === 0, 'nieuw profiel maakt geen event');

const setMood = (color, signals = '["Moe"]', action = 'Wandelen') => as(U.client,
  `update public.profiles set current_mood = $2, last_reason = 'reden met naam Sanne', last_self_action = $3, last_signals = $4::jsonb, mood_updated_at = now() where id = $1`,
  [pid, color, action, signals]);

await setMood('green', '["Goed geslapen", "Rust"]');
let l = await lastLog();
ok(l && l.event_type === 'STOPLICHT_TRANSITIE' && l.saved_euros === 0 && l.informal_minutes === 0, 'eerste kleur (Start → Groen) gelogd zonder waarde');
ok(l.detail === 'Start → Groen · 2 signalen aangevinkt · eigen actie gekozen', 'detail: ' + l.detail);
ok(/^[0-9a-f]{16}$/.test(l.client_hash), 'client_hash is 16 hex-tekens: ' + l.client_hash);
ok(!l.client_hash.includes(pid.replace(/-/g, '').slice(0, 8)), 'client_hash bevat geen profiel-id');
ok(!JSON.stringify(await allLogs()).includes('Sanne'), 'logboek bevat geen naam of vrije tekst');

await setMood('green', '["Rust"]');
ok(await countLogs() === 1, 'zelfde kleur opnieuw → geen nieuw event');

await setMood('orange', '["Slecht geslapen"]');
l = await lastLog();
ok(l.detail === 'Groen → Oranje · 1 signaal aangevinkt · eigen actie gekozen' && l.saved_euros === 0, 'Groen → Oranje gelogd, €0: ' + l.detail);

await setMood('green', '[]');
l = await lastLog();
ok(l.saved_euros === 45 && l.informal_minutes === 30, 'herstel Oranje → Groen = €45 + 30 min');
ok(l.detail.startsWith('Oranje → Groen (herstel)'), 'detail: ' + l.detail);

await setMood('red');
await setMood('green');
l = await lastLog();
ok(l.saved_euros === 0 && l.informal_minutes === 0 && l.detail.includes('vandaag al meegeteld'), 'tweede herstel op dezelfde dag telt niet dubbel: ' + l.detail);

const before = await countLogs();
await as(U.client, `update public.profiles set current_mood = 'orange', last_self_action = '' where id = $1`, [pid]);
// Sinds pakket A (migratie 20261107090000) telt ook een wissel zonder eigen actie.
l = await lastLog();
ok(await countLogs() === before + 1 && l.detail.includes('geen eigen actie') && l.saved_euros === 0,
  'wissel zonder eigen actie → wel een event, zonder bedrag: ' + l.detail);
await as(U.client, `update public.profiles set full_name = 'Sanne G.' where id = $1`, [pid]);
ok(await countLogs() === before + 1, 'naam wijzigen → geen event');

console.log('\nKeuze-Tafel-gebeurtenissen');
await as(U.client, `insert into public.saved_choices (profile_id, title, chosen_path, scenario_key, pad) values ($1, 'Scooter', '🛡️ Pad B: 10 Weken Sparen', 'scooter', 'B')`, [pid]);
l = await lastLog();
ok(l.event_type === 'KEUZETAFEL_PAD_B' && l.saved_euros === 55 && l.informal_minutes === 0, 'Pad B = €55');
ok(l.detail === 'Keuze-Tafel: Kopen op krediet · gekozen voor Pad B (slimme stap)', 'detail: ' + l.detail);
await as(U.client, `insert into public.saved_choices (profile_id, title, chosen_path, scenario_key, pad) values ($1, 'Nieuwe telefoon van Sanne', '⚡ Pad A: Direct Doen', 'custom', 'A')`, [pid]);
l = await lastLog();
ok(l.event_type === 'KEUZETAFEL_PAD_A' && l.saved_euros === 0, 'Pad A = €0');
ok(l.detail === 'Keuze-Tafel: Eigen keuze · gekozen voor Pad A (impuls)' && !l.detail.includes('telefoon'), 'eigen titel komt niet in het logboek: ' + l.detail);
await as(U.client, `insert into public.saved_choices (profile_id, title, chosen_path) values ($1, 'Oud', '🛡️ Pad B: Grens Stellen met App')`, [pid]);
l = await lastLog();
ok(l.event_type === 'KEUZETAFEL_PAD_B' && l.detail.includes('Onbekend scenario'), 'zonder pad-kolom: pad herkend uit de tekst');
await expectError(U.client, `insert into public.saved_choices (profile_id, title, chosen_path, pad) values ('${pid}', 'x', 'y', 'C')`, [], 'ongeldig pad geweigerd');
const nB = await countLogs();
await as(U.client, `insert into public.saved_choices (profile_id, title, chosen_path) values ($1, 'Vrij', 'Iets anders')`, [pid]);
ok(await countLogs() === nB, 'keuze zonder herkenbaar pad → geen event');

console.log('\nNetwerk-opdrachten');
const mem = await as(U.client, `insert into public.network_members (profile_id, name, role, email) values ($1, 'Anja', 'Familie / Ouder', 'anja@test.nl') returning *`, [pid]);
const anja = mem.rows[0];
await as(U.anja, 'select public.accept_invite($1)', [anja.invite_code]);
const t1 = (await as(U.client, `insert into public.tasks (profile_id, title, duration, requested_time, target_type, target_name) values ($1, 'Post', 'hour', 'Wo 9:00', 'open', 'Groep') returning id`, [pid])).rows[0].id;
const nT = await countLogs();
await as(U.anja, 'select public.network_counter_task($1, $2, $3, $4)', [anja.id, t1, 'Do 14:00', '']);
ok(await countLogs() === nT, 'tegenvoorstel alleen → nog geen event');
await as(U.anja, 'select public.network_accept_task($1, $2)', [anja.id, t1]);
l = await lastLog();
ok(l.event_type === 'NETWERK_OPDRACHT_GEACCEPTEERD' && l.informal_minutes === 60 && l.saved_euros === 65, 'accepteren 1 uur = 60 min + €65');
ok(l.detail === 'Opdracht 1 uur · open voor de groep · tegenvoorstel bevestigd · netwerklid: Familie / Ouder', 'detail: ' + l.detail);

const t2 = (await as(U.client, `insert into public.tasks (profile_id, title, duration, requested_time, target_type, target_name, target_member_id) values ($1, 'Klussen', 'large', 'Za', 'specific', 'Anja', $2) returning id`, [pid, anja.id])).rows[0].id;
await as(U.anja, 'select public.network_counter_task($1, $2, $3, $4)', [anja.id, t2, 'Zo 10:00', 'Kan zondag']);
// cliënt keurt goed (zoals approveCounter in de app)
await as(U.client, `update public.tasks set requested_time = counter_proposal_time, status = 'accepted', accepted_by = counter_by, accepted_by_member_id = counter_by_member_id, counter_by = '', counter_by_member_id = null, counter_proposal_time = '', counter_note = '' where id = $1`, [t2]);
l = await lastLog();
ok(l.informal_minutes === 150 && l.saved_euros === 163, 'tegenvoorstel bevestigd 2-3 uur = 150 min + €163');
ok(l.detail.includes('gevraagd aan 1 persoon · tegenvoorstel bevestigd'), 'detail: ' + l.detail);

const nD = await countLogs();
await as(U.client, `update public.tasks set status = 'open', accepted_by = '', accepted_by_member_id = null where id = $1`, [t2]);
await as(U.anja, 'select public.network_accept_task($1, $2)', [anja.id, t2]);
ok(await countLogs() === nD, 'dezelfde opdracht opnieuw accepteren telt niet dubbel');

const t3 = (await as(U.client, `insert into public.tasks (profile_id, title, duration, requested_time) values ($1, 'Kort', 'short', 'Ma') returning id`, [pid])).rows[0].id;
await as(U.anja, 'select public.network_accept_task($1, $2)', [anja.id, t3]);
l = await lastLog();
ok(l.informal_minutes === 30 && l.saved_euros === 33 && l.detail.includes('direct geaccepteerd'), 'kort = 30 min + €33, direct geaccepteerd');
const t4 = (await as(U.client, `insert into public.tasks (profile_id, title, duration, requested_time) values ($1, 'Dag', 'half_day', 'Di') returning id`, [pid])).rows[0].id;
await as(U.anja, 'select public.network_accept_task($1, $2)', [anja.id, t4]);
l = await lastLog();
ok(l.informal_minutes === 240 && l.saved_euros === 260, 'dagdeel = 240 min + €260');

console.log('\nDemo-profiel telt nooit mee');
const nDemo = await countLogs();
const demo = (await as(U.client, 'select public.create_demo_profile() as id')).rows[0].id;
ok(await countLogs() === nDemo, 'demo laden → geen events');
await as(U.client, `update public.profiles set current_mood = 'orange', last_self_action = 'x' where id = $1`, [demo]);
await as(U.client, `update public.profiles set current_mood = 'green', last_self_action = 'x' where id = $1`, [demo]);
await as(U.client, `insert into public.saved_choices (profile_id, title, chosen_path, scenario_key, pad) values ($1, 'x', 'Pad B', 'scooter', 'B')`, [demo]);
const demoTask = (await as(U.client, `select id from public.tasks where profile_id = $1 limit 1`, [demo])).rows[0].id;
const erik = (await as(U.client, `select id from public.network_members where profile_id = $1 and name like 'Erik%'`, [demo])).rows[0].id;
await as(U.client, 'select public.network_accept_task($1, $2)', [erik, demoTask]);
ok(await countLogs() === nDemo, 'stoplicht, keuze en opdracht in demo → geen events');

console.log('\nToegang tot het logboek');
const seenByClient = await as(U.client, 'select * from public.anonymous_impact_logs');
ok(seenByClient.rows.length === 0, 'cliënt ziet het logboek niet');
const seenByAnja = await as(U.anja, 'select * from public.anonymous_impact_logs');
ok(seenByAnja.rows.length === 0, 'netwerklid ziet het logboek niet');
await expectError(null, 'select * from public.anonymous_impact_logs', [], 'anon heeft geen toegang');
const seenByAdmin = await as(U.admin, 'select * from public.anonymous_impact_logs');
ok(seenByAdmin.rows.length === await countLogs() && seenByAdmin.rows.length > 0, `admin ziet alle ${seenByAdmin.rows.length} events`);
await expectError(U.client, `insert into public.anonymous_impact_logs (client_hash, event_type, saved_euros) values ('abcdefgh12345678', 'KEUZETAFEL_PAD_B', 99999)`, [], 'cliënt kan geen nep-event toevoegen');
await expectError(U.admin, `insert into public.anonymous_impact_logs (client_hash, event_type, saved_euros) values ('abcdefgh12345678', 'KEUZETAFEL_PAD_B', 99999)`, [], 'ook admin kan geen nep-event toevoegen');
await expectError(U.admin, `update public.anonymous_impact_logs set saved_euros = 1`, [], 'admin kan events niet wijzigen');
await expectError(U.admin, `delete from public.anonymous_impact_logs`, [], 'admin kan events niet verwijderen');

console.log('\nAdmin-overzicht');
await expectError(U.client, 'select public.admin_dashboard()', [], 'gewone gebruiker krijgt geen overzicht');
await expectError(U.unconfirmed, 'select public.admin_dashboard()', [], 'onbevestigd admin-adres krijgt geen overzicht');
const logs = await allLogs();
const d = (await as(U.admin, 'select public.admin_dashboard() as d')).rows[0].d;
ok(d.clients === 1, 'cliënten = 1 (demo telt niet): ' + d.clients);
ok(d.members === 1 && d.members_joined === 1, 'netwerkleden = 1, gekoppeld = 1');
ok(d.accounts === 7, 'accounts = 7 (alle testaccounts in auth.users)');
const curMood = (await db.query('select current_mood from public.profiles where id = $1', [pid])).rows[0].current_mood;
ok(d.mood[curMood] === 1 && d.mood.none === 0, `stoplicht-verdeling klopt (${curMood} = 1)`);
ok(d.events === logs.length, 'events = ' + d.events);
ok(d.saved_euros === logs.reduce((s, x) => s + x.saved_euros, 0), 'bespaard = €' + d.saved_euros);
ok(d.informal_minutes === logs.reduce((s, x) => s + x.informal_minutes, 0), 'minuten = ' + d.informal_minutes);
ok(d.pad_a === 1 && d.pad_b === 2, `Pad A = ${d.pad_a}, Pad B = ${d.pad_b}`);
ok(d.network_tasks === 4 && d.network_minutes === 60 + 150 + 30 + 240, `netwerk: ${d.network_tasks} opdrachten, ${d.network_minutes} min`);
ok(d.recoveries === 1 && d.mood_events === 6, `stoplicht: ${d.mood_events} wissels, ${d.recoveries} herstel meegeteld`);
ok(d.unique_clients === 1, 'unieke cliënten in logboek = 1');
const future = (await as(U.admin, `select public.admin_dashboard(now() + interval '1 day', null) as d`)).rows[0].d;
ok(future.events === 0 && future.saved_euros === 0 && future.clients === 1, 'periodefilter werkt (toekomst = 0 events, tellingen blijven)');
const past = (await as(U.admin, `select public.admin_dashboard(null, now() - interval '1 day') as d`)).rows[0].d;
ok(past.events === 0, 'periode tot gisteren = 0 events');

console.log('\nProfiel verwijderen houdt het anonieme logboek intact');
const nBeforeDelete = await countLogs();
await as(U.client, 'delete from public.profiles where id = $1', [pid]);
ok(await countLogs() === nBeforeDelete, 'events blijven bestaan na verwijderen profiel');
const d2 = (await as(U.admin, 'select public.admin_dashboard() as d')).rows[0].d;
ok(d2.clients === 0 && d2.events === nBeforeDelete, 'tellingen bijgewerkt, logboek compleet');

done();
