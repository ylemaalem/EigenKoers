-- Demo-profiel: vaste volgorde van netwerkleden en leerdoelen (Anja, Mark, Erik, De Vries)
-- zodat lijsten altijd hetzelfde getoond worden.

create or replace function public.create_demo_profile()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pid uuid;
  v_anja uuid;
  v_mark uuid;
  v_erik uuid;
  v_vries uuid;
begin
  if v_uid is null then
    raise exception 'Je bent niet ingelogd.' using errcode = '28000';
  end if;

  insert into public.profiles (
    owner_id, full_name, supervisor_name, weekly_budget, savings_goal, current_mood,
    last_reason, last_self_action, last_signals, mood_updated_at, is_demo
  ) values (
    v_uid, 'Daan Vermeulen (Demo)', 'Mark', 80, 'Elektrische fiets (€750)', 'green',
    'Ik heb goed geslapen, mijn huis is opgeruimd en ik heb overzicht over mijn weekplanning.',
    'Vasthouden aan mijn vaste dagritme (op tijd opstaan en zelf koken).',
    '["Goed geslapen", "Huis is opgeruimd"]'::jsonb, now(), true
  ) returning id into v_pid;

  update public.signaling_plans set
    signals_text = 'Daan slaapt 7 tot 8 uur per nacht, reageert rustig op berichten, houdt zijn keuken bij en vraagt op tijd hulp als een brief onduidelijk is.',
    signal_chips = '["Goed geslapen", "Huis is opgeruimd", "Geen post-stress", "Zin in de dag"]'::jsonb,
    self_actions = '["Vasthouden aan mijn vaste dagritme (op tijd opstaan en zelf koken).", "Post op woensdag direct op het vaste plankje leggen.", "Twee keer per week sporten of wandelen."]'::jsonb,
    network_actions = '["Neem geen taken over (''handen op de rug''), laat Daan zelf het initiatief nemen.", "Geef een compliment als zijn administratie en huishouden op orde zijn."]'::jsonb
  where profile_id = v_pid and color = 'green';

  update public.signaling_plans set
    signals_text = 'Daan wordt kortaf aan de telefoon, laat post ongeopend liggen, stelt het koken uit en trekt zich terug met games.',
    signal_chips = '["Hoofd zit vol prikkels", "Slecht geslapen", "Overzicht kwijt bij post", "Snel geïrriteerd"]'::jsonb,
    self_actions = '["Taken kleiner maken: brieven alleen op tafel leggen, nog niet zelf oplossen.", "Vanavond geen drukke visite en 30 minuten wandelen met muziek.", "Een concrete opdracht uitzetten in de app voor ondersteuning."]'::jsonb,
    network_actions = '["Bel Daan vandaag NIET onverwacht over lastige brieven of geld.", "Stuur een kort, positief berichtje zonder druk en gun hem rust."]'::jsonb
  where profile_id = v_pid and color = 'orange';

  update public.signaling_plans set
    signals_text = 'Daan neemt de telefoon niet meer op, reageert boos of in paniek en dreigt impulsieve keuzes te maken met werk of geld.',
    signal_chips = '["Volledig overprikkeld", "Boosheid of paniek", "Ik overzie het niet meer"]'::jsonb,
    self_actions = '["Noodrem: 24 uur lang geen geld uitgeven en geen grote beslissingen nemen.", "Met koptelefoon op ontprikkelen en alleen contact hebben met begeleider Mark."]'::jsonb,
    network_actions = '["Alle gewone leerdoelen staan vandaag op pauze; stel geen eisen.", "Begeleider Mark neemt als eerste contact op om rustig af te stemmen."]'::jsonb
  where profile_id = v_pid and color = 'red';

  insert into public.learning_goals (profile_id, color, category, title, is_completed, created_at) values
    (v_pid, 'green',  'Zelfstandig Huishouden',   'Zelf gezonde maaltijd koken en keuken direct opruimen', false, now() + interval '1 second'),
    (v_pid, 'green',  'Administratie & Regie',    'Binnengekomen post controleren en klaarleggen voor donderdag', true, now() + interval '2 seconds'),
    (v_pid, 'orange', 'Opgeknipt Doel (Oranje)',  'Brieven nog niet openmaken, alleen op de eettafel leggen', false, now() + interval '3 seconds'),
    (v_pid, 'orange', 'Simpele Maaltijd',         'Zelf een makkelijke tosti of gebakken ei maken', false, now() + interval '4 seconds'),
    (v_pid, 'red',    'Veiligheid & Rust',        '1 uur ontprikkelen en vandaag geen uitgaven doen', false, now() + interval '5 seconds'),
    (v_pid, 'red',    'Vast Contactpunt',         'Kort telefonisch contact met begeleider Mark om 16:00', false, now() + interval '6 seconds');

  insert into public.network_members (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance, created_at)
  values (v_pid, 'Anja Vermeulen', 'Familie / Ouder', 'anja.vermeulen@voorbeeld.nl', true, true, false, now() + interval '1 second')
  returning id into v_anja;
  insert into public.network_members (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance, created_at)
  values (v_pid, 'Mark Jansen', 'Ambulant Begeleider', 'm.jansen@voorbeeld.nl', true, true, true, now() + interval '2 second')
  returning id into v_mark;
  insert into public.network_members (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance, created_at)
  values (v_pid, 'Erik Vermeulen', 'Familie / Oom', 'erik.vermeulen@voorbeeld.nl', true, true, false, now() + interval '3 second')
  returning id into v_erik;
  insert into public.network_members (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance, created_at)
  values (v_pid, 'Dhr. H. de Vries', 'Bewindvoerder', 'info@devriesbewind.voorbeeld.nl', false, false, true, now() + interval '4 second')
  returning id into v_vries;

  insert into public.tasks (
    profile_id, title, description, duration, requested_time, target_type, target_name, status,
    counter_by, counter_by_member_id, counter_proposal_time, counter_note
  ) values (
    v_pid, 'Samen 2 brieven van gemeente en zorgverzekering bekijken',
    'Ze liggen al geopend op tafel, ik wil weten of ik iets moet invullen.',
    'hour', 'Woensdag 09:00 uur', 'open', 'Open voor hele groep', 'counter',
    'Erik Vermeulen', v_erik, 'Donderdag 14:00 uur',
    'Hoi Daan, woensdagochtend moet ik werken, maar ik kan donderdag om 14:00 uur een uurtje langskomen. Past dat?'
  );

  insert into public.saved_choices (profile_id, title, chosen_path) values
    (v_pid, 'Scooter op afbetaling of Sparen',
     '🛡️ Pad B: 3 Maanden Doelgericht Sparen (€75 p/m apart zetten, €80 weekgeld behouden)');

  insert into public.notifications (profile_id, kind, recipient, message, member_id, from_network, created_at) values
    (v_pid, 'system', 'Daan', 'Demo-profiel geladen. Alles wat je hier doet, blijft in dit demo-profiel.', null, false, now() - interval '2 minutes'),
    (v_pid, 'task', 'Daan', 'Erik Vermeulen stelt een ander moment voor bij "Brieven bekijken": Donderdag 14:00 uur.', v_erik, true, now() - interval '1 minute'),
    (v_pid, 'mood', 'Anja, Mark, Erik', 'Daan Vermeulen staat op GROEN: "Ik heb goed geslapen, mijn huis is opgeruimd en ik heb overzicht over mijn weekplanning."', null, false, now());

  return v_pid;
end;
$$;

revoke all on function public.create_demo_profile() from public, anon;
grant execute on function public.create_demo_profile() to authenticated;
