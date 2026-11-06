import json, time, sys, threading, http.server, socketserver, functools, os
from playwright.sync_api import sync_playwright

DIST = sys.argv[1]
PORT = int(os.environ.get("EK_PORT", "4180"))
REF = 'kjzkyjyvlrwisuxrytkt'
UID = '11111111-1111-1111-1111-111111111111'
PID = '22222222-2222-2222-2222-222222222222'

profile = {"id": PID, "owner_id": UID, "full_name": "Test Cliënt", "supervisor_name": "Mark", "weekly_budget": 80,
           "savings_goal": "", "current_mood": "green", "last_reason": "", "last_self_action": "", "last_signals": [],
           "mood_updated_at": "2026-11-06T10:00:00Z", "is_demo": False, "created_at": "2026-11-01T10:00:00Z", "updated_at": "2026-11-06T10:00:00Z"}
def plan(c, chips, acts, net):
    return {"id": f"plan-{c}", "profile_id": PID, "color": c, "signals_text": "", "signal_chips": chips, "self_actions": acts, "network_actions": net}
plans = [plan('green', [], ['Rustig ontbijten'], ['Zelf aan zet']),
         plan('orange', ['Slecht geslapen', 'Post laten liggen'], ['10 minuten wandelen', 'Muziek luisteren'], ['Geen post bespreken']),
         plan('red', ['Niet meer slapen'], ['Op bed liggen met koptelefoon'], ['Bel mij even'])]
members = [{"id": "m1", "profile_id": PID, "name": "Moeder Anja", "role": "Familie / Ouder", "email": "a@example.com", "user_id": None,
            "can_see_mood": True, "can_see_tasks": True, "can_see_finance": False, "invite_code": "ABCD1234", "joined_at": None, "created_at": "2026-11-01T10:00:00Z"}]
calls = {"profile_patch": [], "notif": [], "plan_patch": []}

def handle(route):
    req = route.request; url = req.url; m = req.method
    def ok(body, status=200):
        route.fulfill(status=status, content_type='application/json', body=json.dumps(body))
    if '/auth/v1/user' in url:
        return ok({"id": UID, "email": "test@example.com", "aud": "authenticated", "role": "authenticated"})
    if '/rest/v1/rpc/list_my_networks' in url: return ok([])
    if '/rest/v1/rpc/am_i_admin' in url: return ok(False)
    if '/rest/v1/profiles' in url:
        if m == 'PATCH':
            body = json.loads(req.post_data); calls["profile_patch"].append(body); profile.update(body)
            return ok(profile)
        single = 'vnd.pgrst.object' in (req.headers.get('accept') or '')
        return ok(profile if single else [profile])
    if '/rest/v1/signaling_plans' in url:
        if m == 'PATCH':
            body = json.loads(req.post_data); calls["plan_patch"].append((url, body)); return ok([])
        return ok(plans)
    if '/rest/v1/network_members' in url: return ok(members)
    if '/rest/v1/notifications' in url:
        if m == 'POST':
            body = json.loads(req.post_data); calls["notif"].append(body)
            row = dict(body, id=f"n{len(calls['notif'])}", created_at="2026-11-06T12:00:00Z")
            return ok(row)
        return ok([])
    if '/rest/v1/' in url: return ok([])
    return ok({})

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIST)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
httpd = socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=DIST))
threading.Thread(target=httpd.serve_forever, daemon=True).start()

session = {"access_token": "fake.jwt.token", "refresh_token": "r", "token_type": "bearer", "expires_in": 3600,
           "expires_at": int(time.time()) + 3600, "user": {"id": UID, "email": "test@example.com", "aud": "authenticated", "role": "authenticated"}}
results = []
def check(name, cond):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name)

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    ctx.add_init_script(f"localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(session))});")
    ctx.route(f"https://{REF}.supabase.co/**", handle)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{PORT}/")
    page.wait_for_selector('#btn-color-orange', state='visible', timeout=15000)
    page.screenshot(path='/home/claude/shots/01_start.png')

    # Oranje: 1 tik open, zonder keuze opslaan -> foutmelding
    page.click('#btn-color-orange')
    page.wait_for_selector('#mood-modal:not([hidden])')
    page.screenshot(path='/home/claude/shots/02_oranje.png')
    page.click('#mood-submit')
    check('Oranje zonder actie geweigerd', page.is_visible('#mood-action-error') and len(calls['profile_patch']) == 0)
    page.click('button[data-action="pick-mood-action"][data-index="0"]')
    page.click('#mood-submit')
    page.wait_for_selector('#mood-modal', state='hidden')
    check('Oranje opgeslagen met 3 tikken', calls['profile_patch'][-1]['current_mood'] == 'orange' and calls['profile_patch'][-1]['last_self_action'] == '10 minuten wandelen')
    check('Oranje zonder tekst toegestaan', calls['profile_patch'][-1]['last_reason'] == '')

    # Rood: 2 tikken, geen actie verplicht, 112 zichtbaar
    page.click('#btn-color-red')
    page.wait_for_selector('#mood-modal:not([hidden])')
    check('112-tekst bij Rood', page.locator('#mood-body a[href="tel:112"]').count() == 1 and 'geen nooddienst' in page.inner_text('#mood-body'))
    page.screenshot(path='/home/claude/shots/03_rood.png')
    page.click('#mood-submit')
    page.wait_for_selector('#mood-modal', state='hidden')
    check('Rood opgeslagen zonder actie (2 tikken)', calls['profile_patch'][-1]['current_mood'] == 'red' and calls['profile_patch'][-1]['last_self_action'] == '')
    check('Melding zonder lege aanhalingstekens', calls['notif'][-1]['message'] == 'Test Cliënt staat op ROOD')

    # Groen: 1 tik, daarna terugblik-vraag
    n_before = len(calls['profile_patch'])
    page.click('#btn-color-green')
    page.wait_for_selector('#reflect-modal:not([hidden])', timeout=5000)
    check('Groen in 1 tik', len(calls['profile_patch']) == n_before + 1 and calls['profile_patch'][-1]['current_mood'] == 'green')
    check('Terugblik verschijnt na Rood', page.is_visible('#reflect-modal'))
    page.screenshot(path='/home/claude/shots/04_terugblik.png')
    page.click('#reflect-form button[data-action="reflect-later"].btn-soft')
    page.wait_for_selector('#reflect-modal', state='hidden')
    check('Later: herinnering blijft staan', page.is_visible('#reflect-banner') and 'terugkijken' in page.inner_text('#reflect-banner'))
    page.screenshot(path='/home/claude/shots/05_banner.png', full_page=False)
    page.click('button[data-action="reflect-open"]')
    page.wait_for_selector('#reflect-modal:not([hidden])')
    page.click('button[data-action="reflect-toggle"][data-kind="signals"][data-index="0"]')
    page.fill('#reflect-new-action', 'Douchen')
    page.click('#reflect-form button[type=submit]')
    page.wait_for_selector('#reflect-modal', state='hidden')
    check('Terugblik bewaard in plan Rood', any('plan-red' in u and b.get('self_actions', [])[-1:] == ['Douchen'] for u, b in calls['plan_patch']))
    check('Terugblik als melding', 'Terugblik op Rood' in calls['notif'][-1]['message'])
    check('Herinnering weg na bewaren', not page.is_visible('#reflect-banner'))

    # Oranje met zelf getypte actie -> wordt knop in plan
    page.click('#btn-color-orange')
    page.click('button[data-action="pick-mood-action"][data-index="custom"]')
    page.fill('#mood-custom-action', 'Thee zetten')
    page.click('#mood-submit')
    page.wait_for_selector('#mood-modal', state='hidden')
    check('Eigen actie bewaard als knop', any('plan-orange' in u and b.get('self_actions', [])[-1:] == ['Thee zetten'] for u, b in calls['plan_patch']))

    # Voorleesknop in uitleg
    page.click('button[data-help="stoplicht"]')
    check('Voorleesknop in uitleg', page.locator('.help-box button[data-action="read-aloud"]').count() == 1)
    page.screenshot(path='/home/claude/shots/06_uitleg.png')
    check('Geen JavaScript-fouten', not errors)
    if errors: print(errors)
    b.close()
httpd.shutdown()
print(f"\n{sum(r for _, r in results)}/{len(results)} geslaagd")
