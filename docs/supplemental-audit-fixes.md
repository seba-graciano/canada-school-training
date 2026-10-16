# Supplemental audit corrections

These changes address five reproduced defects beyond the earlier audit. They are
prepared as uncommitted local changes. Hosted rollout requires the migration-history
checks in [the account guide](tutor-accounts.md#migration-order-and-identities).

| Change | Reason | Effect |
| --- | --- | --- |
| Persist canonical paid state through a forward SQL migration | The state constraint rejected the collection function's legacy value | Valid collections can commit; repeat collections remain rejected |
| Handle failed signout explicitly | Auth could retain the browser session while React displayed login | Operators see failure and authenticated state remains until logout succeeds |
| Reject superseded dashboard responses | An older request could replace newer financial data or loading state | The latest request controls displayed rows and loading |
| Derive submitted search results from current rows | Reloads replaced filtered rows while leaving search text visible | Payment and background refreshes preserve the applied search |
| Use an explicit historical SQL baseline and supported fixtures | The old selector included the same migrations on both sides and setup failed | Regression comparisons execute against distinct schemas |

The changes preserve existing financial formulas. Partial-payment calculation,
late fees, sibling discounts and other issues from the original audit remain
separate work. JWT claim freshness is documented as a known consideration; no
permission, token-lifetime or revocation behavior was changed.

## Local verification

The specification and observed results are recorded in
[`odd/tasks/supplemental-audit-fixes.md`](../odd/tasks/supplemental-audit-fixes.md).
Run Node HTTP/client tests, SQL selection/collection tests, browser regressions,
application build and lint before committing. SQL tests require the external
PGlite module described in the account guide. Browser regressions use locally
available Playwright and intercept application service requests.

Run the following from the repository root with Node 24. Set `PGLITE_MODULE` to
an installed PGlite 0.3.14 `dist/index.js` file and `PLAYWRIGHT_MODULE` to an
installed Playwright `index.mjs` file. These are tool dependencies installed
outside the app; the test commands do not install packages. Browser tests need
installed Google Chrome, or `BROWSER_EXECUTABLE` pointing to another existing
compatible executable.

```sh
node --test supabase/functions/create-tutor-account/handler.test.ts supabase/functions/create-account/handler.test.ts app/src/accounts/createAccount.test.mjs app/src/accounts/createTutorAccount.test.mjs
node --test supabase/tests/tutor-accounts.test.mjs supabase/tests/migrations.test.mjs
node --test app/tests/frontend-regressions.test.mjs
npm --prefix app run build
npm --prefix app run lint
```

In PowerShell, set tool locations before running these commands:

```powershell
$env:PGLITE_MODULE = '<temporary-tools>/node_modules/@electric-sql/pglite/dist/index.js'
$env:PLAYWRIGHT_MODULE = '<temporary-tools>/node_modules/playwright/index.mjs'
```

## Migration and documentation reliability

Local verification on 2026-10-16 passed 21 SQL/migration tests, 90 HTTP/client
tests and 6 real-browser regression tests in an independent temporary copy.
Build/typecheck passed. Lint has one pre-existing AppContext Fast Refresh warning.
The documented `0001 → seed → remaining migrations` path also succeeded in an
isolated PostgreSQL engine. These results do not include hosted verification.

At the user's request, migration filenames now follow the existing consecutive
four-digit convention through `0018`; the three timestamped files were renamed
without changing SQL contents. New files must continue with the next number.
This is not evidence of current remote history. Compare the actual target's
history and CLI dry run with local files before deployment. Documentation alone
does not establish that a migration, hook or function is active.

`SETUP.md` describes the complete migration chain, the legacy seed's required
position, first-administrator bootstrap and manual hook/Realtime prerequisites.
The account guide separates locally verified guarantees from hosted checks that
still need current evidence.

The login email now starts empty instead of preloading a staff address.

Suggested commit subject:

```text
fix: resolve supplemental audit regressions and reconcile migration guidance
```
