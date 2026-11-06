// Databasetests: basisschema, RLS, netwerkfuncties en demo-profiel.
// Draait op PGlite met alle migraties. Gebruik: npm run test:db
import { createDb } from './_setup.mjs';

const { db, ok, as, expectError, done, U } = await createDb();

console.log('Profile + blank plans');
const prof = await as(U.client, `insert into public.profiles (full_name, supervisor_name, weekly_budget, savings_goal) values ('Test Cliënt', 'Mark', 70, 'Laptop') returning *`);
const pid = prof.rows[0].id;
ok(prof.rows[0].owner_id === U.client, 'owner_id defaults to auth.uid()');
ok(prof.rows[0].current_mood === null, 'new profile starts without mood (blank)');
const plans = await as(U.client, `select color, signals_text, self_actions from public.signaling_plans where profile_id = $1 order by color`, [pid]);
ok(plans.rows.length === 3, '3 signaling plans auto-created');
ok(plans.rows.every(r => r.signals_text === '' && r.self_actions.length === 0), 'plans are 100% blank');
await expectError(U.client, `insert into public.profiles (full_name, owner_id) values ('x', '${U.stranger}')`, [], 'cannot set owner_id for someone else');
await expectError(U.client, `update public.profiles set is_demo = true where id = '${pid}'`, [], 'cannot set is_demo');

console.log('\nRLS isolation');
const strangerSees = await as(U.stranger, `select * from public.profiles`);
ok(strangerSees.rows.length === 0, 'stranger sees no profiles');
const strangerPlans = await as(U.stranger, `select * from public.signaling_plans`);
ok(strangerPlans.rows.length === 0, 'stranger sees no plans');
const upd = await as(U.stranger, `update public.profiles set full_name = 'hacked' where id = $1 returning id`, [pid]);
ok(upd.rows.length === 0, 'stranger cannot update profile');
await expectError(U.stranger, `insert into public.learning_goals (profile_id, color, title) values ($1, 'green', 'x')`, [pid], 'stranger cannot insert goal into foreign profile');
await expectError(null, `select * from public.profiles`, [], 'anon has no table access');

console.log('\nGoals, plan editing, mood');
await as(U.client, `insert into public.learning_goals (profile_id, color, category, title) values ($1, 'orange', 'Post', 'Brieven klaarleggen')`, [pid]);
await as(U.client, `update public.signaling_plans set signal_chips = '["Slecht geslapen"]', self_actions = '["Wandelen"]', network_actions = '["Niet bellen"]', signals_text = 'Kortaf' where profile_id = $1 and color = 'orange'`, [pid]);
await as(U.client, `update public.profiles set current_mood = 'orange', last_reason = 'Druk hoofd', last_self_action = 'Wandelen', last_signals = '["Slecht geslapen"]', mood_updated_at = now() where id = $1`, [pid]);
const p2 = await as(U.client, `select current_mood, updated_at > created_at as touched from public.profiles where id = $1`, [pid]);
ok(p2.rows[0].current_mood === 'orange', 'mood updated');
await expectError(U.client, `update public.profiles set current_mood = 'purple' where id = '${pid}'`, [], 'invalid mood rejected');

console.log('\nNetwork members + invite');
const mem = await as(U.client, `insert into public.network_members (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance) values ($1, 'Anja', 'Familie / Ouder', '  Anja@Test.nl ', true, true, false) returning *`, [pid]);
const anjaMember = mem.rows[0];
ok(anjaMember.email === 'anja@test.nl', 'email normalized to lowercase/trimmed');
ok(/^[A-HJ-NP-Z2-9]{8}$/.test(anjaMember.invite_code), 'invite code generated: ' + anjaMember.invite_code);
await expectError(U.client, `insert into public.network_members (profile_id, name, email, user_id) values ('${pid}', 'X', 'x@test.nl', '${U.stranger}')`, [], 'client cannot set user_id directly');
await expectError(U.client, `insert into public.network_members (profile_id, name, email) values ('${pid}', 'Dubbel', 'ANJA@test.nl')`, [], 'duplicate email per profile rejected');

const peek = await as(null, `select public.peek_invite($1) as r`, [anjaMember.invite_code.slice(0, 4).toLowerCase() + '-' + anjaMember.invite_code.slice(4)]);
ok(peek.rows[0].r && peek.rows[0].r.client_first_name === 'Test' && peek.rows[0].r.email_masked === 'a•••@test.nl', 'anon peek_invite works with dash/lowercase: ' + JSON.stringify(peek.rows[0].r));
const peekBad = await as(null, `select public.peek_invite('ZZZZZZZZ') as r`);
ok(peekBad.rows[0].r === null, 'peek_invite unknown code → null');
await expectError(null, `select public.accept_invite('${anjaMember.invite_code}')`, [], 'anon cannot accept invite');
await expectError(U.stranger, `select public.accept_invite('${anjaMember.invite_code}')`, [], 'stranger (wrong email) cannot accept invite');
await expectError(U.stranger, `select public.get_network_view('${anjaMember.id}')`, [], 'stranger cannot read network view');
const acc = await as(U.anja, `select public.accept_invite($1) as r`, [anjaMember.invite_code]);
ok(acc.rows[0].r.member_id === anjaMember.id, 'anja accepts invite');
const nets = await as(U.anja, `select * from public.list_my_networks()`);
ok(nets.rows.length === 1 && nets.rows[0].client_name === 'Test Cliënt', 'anja lists her network');
const anjaTable = await as(U.anja, `select * from public.profiles`);
ok(anjaTable.rows.length === 0, 'anja has no direct table access to profile');

console.log('\nNetwork view filtering');
await as(U.client, `insert into public.saved_choices (profile_id, title, chosen_path) values ($1, 'Scooter', 'Pad B')`, [pid]);
const t1 = await as(U.client, `insert into public.tasks (profile_id, title, description, duration, requested_time, target_type, target_name) values ($1, 'Post ordenen', 'Ligt klaar', 'hour', 'Woensdag 09:00', 'open', 'Open voor hele groep') returning id`, [pid]);
const mem2 = await as(U.client, `insert into public.network_members (profile_id, name, role, email) values ($1, 'Erik', 'Familie', 'erik@test.nl') returning id`, [pid]);
await as(U.client, `insert into public.tasks (profile_id, title, duration, requested_time, target_type, target_name, target_member_id) values ($1, 'Alleen Erik', 'short', 'Vrijdag', 'specific', 'Erik', $2)`, [pid, mem2.rows[0].id]);
await as(U.client, `insert into public.notifications (profile_id, kind, recipient, message) values ($1, 'mood', 'Anja', 'Stoplicht oranje'), ($1, 'choice', 'x', 'Keuze bewaard'), ($1, 'circle', 'x', 'Privé circle-log')`, [pid]);
let view = (await as(U.anja, `select public.get_network_view($1) as v`, [anjaMember.id])).rows[0].v;
ok(view.preview === false && view.can_act === true, 'anja: real view, can act');
ok(view.mood && view.mood.color === 'orange' && view.mood.network_actions[0] === 'Niet bellen', 'anja sees mood + orange network actions');
ok(view.tasks.length === 1 && view.tasks[0].title === 'Post ordenen', 'anja sees open task only (not Erik-specific)');
ok(view.choices === undefined, 'anja cannot see choices (finance off)');
ok(view.notifications.some(n => n.message === 'Stoplicht oranje') && !view.notifications.some(n => n.kind === 'choice' || n.message === 'Privé circle-log'), 'notifications filtered by permission');
await as(U.client, `update public.network_members set can_see_mood = false where id = $1`, [anjaMember.id]);
view = (await as(U.anja, `select public.get_network_view($1) as v`, [anjaMember.id])).rows[0].v;
ok(view.mood === undefined, 'mood hidden after unticking');

console.log('\nAccept / counter flow');
await as(U.anja, `select public.network_counter_task($1, $2, 'Donderdag 14:00', '')`, [anjaMember.id, t1.rows[0].id]);
let task = (await as(U.client, `select * from public.tasks where id = $1`, [t1.rows[0].id])).rows[0];
ok(task.status === 'counter' && task.counter_by === 'Anja' && task.counter_note.includes('Donderdag 14:00'), 'counter proposal stored');
const notif = await as(U.client, `select * from public.notifications where from_network order by created_at desc limit 1`);
ok(notif.rows[0].message.includes('ander moment'), 'client gets notification of counter');
// client approves with 1 click
await as(U.client, `update public.tasks set requested_time = counter_proposal_time, status = 'accepted', accepted_by = counter_by, accepted_by_member_id = counter_by_member_id, counter_by = '', counter_by_member_id = null, counter_proposal_time = '', counter_note = '' where id = $1`, [t1.rows[0].id]);
task = (await as(U.client, `select * from public.tasks where id = $1`, [t1.rows[0].id])).rows[0];
ok(task.status === 'accepted' && task.requested_time === 'Donderdag 14:00' && task.accepted_by === 'Anja', 'client approved counter');
await expectError(U.anja, `select public.network_accept_task('${anjaMember.id}', '${t1.rows[0].id}')`, [], 'cannot accept already accepted task');
await expectError(U.anja, `select public.network_counter_task('${anjaMember.id}', '${t1.rows[0].id}', '', '')`, [], 'empty counter time rejected');
const t3 = await as(U.client, `insert into public.tasks (profile_id, title, duration, requested_time) values ($1, 'Milieustraat', 'half_day', 'Zaterdag') returning id`, [pid]);
await as(U.anja, `select public.network_accept_task($1, $2)`, [anjaMember.id, t3.rows[0].id]);
task = (await as(U.client, `select * from public.tasks where id = $1`, [t3.rows[0].id])).rows[0];
ok(task.status === 'accepted' && task.accepted_by_member_id === anjaMember.id, 'anja accepted open task');
await as(U.client, `update public.network_members set can_see_tasks = false where id = $1`, [anjaMember.id]);
await expectError(U.anja, `select public.network_accept_task('${anjaMember.id}', '${t3.rows[0].id}')`, [], 'no task actions without permission');

console.log('\nTarget member must belong to same profile');
const other = await as(U.stranger, `insert into public.profiles (full_name) values ('Ander') returning id`);
const otherMem = await as(U.stranger, `insert into public.network_members (profile_id, name, email) values ($1, 'Z', 'z@test.nl') returning id`, [other.rows[0].id]);
await expectError(U.client, `insert into public.tasks (profile_id, title, requested_time, target_type, target_member_id) values ('${pid}', 'x', 'y', 'specific', '${otherMem.rows[0].id}')`, [], 'foreign member id rejected');

console.log('\nPreview mode (owner)');
view = (await as(U.client, `select public.get_network_view($1) as v`, [mem2.rows[0].id])).rows[0].v;
ok(view.preview === true && view.can_act === false, 'owner preview of real profile is read-only');
await expectError(U.client, `select public.network_accept_task('${mem2.rows[0].id}', '${t3.rows[0].id}')`, [], 'owner cannot act in non-demo preview');

console.log('\nEmail change resets link');
await as(U.client, `update public.network_members set email = 'anja.nieuw@test.nl' where id = $1`, [anjaMember.id]);
const reset = (await as(U.client, `select * from public.network_members where id = $1`, [anjaMember.id])).rows[0];
ok(reset.user_id === null && reset.invite_code !== anjaMember.invite_code, 'email change unlinks + new code');

console.log('\nDemo profile');
const demo = await as(U.client, `select public.create_demo_profile() as id`);
const demoId = demo.rows[0].id;
const demoP = (await as(U.client, `select * from public.profiles where id = $1`, [demoId])).rows[0];
ok(demoP.is_demo === true && demoP.full_name.startsWith('Daan'), 'demo profile created');
const demoCounts = (await as(U.client, `select
  (select count(*) from public.learning_goals where profile_id = $1)::int g,
  (select count(*) from public.network_members where profile_id = $1)::int m,
  (select count(*) from public.tasks where profile_id = $1)::int t,
  (select count(*) from public.saved_choices where profile_id = $1)::int c,
  (select jsonb_array_length(signal_chips) from public.signaling_plans where profile_id = $1 and color = 'green')::int chips`, [demoId])).rows[0];
ok(demoCounts.g === 6 && demoCounts.m === 4 && demoCounts.t === 1 && demoCounts.c === 1 && demoCounts.chips === 4, 'demo data complete: ' + JSON.stringify(demoCounts));
const erik = (await as(U.client, `select id from public.network_members where profile_id = $1 and name = 'Erik Vermeulen'`, [demoId])).rows[0];
const demoTask = (await as(U.client, `select id from public.tasks where profile_id = $1`, [demoId])).rows[0];
view = (await as(U.client, `select public.get_network_view($1) as v`, [erik.id])).rows[0].v;
ok(view.preview === true && view.can_act === true && view.tasks[0].counter_by_me === true, 'demo preview can act, counter_by_me true');
await as(U.client, `select public.network_accept_task($1, $2)`, [erik.id, demoTask.id]);
ok(true, 'owner can act in demo preview');
const vries = (await as(U.client, `select id from public.network_members where profile_id = $1 and role = 'Bewindvoerder'`, [demoId])).rows[0];
view = (await as(U.client, `select public.get_network_view($1) as v`, [vries.id])).rows[0].v;
ok(view.mood === undefined && view.tasks === undefined && Array.isArray(view.choices), 'bewindvoerder sees only choices');

console.log('\nCascade delete');
await as(U.client, `delete from public.profiles where id = $1`, [demoId]);
const left = (await db.query(`select count(*)::int c from public.network_members where profile_id = $1`, [demoId])).rows[0].c;
ok(left === 0, 'deleting profile cascades');

done();
