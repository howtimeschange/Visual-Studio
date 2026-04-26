const DEFAULT_LOCAL_KEK = 'visual-studio-next-local-dev-kek'

function toBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret || DEFAULT_LOCAL_KEK))
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function sealJson(value: unknown, secret?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await importAesKey(secret || DEFAULT_LOCAL_KEK)
  const plaintext = new TextEncoder().encode(JSON.stringify(value ?? null))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return `${toBase64(iv.buffer)}.${toBase64(ciphertext)}`
}

export async function unsealJson<T>(ciphertext: string, secret?: string): Promise<T> {
  const [ivB64, dataB64] = String(ciphertext || '').split('.', 2)
  if (!ivB64 || !dataB64) {
    throw new Error('Invalid sealed payload')
  }
  const key = await importAesKey(secret || DEFAULT_LOCAL_KEK)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivB64) },
    key,
    fromBase64(dataB64),
  )
  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}
