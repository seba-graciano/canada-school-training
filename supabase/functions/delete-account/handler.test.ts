import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeleteAccountHandler } from './handler.ts';
import type { DeleteAccountClient } from './handler.ts';

const adminId = '00000000-0000-4000-8000-000000000001';
const targetId = '00000000-0000-4000-8000-000000000002';

function setup(options: { role?: string | null; validToken?: boolean; targetExists?: boolean; deleteError?: { code?: string; message?: string } | null; throwDelete?: boolean } = {}) {
  const deletes: Array<{ id: string; shouldSoftDelete: boolean }> = [];
  const clientOptions: unknown[] = [];
  const client: DeleteAccountClient = {
    auth: {
      getUser: async token => ({ data: { user: options.validToken === false || token !== 'caller-token' ? null : { id: adminId } }, error: null }),
      admin: {
        getUserById: async id => ({ data: { user: options.targetExists === false || id !== targetId ? null : { id } }, error: null }),
        deleteUser: async (id, shouldSoftDelete) => {
          deletes.push({ id, shouldSoftDelete });
          if (options.throwDelete) throw new Error('private database details');
          return { data: { user: null }, error: options.deleteError ?? null };
        },
      },
    },
    listAdministrators: async () => ({ data: [{ id: targetId }], error: null }),
    from: () => ({ select: columns => ({ eq: (_column, id) => ({
      maybeSingle: async () => ({ data: id === adminId ? (options.role === null ? null : { user_role: options.role ?? 'admin' }) : (id === targetId ? { user_role: 'admin' } : null), error: null }),
    }) }) }),
  };
  const handler = createDeleteAccountHandler({
    getEnv: name => ({ SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'server-key' } as Record<string, string>)[name],
    createClient: (_url, _key, opts) => { clientOptions.push(opts); return client; },
  });
  const request = (input: unknown, token: string | null = 'Bearer caller-token', method = 'POST', body?: string) =>
    new Request('https://example.test/functions/v1/delete-account', { method, headers: token ? { authorization: token, 'content-type': 'application/json' } : {}, ...(method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? {} : { body: body ?? JSON.stringify(input) }) });
  return { handler, request, deletes, clientOptions };
}

test('authenticated admin deletes a valid other account with hard-delete Admin API', async () => {
  const { handler, request, deletes, clientOptions } = setup();
  const response = await handler(request({ user_id: targetId }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(deletes, [{ id: targetId, shouldSoftDelete: false }]);
  assert.deepEqual(clientOptions, [{ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }]);
});

test('unauthorized and stale profiles cannot delete identities', async () => {
  for (const opts of [{ validToken: false }, { role: 'secretaria' }, { role: null }]) {
    const { handler, request, deletes } = setup(opts);
    const response = await handler(request({ user_id: targetId }));
    assert.ok(response.status === 401 || response.status === 403);
    assert.deepEqual(deletes, []);
  }
});

test('rejects self, malformed, absent, and non-existing target IDs without mutation', async () => {
  for (const [opts, id] of [[{}, adminId.toUpperCase()], [{}, 'bad-uuid'], [{}, undefined], [{ targetExists: false }, targetId]] as const) {
    const { handler, request, deletes } = setup(opts);
    const response = await handler(request(id === undefined ? {} : { user_id: id }));
    assert.ok(response.status >= 400);
    assert.deepEqual(deletes, []);
  }
});

test('requires exactly the delete-account payload and bounds malformed requests', async () => {
  const { handler, request, deletes } = setup();
  for (const input of [{ user_id: targetId, role: 'admin' }, [], null]) assert.equal((await handler(request(input))).status, 400);
  assert.equal((await handler(request({}, 'Bearer caller-token', 'POST', '{'))).status, 400);
  assert.equal((await handler(request({}, 'Bearer caller-token', 'POST', ' '.repeat(8193)))).status, 400);
  assert.equal((await handler(request({}, 'Bearer caller-token', 'GET'))).status, 405);
  assert.equal((await handler(request({}, null, 'OPTIONS'))).status, 204);
  assert.deepEqual(deletes, []);
});

test('maps last-admin trigger failures safely even when the SDK reports a generic database error', async () => {
  const { handler, request, deletes } = setup({ deleteError: { message: 'Database error deleting user' } });
  const response = await handler(request({ user_id: targetId }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /último administrador/i);
  assert.doesNotMatch(body.error, /Database error|private database/i);
  assert.deepEqual(deletes, [{ id: targetId, shouldSoftDelete: false }]);
});
