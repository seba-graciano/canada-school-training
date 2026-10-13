type ServiceError = { code?: string; message?: string };
type UserResult = { data: { user: { id: string } | null }; error: ServiceError | null };

export type AccountRole = 'tutor' | 'admin' | 'secretaria';

export type CreateAccountInput = {
  email: string;
  password: string;
  email_confirm: true;
  user_metadata: { nombre: string; apellido: string; dni?: string; telefono?: string | null };
  app_metadata: { provision_tutor_by: string } | { provision_account_by: string; provision_account_role: AccountRole };
};

export type CreateTutorInput = CreateAccountInput;

export type AccountClient = {
  auth: {
    getUser: (token: string) => Promise<UserResult>;
    admin: { createUser: (input: CreateTutorInput) => Promise<UserResult> };
  };
  from: (table: 'perfiles') => {
    select: (columns: 'user_role') => {
      eq: (column: 'id', id: string) => {
        maybeSingle: () => PromiseLike<{ data: { user_role: string } | null; error: ServiceError | null }>;
      };
    };
  };
};

type Dependencies = {
  getEnv: (name: string) => string | undefined;
  createClient: (url: string, key: string, options: {
    auth: { persistSession: false; autoRefreshToken: false; detectSessionInUrl: false };
  }) => AccountClient;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function json(body: { success: true } | { error: string }, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function validateInput(value: unknown, legacyTutor: boolean): (Omit<CreateAccountInput, 'email_confirm' | 'app_metadata'> & { user_role: AccountRole }) | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowed = ['nombre', 'apellido', 'dni', 'email', 'telefono', 'password'];
  if (!legacyTutor) allowed.push('user_role');
  if (Object.keys(input).some(key => !allowed.includes(key))) return null;
  const role = legacyTutor ? 'tutor' : input.user_role;
  if (role !== 'tutor' && role !== 'admin' && role !== 'secretaria') return null;

  const text = (key: string, max: number): string | null => {
    const raw = input[key];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
  };
  const nombre = text('nombre', 100);
  const apellido = text('apellido', 100);
  const dni = role === 'tutor' ? text('dni', 20) : undefined;
  if (role !== 'tutor' && (input.dni !== undefined || input.telefono !== undefined)) return null;
  const email = text('email', 254)?.toLowerCase();
  const password = input.password;
  let telefono: string | null = null;
  if (input.telefono !== undefined) {
    if (typeof input.telefono !== 'string' || input.telefono.trim().length > 40) return null;
    telefono = input.telefono.trim() || null;
  }
  if (!nombre || !apellido || (role === 'tutor' && !dni) || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || typeof password !== 'string' || password.length < 12 || password.length > 128) return null;
  return { email, password, user_role: role, user_metadata: { nombre, apellido,
    ...(role === 'tutor' ? { dni: dni!, telefono } : {}) } };
}

export function createTutorAccountHandler(dependencies: Dependencies) {
  return accountHandler(dependencies, true);
}

export function createAccountHandler(dependencies: Dependencies) {
  return accountHandler(dependencies, false);
}

function accountHandler(dependencies: Dependencies, legacyTutor: boolean) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
    const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i);
    if (!bearer) return json({ error: 'Inicia sesión para continuar.' }, 401);

    try {
      const url = dependencies.getEnv('SUPABASE_URL');
      const key = dependencies.getEnv('SUPABASE_SERVICE_ROLE_KEY');
      if (!url?.trim() || !key?.trim()) return json({ error: 'No se pudo crear la cuenta. Intenta nuevamente.' }, 500);
      // Each request has its own service client; caller tokens never replace service credentials.
      const client = dependencies.createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data: callerData, error: callerError } = await client.auth.getUser(bearer[1]);
      if (callerError || !callerData.user?.id) return json({ error: 'La sesión no es válida. Inicia sesión nuevamente.' }, 401);

      const { data: profile, error: profileError } = await client.from('perfiles')
        .select('user_role').eq('id', callerData.user.id).maybeSingle();
      if (profileError) return json({ error: 'No se pudo verificar el permiso para crear cuentas.' }, 500);
      if (profile?.user_role !== 'admin') return json({ error: legacyTutor
        ? 'Solo un administrador puede crear cuentas de tutores.'
        : 'Solo un administrador puede crear cuentas.' }, 403);

      let payload: unknown;
      try {
        const body = await request.text();
        if (body.length > 8192) return json({ error: 'Los datos ingresados no son válidos.' }, 400);
        payload = JSON.parse(body);
      } catch {
        return json({ error: 'Los datos ingresados no son válidos.' }, 400);
      }
      const input = validateInput(payload, legacyTutor);
      if (!input) return json({ error: 'Revisa los datos ingresados. La contraseña debe tener entre 12 y 128 caracteres.' }, 400);

      // The Auth insert trigger creates the profile and, for tutors, the guardian atomically.
      const { user_role, ...accountData } = input;
      const app_metadata: CreateAccountInput['app_metadata'] = legacyTutor
        ? { provision_tutor_by: callerData.user.id }
        : { provision_account_by: callerData.user.id, provision_account_role: user_role };
      const { data, error } = await client.auth.admin.createUser({
        ...accountData, email_confirm: true, app_metadata,
      });
      if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
        return json({ error: 'Ya existe una cuenta con ese correo electrónico.' }, 409);
      }
      if (error?.code === 'weak_password' || error?.code === 'email_address_invalid' || error?.code === 'validation_failed') {
        return json({ error: 'El correo o la contraseña no cumplen los requisitos.' }, 400);
      }
      if (error || !data.user?.id) return json({ error: 'No se pudo crear la cuenta. Intenta nuevamente.' }, 500);
      return json({ success: true }, 200);
    } catch {
      return json({ error: 'No se pudo crear la cuenta. Intenta nuevamente.' }, 500);
    }
  };
}
