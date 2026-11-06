// UI-doorlooptest (headless browser) tegen de lokale dev-server.
// De dev-server moet met een TESTproject draaien, niet met productie:
//   VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... npx vite --port 5299
//   EK_SUPABASE_URL=... EK_SUPABASE_KEY=... node tests/e2e/ui.test.mjs http://127.0.0.1:5299/
// De testaccounts (tests/e2e/.creds.json) maakt api.test.mjs aan.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://127.0.0.1:5199/';
// Welke database? Altijd via omgevingsvariabelen, zodat deze test standaard
// NIET tegen productie draait. Zie tests/README.md.
const SB_URL = process.env.EK_SUPABASE_URL;
const KEY = process.env.EK_SUPABASE_KEY;
if (!SB_URL || !KEY) {
  console.error('Zet EK_SUPABASE_URL en EK_SUPABASE_KEY (van een TESTproject). Zie tests/README.md.');
  process.exit(2);
}
if (SB_URL.includes('kjzkyjyvlrwisuxrytkt') && process.env.EK_ALLOW_PROD !== '1') {
  console.error('Geweigerd: dit is de productiedatabase. Gebruik een testproject (of zet bewust EK_ALLOW_PROD=1).');
  process.exit(2);
}
const creds = JSON.parse(fs.readFileSync(new URL('./.creds.json', import.meta.url), 'utf8'));

const shots = new URL('./shots/', import.meta.url);
fs.mkdirSync(shots, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { console.log(cond ? '  ✔' : '  ✘', msg); if (!cond) failures++; };
const consoleErrors = [];

const browser = await chromium.launch({ channel: process.env.EK_BROWSER_CHANNEL || 'chrome', headless: true });

async function newPage(ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, locale: 'nl-NL', ...ctxOpts });
  // Vangnet: draait de dev-server per ongeluk met productie-instellingen, dan
  // blokkeren we elk verzoek naar de productiedatabase en stopt de test.
  if (process.env.EK_ALLOW_PROD !== '1') {
    await ctx.route('https://kjzkyjyvlrwisuxrytkt.supabase.co/**', (route) => {
      console.error('\nGeblokkeerd: de app praat met de PRODUCTIEdatabase. Start de dev-server met VITE_SUPABASE_URL van het testproject.');
      route.abort();
      process.exit(2);
    });
  }
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(name + '.png', shots)), fullPage: false });
const visible = (page, sel) => page.locator(sel).first().isVisible();
async function waitToast(page, text) {
  await page.waitForFunction((t) => document.getElementById('toast-title').textContent.includes(t) && document.getElementById('push-toast').classList.contains('opacity-100'), text, { timeout: 15000 });
}

// ---------------------------------------------------------------- Cliënt
const { page: p } = await newPage();
await p.goto(BASE);
await p.waitForSelector('#screen-auth:not([hidden])', { timeout: 20000 });
ok(true, 'inlogscherm zichtbaar');
await p.click('#form-login .help-btn[data-help="auth-email"]');
ok(await visible(p, '#form-login .help-box'), '(?) uitleg opent bij e-mailveld');
await shot(p, '01-login');

await p.fill('#login-email', creds.client.email);
await p.fill('#login-password', creds.client.password);
await p.click('#form-login [type=submit]');
await p.waitForSelector('#screen-onboarding:not([hidden])', { timeout: 20000 });
ok(true, 'onboarding na inloggen (nog geen profiel)');
await shot(p, '02-onboarding');

await p.fill('#onb-name', 'Sanne de Boer');
await p.fill('#onb-sup', 'Mark');
await p.fill('#onb-budget', '70');
await p.fill('#onb-goal', 'Laptop');
await p.click('#form-onboarding-profile [type=submit]');
await p.waitForSelector('#screen-app:not([hidden])', { timeout: 20000 });
await p.waitForFunction(() => document.getElementById('client-title-name').textContent === 'Sanne de Boer');
ok(true, 'blanco profiel aangemaakt, dashboard zichtbaar');
ok((await p.textContent('#header-status-text')).includes('Nog niet ingevuld'), 'stoplicht start leeg');
ok((await p.textContent('#plan-daily-goals')).includes('Nog geen leerdoelen'), 'leerdoelen leeg');
ok((await p.textContent('#plan-signals-text')).includes('Nog niet ingevuld'), 'signaleringsplan leeg');
await shot(p, '03-blanco-dashboard');

// Stoplicht (pakket A): Oranje = één eigen actie is verplicht, de rest mag.
await p.click('#btn-color-orange');
await p.waitForSelector('#mood-modal:not([hidden])');
ok(await visible(p, '#mood-custom-action'), 'zonder plan-acties: meteen eigen actie typen');
await p.click('#mood-submit');
ok(await visible(p, '#mood-action-error'), 'Oranje: eigen actie verplicht');
await p.click('[data-action="toggle-mood-more"]');
await p.fill('#mood-reason', 'Brief van de gemeente, hoofd zit vol.');
ok(true, 'meer vertellen (mag) is in te vullen');
await p.fill('#mood-custom-action', '30 minuten wandelen');
await shot(p, '04-reflectie-modal');
await p.click('#mood-submit');
await p.waitForSelector('#mood-modal[hidden]', { state: 'attached' });
await p.waitForFunction(() => document.getElementById('client-header').className.includes('bg-amber-500'));
ok(true, 'header wordt oranje na opslaan');
ok((await p.textContent('#current-reflection-box')).includes('Brief van de gemeente'), 'status-update zichtbaar');
// De eigen actie wordt na het opslaan van de kleur in het plan bewaard (één extra verzoek).
const actionSaved = await p.waitForFunction(
  () => document.getElementById('plan-self-actions').textContent.includes('30 minuten wandelen'),
  null, { timeout: 10000 }).then(() => true, () => false);
ok(actionSaved, 'eigen actie bewaard in plan oranje (en meteen zichtbaar)');
// Pakket A: bij Oranje typ je geen nieuw signaal meer; je tikt alleen signalen uit je plan aan.
await shot(p, '05-oranje');

// Leerdoelen
await p.click('[data-action="new-goal"]');
await p.fill('#goal-edit-cat', 'Post');
await p.fill('#goal-edit-title', 'Brieven alleen op tafel leggen');
await p.click('#goal-form [type=submit]');
await p.waitForFunction(() => document.getElementById('plan-daily-goals').textContent.includes('Brieven alleen op tafel leggen'));
ok(true, 'leerdoel toegevoegd (oranje)');
await p.click('[data-action="edit-goal"]');
await p.fill('#goal-edit-title', 'Brieven op de vaste plek leggen');
await p.selectOption('#goal-edit-color', 'green');
await p.click('#goal-form [type=submit]');
await p.waitForFunction(() => document.getElementById('goals-color-label').textContent === 'Groen' && document.getElementById('plan-daily-goals').textContent.includes('vaste plek'));
ok(true, 'leerdoel gewijzigd en naar groen verplaatst');
await p.check('[data-change="toggle-goal"]');
await waitToast(p, 'Goed gedaan');
ok(true, 'leerdoel afvinken werkt');
await p.click('[data-action="delete-goal"]');
await p.click('#confirm-ok');
await p.waitForFunction(() => document.getElementById('plan-daily-goals').textContent.includes('Nog geen leerdoelen'));
ok(true, 'leerdoel verwijderd na bevestiging');

// Signaleringsplan-editor
await p.click('[data-phase-tabs], [data-action="view-phase"][data-color="green"]');
await p.click('[data-action="open-plan-editor"]');
await p.waitForSelector('#signaling-editor-modal:not([hidden])');
await p.fill('#sig-edit-signals', 'Ik slaap goed en heb overzicht.');
for (const [field, text] of [['signal_chips', 'Goed geslapen'], ['self_actions', 'Dagritme vasthouden'], ['self_actions', 'Sporten'], ['network_actions', 'Neem geen taken over']]) {
  await p.fill(`[data-sig-add-input="${field}"]`, text);
  await p.press(`[data-sig-add-input="${field}"]`, 'Enter');
}
await p.click('[data-action="sig-item-edit"][data-field="self_actions"][data-index="1"]');
await p.fill('[data-sig-edit-input="self_actions"]', 'Twee keer per week sporten');
await p.click('[data-action="sig-item-save"]');
await p.click('[data-action="sig-item-delete"][data-field="self_actions"][data-index="0"]');
ok(await visible(p, '#sig-dirty-note'), 'melding niet-opgeslagen wijzigingen');
await shot(p, '06-plan-editor');
await p.click('#sig-form [type=submit]');
await p.waitForSelector('#signaling-editor-modal[hidden]', { state: 'attached' });
const selfTxt = await p.textContent('#plan-self-actions');
ok(selfTxt.includes('Twee keer per week sporten') && !selfTxt.includes('Dagritme'), 'plan: toevoegen, wijzigen (✏️) en verwijderen (🗑️) opgeslagen');
ok((await p.textContent('#plan-network-actions')).includes('Neem geen taken over'), 'netwerk-tip opgeslagen');

// Keuze-tafel
await p.click('#cnav-keuze');
ok((await p.textContent('#scenario-comparison-container')).includes('Teken Gevolgen'), 'eigen keuze vraagt eerst om invoer');
await p.click('#scen-btn-scooter');
ok((await p.textContent('#scenario-comparison-container')).includes('Pad A: Nu op Krediet'), 'scooter-scenario getekend');
await shot(p, '07-keuzetafel');
await p.click('[data-action="choose-path"][data-pad="B"]');
await p.waitForFunction(() => document.getElementById('saved-choices-list').textContent.includes('10 Weken Sparen'));
ok(true, 'pad B bewaard');
await p.click('#scen-btn-custom');
await p.fill('#custom-dilemma-title', 'Nieuwe telefoon kopen');
await p.fill('#custom-dilemma-cost', '50');
await p.click('#custom-scenario-box [type=submit]');
const cmp = await p.textContent('#scenario-comparison-container');
ok(cmp.includes('Nog €20 van €70 over') && cmp.includes('Laptop'), 'eigen keuze rekent met weekgeld en spaardoel');

// Cirkel: netwerklid toevoegen
await p.click('#cnav-cirkel');
await p.click('[data-action="toggle-invite-form"]');
await p.fill('#invite-name', 'Test Netwerklid');
await p.selectOption('#invite-role', 'Familie / Ouder');
await p.fill('#invite-email', creds.member.email);
await p.click('#btn-submit-invite');
await p.waitForSelector('#invite-share-modal:not([hidden])');
const shareText = await p.textContent('#invite-share-body');
const codeMatch = shareText.match(/([A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})/);
ok(!!codeMatch, 'uitnodiging met code: ' + (codeMatch?.[1] || '?'));
ok((await p.getAttribute('#invite-share-body a[href^="mailto:"]', 'href')).includes('uitnodiging%3D'), 'mail-knop bevat uitnodigingslink');
await shot(p, '08-uitnodiging');
await p.click('#invite-share-modal [data-action="close-modal"]');
await p.uncheck('[data-change="toggle-perm"][data-field="can_see_finance"]').catch(() => {});
await p.check('[data-change="toggle-perm"][data-field="can_see_finance"]');
await waitToast(p, 'Kijkrechten');
ok(true, 'kijkrecht aanpassen werkt');
await shot(p, '09-cirkel');

// Opdracht
await p.click('#cnav-taken');
await p.fill('#task-input-title', 'Samen post ordenen');
await p.fill('#task-input-desc', 'Ligt klaar op tafel');
await p.selectOption('#task-input-duration', 'large');
await p.fill('#task-input-datetime', 'Woensdag 09:00');
await p.click('#btn-submit-task');
await p.waitForFunction(() => document.getElementById('client-tasks-list').textContent.includes('Samen post ordenen'));
ok((await p.textContent('#client-tasks-list')).includes('Groot (2 tot 3 uur)'), 'opdracht geplaatst (groot, open voor groep)');
await p.click('[data-action="edit-task"]');
await p.fill('#task-input-title', 'Samen post en brieven ordenen');
await p.click('#btn-submit-task');
await p.waitForFunction(() => document.getElementById('client-tasks-list').textContent.includes('post en brieven'));
ok(true, 'opdracht gewijzigd');

// Voorbeeldweergave
await p.click('#cnav-cirkel');
await p.click('[data-action="preview-member"]');
await p.waitForSelector('#dashboard-network:not([hidden])');
await p.waitForFunction(() => document.getElementById('net-preview-banner').textContent.includes('Voorbeeldweergave'));
ok((await p.textContent('#net-section-tasks')).includes('post en brieven'), 'voorbeeld: netwerk ziet opdracht');
ok(await p.locator('[data-action="net-accept"]').first().isDisabled(), 'voorbeeld (geen demo): reageren uitgeschakeld');
await shot(p, '10-netwerk-voorbeeld');
await p.click('#mode-btn-client');

// ---------------------------------------------------------------- Netwerklid via uitnodigingslink
const code = codeMatch[1].replace('-', '');
const { page: n } = await newPage();
await n.goto(BASE + '?uitnodiging=' + code);
await n.waitForSelector('#auth-invite-banner:not([hidden])', { timeout: 20000 });
ok((await n.textContent('#auth-invite-banner')).includes('Sanne'), 'uitnodigingsbanner toont naam cliënt');
await shot(n, '11-uitnodiging-banner');
await n.click('#auth-tab-login');
await n.fill('#login-email', creds.member.email);
await n.fill('#login-password', creds.member.password);
await n.click('#form-login [type=submit]');
await n.waitForSelector('#dashboard-network:not([hidden])', { timeout: 20000 });
await n.waitForFunction(() => document.getElementById('net-client-name').textContent === 'Sanne de Boer');
ok(true, 'netwerklid automatisch gekoppeld en in Netwerk Weergave');
ok((await n.textContent('#net-section-mood')).includes('Oranje'), 'netwerklid ziet stoplicht oranje');
ok((await n.textContent('#net-section-finance')).includes('10 Weken Sparen'), 'netwerklid ziet keuzes (vinkje aan)');
await n.click('[data-action="net-toggle-counter"]');
await n.fill('[data-form="counter"] input[id^="counter-time-"]', 'Donderdag 14:00');
await n.fill('[data-form="counter"] input[id^="counter-note-"]', 'Woensdag moet ik werken');
await n.click('[data-form="counter"] [type=submit]');
await waitToast(n, 'Voorstel Verzonden');
ok(true, 'tegenvoorstel verstuurd');
await shot(n, '12-netwerklid');

// ---------------------------------------------------------------- Terug naar cliënt: realtime + goedkeuren
await p.click('#cnav-taken');
await p.waitForFunction(() => document.getElementById('client-tasks-list').textContent.includes('Donderdag 14:00'), null, { timeout: 20000 });
ok(true, 'cliënt ziet tegenvoorstel live binnenkomen (realtime)');
ok(!(await p.locator('#tasks-badge').isHidden()), 'badge bij Opdrachten');
await shot(p, '13-tegenvoorstel');
await p.click('[data-action="approve-counter"]');
await p.waitForFunction(() => document.getElementById('client-tasks-list').textContent.includes('Geaccepteerd door Test Netwerklid'));
ok((await p.textContent('#client-tasks-list')).includes('Donderdag 14:00'), 'goedgekeurd met 1 klik, nieuwe tijd staat vast');
await p.click('[data-action="open-notifications"]');
ok((await p.textContent('#notifications-list')).includes('ander moment'), 'meldingen tonen reactie netwerk');
await p.click('#notifications-modal [data-action="close-modal"]');

// ---------------------------------------------------------------- Demo-profiel
await p.click('[data-action="open-account"]');
await p.click('#account-modal [data-action="load-demo"]');
await p.waitForFunction(() => document.getElementById('client-title-name').textContent.startsWith('Daan Vermeulen'), null, { timeout: 20000 });
ok(!(await p.locator('#header-demo-badge').isHidden()), 'demo-profiel geladen met Demo-label');
await p.click('#cnav-taken');
ok((await p.textContent('#client-tasks-list')).includes('Voorstel van Erik Vermeulen'), 'demo: tegenvoorstel van Erik zichtbaar');
await p.click('#cnav-cirkel');
await p.locator('#circle-members-list > div', { hasText: 'Erik Vermeulen' }).locator('[data-action="preview-member"]').click();
await p.waitForFunction(() => document.getElementById('net-viewer-name').textContent === 'Erik Vermeulen');
ok(!(await p.locator('[data-action="net-accept"]').first().isDisabled()), 'demo: reageren als netwerklid mogelijk');
await shot(p, '14-demo-netwerk');
await p.click('#mode-btn-client');
await p.click('[data-action="open-account"]');
ok((await p.textContent('#accounts-switcher-list')).includes('Sanne de Boer'), 'account-modal toont beide profielen');
await shot(p, '15-account');
await p.click('#account-modal [data-action="close-modal"]');

// Mobiel formaat
await p.setViewportSize({ width: 375, height: 760 });
await p.click('#cnav-status');
await shot(p, '16-mobiel');
const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
ok(!overflow, 'geen horizontale scroll op 375px');

console.log('\nConsole-fouten:', consoleErrors.length ? consoleErrors : 'geen');
if (consoleErrors.length) failures++;
await browser.close();
console.log(failures ? `\n${failures} MISLUKT` : '\nALLE UI-TESTS GESLAAGD');
process.exit(failures ? 1 : 0);
