import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAccountHandler } from '../create-tutor-account/handler.ts';
import type { AccountClient, CreateTutorInput } from '../create-tutor-account/handler.ts';

const common = { nombre: ' New ', apellido: ' Account ', email: ' NEW@EXAMPLE.TEST ', password: 'password123456' };

function setup(role: string | null = 'admin', validToken = true) {
  const writes: CreateTutorInput[] = [];
  const client: AccountClient = {
    auth: {
      getUser: async () => ({ data: { user: validToken ? { id: 'current-admin' } : null }, error: null }),
      admin: { createUser: async input => {
        writes.push(input);
        return { data: { user: { id: 'new-account' } }, error: null };
      } },
    },
    from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: role ? { user_role: role } : null, error: null }),
    }) }) }),
  };
  const handler = createAccountHandler({
    getEnv: name => ({ SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'server-key' } as Record<string, string>)[name],
    createClient: () => client,
  });
  const request = (input: unknown, token: string | null = 'Bearer current-token') => new Request('https://example.test/functions/v1/create-account', {
    method: 'POST', headers: token ? { authorization: token } : {}, body: JSON.stringify(input),
  });
  return { writes, handler, request };
}

for (const user_role of ['admin', 'secretaria', 'tutor']) {
  test(`creates ${user_role} with a protected validated role`, async () => {
    const { writes, handler, request } = setup();
    const tutorData = user_role === 'tutor' ? { dni: ' 12345678 ', telefono: ' 5555 ' } : {};
    const response = await handler(request({ ...common, ...tutorData, user_role }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.deepEqual(writes, [{
      email: 'new@example.test', password: common.password, email_confirm: true,
      user_metadata: { nombre: 'New', apellido: 'Account', ...(user_role === 'tutor' ? { dni: '12345678', telefono: '5555' } : {}) },
      app_metadata: { provision_account_by: 'current-admin', provision_account_role: user_role },
    }]);
  });
}

for (const user_role of [undefined, null, '', 'ADMIN', 'teacher', {}, ['admin']]) {
  test(`rejects absent or invalid role ${JSON.stringify(user_role)}`, async () => {
    const { writes, handler, request } = setup();
    const response = await handler(request({ ...common, user_role }));
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
    assert.deepEqual(writes, []);
  });
}

test('tutor DNI is required and staff guardian fields are rejected', async () => {
  const { writes, handler, request } = setup();
  for (const input of [
    { ...common, user_role: 'tutor' },
    { ...common, user_role: 'tutor', dni: ' ' },
    { ...common, user_role: 'admin', dni: '12345' },
    { ...common, user_role: 'secretaria', telefono: '12345' },
  ]) assert.equal((await handler(request(input))).status, 400);
  assert.deepEqual(writes, []);
});

for (const field of ['tutor_id', 'role', 'app_metadata', 'user_metadata', 'provision_account_role']) {
  test(`rejects injected ${field}`, async () => {
    const { writes, handler, request } = setup();
    assert.equal((await handler(request({ ...common, user_role: 'admin', [field]: 'admin' }))).status, 400);
    assert.deepEqual(writes, []);
  });
}

for (const role of ['secretaria', 'tutor', null]) {
  test(`current ${role} profile cannot provision any role`, async () => {
    const { writes, handler, request } = setup(role);
    for (const user_role of ['admin', 'secretaria', 'tutor']) {
      assert.equal((await handler(request({ ...common, user_role, dni: '12345' }))).status, 403);
    }
    assert.deepEqual(writes, []);
  });
}

test('missing or invalid bearer cannot provision staff', async () => {
  const { writes, handler, request } = setup('admin', false);
  for (const token of [null, 'Bearer invalid']) {
    assert.equal((await handler(request({ ...common, user_role: 'admin' }, token))).status, 401);
  }
  assert.deepEqual(writes, []);
});
