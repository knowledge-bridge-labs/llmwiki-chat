export const localIoLogStorageKey = 'llmwiki-chat:local-io-log:v1'
export const localIoLoggingPreferenceStorageKey = 'llmwiki-chat:local-io-logging-enabled:v1'
export const localIoLogSchemaVersion = 'llmwiki-chat.local-io-log.v1'

const localIoLogEntryLimit = 50
const localIoLogStringLimit = 12_000
const localIoLogArrayItemLimit = 80
const localIoLogDepthLimit = 8
const redactedValue = '[redacted]'

export interface LocalIoLogEntry {
  schemaVersion: typeof localIoLogSchemaVersion
  id: string
  turnId: string
  threadId: string
  sessionId: string
  messageId: string
  assistantMessageId: string
  startedAt: string
  updatedAt: string
  completedAt?: string
  status: 'running' | 'completed' | 'error'
  runtime: {
    id: string
    name: string
    protocol: string
    mode?: string
  }
  prompt: string
  request?: {
    transport: string
    summary: Record<string, unknown>
    body: unknown
  }
  response?: {
    answer?: string
    metadata?: Record<string, unknown>
  }
  error?: {
    message: string
    diagnostic?: unknown
  }
}

export function loadLocalIoLoggingEnabled(): boolean {
  if (typeof window === 'undefined') return true

  try {
    return window.localStorage.getItem(localIoLoggingPreferenceStorageKey) !== 'false'
  } catch {
    return true
  }
}

export function persistLocalIoLoggingEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(localIoLoggingPreferenceStorageKey, enabled ? 'true' : 'false')
  } catch {
    // localStorage can be disabled or quota-limited; the current tab state remains authoritative.
  }
}

export function loadLocalIoLogEntries(): LocalIoLogEntry[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(localIoLogStorageKey)
    if (!raw) return []
    return boundLocalIoLogEntries(parseLocalIoLogJsonl(raw))
  } catch {
    return []
  }
}

export function storeLocalIoLogEntries(entries: LocalIoLogEntry[]): LocalIoLogEntry[] {
  const safeEntries = boundLocalIoLogEntries(entries.map(sanitizeLocalIoLogEntry))
  if (typeof window === 'undefined') return safeEntries

  try {
    window.localStorage.setItem(localIoLogStorageKey, localIoLogJsonl(safeEntries))
  } catch {
    // Keep the visible panel useful in memory when localStorage is unavailable or full.
  }
  return safeEntries
}

export function clearLocalIoLogEntries(): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(localIoLogStorageKey)
  } catch {
    // Clearing storage is best effort; the React state is cleared by the caller.
  }
}

export function localIoLogJsonl(entries: LocalIoLogEntry[]): string {
  return entries.map((entry) => JSON.stringify(sanitizeLocalIoLogEntry(entry))).join('\n')
}

export function sanitizeLocalIoLogEntry(entry: LocalIoLogEntry): LocalIoLogEntry {
  return sanitizeLocalIoLogValue(entry) as LocalIoLogEntry
}

export function sanitizeLocalIoLogValue(value: unknown, key = '', depth = 0): unknown {
  if (isSensitiveKey(key)) return redactedValue
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= localIoLogDepthLimit) return '[truncated-depth]'
  if (Array.isArray(value)) {
    return value
      .slice(0, localIoLogArrayItemLimit)
      .map((item) => sanitizeLocalIoLogValue(item, key, depth + 1))
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeLocalIoLogValue(entryValue, entryKey, depth + 1),
      ]),
    )
  }
  return String(value)
}

function parseLocalIoLogJsonl(raw: string): LocalIoLogEntry[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLocalIoLogLine)
    .filter((entry): entry is LocalIoLogEntry => Boolean(entry))
    .map(sanitizeLocalIoLogEntry)
}

function parseLocalIoLogLine(line: string): LocalIoLogEntry | null {
  try {
    const parsed: unknown = JSON.parse(line)
    if (!isRecord(parsed)) return null
    if (parsed.schemaVersion !== localIoLogSchemaVersion) return null
    if (
      typeof parsed.id !== 'string'
      || typeof parsed.turnId !== 'string'
      || typeof parsed.threadId !== 'string'
      || typeof parsed.sessionId !== 'string'
      || typeof parsed.messageId !== 'string'
      || typeof parsed.assistantMessageId !== 'string'
      || typeof parsed.startedAt !== 'string'
      || typeof parsed.updatedAt !== 'string'
      || typeof parsed.prompt !== 'string'
      || (parsed.status !== 'running' && parsed.status !== 'completed' && parsed.status !== 'error')
      || !isRecord(parsed.runtime)
    ) {
      return null
    }
    return parsed as unknown as LocalIoLogEntry
  } catch {
    return null
  }
}

function boundLocalIoLogEntries(entries: LocalIoLogEntry[]): LocalIoLogEntry[] {
  return entries.slice(-localIoLogEntryLimit)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return /^(?:authorization|proxyauthorization|cookie|setcookie|xapikey|apikey|accesstoken|refreshtoken|idtoken|authtoken|bearertoken|token|password|passwd|secret|clientsecret|credential|credentials|session|jwt|code|sig|signature)$/i.test(normalized)
    || normalized.endsWith('token')
    || normalized.endsWith('secret')
    || normalized.endsWith('password')
    || normalized.endsWith('credential')
    || normalized.endsWith('credentials')
    || normalized.endsWith('url')
    || normalized.endsWith('uri')
    || normalized.endsWith('endpoint')
}

function sanitizeString(value: string): string {
  const clean = value
    .replace(/\bsk-proj-[A-Za-z0-9_-]+/g, '[redacted-api-key]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted-api-key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bBasic\s+[A-Za-z0-9+/=-]+/gi, 'Basic [redacted]')
    .replace(/\b(Set-Cookie|Cookie)\s*:\s*[^\r\n]+/gi, '$1: [redacted]')
    .replace(/\b(Authorization\s*[:=]\s*)(?:Bearer\s+)?[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/\b((?:token|access_token|refresh_token|id_token|api_key|apikey|secret|client_secret|password|credential|code|sig|signature)\s*[=:]\s*)[^\s,;&"']+/gi, '$1[redacted]')
    .replace(/\b[A-Za-z]:\\[^\s"'<>]+/g, '[redacted-path]')
    .replace(/\\\\[^\\\s"'<>]+\\[^\s"'<>]+/g, '[redacted-path]')
    .replace(/\/(?:Users|home|var\/folders|var\/tmp|tmp)\/[^\s"'<>]+/g, '[redacted-path]')

  const redactedUrls = redactCredentialBearingUrls(clean)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
  if (redactedUrls.length <= localIoLogStringLimit) return redactedUrls
  return `${redactedUrls.slice(0, localIoLogStringLimit)}…[truncated]`
}

function redactCredentialBearingUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
    try {
      const url = new URL(match)
      let changed = false
      if (url.username || url.password) {
        url.username = ''
        url.password = ''
        changed = true
      }
      for (const [param] of url.searchParams) {
        if (isSensitiveUrlParam(param)) {
          url.searchParams.set(param, redactedValue)
          changed = true
        }
      }
      return changed ? url.toString() : match
    } catch {
      return match
    }
  })
}

function isSensitiveUrlParam(key: string): boolean {
  return /(?:token|secret|password|passwd|credential|authorization|api[-_]?key|key|code|signature|sig)/i.test(key)
}
