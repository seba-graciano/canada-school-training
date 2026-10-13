# Create tutor account

This legacy endpoint stays tutor-only and rejects `user_role`. Use the new
[`create-account`](../create-account/README.md) endpoint to select an existing role.

This Edge Function accepts administrator requests to create a confirmed Auth
identity. The provisioning trigger in the database creates the guardian and tutor
profile within the Auth insert transaction. Apply that migration before enabling
the function.

The runtime reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only from the
server environment. Never pass the service key to the browser. It validates the
bearer token with Auth and checks the caller's current `perfiles.user_role` before
creating a user. A separate service client is created for every request.

`POST /functions/v1/create-tutor-account` accepts JSON with `nombre`, `apellido`,
`dni`, `email`, `password`, and optional `telefono`. All other fields are rejected.
Names allow up to 100 characters, DNI 20, email 254, phone 40, and password 12–128.
The function trims personal fields and lowercases email; password is preserved.
Empty or omitted phone is stored as null. Success returns `{ "success": true }`.
Errors return a safe Spanish `{ "error": "..." }` message. No invitations or
confirmation emails are sent; the administrator supplies the initial password.

Run HTTP-boundary tests without Deno or a Supabase project:

```sh
node --experimental-strip-types --test supabase/functions/create-tutor-account/handler.test.ts
```

These tests inject Auth/database clients. Integration verification of Auth and the
transactional trigger must run separately against an authorized Supabase environment.
