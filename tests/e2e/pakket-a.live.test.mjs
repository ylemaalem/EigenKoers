// Live test pakket A tegen een Supabase-TESTproject, in de echte app.
// Doet: Oranje (eigen actie verplicht), Rood (112-tekst, alleen bevestigen),
// Groen in 1 tik, terugblik na Rood (Later → herinnering → bewaren),
// en controleert daarna via de API wat er werkelijk is opgeslagen.
//
// Gebruik (dev-server draait met VITE_SUPABASE_URL van het testproject):
//   EK_SUPABASE_URL=... EK_SUPABASE_KEY=... node tests/e2e/pakket-a.live.test.mjs http://127.0.0.1:5299/
// De logboekregels (anonymous_impact_logs) zijn alleen voor de beheerder leesbaar;
// die controleer je daarna in de SQL-editor van het testproject (zie de uitvoer).
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://127.0.0.1:5299/';
const URL = process.env.EK_SUPABASE_URL;
const KEY = process.env.EK_SUPABASE_KEY;
if (!URL || !KEY) { console.error('Zet EK_SUPABASE_URL en EK_SUPABASE_KEY (testproject).'); process.exit(2); }
if (URL.includes('kjzkyjyvlrwisuxrytkt') && process.env.EK_ALLOW_PROD !== '1') { console.error('Geweigerd: productie.'); process.exit(2); }

let failures = 0;
const ok = (c, m) => { console.log(c ? '  ✔' : '  ✘', m); if (!c) failures++; };
const sbc = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const tag = crypto.randomBytes(3).toString('hex');
const pw = () => crypto.randomBytes(12).toString('base64url');
const client = { email: `ek-a-client-${tag}@example.com`, password: pw(), name: 'Pakket A Cliënt' };
const member = { email: `ek-a-netwerk-${tag}@example.com`, password: pw(), name: 'Anja Test' };

for (const u of [client, member]) {
  const res = await fetch(`${URL}/functions/v1/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
    body: JSON.stringify({ email: u.email, password: u.password, full_name: u.name }),
  });
  ok(res.status === 200, `account ${u.email.split('@')[0]} aangemaakt`);
}
const C = sbc(); const M = sbc();
await C.auth.signInWithPassword({ email: client.email, password: client.password });
await M.auth.signInWithPassword({ email: member.email, password: member.password });

// Profiel met plan (Oranje: 1 actie, Rood: 1 signaal + 1 actie) en een netwerklid met "stoplicht zien".
const { data: prof } = await C.from('profiles').insert({ full_name: 'Pakket A Cliënt' }).select().single();
const { data: plans } = await C.from('signaling_plans').select('*').eq('profile_id', prof.id);
const plan = Object.fromEntries(plans.map((p) => [p.color, p]));
await C.from('signaling_plans').update({ self_actions: ['10 minuten wandelen'] }).eq('id', plan.orange.id);
await C.from('signaling_plans').update({ signal_chips: ['Niet meer slapen'], self_actions: ['Op bed met koptelefoon'] }).eq('id', plan.red.id);
await C.from('profiles').update({ current_mood: 'green', mood_updated_at: new Date().toISOString() }).eq('id', prof.id);
const { data: mem } = await C.from('network_members').insert({ profile_id: prof.id, name: 'Anja Test', role: 'Familie / Ouder', email: member.email, can_see_mood: true, can_see_tasks: true, can_see_finance: false }).select().single();
ok(!(await M.rpc('accept_invite', { p_code: mem.invite_code })).error, 'netwerklid gekoppeld');

const browser = await chromium.launch({ channel: process.env.EK_BROWSER_CHANNEL || 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'nl-NL' });
await ctx.route('https://kjzkyjyvlrwisuxrytkt.supabase.co/**', (r) => { console.error('Geblokkeerd: productie.'); r.abort(); process.exit(2); });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(BASE);
await p.waitForSelector('#screen-auth:not([hidden])', { timeout: 20000 });
await p.fill('#login-email', client.email);
await p.fill('#login-password', client.password);
await p.click('#form-login [type=submit]');
await p.waitForSelector('#btn-color-orange', { state: 'visible', timeout: 20000 });
const mood = async () => (await C.from('profiles').select('current_mood,last_self_action,last_reason').eq('id', prof.id).single()).data;

console.log('\nOranje');
await p.click('#btn-color-orange');
await p.waitForSelector('#mood-modal:not([hidden])');
await p.click('#mood-submit');
ok(await p.isVisible('#mood-action-error') && (await mood()).current_mood === 'green', 'zonder eigen actie: geweigerd, niets opgeslagen');
await p.click('button[data-action="pick-mood-action"][data-index="0"]');
await p.click('#mood-submit');
await p.waitForSelector('#mood-modal', { state: 'hidden' });
let m = await mood();
ok(m.current_mood === 'orange' && m.last_self_action === '10 minuten wandelen', 'Oranje opgeslagen in de database met eigen actie');

console.log('\nRood');
await p.click('#btn-color-red');
await p.waitForSelector('#mood-modal:not([hidden])');
ok((await p.innerText('#mood-body')).includes('geen nooddienst') && await p.locator('#mood-body a[href="tel:112"]').count() === 1, '112-tekst en belknop zichtbaar');
await p.click('#mood-submit');
await p.waitForSelector('#mood-modal', { state: 'hidden' });
m = await mood();
ok(m.current_mood === 'red' && m.last_self_action === '', 'Rood opgeslagen zonder eigen actie');
const view = (await M.rpc('get_network_view', { p_member_id: mem.id })).data;
ok(view?.mood?.color === 'red', 'netwerklid ziet Rood direct');

console.log('\nGroen + terugblik');
await p.click('#btn-color-green');
await p.waitForSelector('#reflect-modal:not([hidden])', { timeout: 10000 });
ok((await mood()).current_mood === 'green', 'Groen in 1 tik opgeslagen');
await p.click('#reflect-form button[data-action="reflect-later"].btn-soft');
await p.waitForSelector('#reflect-modal', { state: 'hidden' });
ok(await p.isVisible('#reflect-banner'), 'Later: herinnering blijft staan');
await p.reload();
await p.waitForSelector('#btn-color-orange', { state: 'visible', timeout: 20000 });
ok(await p.waitForSelector('#reflect-banner:not([hidden])', { timeout: 10000 }).then(() => true, () => false),
  'herinnering staat er na herladen nog (localStorage)');
await p.click('button[data-action="reflect-open"]');
await p.waitForSelector('#reflect-modal:not([hidden])');
await p.click('button[data-action="reflect-toggle"][data-kind="signals"][data-index="0"]');
await p.fill('#reflect-new-action', 'Douchen');
await p.click('#reflect-form button[type=submit]');
await p.waitForSelector('#reflect-modal', { state: 'hidden' });
const red = (await C.from('signaling_plans').select('self_actions').eq('id', plan.red.id).single()).data;
ok(red.self_actions.includes('Douchen'), 'terugblik bewaard in plan Rood (database)');
ok(!(await p.isVisible('#reflect-banner')), 'herinnering weg na bewaren');
const notes = (await M.rpc('get_network_view', { p_member_id: mem.id })).data.notifications || [];
ok(notes.some((n) => n.message.startsWith('Terugblik op Rood')), 'LET OP: netwerklid met "stoplicht zien" leest de terugblik');

console.log('\nOranje met zelf getypte actie');
await p.click('#btn-color-orange');
await p.click('button[data-action="pick-mood-action"][data-index="custom"]');
await p.fill('#mood-custom-action', 'Thee zetten');
await p.click('#mood-submit');
await p.waitForSelector('#mood-modal', { state: 'hidden' });
await p.click('#cnav-status').catch(() => {});
const shown = await p.waitForFunction(() => document.getElementById('plan-self-actions').textContent.includes('Thee zetten'), null, { timeout: 10000 }).then(() => true, () => false);
ok(shown, 'eigen actie direct zichtbaar in het plan');
const orange = (await C.from('signaling_plans').select('self_actions').eq('id', plan.orange.id).single()).data;
ok(orange.self_actions.includes('Thee zetten'), 'eigen actie bewaard als knop (database)');

ok(!errors.length, 'geen JavaScript-fouten' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(`\nVerwacht in anonymous_impact_logs (SQL-editor testproject), 5 regels STOPLICHT_TRANSITIE:`);
console.log('  Start → Groen · geen eigen actie | Groen → Oranje · eigen actie | Oranje → Rood · geen eigen actie | Rood → Groen (herstel) €45/30 min | Groen → Oranje · eigen actie');
console.log(failures ? `\n${failures} MISLUKT` : '\nALLE PAKKET A-LIVETESTS GESLAAGD');
process.exit(failures ? 1 : 0);
