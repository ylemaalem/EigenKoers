-- =============================================================================
-- EigenKoers – Super Admin-portaal en anoniem Impact-Logboek
--
-- * public.anonymous_impact_logs: anonieme gebeurtenissen voor subsidie-
--   verantwoording (ZonMw / gemeente). Er staan GEEN namen, e-mailadressen of
--   vrije teksten in. Alleen een onherleidbare client_hash (HMAC met een geheime
--   sleutel), het soort gebeurtenis, een korte vaste toelichting en de
--   rekenwaarden.
-- * Gebeurtenissen worden ALLEEN door de database zelf gelogd (triggers). Er is
--   bewust geen INSERT-recht voor gebruikers: zo kan niemand nep-events of
--   verzonnen bedragen toevoegen, en blijft het logboek betrouwbaar.
-- * Demo-profielen worden nooit gelogd of meegeteld.
-- * Alleen de beheerder (private.app_admins + bevestigd e-mailadres) kan het
--   logboek lezen en het overzicht opvragen.
--
-- Rekenregels
--   STOPLICHT_TRANSITIE            elke wissel van kleur waarbij de cliënt een eigen
--                                  actie koos. Herstel van Oranje/Rood naar Groen:
--                                  +30 min informele zorg en +€45 (max. 1x per dag
--                                  per cliënt meegeteld).
--   KEUZETAFEL_PAD_A               keuze voor Pad A (impuls): €0.
--   KEUZETAFEL_PAD_B               keuze voor Pad B (slimme stap): +€55 bespaarde schadelast.
--   NETWERK_OPDRACHT_GEACCEPTEERD  netwerklid accepteert een opdracht, of de cliënt
--                                  bevestigt een tegenvoorstel (1x per opdracht):
--                                  15-30 min = 30 min, 1 uur = 60 min,
--                                  2-3 uur = 150 min, dagdeel = 240 min;
--                                  bespaarde WMO-kosten = minuten x €65 per uur.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Beheerders
-- -----------------------------------------------------------------------------
create table private.app_admins (
  email      text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  created_at timestamptz not null default now()
);
comment on table private.app_admins is 'E-mailadressen met toegang tot het Super Admin-portaal.';
revoke all on private.app_admins from public, anon, authenticated;

insert into private.app_admins (email) values ('y.lemaalem@gmail.com')
on conflict (email) do nothing;

-- Beheerder = ingelogd met een bevestigd account waarvan het e-mailadres in
-- private.app_admins staat. Het e-mailadres komt uit auth.users (niet uit de
-- JWT), zodat een oude of aangepaste token geen rol speelt.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join private.app_admins a on a.email = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Geheime sleutel voor de anonieme client_hash
-- -----------------------------------------------------------------------------
create table private.impact_settings (
  id   boolean primary key default true check (id),
  salt text not null
);
revoke all on private.impact_settings from public, anon, authenticated;

insert into private.impact_settings (salt)
values (encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

-- Onherleidbare code per cliëntprofiel (zelfde profiel = zelfde code).
create or replace function private.impact_hash(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(encode(extensions.hmac(p_profile_id::text, s.salt, 'sha256'), 'hex'), 16)
  from private.impact_settings s;
$$;
revoke all on function private.impact_hash(uuid) from public;

create or replace function private.color_label(p_color text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_color
    when 'green'  then 'Groen'
    when 'orange' then 'Oranje'
    when 'red'    then 'Rood'
    else 'Start'
  end;
$$;
revoke all on function private.color_label(text) from public;

-- -----------------------------------------------------------------------------
-- 3. Het logboek
-- -----------------------------------------------------------------------------
create table public.anonymous_impact_logs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  client_hash      text not null check (char_length(client_hash) between 8 and 64),
  event_type       text not null check (event_type in (
                     'STOPLICHT_TRANSITIE', 'KEUZETAFEL_PAD_A', 'KEUZETAFEL_PAD_B',
                     'NETWERK_OPDRACHT_GEACCEPTEERD')),
  detail           text check (char_length(detail) <= 300),
  saved_euros      integer not null default 0 check (saved_euros >= 0),
  informal_minutes integer not null default 0 check (informal_minutes >= 0)
);
comment on table public.anonymous_impact_logs is
  'Anoniem impact-logboek voor subsidieverantwoording. Alleen leesbaar voor de beheerder; alleen te vullen door database-triggers.';
create index anonymous_impact_logs_created_idx on public.anonymous_impact_logs (created_at desc);
create index anonymous_impact_logs_type_created_idx on public.anonymous_impact_logs (event_type, created_at desc);
create index anonymous_impact_logs_client_idx on public.anonymous_impact_logs (client_hash, event_type, created_at desc);

alter table public.anonymous_impact_logs enable row level security;

create policy "Alleen beheerder leest het impact-logboek" on public.anonymous_impact_logs
  for select to authenticated
  using ((select private.is_admin()));

revoke all on public.anonymous_impact_logs from anon, authenticated;
grant select on public.anonymous_impact_logs to authenticated;
grant all on public.anonymous_impact_logs to service_role;

-- Opdrachten die al zijn meegeteld (zodat één opdracht nooit dubbel telt).
create table private.impact_logged_tasks (
  task_id   uuid primary key,
  logged_at timestamptz not null default now()
);
revoke all on private.impact_logged_tasks from public, anon, authenticated;

-- Eén plek die logt. Gaat er iets mis, dan gaat de actie van de cliënt gewoon
-- door: het logboek mag het gebruik van de app nooit blokkeren.
create or replace function private.log_impact(
  p_profile_id uuid, p_event text, p_detail text, p_euros integer, p_minutes integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.anonymous_impact_logs (client_hash, event_type, detail, saved_euros, informal_minutes)
  values (
    private.impact_hash(p_profile_id),
    p_event,
    left(p_detail, 300),
    greatest(coalesce(p_euros, 0), 0),
    greatest(coalesce(p_minutes, 0), 0)
  );
exception when others then
  raise warning 'EigenKoers impact-log mislukt (%): %', p_event, sqlerrm;
end;
$$;
revoke all on function private.log_impact(uuid, text, text, integer, integer) from public;

-- -----------------------------------------------------------------------------
-- 4. Automatisch loggen
-- -----------------------------------------------------------------------------

-- 4a. Stoplicht: andere kleur + eigen actie gekozen.
create or replace function private.impact_on_mood_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash     text;
  v_recovery boolean;
  v_credit   boolean := false;
  v_signals  int;
begin
  if new.is_demo
     or new.current_mood is null
     or new.current_mood is not distinct from old.current_mood
     or btrim(coalesce(new.last_self_action, '')) = '' then
    return null;
  end if;

  begin
    v_recovery := old.current_mood in ('orange', 'red') and new.current_mood = 'green';
    if v_recovery then
      v_hash := private.impact_hash(new.id);
      v_credit := not exists (
        select 1 from public.anonymous_impact_logs l
        where l.client_hash = v_hash
          and l.event_type = 'STOPLICHT_TRANSITIE'
          and l.saved_euros > 0
          and l.created_at >= (date_trunc('day', now() at time zone 'Europe/Amsterdam') at time zone 'Europe/Amsterdam')
      );
    end if;
    v_signals := case when jsonb_typeof(new.last_signals) = 'array' then jsonb_array_length(new.last_signals) else 0 end;

    perform private.log_impact(
      new.id,
      'STOPLICHT_TRANSITIE',
      format('%s → %s%s · %s %s aangevinkt · eigen actie gekozen',
        private.color_label(old.current_mood),
        private.color_label(new.current_mood),
        case when v_recovery and v_credit then ' (herstel)'
             when v_recovery then ' (herstel, vandaag al meegeteld)'
             else '' end,
        v_signals,
        case when v_signals = 1 then 'signaal' else 'signalen' end),
      case when v_credit then 45 else 0 end,
      case when v_credit then 30 else 0 end
    );
  exception when others then
    raise warning 'EigenKoers impact-log stoplicht mislukt: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function private.impact_on_mood_change() from public;

create trigger profiles_impact_mood
  after update of current_mood on public.profiles
  for each row execute function private.impact_on_mood_change();

-- 4b. Keuze-Tafel: welk scenario en welk pad (A of B).
alter table public.saved_choices
  add column scenario_key text check (scenario_key in ('scooter', 'werk_stoppen', 'geld_uitlenen', 'custom')),
  add column pad          text check (pad in ('A', 'B'));
comment on column public.saved_choices.scenario_key is 'Categorie op de Keuze-Tafel (voor het anonieme logboek, zonder de eigen titel).';
comment on column public.saved_choices.pad is 'Gekozen pad: A (impuls) of B (slimme stap).';
grant insert (scenario_key, pad) on public.saved_choices to authenticated;

create or replace function private.impact_on_choice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_demo boolean;
  v_pad  text := new.pad;
begin
  begin
    select p.is_demo into v_demo from public.profiles p where p.id = new.profile_id;
    if coalesce(v_demo, true) then
      return null;
    end if;
    if v_pad is null then
      v_pad := case
        when new.chosen_path ~* 'pad\s*b' then 'B'
        when new.chosen_path ~* 'pad\s*a' then 'A'
      end;
    end if;
    if v_pad is null then
      return null;
    end if;

    perform private.log_impact(
      new.profile_id,
      case when v_pad = 'B' then 'KEUZETAFEL_PAD_B' else 'KEUZETAFEL_PAD_A' end,
      format('Keuze-Tafel: %s · gekozen voor Pad %s (%s)',
        case new.scenario_key
          when 'scooter'       then 'Kopen op krediet'
          when 'werk_stoppen'  then 'Werk stoppen'
          when 'geld_uitlenen' then 'Geld uitlenen'
          when 'custom'        then 'Eigen keuze'
          else 'Onbekend scenario'
        end,
        v_pad,
        case when v_pad = 'B' then 'slimme stap' else 'impuls' end),
      case when v_pad = 'B' then 55 else 0 end,
      0
    );
  exception when others then
    raise warning 'EigenKoers impact-log keuze mislukt: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function private.impact_on_choice() from public;

create trigger saved_choices_impact
  after insert on public.saved_choices
  for each row execute function private.impact_on_choice();

-- 4c. Netwerk: opdracht geaccepteerd of tegenvoorstel bevestigd (1x per opdracht).
create or replace function private.impact_on_task_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_demo    boolean;
  v_minutes int;
  v_role    text;
begin
  if new.status <> 'accepted'
     or old.status = 'accepted'
     or new.accepted_by_member_id is null then
    return null;
  end if;

  begin
    select p.is_demo into v_demo from public.profiles p where p.id = new.profile_id;
    if coalesce(v_demo, true) then
      return null;
    end if;

    insert into private.impact_logged_tasks (task_id) values (new.id)
    on conflict (task_id) do nothing;
    if not found then
      return null;
    end if;

    v_minutes := case new.duration
      when 'short'    then 30
      when 'hour'     then 60
      when 'large'    then 150
      when 'half_day' then 240
      else 60
    end;
    select m.role into v_role from public.network_members m where m.id = new.accepted_by_member_id;

    perform private.log_impact(
      new.profile_id,
      'NETWERK_OPDRACHT_GEACCEPTEERD',
      format('Opdracht %s · %s · %s · netwerklid: %s',
        case new.duration
          when 'short' then '15-30 min'
          when 'hour'  then '1 uur'
          when 'large' then '2-3 uur'
          else 'heel dagdeel'
        end,
        case when new.target_type = 'open' then 'open voor de groep' else 'gevraagd aan 1 persoon' end,
        case when old.status = 'counter' then 'tegenvoorstel bevestigd' else 'direct geaccepteerd' end,
        case when v_role in ('Familie / Ouder', 'Familie / Overig', 'Ambulant Begeleider', 'Bewindvoerder',
                             'Vriend / Buur / Kennis', 'Werk / Dagbesteding')
             then v_role else 'Anders' end),
      round(v_minutes * 65 / 60.0)::int,
      v_minutes
    );
  exception when others then
    raise warning 'EigenKoers impact-log opdracht mislukt: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function private.impact_on_task_accepted() from public;

create trigger tasks_impact_accepted
  after update of status on public.tasks
  for each row execute function private.impact_on_task_accepted();

-- -----------------------------------------------------------------------------
-- 5. RPC's voor het Admin-portaal
-- -----------------------------------------------------------------------------
create or replace function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin();
$$;

-- Overzicht: tellingen (zonder namen) + totalen uit het logboek in de gekozen periode.
create or replace function public.admin_dashboard(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.is_admin() then
    raise exception 'Alleen de beheerder heeft toegang tot dit overzicht.' using errcode = '42501';
  end if;

  with l as (
    select * from public.anonymous_impact_logs x
    where (p_from is null or x.created_at >= p_from)
      and (p_to is null or x.created_at < p_to)
  ),
  p as (
    select * from public.profiles where not is_demo
  ),
  m as (
    select nm.* from public.network_members nm join p on p.id = nm.profile_id
  )
  select jsonb_build_object(
    'accounts',          (select count(*) from auth.users),
    'clients',           (select count(*) from p),
    'members',           (select count(*) from m),
    'members_joined',    (select count(*) from m where m.user_id is not null),
    'mood', jsonb_build_object(
      'green',  (select count(*) from p where current_mood = 'green'),
      'orange', (select count(*) from p where current_mood = 'orange'),
      'red',    (select count(*) from p where current_mood = 'red'),
      'none',   (select count(*) from p where current_mood is null)
    ),
    'events',            (select count(*) from l),
    'unique_clients',    (select count(distinct client_hash) from l),
    'informal_minutes',  (select coalesce(sum(informal_minutes), 0) from l),
    'saved_euros',       (select coalesce(sum(saved_euros), 0) from l),
    'mood_events',       (select count(*) from l where event_type = 'STOPLICHT_TRANSITIE'),
    'recoveries',        (select count(*) from l where event_type = 'STOPLICHT_TRANSITIE' and saved_euros > 0),
    'pad_a',             (select count(*) from l where event_type = 'KEUZETAFEL_PAD_A'),
    'pad_b',             (select count(*) from l where event_type = 'KEUZETAFEL_PAD_B'),
    'network_tasks',     (select count(*) from l where event_type = 'NETWERK_OPDRACHT_GEACCEPTEERD'),
    'network_minutes',   (select coalesce(sum(informal_minutes), 0) from l where event_type = 'NETWERK_OPDRACHT_GEACCEPTEERD'),
    'first_event_at',    (select min(created_at) from public.anonymous_impact_logs),
    'generated_at',      now()
  ) into result;

  return result;
end;
$$;

revoke all on function public.am_i_admin() from public, anon;
revoke all on function public.admin_dashboard(timestamptz, timestamptz) from public, anon;
grant execute on function public.am_i_admin() to authenticated;
grant execute on function public.admin_dashboard(timestamptz, timestamptz) to authenticated;
