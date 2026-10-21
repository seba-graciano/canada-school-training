export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const segments = token.split('.')
    if (segments.length !== 3) return null
    const segment = segments[1]
    if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) return null

    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4))
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    return payload as Record<string, unknown>
  } catch {
    return null
  }
}
