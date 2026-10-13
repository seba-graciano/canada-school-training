import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTutorAccountHandler } from './handler.ts';
import type { AccountClient, CreateTutorInput } from './handler.ts';

const validInput = {
  nombre: ' Ana ', apellido: ' Pérez ', dni: ' 12345678 ',
  email: ' ANA@EXAMPLE.COM ', telefono: ' 123456 ', password: '  password1234  ',
};

type TestOverrides = {
  noConfig?: boolean;
  authThrows?: boolean;
  roleThrows?: boolean;
  createThrows?: boolean;
  authResult?: Awaited<ReturnType<AccountClient['auth']['getUser']>>;
  createResult?: Awaited<ReturnType<AccountClient['auth']['admin']['createUser']>>;
  roleResult?: { data: { user_role: string } | null; error: { message: string } | null };
};

function setup(overrides: TestOverrides = {}) {
  const calls: Array<{ operation: string; value: unknown }> = [];
  const client = {
    auth: {
      getUser: async (token: string) => {
        calls.push({ operation: 'getUser', value: token });
        if (overrides.authThrows) throw new Error('sensitive auth details');
        return overrides.authResult ?? { data: { user: { id: 'admin-id', user_metadata: { role: 'admin' } } }, error: null };
      },
      admin: {
        createUser: async (input: unknown) => {
          calls.push({ operation: 'createUser', value: input });
          if (overrides.createThrows) throw new Error('sensitive SQL details');
          return overrides.createResult ?? { data: { user: { id: 'new-id' } }, error: null };
        },
      },
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, id: string) => ({
          maybeSingle: async () => {
            calls.push({ operation: 'profile', value: { table, columns, column, id } });
            if (overrides.roleThrows) throw new Error('sensitive SQL details');
            return overrides.roleResult ?? { data: { user_role: 'admin' }, error: null };
          },
        }),
      }),
    }),
  };
  const handler = createTutorAccountHandler({
    getEnv: (key: string) => overrides.noConfig ? undefined : ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-key' } as Record<string, string>)[key],
    createClient: (url: string, key: string, options: unknown) => {
      calls.push({ operation: 'client', value: { url, key, options } });
      return client;
    },
  });
  const request = (body: unknown = validInput, authorization: string | null = 'Bearer valid-token', method = 'POST') => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authorization !== null) headers.authorization = authorization;
    return new Request('https://test.supabase.co/functions/v1/create-tutor-account', {
      method, headers, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
  };
  return { handler, calls, request };
}

async function expectError(response: Response, status: number) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
  assert.ok(!JSON.stringify(body).includes('sensitive'));
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
}

test('admin creates a confirmed Auth identity and normalizes guardian data', async () => {
  const { handler, calls, request } = setup();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(calls.map(call => call.operation), ['client', 'getUser', 'profile', 'createUser']);
  assert.equal(calls[1].value, 'valid-token');
  assert.deepEqual(calls[2].value, { table: 'perfiles', columns: 'user_role', column: 'id', id: 'admin-id' });
  assert.deepEqual(calls[3].value, {
    email: 'ana@example.com', password: validInput.password, email_confirm: true,
    user_metadata: { nombre: 'Ana', apellido: 'Pérez', dni: '12345678', telefono: '123456' },
    app_metadata: { provision_tutor_by: 'admin-id' },
  });
  assert.deepEqual(calls[0].value, {
    url: 'https://test.supabase.co', key: 'server-only-key',
    options: { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  });
});

test('phone is optional and maps to null', async () => {
  const { handler, calls, request } = setup();
  const { telefono: _phone, ...input } = validInput;
  assert.equal((await handler(request(input))).status, 200);
  assert.equal((calls.at(-1)!.value as CreateTutorInput).user_metadata.telefono, null);
});

for (const token of [null, '', 'Basic valid-token', 'Bearer', 'Bearer one two']) {
  test(`rejects missing or malformed bearer: ${token}`, async () => {
    const { handler, calls, request } = setup();
    await expectError(await handler(request(validInput, token)), 401);
    assert.equal(calls.length, 0);
  });
}

for (const authResult of [
  { data: { user: null }, error: null },
  { data: { user: { id: 'admin-id' } }, error: { message: 'sensitive token' } },
]) {
  test('rejects token not verified by Auth', async () => {
    const { handler, calls, request } = setup({ authResult });
    await expectError(await handler(request()), 401);
    assert.deepEqual(calls.map(call => call.operation), ['client', 'getUser']);
  });
}

for (const role of ['secretaria', 'tutor', null]) {
  test(`denies ${role} even with administrator user metadata`, async () => {
    const { handler, calls, request } = setup({ roleResult: { data: role ? { user_role: role } : null, error: null } });
    await expectError(await handler(request()), 403);
    assert.ok(!calls.some(call => call.operation === 'createUser'));
  });
}

for (const field of ['role', 'user_role', 'tutor_id', 'app_metadata', 'unknown']) {
  test(`rejects forbidden/unknown input field ${field}`, async () => {
    const { handler, calls, request } = setup();
    await expectError(await handler(request({ ...validInput, [field]: 'admin' })), 400);
    assert.ok(!calls.some(call => call.operation === 'createUser'));
  });
}

for (const body of [null, [], 'text', {},
  { ...validInput, nombre: ' ' }, { ...validInput, apellido: 10 },
  { ...validInput, dni: '' }, { ...validInput, email: 'invalid' },
  { ...validInput, telefono: 123 }, { ...validInput, password: 'short' },
  { ...validInput, nombre: 'a'.repeat(101) }, { ...validInput, apellido: 'a'.repeat(101) },
  { ...validInput, dni: '1'.repeat(21) }, { ...validInput, telefono: '1'.repeat(41) },
  { ...validInput, email: `${'a'.repeat(250)}@b.co` }, { ...validInput, password: 'a'.repeat(129) },
]) {
  test(`rejects invalid input ${JSON.stringify(body).slice(0, 50)}`, async () => {
    const { handler, calls, request } = setup();
    await expectError(await handler(request(body)), 400);
    assert.ok(!calls.some(call => call.operation === 'createUser'));
  });
}

test('rejects malformed JSON without creating users', async () => {
  const { handler, calls } = setup();
  await expectError(await handler(new Request('https://test', { method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: '{' })), 400);
  assert.ok(!calls.some(call => call.operation === 'createUser'));
});

for (const code of ['email_exists', 'user_already_exists']) {
  test(`maps duplicate ${code} without exposing provider details`, async () => {
    const { handler, request } = setup({ createResult: { data: { user: null }, error: { code, message: 'sensitive duplicate detail' } } });
    await expectError(await handler(request()), 409);
  });
}

for (const overrides of [
  { noConfig: true }, { authThrows: true }, { roleThrows: true }, { createThrows: true },
  { roleResult: { data: { user_role: 'admin' }, error: { message: 'sensitive DB' } } },
  { createResult: { data: { user: null }, error: { code: 'unexpected_failure', message: 'sensitive DB' } } },
  { createResult: { data: { user: null }, error: null } },
]) {
  test(`fails closed on configuration/service failure ${JSON.stringify(overrides).slice(0, 40)}`, async () => {
    const { handler, calls, request } = setup(overrides);
    await expectError(await handler(request()), 500);
    if (overrides.noConfig || overrides.authThrows || overrides.roleThrows || overrides.roleResult) {
      assert.ok(!calls.some(call => call.operation === 'createUser'));
    }
  });
}

test('GET is rejected and OPTIONS supports browser preflight without auth', async () => {
  const { handler, calls, request } = setup();
  await expectError(await handler(request(undefined, null, 'GET')), 405);
  const response = await handler(request(undefined, null, 'OPTIONS'));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.ok(response.headers.get('Access-Control-Allow-Headers')?.includes('authorization'));
  assert.equal(calls.length, 0);
});
