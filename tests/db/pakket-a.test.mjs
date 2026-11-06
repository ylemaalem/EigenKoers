// Databasetests voor pakket A: lichtere kleurwissel en terugblik na Rood.
// Doet in de database na wat de app nu doet (zelfde tabellen, zelfde kolommen).
// Gebruik: npm run test:db
import { createDb } from './_setup.mjs';

const { db, ok, as, expectError, done, U } = await createDb({ quiet: true });

const logs = async () => (await db.query('select * from public.anonymous_impact_logs order by created_at, id')).rows;
const last = async () => (await logs()).at(-1);
// Precies de kolommen die saveMood() in src/main.js bijwerkt.
const setMood = (pid, color, action = '', reason = '', signals = []) => as(U.client,
  `update public.profiles set current_mood = $2, last_self_action = $3, last_reason = $4,
     last_signals = $5::jsonb, mood_updated_at = now() where id = $1`,
  [pid, color, action, reason, JSON.stringify(signals)]);

console.log('\nKleurwissel zonder eigen actie komt in het logboek');
const pid = (await as(U.client, `insert into public.profiles (full_name) values ('Sanne') returning id`)).rows[0].id;
await setMood(pid, 'green');
let l = await last();
ok((await logs()).length === 1 && l.detail.startsWith('Start → Groen') && l.saved_euros === 0,
  'eerste kleurkeuze geeft 1 regel zonder bedrag: ' + l?.detail);
await setMood(pid, 'green');
ok((await logs()).length === 1, 'Groen → Groen (nog een keer tikken) geeft geen extra regel');
await setMood(pid, 'red');
l = await last();
ok((await logs()).length === 2 && l.detail.includes('Groen → Rood') && l.detail.includes('geen eigen actie'),
  'Rood zonder actie (2 tikken in de app) → 1 regel: ' + l.detail);
ok(l.saved_euros === 0 && l.informal_minutes === 0, 'naar Rood telt geen bedrag en geen minuten');
ok(!JSON.stringify(l).includes('Sanne'), 'geen naam in het logboek');

console.log('\nHerstel naar Groen met 1 tik');
await setMood(pid, 'green');
l = await last();
ok(l.detail.includes('Rood → Groen (herstel)') && l.saved_euros === 45 && l.informal_minutes === 30,
  'Rood → Groen zonder actie telt als herstel (rekenvoorbeeld €45 / 30 min): ' + l.detail);
await setMood(pid, 'orange', '10 minuten wandelen');
l = await last();
ok(l.detail.includes('eigen actie gekozen'), 'Oranje met actie: "eigen actie gekozen"');
await setMood(pid, 'green');
l = await last();
ok(l.saved_euros === 0 && l.detail.includes('vandaag al meegeteld'), 'tweede herstel op dezelfde dag telt niet dubbel');

console.log('\nDemo-profiel telt nooit mee');
const demoId = (await as(U.client, 'select public.create_demo_profile() as id')).rows[0].id;
const n = (await logs()).length;
await setMood(demoId, 'red');
await setMood(demoId, 'green');
ok((await logs()).length === n, 'wissels in het demo-profiel geven geen regels');

console.log('\nTerugblik na Rood: het plan voor Rood bijwerken');
const redPlan = (await as(U.client, `select id, self_actions, signal_chips from public.signaling_plans where profile_id = $1 and color = 'red'`, [pid])).rows[0];
await as(U.client, `update public.signaling_plans set self_actions = $2::jsonb, signal_chips = $3::jsonb where id = $1`,
  [redPlan.id, JSON.stringify(['Douchen']), JSON.stringify(['Niet meer slapen'])]);
const after = (await as(U.client, 'select self_actions, signal_chips from public.signaling_plans where id = $1', [redPlan.id])).rows[0];
ok(after.self_actions[0] === 'Douchen' && after.signal_chips[0] === 'Niet meer slapen', 'eigenaar kan het plan voor Rood aanvullen');
const strangerUpd = await as(U.stranger, `update public.signaling_plans set self_actions = '["hack"]'::jsonb where id = $1 returning id`, [redPlan.id]);
ok(strangerUpd.rows.length === 0, 'buitenstaander kan het plan niet wijzigen (0 rijen)');

console.log('\nWie ziet de terugblik? (melding van soort "mood")');
const anja = (await as(U.client, `insert into public.network_members (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance)
  values ($1, 'Anja', 'Familie / Ouder', 'anja@test.nl', true, false, false) returning *`, [pid])).rows[0];
const coach = (await as(U.client, `insert into public.network_members (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance)
  values ($1, 'Coach', 'Begeleider', 'coach@test.nl', false, true, false) returning *`, [pid])).rows[0];
await as(U.anja, 'select public.accept_invite($1)', [anja.invite_code]);
await as(U.coach, 'select public.accept_invite($1)', [coach.invite_code]);
// Precies wat saveReflection() in src/main.js opslaat.
await as(U.client, `insert into public.notifications (profile_id, kind, recipient, message) values ($1, 'mood', 'Anja', $2)`,
  [pid, 'Terugblik op Rood van Sanne: merkte: Niet meer slapen. wat hielp: Douchen']);
const vAnja = (await as(U.anja, 'select public.get_network_view($1) as v', [anja.id])).rows[0].v;
const vCoach = (await as(U.coach, 'select public.get_network_view($1) as v', [coach.id])).rows[0].v;
ok(vAnja.notifications.some((x) => x.message.startsWith('Terugblik op Rood')),
  'netwerklid MET vinkje "stoplicht zien" leest de terugblik (zo werkt het nu)');
ok(!vCoach.notifications.some((x) => x.message.startsWith('Terugblik op Rood')),
  'netwerklid ZONDER dat vinkje leest de terugblik niet');
ok(!vCoach.mood, 'netwerklid zonder vinkje ziet ook de kleur niet');
await expectError(U.stranger, 'select public.get_network_view($1)', [anja.id], 'buitenstaander kan het netwerkoverzicht niet openen');

done();
