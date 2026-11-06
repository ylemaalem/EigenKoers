// Gedeelde opzet voor de databasetests.
//
// De tests draaien op PGlite: een echte Postgres die in Node draait, zonder
// internet en zonder Supabase-account. Dat is dus nooit de productiedatabase.
// We bootsen het stukje Supabase na dat de migraties nodig hebben: de rollen
// anon/authenticated/service_role, het schema auth met auth.users en auth.uid().
// Daarna passen we ALLE migraties uit supabase/migrations toe, op volgorde van
// bestandsnaam, precies zoals Supabase dat doet.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

export const U = {
  client: '11111111-1111-1111-1111-111111111111',
  anja: '22222222-2222-2222-2222-222222222222',
  stranger: '33333333-3333-3333-3333-333333333333',
  admin: '44444444-4444-4444-4444-444444444444',
  unconfirmed: '55555555-5555-5555-5555-555555555555',
  clientB: '66666666-6666-6666-6666-666666666666',
  coach: '77777777-7777-7777-7777-777777777777',
};

const STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create publication supabase_realtime;
insert into auth.users values
  ('${U.client}', 'client@test.nl', now()),
  ('${U.anja}', 'anja@test.nl', now()),
  ('${U.stranger}', 'stranger@test.nl', now()),
  ('${U.admin}', 'Y.Lemaalem@gmail.com', now()),
  ('${U.unconfirmed}', 'nietbevestigd@test.nl', null),
  ('${U.clientB}', 'clientb@test.nl', now()),
  ('${U.coach}', 'coach@test.nl', now());
`;

export function migrationFiles({ upTo } = {}) {
  return fs.readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !upTo || f <= upTo);
}

export async function createDb({ upTo, quiet = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  let failures = 0;
  let passes = 0;

  const ok = (cond, msg) => {
    if (cond) { passes++; console.log('  ✔', msg); } else { failures++; console.log('  ✘', msg); }
  };
  // Voer SQL uit als een bepaalde gebruiker (zoals Supabase doet met de JWT).
  // user = null betekent: niet ingelogd (rol anon).
  const as = async (user, sql, params) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('reset role;');
    }
  };
  const expectError = async (user, sql, params, label) => {
    try {
      await as(user, sql, params);
      ok(false, `${label} (verwachtte een weigering, maar het lukte)`);
    } catch (e) {
      ok(true, `${label} → ${e.message}`);
    }
  };
  const done = () => {
    console.log(`\n${passes} geslaagd, ${failures} mislukt`);
    console.log(failures === 0 ? 'ALLE TESTS GESLAAGD' : `${failures} TEST(S) MISLUKT`);
    process.exit(failures ? 1 : 0);
  };

  await db.exec(STUB);
  await db.exec('create extension if not exists pgcrypto with schema extensions;');
  for (const f of migrationFiles({ upTo })) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    if (!quiet) console.log(`Migratie toegepast: ${f}`);
  }
  return { db, ok, as, expectError, done, U, get failures() { return failures; } };
}
