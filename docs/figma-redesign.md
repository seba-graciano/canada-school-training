# Selecting installments to collect

Open **Alumnos**, choose **Cobrar**, select the months being paid, review the amount, and confirm. Months need not be consecutive. Nothing is charged when opening a student or selecting checkboxes. Paid installments remain visible and cannot be selected. Tutor accounts can inspect their linked students but cannot collect payments.

## Amounts and failure handling

The review uses the existing collection amount in integer cents: installment amount plus stored surcharge minus stored discount. Dashboard late-fee reporting remains unchanged and is not added automatically to this amount. The existing backend records cash payments dated today; this redesign does not add payment methods, receipt references, invitations, roles, or other unconfirmed Figma rules.

Immediately before collection, the screen reloads the selected student's installments and requires a fresh review if an amount or paid state changed. Submission is locked against repeat clicks. Each selected installment uses the existing `cobrar_cuota` transaction, with its existing authorization, row lock and duplicate-payment checks. A group is not one atomic transaction: if one installment fails, processing stops, earlier successful payments remain recorded, and the screen reloads the server state before another selection. Network failures never trigger automatic retries.

Installments with an existing partial payment are shown for review and cannot be submitted through this screen: the existing RPC charges the full configured amount rather than subtracting an earlier partial payment. This prevents the new selection flow from overcharging those balances without changing financial rules or stored records. No database migration is included. The existing single-ID RPC does not accept an expected amount, so concurrent fee changes after the final reload remain subject to that existing backend contract; the success message reports its actual returned amount.

## Interface and verification

The shared shell, login, student list, student details, collection review and account creation follow the supplied desktop/mobile design. Filters use live data, and small screens use student cards. Account creation retains the current three roles and password workflow. Registered account search and guarded deletion are documented in [account-directory.md](account-directory.md), including their required backend activation. SVGs and Inter font files are stored locally under `app/public/design`; the font license is included.

From `app/`, run:

```powershell
npm run build
npm run lint
node --test src/accounts/createAccount.test.mjs src/accounts/createTutorAccount.test.mjs
$env:PLAYWRIGHT_MODULE = '<absolute path to an existing playwright/index.mjs>'
node --test tests/frontend-regressions.test.mjs
```

The browser suite intercepts all backend requests and uses no real school data. It covers skipped months, single-month collection, repeated confirmation, paid and partial balances, server changes, partial group failures, tutor restrictions, stale dashboard responses and logout recovery. Layout and local asset geometry checks cover 390, 768 and 1440 px. To save screenshots, set `REDESIGN_SCREENSHOTS` to an output directory before running it.

Rollback boundary: the frontend redesign and new payment selection files; existing database schema, migrations and account endpoints are unchanged. Implementation progress and the original requirements are recorded in `odd/tasks/figma-redesign.md`.
