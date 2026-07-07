export function isReachablePublicHttpsSourceUrl(value: string): boolean {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(value)
  } catch {
    return false
  }

  if (parsedUrl.protocol !== 'https:') return false

  const host = parsedUrl.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase()
  return isPublicReachableHost(host)
}

export function isAllowedAgentRuntimeUrl(value: string): boolean {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(value)
  } catch {
    return false
  }

  const protocol = parsedUrl.protocol
  const host = normalizedHost(parsedUrl)
  if ((protocol === 'http:' || protocol === 'https:') && isLoopbackHost(host)) return true
  if (allowsPrivateAgentRuntimeUrls() && (protocol === 'http:' || protocol === 'https:') && isPrivateAgentRuntimeHost(host)) {
    return true
  }
  return protocol === 'https:' && isPublicReachableHost(host)
}

export function isAllowedA2aKnowledgeSourceMessageUrl(value: string): boolean {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(value)
  } catch {
    return false
  }

  const protocol = parsedUrl.protocol
  const host = normalizedHost(parsedUrl)
  if ((protocol === 'http:' || protocol === 'https:') && isLoopbackHost(host)) return true
  return protocol === 'https:' && isPublicReachableHost(host)
}

export const agentRuntimeUrlPolicyMessage =
  'External Agent Runtime URLs must use public HTTPS, or loopback HTTP(S) for local development. Private or tailnet HTTP(S) runtime URLs require VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS=true in local dev.'

export const a2aKnowledgeSourceMessageUrlPolicyMessage =
  'A2A Knowledge Source agent-card message URLs must use public HTTPS, or loopback HTTP(S) for local source-clone development. Private or tailnet message URLs are not enabled by the Agent Runtime private URL override.'

type Ipv4Octets = readonly [number, number, number, number]

interface Ipv4CidrBlock {
  base: Ipv4Octets
  prefixLength: number
}

const unavailableIpv4CidrBlocks: Ipv4CidrBlock[] = [
  { base: [0, 0, 0, 0], prefixLength: 8 },
  { base: [10, 0, 0, 0], prefixLength: 8 },
  { base: [100, 64, 0, 0], prefixLength: 10 },
  { base: [127, 0, 0, 0], prefixLength: 8 },
  { base: [169, 254, 0, 0], prefixLength: 16 },
  { base: [172, 16, 0, 0], prefixLength: 12 },
  { base: [192, 0, 0, 0], prefixLength: 24 },
  { base: [192, 0, 2, 0], prefixLength: 24 },
  { base: [192, 168, 0, 0], prefixLength: 16 },
  { base: [198, 18, 0, 0], prefixLength: 15 },
  { base: [198, 51, 100, 0], prefixLength: 24 },
  { base: [203, 0, 113, 0], prefixLength: 24 },
  { base: [224, 0, 0, 0], prefixLength: 4 },
  { base: [240, 0, 0, 0], prefixLength: 4 },
]

const privateAgentRuntimeIpv4CidrBlocks: Ipv4CidrBlock[] = [
  { base: [10, 0, 0, 0], prefixLength: 8 },
  { base: [100, 64, 0, 0], prefixLength: 10 },
  { base: [172, 16, 0, 0], prefixLength: 12 },
  { base: [192, 168, 0, 0], prefixLength: 16 },
]

function isPublicReachableHost(host: string): boolean {
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false
  }

  if (host.includes(':')) return isPublicReachableIpv6Host(host)

  const ipv4Octets = parseIpv4Octets(host)
  if (ipv4Octets) return !isUnavailableIpv4Octets(ipv4Octets)

  return host.includes('.')
}

function normalizedHost(parsedUrl: URL): string {
  return parsedUrl.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase()
}

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.includes(':')) {
    const groups = parseIpv6Groups(host)
    return Boolean(groups && groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1)
  }
  const ipv4Octets = parseIpv4Octets(host)
  return Boolean(ipv4Octets && ipv4Octets[0] === 127)
}

function allowsPrivateAgentRuntimeUrls(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_LLMWIKI_CHAT_ALLOW_PRIVATE_AGENT_RUNTIME_URLS === 'true'
}

function isPrivateAgentRuntimeHost(host: string): boolean {
  if (!host) return false

  if (host.includes(':')) return isPrivateAgentRuntimeIpv6Host(host)

  const ipv4Octets = parseIpv4Octets(host)
  if (ipv4Octets) return isPrivateAgentRuntimeIpv4Octets(ipv4Octets)

  return false
}

function isPrivateAgentRuntimeIpv6Host(host: string): boolean {
  const groups = parseIpv6Groups(host)
  if (!groups) return false

  const mappedIpv4 = ipv4MappedIpv6Octets(groups)
  if (mappedIpv4) return isPrivateAgentRuntimeIpv4Octets(mappedIpv4)

  const firstGroup = groups[0]
  if ((firstGroup & 0xfe00) === 0xfc00) return true

  return false
}

function isPrivateAgentRuntimeIpv4Octets(octets: Ipv4Octets): boolean {
  return privateAgentRuntimeIpv4CidrBlocks.some((block) => ipv4CidrContains(block, octets))
}

function isPublicReachableIpv6Host(host: string): boolean {
  const groups = parseIpv6Groups(host)
  if (!groups) return false

  const mappedIpv4 = ipv4MappedIpv6Octets(groups)
  if (mappedIpv4) return !isUnavailableIpv4Octets(mappedIpv4)

  if (groups.every((group) => group === 0)) return false
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return false

  const firstGroup = groups[0]
  if ((firstGroup & 0xfe00) === 0xfc00) return false
  if ((firstGroup & 0xffc0) === 0xfe80) return false
  if ((firstGroup & 0xff00) === 0xff00) return false
  if (firstGroup === 0x2001 && groups[1] === 0x0db8) return false

  return true
}

function parseIpv4Octets(host: string): Ipv4Octets | null {
  const parts = host.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null

  const octets = parts.map(Number) as unknown as Ipv4Octets
  if (octets.some((octet) => octet < 0 || octet > 255)) return null
  return octets
}

function isUnavailableIpv4Octets(octets: Ipv4Octets): boolean {
  return unavailableIpv4CidrBlocks.some((block) => ipv4CidrContains(block, octets))
}

function ipv4CidrContains(block: Ipv4CidrBlock, octets: Ipv4Octets): boolean {
  const address = ipv4ToInteger(octets)
  const base = ipv4ToInteger(block.base)
  const blockSize = 2 ** (32 - block.prefixLength)
  return address >= base && address < base + blockSize
}

function ipv4ToInteger(octets: Ipv4Octets): number {
  const [first, second, third, fourth] = octets
  return (((first * 256) + second) * 256 + third) * 256 + fourth
}

function parseIpv6Groups(host: string): number[] | null {
  const [leftText, rightText, ...rest] = host.split('::')
  if (rest.length || leftText === undefined) return null

  const left = leftText ? parseIpv6GroupList(leftText) : []
  const right = rightText ? parseIpv6GroupList(rightText) : []
  if (!left || !right) return null

  if (rightText === undefined) return left.length === 8 ? left : null

  const zeroGroupCount = 8 - left.length - right.length
  if (zeroGroupCount < 1) return null
  return [...left, ...Array.from({ length: zeroGroupCount }, () => 0), ...right]
}

function parseIpv6GroupList(value: string): number[] | null {
  const parts = value.split(':')
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null
  return parts.map((part) => parseInt(part, 16))
}

function ipv4MappedIpv6Octets(groups: number[]): Ipv4Octets | null {
  if (!groups.slice(0, 5).every((group) => group === 0) || groups[5] !== 0xffff) return null
  return [
    (groups[6] >> 8) & 0xff,
    groups[6] & 0xff,
    (groups[7] >> 8) & 0xff,
    groups[7] & 0xff,
  ] as Ipv4Octets
}
