# Create accounts

Administrators call this Edge Function to create an Auth login and a profile with
role `admin`, `secretaria`, or `tutor`. Only tutor accounts create a new guardian
row. The database provisioning trigger commits these records atomically.

`POST /functions/v1/create-account` requires a verified administrator bearer token
and this JSON contract:

| Field | Requirement |
| --- | --- |
| `user_role` | Exactly `admin`, `secretaria`, or `tutor` |
| `nombre`, `apellido` | Required; 1–100 characters after trimming |
| `email` | Required; valid email, at most 254 characters; normalized to lowercase |
| `password` | Required; 12–128 characters; preserved verbatim |
| `dni` | Required only for tutor; 1–20 characters after trimming |
| `telefono` | Optional for tutor; at most 40 characters; empty value becomes null |

Staff requests omit `dni` and `telefono`. Unknown fields, guardian fields on staff
requests, invalid roles, and client-supplied provisioning metadata are rejected.
Success returns `{ "success": true }`; errors return safe Spanish messages.

Credentials remain in server environment variables `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. The function checks `auth.getUser(token)` and the
caller's current `perfiles.user_role`; browser/JWT role claims do not authorize it.
The validated role and actor are passed only through protected `app_metadata`.
No email is sent; the administrator supplies the initial password.

Apply the pending account-provisioning migration before deploying this function.
Keep gateway JWT verification enabled for the signed-in frontend invocation.
The legacy `create-tutor-account` endpoint remains tutor-only and does not accept
`user_role`.

Run the local HTTP tests from the repository root with Node 24:

```sh
node --test supabase/functions/create-account/handler.test.ts supabase/functions/create-tutor-account/handler.test.ts
```

Hosted Auth, trigger execution, and login require separate integration checks;
these tests inject clients and do not access any Supabase project.
