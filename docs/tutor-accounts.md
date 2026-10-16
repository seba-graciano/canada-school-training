# Administrator-created accounts

Administrators open **Crear cuenta** beside their account in the header and choose
`admin`, `secretaria`, or `tutor`. Each submission creates a login and a matching
`perfiles` row atomically. Tutors also get a new `tutores` row; staff profiles have
`tutor_id = NULL` and create no guardian. Courses and existing students are not
assigned automatically.
The administrator supplies an initial password of 12–128 characters and shares it
through the school's normal private channel. No email is sent. All accounts require
name, surname and email. Only tutors require DNI and can supply a phone number.

## Deployment order

1. Follow [Migration order and identities](#migration-order-and-identities).
   Account creation requires both `0016_tutor_accounts.sql` and
   `0017_provision_accounts_after_metadata.sql`. They support all three
   roles and Auth's insert-then-metadata-update lifecycle. For an existing
   database, compare its actual history before applying any file.
2. Deploy `create-account` with gateway JWT verification enabled:
   `supabase functions deploy create-account --project-ref <project-ref>`.
   The signed-in frontend invokes it with the user's bearer token. The function
   additionally validates every bearer token through `auth.getUser` and checks
   the caller's current database profile. Browser checks alone never authorize it.
3. Confirm the server environment has `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`. Never put a service key in a `VITE_` variable.
4. Keep the existing Custom Access Token Hook enabled. It reads the new profile
   and assigns `user_role`; tutor tokens also contain the new `tutor_id` claim.
5. Publish the frontend, then verify an administrator can create an account and
   each requested role can log in. A tutor with no linked students sees an empty list.

The legacy `create-tutor-account` endpoint remains tutor-only and compatible.
It rejects client-supplied `user_role` and uses its existing protected tutor marker.
If deployed using its previous `--no-verify-jwt` configuration, its handler still
validates the bearer token and current administrator profile. The generic endpoint
keeps gateway JWT verification enabled.

Deploy and test only against the explicitly authorized project. Local checks do
not establish that hosted Auth, signing keys, or the hook are configured correctly.

## Access and transaction guarantees

Only the server Admin API sets protected `app_metadata.provision_account_by` and
`app_metadata.provision_account_role`. The private trigger independently validates
the requested role and actor's current administrator profile, then creates the
profile and, for tutors, guardian in the same transaction as `auth.users`.
Auth first inserts provider metadata, then applies requested protected metadata.
The trigger handles both insertion and that metadata update. Existing profiles
remain authoritative, so later metadata updates neither change roles nor duplicate
guardians. The endpoint verifies the persisted profile before reporting success.
Trigger failures roll the entire transaction back. Editable `user_metadata` contains
personal fields; role claims there cannot override the protected selected role.

The legacy `provision_tutor_by` marker continues to provision only tutors. Neither
endpoint accepts profile IDs or provisioning metadata from the browser. Staff
requests omit guardian fields, and unsupported role values are rejected.

Tutors can only read their own family through existing RLS and dashboard filtering.
The bulk fee increase now also checks the current staff profile before writing;
direct calls from tutors and anonymous users fail. Local regression tests verify
collection amounts and administrative dashboard results against the explicit
pre-account migration baseline, allowing the intentional canonical state change.

**Known consideration — JWT freshness:** table policies and the dashboard still
read role and family claims from the issued JWT. Changing a profile does not
immediately change an already issued token. Some newer privileged operations
additionally check the current database profile. No authorization rule or token
lifetime was changed in the supplemental audit fixes. Immediate revocation or
family reassignment semantics require a separate product/security decision;
see [Supabase's JWT freshness guidance](https://supabase.com/docs/guides/database/postgres/row-level-security#authjwt).

## Migration order and identities

Verified local ordering is the filename order in `supabase/migrations/`:

1. `0001_schema.sql` through `0013_bulk_aumentar_cuotas.sql` form the original
   pre-account baseline.
2. `0014_normalizar_estados_cuotas.sql` normalizes `estado` to `Pagada`,
   `Pendiente`, or `Vencida`; `0015_aumento_cuotas_en_lote.sql` adds its bulk RPC.
3. `0016_tutor_accounts.sql` provisions accounts for all three supported roles.
4. `0017_provision_accounts_after_metadata.sql` handles protected metadata updates.
5. `0018_fix_cobro_estado.sql` updates collection to persist `Pagada`.
   It replaces the function without rewriting migration 0010 or changing its
   financial calculations. Apply it after the preceding files.

All local migrations use consecutive four-digit prefixes: `0001`, `0002`, and so
on. New migrations must use the next available number (`0019` after this chain).
If the CLI generates a timestamped file, rename that new, unapplied local file to
the next number before sharing it. The migration selection test enforces this
convention. The three most recent files were renumbered at the user's request
without changing their SQL bytes.

Do not keep numbered and timestamped copies of the same migration. Filename
versions identify migrations; identical SQL with a different version is not
automatically considered applied by Supabase. Historical timestamped versions
in the account task log are not current local filenames or proof of remote state.

For a new disposable database, follow [SETUP.md](../SETUP.md), including the
special pre-migration position of the optional legacy seed. For an existing
project, use an explicitly authorized CLI session linked to the intended project:

```sh
supabase migration list --linked
supabase db push --linked --dry-run
```

Compare local versions with `supabase_migrations.schema_migrations`. The dry run
must show only changes that are actually pending. If the remote history contains
different versions, or already applied timestamped migrations leave older numeric
ones missing, stop and reconcile the history with the team. Do not rename applied
migrations, replay provisioning triggers, or run `migration repair` automatically.
Any repair or data migration requires its own reviewed plan and authorization.
See the [official CLI migration reference](https://supabase.com/docs/reference/cli/supabase-migration-list).

## Local checks

Run from the repository root with Node 24:

```sh
node --test supabase/functions/create-tutor-account/handler.test.ts supabase/functions/create-account/handler.test.ts
node --test app/src/accounts/*.test.mjs
deno check --no-lock supabase/functions/create-tutor-account/index.ts supabase/functions/create-account/index.ts
```

SQL tests use PGlite 0.3.14 installed in a temporary directory. Set `PGLITE_MODULE`
to its absolute `node_modules/@electric-sql/pglite/dist/index.js` path, then run
`node --test supabase/tests/tutor-accounts.test.mjs supabase/tests/migrations.test.mjs`.
The tests apply every migration
to an isolated PostgreSQL engine with minimal Auth table/claim stubs, exercise RLS,
RPCs, three-role profile linkage and rollback. They do not run the actual Supabase Auth server.
The baseline fixture explicitly selects migrations 0001–0013. Selection tests
prove that later normalization, provisioning and collection fixes are excluded
from that historical set and included in the current set. Baseline comparisons
use each version's supported state values; both paths must actually execute.

From `app/`, run `npm run build` and `npm run lint`.

Browser regression commands and tool prerequisites are documented in
[the supplemental fixes](supplemental-audit-fixes.md#local-verification).

## Evidence and hosted verification

This guide describes the current local source. Historical entries in
`odd/tasks/tutor-accounts.md` record work on a shared test project on 2026-10-13;
they are historical observations, not proof of its present deployment or schema.
The supplemental correction did not inspect or change a hosted project.

Before declaring a deployment verified, record the intended project, inspection
date, actual migration versions, deployed function version/JWT configuration and
hook configuration. Then verify authenticated login, account creation for each
supported role and an authorized collection against that exact environment.
Keep credentials and personal data out of the verification record.

Current local automated tests use Auth stubs and intercepted browser requests.
They establish local regression behavior, not hosted Auth configuration or remote
migration history. Inspect the selected environment file locally before use;
this guide deliberately does not claim what an ignored `.env.local` contains.
