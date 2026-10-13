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

1. Apply `supabase/migrations/20261013194312_tutor_accounts.sql` to the intended
   authorized Supabase project after migrations 0001–0013. This migration
   supports all three roles. The Auth insert trigger must exist
   before this function accepts account creation requests.
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
Any failure rolls the entire transaction back. Editable `user_metadata` contains
personal fields; role claims there cannot override the protected selected role.

The legacy `provision_tutor_by` marker continues to provision only tutors. Neither
endpoint accepts profile IDs or provisioning metadata from the browser. Staff
requests omit guardian fields, and unsupported role values are rejected.

Tutors can only read their own family through existing RLS and dashboard filtering.
The bulk fee increase now also checks the current staff profile before writing;
direct calls from tutors and anonymous users fail. Existing collection behavior
and administrative dashboard results are preserved.

## Local checks

Run from the repository root with Node 24:

```sh
node --test supabase/functions/create-tutor-account/handler.test.ts supabase/functions/create-account/handler.test.ts
node --test app/src/accounts/*.test.mjs
deno check --no-lock supabase/functions/create-tutor-account/index.ts supabase/functions/create-account/index.ts
```

SQL tests use PGlite 0.3.14 installed in a temporary directory. Set `PGLITE_MODULE`
to its absolute `node_modules/@electric-sql/pglite/dist/index.js` path, then run
`node --test supabase/tests/tutor-accounts.test.mjs`. The tests apply every migration
to an isolated PostgreSQL engine with minimal Auth table/claim stubs, exercise RLS,
RPCs, three-role profile linkage and rollback. They do not run the actual Supabase Auth server.
`BASELINE_ONLY=1` skips the new timestamped migration to reproduce the missing guard
and missing provisioning behavior without touching a deployed database.

From `app/`, run `npm run build` and `npm run lint`.

## Shared test project

The account migration and `create-account` version 1 are deployed to
`canada-school-prueba` (`hoatbnzqmpmbgzybmftb`). Migration version
`20261013194312` matches the hosted migration history. The local ignored
`app/.env.local` selects this project using its publishable key. Run the frontend
locally and sign in with an existing administrator from this project to exercise
real creation. Demo credentials from the disposable preview do not apply.

Hosted checks confirmed JWT verification is enabled, anonymous/invalid-token
requests return 401, browser preflight succeeds, and deployment preserved the
existing record counts. Successful Auth login and creation through the form
still require the project administrator's credentials; the local automated
tests do not prove that the hosted access-token hook is enabled.
