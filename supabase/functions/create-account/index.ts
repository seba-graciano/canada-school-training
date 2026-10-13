import { createClient } from 'npm:@supabase/supabase-js@2.109.0';
import { createAccountHandler } from '../create-tutor-account/handler.ts';

Deno.serve(createAccountHandler({
  getEnv: (name) => Deno.env.get(name),
  createClient: (url, key, options) => {
    const client = createClient(url, key, options);
    return {
      auth: {
        getUser: (token) => client.auth.getUser(token),
        admin: { createUser: (input) => client.auth.admin.createUser(input) },
      },
      from: (table) => ({
        select: (columns) => ({
          eq: (column, id) => ({
            maybeSingle: async () => {
              const { data, error } = await client.from(table).select(columns).eq(column, id).maybeSingle();
              return { data, error };
            },
          }),
        }),
      }),
    };
  },
}));
