# Delete account Edge Function

`POST /functions/v1/delete-account` accepts exactly `{ "user_id": "<uuid>" }` and returns `{ "success": true }` on success or `{ "error": "..." }` on failure.

The function validates the bearer token with Supabase Auth, checks the caller's current `perfiles.user_role`, rejects self-deletion, confirms the target Auth identity exists, and then invokes the server-side Auth Admin API with hard deletion. The service-role key stays in Edge Function environment variables. The database trigger protects the final administrator inside the same transaction as the Auth deletion; an Auth identity deletion cascades to its profile and leaves tutors, students, installments, and payments intact.

The account directory is exposed through `admin_list_accounts(p_search, p_page, p_page_size)`. It returns Auth identity ID, email, and nullable profile role with a maximum page size of 100. Only the current administrator profile may call it.
