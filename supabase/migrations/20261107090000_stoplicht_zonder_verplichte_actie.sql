-- EigenKoers – pakket A: lichtere kleurwissel.
-- Groen en Rood kunnen nu zonder eigen actie worden opgeslagen. Het impact-logboek
-- telde een kleurwissel alleen als er een eigen actie was. Nu telt elke echte
-- kleurwissel. Het rekenvoorbeeld (+30 min / +€45 bij herstel naar groen) blijft
-- ongewijzigd en blijft max. 1x per dag per cliënt.
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
  v_action   boolean;
begin
  if new.is_demo
     or new.current_mood is null
     or new.current_mood is not distinct from old.current_mood then
    return null;
  end if;

  begin
    v_action := btrim(coalesce(new.last_self_action, '')) <> '';
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
      format('%s → %s%s · %s %s aangevinkt · %s',
        private.color_label(old.current_mood),
        private.color_label(new.current_mood),
        case when v_recovery and v_credit then ' (herstel)'
             when v_recovery then ' (herstel, vandaag al meegeteld)'
             else '' end,
        v_signals,
        case when v_signals = 1 then 'signaal' else 'signalen' end,
        case when v_action then 'eigen actie gekozen' else 'geen eigen actie' end),
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
