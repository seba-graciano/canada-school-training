import { FunctionsHttpError } from '@supabase/supabase-js'

export type AccountRole = 'admin' | 'secretaria' | 'tutor' | null
export type DirectoryAccount = { id: string; email: string | null; user_role: AccountRole }
export type AccountDirectory = { accounts: DirectoryAccount[]; total: number; page: number; page_size: number }
type Rpc = (name: string, args: { p_search: string; p_page: number; p_page_size: 20 }) => Promise<{ data: unknown; error: unknown }>
type Invoke = (name: string, options: { body: { user_id: string } }) => Promise<{ data: unknown; error: unknown }>

const loadError = 'No se pudo cargar el listado de cuentas. Intente nuevamente.'
const deleteError = 'No se pudo eliminar la cuenta. Verifique la conexión e intente nuevamente.'
const roles = new Set(['admin', 'secretaria', 'tutor'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAccount(value: unknown): value is DirectoryAccount {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && value.id.length > 0
    && (typeof value.email === 'string' || value.email === null)
    && (value.user_role === null || (typeof value.user_role === 'string' && roles.has(value.user_role)))
}

function isDirectory(value: unknown): value is AccountDirectory {
  return isRecord(value)
    && Array.isArray(value.accounts) && value.accounts.every(isAccount)
    && Number.isInteger(value.total) && Number(value.total) >= 0
    && Number.isInteger(value.page) && Number(value.page) >= 1
    && Number.isInteger(value.page_size) && Number(value.page_size) === 20
}

export async function listAccounts(
  input: { search: string; page: number },
  rpc: Rpc,
): Promise<AccountDirectory | { error: string }> {
  try {
    const { data, error } = await rpc('admin_list_accounts', {
      p_search: input.search,
      p_page: input.page,
      p_page_size: 20,
    })
    if (error || !isDirectory(data)) return { error: loadError }
    return data
  } catch {
    return { error: loadError }
  }
}

async function safeFunctionError(error: unknown): Promise<string | null> {
  if (error instanceof FunctionsHttpError && isRecord(error.context) && 'json' in error.context) {
    try {
      const body: unknown = await (error.context as unknown as Response).json()
      if (isRecord(body) && typeof body.error === 'string' && body.error.trim()) return body.error
    } catch {
      return null
    }
  }
  return null
}

export async function deleteAccount(userId: string, invoke: Invoke): Promise<{ success: true } | { error: string }> {
  try {
    const { data, error } = await invoke('delete-account', { body: { user_id: userId } })
    if (error) return { error: (await safeFunctionError(error)) ?? deleteError }
    if (isRecord(data) && data.success === true) return { success: true }
    if (isRecord(data) && typeof data.error === 'string' && data.error.trim()) return { error: data.error }
    return { error: deleteError }
  } catch {
    return { error: deleteError }
  }
}
