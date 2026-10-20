import { createClient } from 'npm:@supabase/supabase-js@2.109.0';
import { createDeleteAccountHandler } from './handler.ts';

Deno.serve(createDeleteAccountHandler({
  getEnv: name => Deno.env.get(name),
  createClient: (url, key, options) => {
    const client = createClient(url, key, options);
    return {
      auth: {
        getUser: token => client.auth.getUser(token),
        admin: {
          getUserById: id => client.auth.admin.getUserById(id),
          deleteUser: (id, shouldSoftDelete) => client.auth.admin.deleteUser(id, shouldSoftDelete),
        },
      },
      listAdministrators: () => client.from('perfiles').select('id').eq('user_role', 'admin'),
      from: table => ({
        select: columns => ({
          eq: (column, value) => {
            const query = client.from(table).select(columns).eq(column, value);
            return {
              maybeSingle: async () => {
                const { data, error } = await query.maybeSingle();
                return { data, error };
              },
            };
          },
        }),
      }),
    };
  },
}));
