import type {
  AssetRecord,
  CanvasProjectElementRecord,
  CanvasProjectRecord,
  ConversationRecord,
  ConversationTurnRecord,
  JobItemRecord,
  JobRecord,
  RuntimeEvent,
  SealedCredentialRecord,
  SessionRecord,
} from '../../packages/contracts/v2'
import { createId, nowIso } from '../../packages/core/id'
import { sha256Hex } from '../../packages/core/hash'

type BlobBucketKind = 'input' | 'result' | 'temp'

type MemoryState = {
  sessions: Map<string, SessionRecord>
  assets: Map<string, AssetRecord>
  assetDataUrls: Map<string, string>
  jobs: Map<string, JobRecord>
  jobItems: Map<string, Map<string, JobItemRecord>>
  events: Map<string, RuntimeEvent[]>
  conversations: Map<string, ConversationRecord>
  turns: Map<string, Array<ConversationTurnRecord>>
  canvasProjects: Map<string, CanvasProjectRecord>
  canvasProjectElements: Map<string, CanvasProjectElementRecord[]>
  sealedCredentials: Map<string, SealedCredentialRecord>
}

const memoryState: MemoryState = {
  sessions: new Map(),
  assets: new Map(),
  assetDataUrls: new Map(),
  jobs: new Map(),
  jobItems: new Map(),
  events: new Map(),
  conversations: new Map(),
  turns: new Map(),
  canvasProjects: new Map(),
  canvasProjectElements: new Map(),
  sealedCredentials: new Map(),
}

function getScopeKey(scope: string, scopeId: string): string {
  return `${scope}:${scopeId}`
}

function inferMimeFromDataUrl(dataUrl: string): string {
  const match = String(dataUrl || '').match(/^data:(image\/[^;]+);base64,/i)
  return match?.[1] || 'image/png'
}

function byteLengthFromDataUrl(dataUrl: string): number {
  const payload = String(dataUrl || '').split(',', 2)[1] || ''
  return Math.floor((payload.length * 3) / 4)
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const payload = String(dataUrl || '').split(',', 2)[1] || ''
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, mime: string): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return `data:${mime};base64,${btoa(binary)}`
}

function bucketFor(env: any, kind: BlobBucketKind): R2Bucket | null {
  if (kind === 'input') return env?.VS_INPUTS_BUCKET || null
  if (kind === 'result') return env?.VS_RESULTS_BUCKET || null
  return env?.VS_TEMP_BUCKET || null
}

export async function ensureSession(env: any, sessionId?: string): Promise<SessionRecord> {
  const id = sessionId || createId('sess')
  const now = nowIso()
  const existing = memoryState.sessions.get(id)
  if (existing) {
    existing.lastActiveAt = now
    memoryState.sessions.set(id, existing)
    return existing
  }

  const created: SessionRecord = {
    id,
    createdAt: now,
    lastActiveAt: now,
    preferencesJson: null,
  }
  memoryState.sessions.set(id, created)
  return created
}

export async function createAsset(env: any, input: {
  sessionId: string
  kind: AssetRecord['kind']
  source?: string
  mime?: string
  filename?: string
  dataUrl: string
  bucketKind?: BlobBucketKind
}): Promise<AssetRecord> {
  const id = createId('asset')
  const createdAt = nowIso()
  const mime = input.mime || inferMimeFromDataUrl(input.dataUrl)
  const sha256 = await sha256Hex(String(input.dataUrl || ''))
  const record: AssetRecord = {
    id,
    sessionId: input.sessionId,
    kind: input.kind,
    source: input.source || 'browser_upload',
    mime,
    sizeBytes: byteLengthFromDataUrl(input.dataUrl),
    r2Key: null,
    sha256,
    createdAt,
    filename: input.filename || null,
    width: null,
    height: null,
  }

  const bucket = bucketFor(env, input.bucketKind || (input.kind === 'result' || input.kind === 'generated' ? 'result' : 'input'))
  if (bucket) {
    const key = `${record.kind === 'result' || record.kind === 'generated' ? 'results' : 'inputs'}/${record.sessionId}/${record.id}`
    await bucket.put(key, dataUrlToArrayBuffer(input.dataUrl), {
      httpMetadata: { contentType: mime },
    })
    record.r2Key = key
  } else {
    memoryState.assetDataUrls.set(id, input.dataUrl)
  }

  memoryState.assets.set(id, record)
  return record
}

export async function getAsset(assetId: string): Promise<AssetRecord | null> {
  return memoryState.assets.get(assetId) || null
}

export async function getAssetDataUrl(env: any, assetId: string): Promise<string | null> {
  const record = memoryState.assets.get(assetId)
  if (!record) return null
  const inline = memoryState.assetDataUrls.get(assetId)
  if (inline) return inline
  if (!record.r2Key) return null

  const bucket = record.kind === 'result' || record.kind === 'generated'
    ? bucketFor(env, 'result')
    : bucketFor(env, 'input')
  if (!bucket) return null

  const object = await bucket.get(record.r2Key)
  if (!object) return null
  return arrayBufferToDataUrl(await object.arrayBuffer(), object.httpMetadata?.contentType || record.mime || 'image/png')
}

export async function createJob(env: any, input: Omit<JobRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<JobRecord> {
  const now = nowIso()
  const record: JobRecord = {
    ...input,
    id: input.id || createId('job'),
    createdAt: now,
    updatedAt: now,
  }
  memoryState.jobs.set(record.id, record)
  return record
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  return memoryState.jobs.get(jobId) || null
}

export async function updateJob(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
  const current = memoryState.jobs.get(jobId)
  if (!current) return null
  const next = { ...current, ...patch, updatedAt: nowIso() }
  memoryState.jobs.set(jobId, next)
  return next
}

export async function createJobItems(jobId: string, items: Array<Omit<JobItemRecord, 'id'>>): Promise<JobItemRecord[]> {
  const map = memoryState.jobItems.get(jobId) || new Map<string, JobItemRecord>()
  const created = items.map((item) => {
    const record: JobItemRecord = { ...item, id: createId('item') }
    map.set(record.id, record)
    return record
  })
  memoryState.jobItems.set(jobId, map)
  return created
}

export async function listJobItems(jobId: string): Promise<JobItemRecord[]> {
  const map = memoryState.jobItems.get(jobId)
  return map ? [...map.values()] : []
}

export async function updateJobItem(jobId: string, itemId: string, patch: Partial<JobItemRecord>): Promise<JobItemRecord | null> {
  const map = memoryState.jobItems.get(jobId)
  const current = map?.get(itemId)
  if (!map || !current) return null
  const next = { ...current, ...patch }
  map.set(itemId, next)
  return next
}

export async function appendEvent(event: RuntimeEvent): Promise<RuntimeEvent> {
  const key = getScopeKey(event.scope, event.scopeId)
  const events = memoryState.events.get(key) || []
  events.push(event)
  memoryState.events.set(key, events)
  return event
}

export async function listEvents(scope: string, scopeId: string, afterSeq = 0): Promise<RuntimeEvent[]> {
  const events = memoryState.events.get(getScopeKey(scope, scopeId)) || []
  return events.filter((event) => event.seq > afterSeq)
}

export async function createConversation(sessionId: string): Promise<ConversationRecord> {
  const now = nowIso()
  const record: ConversationRecord = {
    id: createId('conv'),
    sessionId,
    createdAt: now,
    updatedAt: now,
  }
  memoryState.conversations.set(record.id, record)
  memoryState.turns.set(record.id, [])
  return record
}

export async function getConversation(conversationId: string): Promise<ConversationRecord | null> {
  return memoryState.conversations.get(conversationId) || null
}

export async function createConversationTurn(input: Omit<ConversationTurnRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ConversationTurnRecord> {
  const now = nowIso()
  const record: ConversationTurnRecord = {
    ...input,
    id: createId('turn'),
    createdAt: now,
    updatedAt: now,
  }
  const turns = memoryState.turns.get(record.conversationId) || []
  turns.push(record)
  memoryState.turns.set(record.conversationId, turns)

  const conversation = memoryState.conversations.get(record.conversationId)
  if (conversation) {
    conversation.updatedAt = now
    memoryState.conversations.set(conversation.id, conversation)
  }

  return record
}

export async function listConversationTurns(conversationId: string): Promise<ConversationTurnRecord[]> {
  return [...(memoryState.turns.get(conversationId) || [])]
}

export async function getConversationTurn(turnId: string): Promise<ConversationTurnRecord | null> {
  for (const turns of memoryState.turns.values()) {
    const turn = turns.find((entry) => entry.id === turnId)
    if (turn) return turn
  }
  return null
}

export async function updateConversationTurn(turnId: string, patch: Partial<ConversationTurnRecord>): Promise<ConversationTurnRecord | null> {
  for (const [conversationId, turns] of memoryState.turns.entries()) {
    const index = turns.findIndex((entry) => entry.id === turnId)
    if (index === -1) continue
    const next = { ...turns[index], ...patch, updatedAt: nowIso() }
    turns[index] = next
    memoryState.turns.set(conversationId, turns)
    return next
  }
  return null
}

export async function listCanvasProjects(sessionId?: string): Promise<CanvasProjectRecord[]> {
  const projects = [...memoryState.canvasProjects.values()]
  return sessionId ? projects.filter((project) => project.sessionId === sessionId) : projects
}

export async function createCanvasProject(input: {
  sessionId: string
  title?: string
  metadataJson?: Record<string, unknown>
}): Promise<CanvasProjectRecord> {
  const now = nowIso()
  const record: CanvasProjectRecord = {
    id: createId('canvas'),
    sessionId: input.sessionId,
    title: String(input.title || 'Untitled canvas').trim() || 'Untitled canvas',
    metadataJson: input.metadataJson || {},
    createdAt: now,
    updatedAt: now,
  }
  memoryState.canvasProjects.set(record.id, record)
  memoryState.canvasProjectElements.set(record.id, [])
  return record
}

export async function getCanvasProject(projectId: string): Promise<CanvasProjectRecord | null> {
  return memoryState.canvasProjects.get(projectId) || null
}

export async function updateCanvasProject(projectId: string, patch: Partial<CanvasProjectRecord>): Promise<CanvasProjectRecord | null> {
  const current = memoryState.canvasProjects.get(projectId)
  if (!current) return null
  const next: CanvasProjectRecord = {
    ...current,
    ...patch,
    id: current.id,
    sessionId: patch.sessionId || current.sessionId,
    title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : current.title,
    metadataJson: patch.metadataJson || current.metadataJson,
    updatedAt: nowIso(),
  }
  memoryState.canvasProjects.set(projectId, next)
  return next
}

export async function listCanvasProjectElements(projectId: string): Promise<CanvasProjectElementRecord[]> {
  return [...(memoryState.canvasProjectElements.get(projectId) || [])]
}

export async function replaceCanvasProjectElements(
  projectId: string,
  elements: Array<Record<string, unknown>>,
): Promise<CanvasProjectElementRecord[] | null> {
  const project = memoryState.canvasProjects.get(projectId)
  if (!project) return null
  const now = nowIso()
  const records = elements.map((element, index) => {
    const id = typeof element.id === 'string' && element.id ? element.id : createId('cel')
    return {
      id,
      projectId,
      elementType: typeof element.type === 'string' ? element.type : 'unknown',
      zIndex: index,
      dataJson: element,
      createdAt: now,
      updatedAt: now,
    }
  })
  memoryState.canvasProjectElements.set(projectId, records)
  project.updatedAt = now
  memoryState.canvasProjects.set(projectId, project)
  return records
}

export async function createSealedCredential(jobId: string, ciphertext: string, expiresAt: string): Promise<SealedCredentialRecord> {
  const record: SealedCredentialRecord = {
    id: createId('cred'),
    jobId,
    ciphertext,
    keyVersion: 'v1',
    expiresAt,
    createdAt: nowIso(),
  }
  memoryState.sealedCredentials.set(record.id, record)
  return record
}

export async function getSealedCredential(credentialId: string): Promise<SealedCredentialRecord | null> {
  return memoryState.sealedCredentials.get(credentialId) || null
}

export async function deleteSealedCredential(credentialId: string): Promise<void> {
  memoryState.sealedCredentials.delete(credentialId)
}
