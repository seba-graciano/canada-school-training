import '../src/index.css'
import { createRoot } from 'react-dom/client'
import { AppProvider } from '../src/AppContext'
import AccountScreen from '../src/accounts/AccountScreen'
import { supabase } from '../src/supabase'

declare global {
  interface Window { accountDirectory: any }
}

const session = {
  access_token: `e30.${btoa(JSON.stringify({ user_role: 'admin' }))}.signature`,
  refresh_token: 'local-fixture',
  user: { id: 'current-admin', email: 'admin@example.com' },
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
}
const accounts: Array<{ id: string; email: string | null; user_role: string | null }> = [
  { id: session.user.id, email: session.user.email, user_role: 'admin' },
  ...Array.from({ length: 20 }, (_, index) => ({
    id: `account-${index + 1}`,
    email: index === 1 ? null : `person${String(index + 1).padStart(2, '0')}@example.com`,
    user_role: index === 1 ? null : index % 2 ? 'tutor' : 'secretaria',
  })),
]
const controls = (window as any).accountDirectory = {
  accounts,
  rpcCalls: [] as unknown[],
  functionCalls: [] as unknown[],
  deleteCalls: [] as unknown[],
  deleteError: '',
  delayDelete: false,
  delaySearch: '',
  rpcError: '',
  createdRoles: [] as string[],
}

supabase.auth.getSession = async () => ({ data: { session: session as any }, error: null }) as any
supabase.auth.onAuthStateChange = (() => ({ data: { subscription: { unsubscribe: () => undefined } } })) as any
supabase.rpc = (async (name: string, args: Record<string, unknown>) => {
  controls.rpcCalls.push({ name, args })
  const search = String(args.p_search ?? '').toLocaleLowerCase()
  if (controls.delaySearch.toLocaleLowerCase() === search) await new Promise(resolve => setTimeout(resolve, 350))
  if (controls.rpcError) return { data: null, error: new Error(controls.rpcError) }
  const page = Number(args.p_page ?? 1)
  const filtered = controls.accounts.filter((account: any) => (account.email ?? '').toLocaleLowerCase().includes(search))
  const start = (page - 1) * 20
  return { data: { accounts: filtered.slice(start, start + 20), total: filtered.length, page, page_size: 20 }, error: null }
}) as any
createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <AccountScreen onBack={() => undefined} onCreated={role => controls.createdRoles.push(role)} />
  </AppProvider>,
)
