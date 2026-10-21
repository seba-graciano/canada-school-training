type ServiceError = { code?: string; message?: string };
type UserResult = { data: { user: { id: string } | null }; error: ServiceError | null };
type ProfileResult = { data: { user_role: string } | null; error: ServiceError | null };

export type DeleteAccountClient = {
  auth: {
    getUser: (token: string) => Promise<UserResult>;
    admin: {
      getUserById: (id: string) => Promise<UserResult>;
      deleteUser: (id: string, shouldSoftDelete?: boolean) => Promise<UserResult>;
    };
  };
  listAdministrators: () => PromiseLike<{ data: Array<{ id: string }> | null; error: ServiceError | null }>;
  from: (table: 'perfiles') => {
    select: (columns: 'user_role') => {
      eq: (column: 'id', value: string) => {
        maybeSingle: () => PromiseLike<ProfileResult>;
      };
    };
  };
};

type Dependencies = {
  getEnv: (name: string) => string | undefined;
  createClient: (url: string, key: string, options: {
    auth: { persistSession: false; autoRefreshToken: false; detectSessionInUrl: false };
  }) => DeleteAccountClient;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
const lastAdminMarker = 'ACCOUNT_DIRECTORY_LAST_ADMIN';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: { success: true } | { error: string }, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function readSmallBody(request: Request): Promise<unknown | null> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 8192)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function validInput(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'user_id') || typeof input.user_id !== 'string') return null;
  const id = input.user_id.trim();
  return id.length <= 36 && uuidPattern.test(id) ? id.toLowerCase() : null;
}

export function createDeleteAccountHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
    const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i);
    if (!bearer) return json({ error: 'Inicia sesión para continuar.' }, 401);

    try {
      const url = dependencies.getEnv('SUPABASE_URL');
      const key = dependencies.getEnv('SUPABASE_SERVICE_ROLE_KEY');
      if (!url?.trim() || !key?.trim()) return json({ error: 'No se pudo eliminar la cuenta. Intenta nuevamente.' }, 500);
      // Use a fresh service client per request; never replace its credentials with the caller token.
      const client = dependencies.createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data: callerData, error: callerError } = await client.auth.getUser(bearer[1]);
      if (callerError || !callerData.user?.id) return json({ error: 'La sesión no es válida. Inicia sesión nuevamente.' }, 401);

      const { data: callerProfile, error: callerProfileError } = await client.from('perfiles')
        .select('user_role').eq('id', callerData.user.id).maybeSingle();
      if (callerProfileError) return json({ error: 'No se pudo verificar el permiso para eliminar cuentas.' }, 500);
      if (callerProfile?.user_role !== 'admin') return json({ error: 'Solo un administrador puede eliminar cuentas.' }, 403);

      const targetId = validInput(await readSmallBody(request));
      if (!targetId) return json({ error: 'Los datos ingresados no son válidos.' }, 400);
      if (targetId === callerData.user.id.toLowerCase()) return json({ error: 'No puedes eliminar tu propia cuenta.' }, 400);

      const { data: targetData, error: targetError } = await client.auth.admin.getUserById(targetId);
      if (targetError) return json({ error: 'No se pudo verificar la cuenta seleccionada.' }, 500);
      if (!targetData.user?.id) return json({ error: 'La cuenta seleccionada no existe.' }, 404);
      const { data: targetProfile, error: targetProfileError } = await client.from('perfiles')
        .select('user_role').eq('id', targetId).maybeSingle();
      if (targetProfileError) return json({ error: 'No se pudo verificar la cuenta seleccionada.' }, 500);

      const { error: deleteError } = await client.auth.admin.deleteUser(targetId, false);
      if (deleteError) {
        // The Auth Admin API may replace a Postgres trigger's message with a generic error.
        // This fallback is diagnostic only; the serialized trigger remains authoritative.
        if (deleteError.message?.includes(lastAdminMarker)) return json({ error: 'No se puede eliminar al último administrador.' }, 409);
        if (targetProfile?.user_role === 'admin') {
          const { data: admins, error: adminsError } = await client.listAdministrators();
          if (!adminsError && admins?.length === 1 && admins[0].id.toLowerCase() === targetId) {
            return json({ error: 'No se puede eliminar al último administrador.' }, 409);
          }
        }
        return json({ error: 'No se pudo eliminar la cuenta. Intenta nuevamente.' }, 500);
      }
      return json({ success: true }, 200);
    } catch {
      return json({ error: 'No se pudo eliminar la cuenta. Intenta nuevamente.' }, 500);
    }
  };
}
