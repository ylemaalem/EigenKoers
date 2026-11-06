// End-to-end backendtest tegen een Supabase-TESTproject (via de publieke sleutel, zoals de browser).
// Gebruik: EK_SUPABASE_URL=... EK_SUPABASE_KEY=... node tests/e2e/api.test.mjs
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';

// Welke database? Altijd via omgevingsvariabelen, zodat deze test standaard
// NIET tegen productie draait. Zie tests/README.md.
const URL = process.env.EK_SUPABASE_URL;
const KEY = process.env.EK_SUPABASE_KEY;
if (!URL || !KEY) {
  console.error('Zet EK_SUPABASE_URL en EK_SUPABASE_KEY (van een TESTproject). Zie tests/README.md.');
  process.exit(2);
}
if (URL.includes('kjzkyjyvlrwisuxrytkt') && process.env.EK_ALLOW_PROD !== '1') {
  console.error('Geweigerd: dit is de productiedatabase. Gebruik een testproject (of zet bewust EK_ALLOW_PROD=1).');
  process.exit(2);
}
const credsFile = new globalThis.URL('./.creds.json', import.meta.url);

let creds;
if (fs.existsSync(credsFile)) {
  creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
} else {
  const tag = crypto.randomBytes(3).toString('hex');
  const pw = () => crypto.randomBytes(12).toString('base64url');
  creds = {
    client: { email: `ek-test-client-${tag}@example.com`, password: pw(), name: 'Test Cliënt' },
    member: { email: `ek-test-netwerk-${tag}@example.com`, password: pw(), name: 'Test Netwerklid' },
  };
  fs.writeFileSync(credsFile, JSON.stringify(creds, null, 2));
}

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? '  ✔' : '  ✘', msg); if (!cond) failures++; };
const client = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function register(u) {
  const res = await fetch(`${URL}/functions/v1/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY },
    body: JSON.stringify({ email: u.email, password: u.password, full_name: u.name }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

console.log('Registratie');
for (const u of [creds.client, creds.member]) {
  const r = await register(u);
  ok(r.status === 200 || r.body.error === 'email_exists', `register ${u.email.split('@')[0]} → ${r.status} ${r.body.error || 'ok'}`);
}
const dup = await register(creds.client);
ok(dup.status === 409 && dup.body.error === 'email_exists', 'dubbele registratie → 409 email_exists');
const weak = await register({ email: 'x@example.com', password: '123', name: 'X' });
ok(weak.status === 400 && weak.body.error === 'weak_password', 'zwak wachtwoord geweigerd');

const C = client();
const M = client();
let r = await C.auth.signInWithPassword({ email: creds.client.email, password: creds.client.password });
ok(!r.error, 'cliënt kan inloggen ' + (r.error?.message || ''));
r = await M.auth.signInWithPassword({ email: creds.member.email, password: creds.member.password });
ok(!r.error, 'netwerklid kan inloggen ' + (r.error?.message || ''));
const bad = await client().auth.signInWithPassword({ email: creds.client.email, password: 'fout-wachtwoord' });
ok(!!bad.error, 'fout wachtwoord geweigerd');

console.log('\nBlanco profiel');
const { data: prof, error: pe } = await C.from('profiles').insert({ full_name: 'API Test Cliënt', supervisor_name: 'Mark', weekly_budget: 70, savings_goal: 'Laptop' }).select().single();
ok(!pe && prof, 'profiel aangemaakt ' + (pe?.message || ''));
const pid = prof.id;
const { data: plans } = await C.from('signaling_plans').select('*').eq('profile_id', pid);
ok(plans.length === 3 && plans.every((p) => p.signals_text === '' && p.self_actions.length === 0 && p.signal_chips.length === 0), '3 lege signaleringsplannen');
ok(prof.current_mood === null, 'stoplicht start leeg');

console.log('\nPlan, leerdoelen, stoplicht');
const orange = plans.find((p) => p.color === 'orange');
let u = await C.from('signaling_plans').update({ signals_text: 'Kortaf', signal_chips: ['Slecht geslapen'], self_actions: ['Wandelen'], network_actions: ['Niet bellen'] }).eq('id', orange.id);
ok(!u.error, 'plan oranje bijgewerkt');
const g = await C.from('learning_goals').insert({ profile_id: pid, color: 'orange', category: 'Post', title: 'Brieven klaarleggen' }).select().single();
ok(!g.error, 'leerdoel toegevoegd');
u = await C.from('learning_goals').update({ color: 'green', title: 'Brieven op vaste plek' }).eq('id', g.data.id);
ok(!u.error, 'leerdoel gewijzigd + verplaatst');
u = await C.from('profiles').update({ current_mood: 'orange', last_reason: 'Druk hoofd', last_self_action: 'Wandelen', last_signals: ['Slecht geslapen'], mood_updated_at: new Date().toISOString() }).eq('id', pid);
ok(!u.error, 'stoplicht op oranje');
const forbid = await C.from('profiles').update({ is_demo: true }).eq('id', pid);
ok(!!forbid.error, 'is_demo niet zelf te zetten');

console.log('\nNetwerk + uitnodiging');
const mem = await C.from('network_members').insert({ profile_id: pid, name: 'Test Netwerklid', role: 'Familie / Ouder', email: creds.member.email.toUpperCase(), can_see_mood: true, can_see_tasks: true, can_see_finance: false }).select().single();
ok(!mem.error && mem.data.email === creds.member.email && /^[A-HJ-NP-Z2-9]{8}$/.test(mem.data.invite_code), 'netwerklid + code ' + (mem.error?.message || mem.data.invite_code));
const code = mem.data.invite_code;
const anonPeek = await client().rpc('peek_invite', { p_code: code.slice(0, 4) + '-' + code.slice(4).toLowerCase() });
ok(anonPeek.data?.client_first_name === 'API', 'peek_invite zonder login: ' + JSON.stringify(anonPeek.data));
const beforeJoin = await M.rpc('get_network_view', { p_member_id: mem.data.id });
ok(!!beforeJoin.error, 'netwerklid ziet niets vóór koppelen');
const acc = await M.rpc('accept_invite', { p_code: code });
ok(!acc.error && acc.data.member_id === mem.data.id, 'uitnodiging geaccepteerd ' + (acc.error?.message || ''));
const nets = await M.rpc('list_my_networks');
ok(nets.data?.length === 1, 'netwerklid ziet 1 netwerk');
const direct = await M.from('profiles').select('*');
ok(direct.data?.length === 0, 'netwerklid heeft geen directe tabeltoegang');

console.log('\nOpdrachten + tegenvoorstel');
const t = await C.from('tasks').insert({ profile_id: pid, title: 'Post ordenen', description: 'Ligt klaar', duration: 'hour', requested_time: 'Woensdag 09:00', target_type: 'open', target_name: 'Open voor hele groep' }).select().single();
ok(!t.error, 'opdracht geplaatst');
await C.from('notifications').insert({ profile_id: pid, kind: 'mood', recipient: 'Test', message: 'Stoplicht oranje' });
let view = await M.rpc('get_network_view', { p_member_id: mem.data.id });
ok(!view.error && view.data.mood?.color === 'orange' && view.data.mood.network_actions[0] === 'Niet bellen', 'netwerk ziet stoplicht + tips');
ok(view.data.tasks?.length === 1 && view.data.choices === undefined, 'netwerk ziet opdracht, geen keuzes');
let rpc = await M.rpc('network_counter_task', { p_member_id: mem.data.id, p_task_id: t.data.id, p_time: 'Donderdag 14:00', p_note: 'Woensdag werk ik' });
ok(!rpc.error, 'tegenvoorstel gedaan ' + (rpc.error?.message || ''));
let task = (await C.from('tasks').select('*').eq('id', t.data.id).single()).data;
ok(task.status === 'counter' && task.counter_proposal_time === 'Donderdag 14:00', 'cliënt ziet tegenvoorstel');
u = await C.from('tasks').update({ requested_time: task.counter_proposal_time, status: 'accepted', accepted_by: task.counter_by, accepted_by_member_id: task.counter_by_member_id, counter_by: '', counter_by_member_id: null, counter_proposal_time: '', counter_note: '' }).eq('id', task.id);
ok(!u.error, 'cliënt keurt goed met 1 klik');
rpc = await M.rpc('network_accept_task', { p_member_id: mem.data.id, p_task_id: t.data.id });
ok(!!rpc.error, 'al ingeplande opdracht niet nogmaals te accepteren');

console.log('\nKijkrechten');
await C.from('network_members').update({ can_see_mood: false, can_see_tasks: false, can_see_finance: true }).eq('id', mem.data.id);
await C.from('saved_choices').insert({ profile_id: pid, title: 'Scooter', chosen_path: 'Pad B' });
view = await M.rpc('get_network_view', { p_member_id: mem.data.id });
ok(view.data.mood === undefined && view.data.tasks === undefined && view.data.choices?.length === 1, 'vinkjes direct toegepast');

console.log('\nDemo-profiel');
const demo = await C.rpc('create_demo_profile');
ok(!demo.error, 'demo geladen');
const dp = (await C.from('profiles').select('*').eq('id', demo.data).single()).data;
ok(dp.is_demo && dp.full_name.startsWith('Daan'), 'demo = Daan Vermeulen');
const dm = (await C.from('network_members').select('*').eq('profile_id', demo.data)).data;
const erik = dm.find((m) => m.name === 'Erik Vermeulen');
view = await C.rpc('get_network_view', { p_member_id: erik.id });
ok(view.data.preview && view.data.can_act, 'voorbeeldweergave demo: mag reageren');
const realPreview = await C.rpc('network_accept_task', { p_member_id: mem.data.id, p_task_id: t.data.id });
ok(!!realPreview.error, 'eigenaar kan niet namens echt netwerklid reageren');

console.log('\nOpruimen (testprofielen)');
const del1 = await C.from('profiles').delete().eq('id', demo.data);
const del2 = await C.from('profiles').delete().eq('id', pid);
ok(!del1.error && !del2.error, 'testprofielen verwijderd');
const left = await C.from('profiles').select('id');
ok(left.data.length === 0, 'cliënt heeft geen profielen meer');

console.log(failures ? `\n${failures} MISLUKT` : '\nALLE API-TESTS GESLAAGD');
process.exit(failures ? 1 : 0);
