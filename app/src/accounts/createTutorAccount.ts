import { submitAccountRequest } from './createAccount.ts'
import type { InvokeFunction } from './createAccount.ts'

export type TutorAccountInput = {
  nombre: string
  apellido: string
  dni: string
  email: string
  telefono: string
  password: string
}

export function createTutorAccount(
  input: TutorAccountInput,
  invoke: InvokeFunction<TutorAccountInput>,
) {
  return submitAccountRequest('create-tutor-account', input, invoke)
}
