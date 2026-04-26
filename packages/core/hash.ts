function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const payload = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', payload)
  return arrayBufferToHex(digest)
}

export async function stableHash(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(value ?? null))
}
