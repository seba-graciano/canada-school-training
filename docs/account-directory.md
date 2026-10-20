# Registered accounts

Administrators can view actual registered account emails and roles in **Administración de cuentas**, search by email and use the three-dot menu to delete an account after confirmation. Existing account creation remains available beside the directory. A missing profile is displayed as an unassigned role, not as an administrator or tutor.

## Deletion boundary

Deleting an account removes the login identity and its profile. It preserves the tutor record and all linked students, installments and payment history. The signed-in administrator cannot delete their own account. A database guard protects the final administrator even when deletion requests compete. These are access-account operations; no student or billing deletion is performed.

Only a currently authorized administrator can query the directory or request deletion. The privileged deletion client runs in the Edge Function, and its credentials never reach the browser. Database authorization reads the live profile so an old JWT from a deleted or downgraded account does not retain its previous table/RPC privileges.

The UI shows loading, empty and failure states, preserves unsuccessful deletion targets, and reloads the directory after successful creation or deletion. Search resets the current page. Each result has an email, the real profile role and an accessible actions menu. No role-editing or password-reset action is included.

## Activation

This feature adds `supabase/migrations/20261020190612_account_directory.sql` and the `delete-account` Edge Function. Apply the migration and deploy that function through the project's existing Supabase release process before using the new UI with real accounts. Review the selected project's migration history first; do not replay historical migrations blindly. Account management is unavailable on a backend that has not received these changes.

Implementation and tests in this repository use isolated local fixtures. No live accounts were queried or deleted, and no remote migration or deployment was performed as part of preparing the feature. Selecting and authorizing the destination and connection is a separate deployment step.

## Checks

Use Node 24 and temporary PGlite 0.3.14 through `PGLITE_MODULE`, following the existing test setup in `tutor-accounts.md`. Browser checks use the existing Playwright installation through `PLAYWRIGHT_MODULE` and intercept all backend requests. Source changes and observed commands are recorded in `odd/tasks/account-directory.md`.

The SQL checks exercise directory authorization, search and pagination, profile-based role revocation, last-administrator refusal and preservation of school records. HTTP handler checks exercise authenticated administrator verification, invalid targets, self-deletion, provider failures and safe responses. Browser checks cover real-table rendering, search, menu/confirmation behavior and mutation outcomes.

Local verification passed 26 SQL/migration cases, 77 HTTP handler cases, 22 client helper cases, 26 browser regressions, the production build and a native Deno 2.5.6 check against the pinned Supabase SDK 2.109.0. The SQL suite includes an independent data-preservation/stale-tutor regression. The browser fixture asserts computed styles, and image geometry checks wait for assets to load. Lint exits successfully with the existing AppContext Fast Refresh warning and a new account directory effect-state warning.

Independent checks used fresh temporary copies and fixture data. PGlite validates serial last-admin refusal and data preservation; separate concurrent PostgreSQL sessions and the deployed Supabase environment remain untested. Transaction advisory locking and administrator row locks were inspected, but those inspections are not a live concurrency test.

The user-authorized native review completed without blocking findings. It recorded one nonblocking retry limitation: if deletion succeeds but its response is lost, another attempt can report that the identity is unavailable while the old row remains visible. Close the confirmation and reopen the directory to reconcile it. Automatic reconciliation after an uncertain deletion outcome remains separate follow-up work.

Rollback requires coordinated frontend/backend deployment: keep the current helper's live-profile authorization when retaining account deletion. Restoring JWT-only authorization while deleting accounts would restore access-token privileges until expiry. Never roll back by deleting tutor or billing records.
