-- =============================================================================
-- EigenKoers – databaseschema
--
-- Tabellen (allemaal met Row Level Security):
--   profiles, signaling_plans, learning_goals, network_members, tasks,
--   saved_choices, notifications
--
-- Toegangsmodel
--   * Eigenaar (cliënt of begeleider die het profiel aanmaakte): volledig
--     beheer van alle eigen rijen via RLS (owner_id = auth.uid()).
--   * Netwerkleden: GEEN directe tabeltoegang. Ze lezen en reageren alleen via
--     SECURITY DEFINER-functies die per vinkje (can_see_mood / can_see_tasks /
--     can_see_finance) filteren. Koppelen gebeurt met een persoonlijke
--     uitnodigingscode + het e-mailadres waarmee ze zijn ingelogd.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Hulpfuncties
-- -----------------------------------------------------------------------------

-- Leesbare uitnodigingscode van 8 tekens (geen 0/O/1/I om verwarring te voorkomen).
create or replace function private.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(8);
  result text := '';
  i int;
begin
  for i in 0..7 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

create or replace function private.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function private.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then ''
    else left(p_email, 1) || '•••@' || split_part(p_email, '@', 2)
  end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. profiles
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  full_name        text not null check (char_length(btrim(full_name)) between 1 and 120),
  supervisor_name  text not null default '' check (char_length(supervisor_name) <= 120),
  weekly_budget    numeric(10, 2) check (weekly_budget is null or (weekly_budget >= 0 and weekly_budget <= 100000)),
  savings_goal     text not null default '' check (char_length(savings_goal) <= 200),
  current_mood     text check (current_mood in ('green', 'orange', 'red')),
  last_reason      text not null default '' check (char_length(last_reason) <= 2000),
  last_self_action text not null default '' check (char_length(last_self_action) <= 500),
  last_signals     jsonb not null default '[]'::jsonb check (jsonb_typeof(last_signals) = 'array'),
  mood_updated_at  timestamptz,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.profiles is 'Cliëntprofiel. Een gebruiker (cliënt of begeleider) kan meerdere profielen beheren.';
create index profiles_owner_id_idx on public.profiles (owner_id);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. signaling_plans (precies één rij per kleur per profiel)
-- -----------------------------------------------------------------------------
create table public.signaling_plans (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  color           text not null check (color in ('green', 'orange', 'red')),
  signals_text    text not null default '' check (char_length(signals_text) <= 4000),
  signal_chips    jsonb not null default '[]'::jsonb check (jsonb_typeof(signal_chips) = 'array'),
  self_actions    jsonb not null default '[]'::jsonb check (jsonb_typeof(self_actions) = 'array'),
  network_actions jsonb not null default '[]'::jsonb check (jsonb_typeof(network_actions) = 'array'),
  updated_at      timestamptz not null default now(),
  unique (profile_id, color)
);
comment on column public.signaling_plans.signal_chips is 'Korte signalen die de cliënt in de reflectie-check kan aanvinken.';

create trigger signaling_plans_touch_updated_at
  before update on public.signaling_plans
  for each row execute function private.touch_updated_at();

-- Nieuw profiel => drie lege plannen (groen/oranje/rood). Blanco, geen voorbeeldtekst.
create or replace function private.create_signaling_plans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.signaling_plans (profile_id, color)
  values (new.id, 'green'), (new.id, 'orange'), (new.id, 'red')
  on conflict (profile_id, color) do nothing;
  return new;
end;
$$;

create trigger profiles_create_signaling_plans
  after insert on public.profiles
  for each row execute function private.create_signaling_plans();

-- -----------------------------------------------------------------------------
-- 3. learning_goals
-- -----------------------------------------------------------------------------
create table public.learning_goals (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  color        text not null check (color in ('green', 'orange', 'red')),
  category     text not null default '' check (char_length(category) <= 120),
  title        text not null check (char_length(btrim(title)) between 1 and 300),
  is_completed boolean not null default false,
  created_at   timestamptz not null default now()
);
create index learning_goals_profile_color_idx on public.learning_goals (profile_id, color);

-- -----------------------------------------------------------------------------
-- 4. network_members
-- -----------------------------------------------------------------------------
create table public.network_members (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  role            text not null default '' check (char_length(role) <= 80),
  email           text not null check (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  user_id         uuid references auth.users (id) on delete set null,
  can_see_mood    boolean not null default true,
  can_see_tasks   boolean not null default true,
  can_see_finance boolean not null default false,
  invite_code     text not null unique,
  joined_at       timestamptz,
  created_at      timestamptz not null default now()
);
create unique index network_members_profile_email_key on public.network_members (profile_id, lower(email));
create index network_members_user_id_idx on public.network_members (user_id);

-- E-mail normaliseren, code genereren, en bij een nieuw e-mailadres de koppeling verbreken.
create or replace function private.network_members_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.invite_code := private.generate_invite_code();
    new.user_id := null;
    new.joined_at := null;
  elsif new.email is distinct from old.email then
    new.invite_code := private.generate_invite_code();
    new.user_id := null;
    new.joined_at := null;
  end if;
  return new;
end;
$$;

create trigger network_members_before_write
  before insert or update on public.network_members
  for each row execute function private.network_members_before_write();

-- -----------------------------------------------------------------------------
-- 5. tasks
-- -----------------------------------------------------------------------------
create table public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references public.profiles (id) on delete cascade,
  title                 text not null check (char_length(btrim(title)) between 1 and 200),
  description           text not null default '' check (char_length(description) <= 2000),
  duration              text not null default 'hour' check (duration in ('short', 'hour', 'large', 'half_day')),
  requested_time        text not null check (char_length(btrim(requested_time)) between 1 and 120),
  target_type           text not null default 'open' check (target_type in ('open', 'specific')),
  target_name           text not null default '' check (char_length(target_name) <= 120),
  target_member_id      uuid references public.network_members (id) on delete set null,
  status                text not null default 'open' check (status in ('open', 'accepted', 'counter')),
  accepted_by           text not null default '' check (char_length(accepted_by) <= 120),
  accepted_by_member_id uuid references public.network_members (id) on delete set null,
  counter_by            text not null default '' check (char_length(counter_by) <= 120),
  counter_by_member_id  uuid references public.network_members (id) on delete set null,
  counter_proposal_time text not null default '' check (char_length(counter_proposal_time) <= 120),
  counter_note          text not null default '' check (char_length(counter_note) <= 1000),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on column public.tasks.duration is 'short = 15-30 min, hour = 1 uur, large = 2-3 uur, half_day = heel dagdeel';
create index tasks_profile_created_idx on public.tasks (profile_id, created_at desc);
create index tasks_target_member_idx on public.tasks (target_member_id);
create index tasks_accepted_member_idx on public.tasks (accepted_by_member_id);
create index tasks_counter_member_idx on public.tasks (counter_by_member_id);

-- Netwerklid-verwijzingen moeten bij hetzelfde profiel horen.
create or replace function private.tasks_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.target_type = 'open' then
    new.target_member_id := null;
  end if;
  if new.target_member_id is not null and not exists (
    select 1 from public.network_members m
    where m.id = new.target_member_id and m.profile_id = new.profile_id
  ) then
    raise exception 'Dit netwerklid hoort niet bij dit profiel.' using errcode = '23514';
  end if;
  if new.accepted_by_member_id is not null and not exists (
    select 1 from public.network_members m
    where m.id = new.accepted_by_member_id and m.profile_id = new.profile_id
  ) then
    raise exception 'Dit netwerklid hoort niet bij dit profiel.' using errcode = '23514';
  end if;
  if new.counter_by_member_id is not null and not exists (
    select 1 from public.network_members m
    where m.id = new.counter_by_member_id and m.profile_id = new.profile_id
  ) then
    raise exception 'Dit netwerklid hoort niet bij dit profiel.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_before_write
  before insert or update on public.tasks
  for each row execute function private.tasks_before_write();

-- -----------------------------------------------------------------------------
-- 6. saved_choices
-- -----------------------------------------------------------------------------
create table public.saved_choices (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 300),
  chosen_path text not null check (char_length(btrim(chosen_path)) between 1 and 300),
  created_at  timestamptz not null default now()
);
create index saved_choices_profile_created_idx on public.saved_choices (profile_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 7. notifications (meldingen-logboek, ook zichtbaar voor netwerk volgens vinkjes)
-- -----------------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  kind         text not null default 'system' check (kind in ('mood', 'task', 'choice', 'circle', 'system')),
  recipient    text not null default '' check (char_length(recipient) <= 300),
  message      text not null check (char_length(message) between 1 and 1000),
  member_id    uuid references public.network_members (id) on delete set null,
  from_network boolean not null default false,
  created_at   timestamptz not null default now()
);
create index notifications_profile_created_idx on public.notifications (profile_id, created_at desc);
create index notifications_member_idx on public.notifications (member_id);

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
create or replace function private.my_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p where p.owner_id = (select auth.uid());
$$;

alter table public.profiles        enable row level security;
alter table public.signaling_plans enable row level security;
alter table public.learning_goals  enable row level security;
alter table public.network_members enable row level security;
alter table public.tasks           enable row level security;
alter table public.saved_choices   enable row level security;
alter table public.notifications   enable row level security;

create policy "Eigenaar leest eigen profielen" on public.profiles
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Eigenaar maakt eigen profielen" on public.profiles
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Eigenaar wijzigt eigen profielen" on public.profiles
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Eigenaar verwijdert eigen profielen" on public.profiles
  for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "Eigenaar beheert signaleringsplan" on public.signaling_plans
  for all to authenticated
  using (profile_id in (select private.my_profile_ids()))
  with check (profile_id in (select private.my_profile_ids()));

create policy "Eigenaar beheert leerdoelen" on public.learning_goals
  for all to authenticated
  using (profile_id in (select private.my_profile_ids()))
  with check (profile_id in (select private.my_profile_ids()));

create policy "Eigenaar beheert netwerkleden" on public.network_members
  for all to authenticated
  using (profile_id in (select private.my_profile_ids()))
  with check (profile_id in (select private.my_profile_ids()));

create policy "Eigenaar beheert opdrachten" on public.tasks
  for all to authenticated
  using (profile_id in (select private.my_profile_ids()))
  with check (profile_id in (select private.my_profile_ids()));

create policy "Eigenaar beheert keuzes" on public.saved_choices
  for all to authenticated
  using (profile_id in (select private.my_profile_ids()))
  with check (profile_id in (select private.my_profile_ids()));

create policy "Eigenaar beheert meldingen" on public.notifications
  for all to authenticated
  using (profile_id in (select private.my_profile_ids()))
  with check (profile_id in (select private.my_profile_ids()));

-- -----------------------------------------------------------------------------
-- Rechten (expliciet, onafhankelijk van de Data API-standaardinstellingen)
-- Kolomrechten voorkomen dat een cliënt zelf user_id/invite_code/is_demo zet.
-- -----------------------------------------------------------------------------
revoke all on public.profiles, public.signaling_plans, public.learning_goals,
  public.network_members, public.tasks, public.saved_choices, public.notifications
  from anon, authenticated;
grant all on public.profiles, public.signaling_plans, public.learning_goals,
  public.network_members, public.tasks, public.saved_choices, public.notifications
  to service_role;

grant select, delete on public.profiles to authenticated;
grant insert (full_name, supervisor_name, weekly_budget, savings_goal) on public.profiles to authenticated;
grant update (full_name, supervisor_name, weekly_budget, savings_goal, current_mood,
              last_reason, last_self_action, last_signals, mood_updated_at) on public.profiles to authenticated;

grant select on public.signaling_plans to authenticated;
grant update (signals_text, signal_chips, self_actions, network_actions) on public.signaling_plans to authenticated;

grant select, delete on public.learning_goals to authenticated;
grant insert (profile_id, color, category, title, is_completed) on public.learning_goals to authenticated;
grant update (color, category, title, is_completed) on public.learning_goals to authenticated;

grant select, delete on public.network_members to authenticated;
grant insert (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance) on public.network_members to authenticated;
grant update (name, role, email, can_see_mood, can_see_tasks, can_see_finance) on public.network_members to authenticated;

grant select, delete on public.tasks to authenticated;
grant insert (profile_id, title, description, duration, requested_time, target_type, target_name, target_member_id)
  on public.tasks to authenticated;
grant update (title, description, duration, requested_time, target_type, target_name, target_member_id, status,
              accepted_by, accepted_by_member_id, counter_by, counter_by_member_id, counter_proposal_time, counter_note)
  on public.tasks to authenticated;

grant select, delete on public.saved_choices to authenticated;
grant insert (profile_id, title, chosen_path) on public.saved_choices to authenticated;

grant select, delete on public.notifications to authenticated;
grant insert (profile_id, kind, recipient, message, member_id) on public.notifications to authenticated;

revoke all on function private.my_profile_ids() from public;
grant execute on function private.my_profile_ids() to authenticated;
revoke all on function private.generate_invite_code() from public;
revoke all on function private.normalize_invite_code(text) from public;
revoke all on function private.mask_email(text) from public;
revoke all on function private.create_signaling_plans() from public;
revoke all on function private.network_members_before_write() from public;
revoke all on function private.tasks_before_write() from public;
revoke all on function private.touch_updated_at() from public;

-- -----------------------------------------------------------------------------
-- RPC: netwerkkant (alleen via deze functies, gefilterd op vinkjes)
-- -----------------------------------------------------------------------------

-- Welke cliënten heb ik (als ingelogd netwerklid) gekoppeld?
create or replace function public.list_my_networks()
returns table (
  member_id   uuid,
  profile_id  uuid,
  client_name text,
  member_name text,
  member_role text,
  joined_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.profile_id, p.full_name, m.name, m.role, m.joined_at
  from public.network_members m
  join public.profiles p on p.id = m.profile_id
  where m.user_id = (select auth.uid())
  order by p.full_name;
$$;

-- Interne controle: mag de ingelogde gebruiker dit netwerklid-perspectief zien / gebruiken?
-- Netwerklid zelf: altijd. Eigenaar: alleen als voorbeeldweergave (acties alleen in demo-profielen).
-- Geeft TRUE terug als het een voorbeeldweergave van de eigenaar is, FALSE voor het netwerklid zelf.
create or replace function private.check_member_access(p_member_id uuid, p_need_act boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member_user uuid;
  v_owner uuid;
  v_is_demo boolean;
begin
  if v_uid is null then
    raise exception 'Je bent niet ingelogd.' using errcode = '28000';
  end if;
  select m.user_id, p.owner_id, p.is_demo
    into v_member_user, v_owner, v_is_demo
  from public.network_members m
  join public.profiles p on p.id = m.profile_id
  where m.id = p_member_id;
  if not found then
    raise exception 'Dit netwerklid bestaat niet (meer).' using errcode = 'P0002';
  end if;
  if v_member_user = v_uid then
    return false;
  end if;
  if v_owner = v_uid then
    if p_need_act and not v_is_demo then
      raise exception 'In de voorbeeldweergave kun je alleen in het demo-profiel namens een netwerklid reageren.'
        using errcode = '42501';
    end if;
    return true;
  end if;
  raise exception 'Je hebt geen toegang tot dit netwerk.' using errcode = '42501';
end;
$$;
revoke all on function private.check_member_access(uuid, boolean) from public;

create or replace function public.get_network_view(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.network_members;
  p public.profiles;
  v_preview boolean;
  result jsonb;
begin
  v_preview := private.check_member_access(p_member_id, false);
  select * into m from public.network_members where id = p_member_id;
  select * into p from public.profiles where id = m.profile_id;

  result := jsonb_build_object(
    'preview', v_preview,
    'can_act', (not v_preview) or p.is_demo,
    'is_demo', p.is_demo,
    'client', jsonb_build_object('full_name', p.full_name),
    'viewer', jsonb_build_object(
      'id', m.id, 'name', m.name, 'role', m.role, 'email', m.email,
      'can_see_mood', m.can_see_mood, 'can_see_tasks', m.can_see_tasks, 'can_see_finance', m.can_see_finance
    )
  );

  if m.can_see_mood then
    result := result || jsonb_build_object('mood', jsonb_build_object(
      'color', p.current_mood,
      'reason', p.last_reason,
      'self_action', p.last_self_action,
      'signals', p.last_signals,
      'updated_at', p.mood_updated_at,
      'network_actions', coalesce((
        select sp.network_actions from public.signaling_plans sp
        where sp.profile_id = p.id and sp.color = p.current_mood), '[]'::jsonb),
      'signals_text', coalesce((
        select sp.signals_text from public.signaling_plans sp
        where sp.profile_id = p.id and sp.color = p.current_mood), '')
    ));
  end if;

  if m.can_see_tasks then
    result := result || jsonb_build_object('tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'description', t.description,
        'duration', t.duration,
        'requested_time', t.requested_time,
        'target_type', t.target_type,
        'status', t.status,
        'accepted_by', t.accepted_by,
        'accepted_by_me', coalesce(t.accepted_by_member_id = m.id, false),
        'counter_by', t.counter_by,
        'counter_by_me', coalesce(t.counter_by_member_id = m.id, false),
        'counter_proposal_time', t.counter_proposal_time,
        'counter_note', t.counter_note,
        'created_at', t.created_at
      ) order by t.created_at desc)
      from public.tasks t
      where t.profile_id = p.id
        and (t.target_type = 'open' or t.target_member_id = m.id)
    ), '[]'::jsonb));
  end if;

  if m.can_see_finance then
    result := result || jsonb_build_object(
      'savings_goal', p.savings_goal,
      'choices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'title', c.title, 'chosen_path', c.chosen_path, 'created_at', c.created_at
        ) order by c.created_at desc)
        from public.saved_choices c
        where c.profile_id = p.id
      ), '[]'::jsonb)
    );
  end if;

  result := result || jsonb_build_object('notifications', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'kind', x.kind, 'recipient', x.recipient, 'message', x.message, 'created_at', x.created_at
    ) order by x.created_at desc)
    from (
      select n.* from public.notifications n
      where n.profile_id = p.id
        and (
          n.member_id = m.id
          or (n.member_id is null and (
               (n.kind = 'mood'   and m.can_see_mood)
            or (n.kind = 'task'   and m.can_see_tasks)
            or (n.kind = 'choice' and m.can_see_finance)
          ))
        )
      order by n.created_at desc
      limit 30
    ) x
  ), '[]'::jsonb));

  return result;
end;
$$;

create or replace function public.network_accept_task(p_member_id uuid, p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.network_members;
  p public.profiles;
  v_preview boolean;
  t public.tasks;
begin
  v_preview := private.check_member_access(p_member_id, true);
  select * into m from public.network_members where id = p_member_id;
  select * into p from public.profiles where id = m.profile_id;

  if not m.can_see_tasks then
    raise exception 'Je hebt geen toegang tot opdrachten van %.', p.full_name using errcode = '42501';
  end if;

  select * into t from public.tasks
  where id = p_task_id and profile_id = p.id
  for update;
  if not found or not (t.target_type = 'open' or t.target_member_id = m.id) then
    raise exception 'Deze opdracht bestaat niet (meer).' using errcode = 'P0002';
  end if;
  if t.status = 'accepted' then
    raise exception 'Deze opdracht is al ingepland door %.', t.accepted_by using errcode = '23514';
  end if;

  update public.tasks set
    status = 'accepted',
    accepted_by = m.name,
    accepted_by_member_id = m.id,
    counter_by = '',
    counter_by_member_id = null,
    counter_proposal_time = '',
    counter_note = ''
  where id = t.id;

  insert into public.notifications (profile_id, kind, recipient, message, member_id, from_network)
  values (p.id, 'task', p.full_name,
          format('%s heeft je opdracht "%s" geaccepteerd (%s).', m.name, t.title, t.requested_time),
          m.id, true);
end;
$$;

create or replace function public.network_counter_task(
  p_member_id uuid, p_task_id uuid, p_time text, p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.network_members;
  p public.profiles;
  v_preview boolean;
  t public.tasks;
  v_time text := btrim(coalesce(p_time, ''));
  v_note text := btrim(coalesce(p_note, ''));
begin
  v_preview := private.check_member_access(p_member_id, true);
  select * into m from public.network_members where id = p_member_id;
  select * into p from public.profiles where id = m.profile_id;

  if not m.can_see_tasks then
    raise exception 'Je hebt geen toegang tot opdrachten van %.', p.full_name using errcode = '42501';
  end if;
  if char_length(v_time) = 0 or char_length(v_time) > 120 then
    raise exception 'Vul in op welke dag en tijd je wel kunt helpen.' using errcode = '22023';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'De toelichting is te lang (maximaal 1000 tekens).' using errcode = '22023';
  end if;

  select * into t from public.tasks
  where id = p_task_id and profile_id = p.id
  for update;
  if not found or not (t.target_type = 'open' or t.target_member_id = m.id) then
    raise exception 'Deze opdracht bestaat niet (meer).' using errcode = 'P0002';
  end if;
  if t.status = 'accepted' then
    raise exception 'Deze opdracht is al ingepland door %.', t.accepted_by using errcode = '23514';
  end if;

  update public.tasks set
    status = 'counter',
    counter_by = m.name,
    counter_by_member_id = m.id,
    counter_proposal_time = v_time,
    counter_note = case when v_note = '' then format('Ik kan helpen op %s, past dat?', v_time) else v_note end
  where id = t.id;

  insert into public.notifications (profile_id, kind, recipient, message, member_id, from_network)
  values (p.id, 'task', p.full_name,
          format('%s stelt een ander moment voor bij "%s": %s.', m.name, t.title, v_time),
          m.id, true);
end;
$$;

-- Uitnodiging bekijken (ook vóór inloggen): alleen voornaam cliënt, naam en gemaskeerd e-mailadres.
create or replace function public.peek_invite(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := private.normalize_invite_code(p_code);
  m public.network_members;
  v_client text;
begin
  if char_length(v_code) <> 8 then
    return null;
  end if;
  select * into m from public.network_members where invite_code = v_code;
  if not found then
    return null;
  end if;
  select split_part(p.full_name, ' ', 1) into v_client from public.profiles p where p.id = m.profile_id;
  return jsonb_build_object(
    'client_first_name', v_client,
    'member_name', m.name,
    'email_masked', private.mask_email(m.email),
    'already_joined', m.user_id is not null
  );
end;
$$;

-- Uitnodiging accepteren: code + ingelogd e-mailadres moeten kloppen.
create or replace function public.accept_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := private.normalize_invite_code(p_code);
  v_email text;
  m public.network_members;
  v_client text;
begin
  if v_uid is null then
    raise exception 'Log eerst in om de uitnodiging te accepteren.' using errcode = '28000';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  select * into m from public.network_members where invite_code = v_code for update;
  if not found then
    raise exception 'Deze uitnodigingscode klopt niet. Controleer de code en probeer het opnieuw.' using errcode = 'P0002';
  end if;
  if m.user_id is not null and m.user_id <> v_uid then
    raise exception 'Deze uitnodiging is al door iemand anders gebruikt.' using errcode = '42501';
  end if;
  if m.email <> v_email then
    raise exception 'Deze uitnodiging is voor een ander e-mailadres (%). Log in met dat e-mailadres.',
      private.mask_email(m.email) using errcode = '42501';
  end if;

  select p.full_name into v_client from public.profiles p where p.id = m.profile_id;

  if m.user_id is null then
    update public.network_members set user_id = v_uid, joined_at = now() where id = m.id;
    insert into public.notifications (profile_id, kind, recipient, message, member_id, from_network)
    values (m.profile_id, 'circle', v_client,
            format('%s heeft je uitnodiging geaccepteerd en kijkt nu mee.', m.name), m.id, true);
  end if;

  return jsonb_build_object('member_id', m.id, 'profile_id', m.profile_id, 'client_name', v_client);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: demo-profiel "Daan Vermeulen" laden (alleen op verzoek, nooit automatisch)
-- -----------------------------------------------------------------------------
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

  insert into public.learning_goals (profile_id, color, category, title, is_completed) values
    (v_pid, 'green',  'Zelfstandig Huishouden',   'Zelf gezonde maaltijd koken en keuken direct opruimen', false),
    (v_pid, 'green',  'Administratie & Regie',    'Binnengekomen post controleren en klaarleggen voor donderdag', true),
    (v_pid, 'orange', 'Opgeknipt Doel (Oranje)',  'Brieven nog niet openmaken, alleen op de eettafel leggen', false),
    (v_pid, 'orange', 'Simpele Maaltijd',         'Zelf een makkelijke tosti of gebakken ei maken', false),
    (v_pid, 'red',    'Veiligheid & Rust',        '1 uur ontprikkelen en vandaag geen uitgaven doen', false),
    (v_pid, 'red',    'Vast Contactpunt',         'Kort telefonisch contact met begeleider Mark om 16:00', false);

  insert into public.network_members (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance)
  values (v_pid, 'Anja Vermeulen', 'Familie / Ouder', 'anja.vermeulen@voorbeeld.nl', true, true, false)
  returning id into v_anja;
  insert into public.network_members (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance)
  values (v_pid, 'Mark Jansen', 'Ambulant Begeleider', 'm.jansen@voorbeeld.nl', true, true, true)
  returning id into v_mark;
  insert into public.network_members (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance)
  values (v_pid, 'Erik Vermeulen', 'Familie / Oom', 'erik.vermeulen@voorbeeld.nl', true, true, false)
  returning id into v_erik;
  insert into public.network_members (profile_id, name, role, email, can_see_mood, can_see_tasks, can_see_finance)
  values (v_pid, 'Dhr. H. de Vries', 'Bewindvoerder', 'info@devriesbewind.voorbeeld.nl', false, false, true)
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

-- -----------------------------------------------------------------------------
-- Uitvoerrechten RPC's
-- -----------------------------------------------------------------------------
revoke all on function public.list_my_networks() from public, anon;
revoke all on function public.get_network_view(uuid) from public, anon;
revoke all on function public.network_accept_task(uuid, uuid) from public, anon;
revoke all on function public.network_counter_task(uuid, uuid, text, text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.create_demo_profile() from public, anon;
revoke all on function public.peek_invite(text) from public;

grant execute on function public.list_my_networks() to authenticated;
grant execute on function public.get_network_view(uuid) to authenticated;
grant execute on function public.network_accept_task(uuid, uuid) to authenticated;
grant execute on function public.network_counter_task(uuid, uuid, text, text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.create_demo_profile() to authenticated;
grant execute on function public.peek_invite(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: eigenaar ziet reacties van netwerkleden direct binnenkomen
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tasks, public.notifications;
  end if;
end;
$$;
