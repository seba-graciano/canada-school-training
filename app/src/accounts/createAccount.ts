import { FunctionsHttpError } from '@supabase/supabase-js'

export type AccountRole = 'tutor' | 'admin' | 'secretaria'
type CommonAccountInput = { nombre: string; apellido: string; email: string; password: string }
export type AccountInput = CommonAccountInput & (
  { user_role: 'tutor'; dni: string; telefono?: string } |
  { user_role: 'admin' | 'secretaria' }
)
export type InvokeFunction<Input> = (
  name: string,
  options: { body: Input },
) => Promise<{ data: unknown; error: unknown }>

const fallbackError = 'No se pudo crear la cuenta. Verifique la conexión e intente nuevamente.'

function responseError(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('error' in data)) return null
  return typeof data.error === 'string' && data.error.trim() ? data.error : null
}

export async function submitAccountRequest<Input>(
  endpoint: string,
  input: Input,
  invoke: InvokeFunction<Input>,
): Promise<{ success: true } | { error: string }> {
  try {
    const { data, error } = await invoke(endpoint, { body: input })
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const message = responseError(await error.context.json())
        if (message) return { error: message }
      }
      return { error: fallbackError }
    }
    const message = responseError(data)
    if (message) return { error: message }
    if (typeof data === 'object' && data !== null && 'success' in data && data.success === true) {
      return { success: true }
    }
    return { error: fallbackError }
  } catch {
    return { error: fallbackError }
  }
}

export function createAccount(input: AccountInput, invoke: InvokeFunction<AccountInput>) {
  return submitAccountRequest('create-account', input, invoke)
}
