import type {
  AssetKind,
  AssetRecord,
  AuthSessionRecord,
  CanvasProjectElementRecord,
  CanvasProjectRecord,
  ConversationRecord,
  ConversationTurnRecord,
  EventScope,
  JobItemRecord,
  JobRecord,
  RuntimeEvent,
  SealedCredentialRecord,
  SessionRecord,
  ProjectInviteRecord,
  ProjectMemberRecord,
  ProjectRole,
  UsageEventRecord,
  UserRecord,
} from '../../packages/contracts/v2'
import { createId, nowIso } from '../../packages/core/id'
import { sha256Hex } from '../../packages/core/hash'

type BlobBucketKind = 'input' | 'result' | 'temp'

type MemoryState = {
  sessions: Map<string, SessionRecord>
  users: Map<string, UserRecord>
  usersByEmail: Map<string, string>
  authSessions: Map<string, AuthSessionRecord>
  authSessionsByTokenHash: Map<string, string>
  assets: Map<string, AssetRecord>
  assetDataUrls: Map<string, string>
  jobs: Map<string, JobRecord>
  jobItems: Map<string, Map<string, JobItemRecord>>
  events: Map<string, RuntimeEvent[]>
  conversations: Map<string, ConversationRecord>
  turns: Map<string, Array<ConversationTurnRecord>>
  canvasProjects: Map<string, CanvasProjectRecord>
  canvasProjectElements: Map<string, CanvasProjectElementRecord[]>
  projectMembers: Map<string, ProjectMemberRecord>
  projectInvites: Map<string, ProjectInviteRecord>
  projectInvitesByToken: Map<string, string>
  usageEvents: UsageEventRecord[]
  sealedCredentials: Map<string, SealedCredentialRecord>
}

const memoryState: MemoryState = {
  sessions: new Map(),
  users: new Map(),
  usersByEmail: new Map(),
  authSessions: new Map(),
  authSessionsByTokenHash: new Map(),
  assets: new Map(),
  assetDataUrls: new Map(),
  jobs: new Map(),
  jobItems: new Map(),
  events: new Map(),
  conversations: new Map(),
  turns: new Map(),
  canvasProjects: new Map(),
  canvasProjectElements: new Map(),
  projectMembers: new Map(),
  projectInvites: new Map(),
  projectInvitesByToken: new Map(),
  usageEvents: [],
  sealedCredentials: new Map(),
}

function dbFor(env: any): D1Database | null {
  return env?.VS_DB || null
}

function getScopeKey(scope: string, scopeId: string): string {
  return `${scope}:${scopeId}`
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback
  try {
    return JSON.parse(String(value)) as T
  } catch {
    return fallback
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

function isMissingUsageCostColumn(error: unknown): boolean {
  return /no column named|has no column|no such column/i.test(String((error as any)?.message || error || ''))
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

function resolveEnvAndId(envOrId: any, maybeId?: string): { env: any; id: string } {
  if (maybeId === undefined) return { env: null, id: String(envOrId || '') }
  return { env: envOrId, id: String(maybeId || '') }
}

function rowToSession(row: any): SessionRecord {
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    lastActiveAt: String(row.last_active_at),
    userId: row.user_id || null,
    clientFingerprint: row.client_fingerprint || undefined,
    preferencesJson: parseJson<Record<string, unknown> | null>(row.preferences_json, null),
  }
}

function rowToUser(row: any): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email || '').toLowerCase(),
    name: String(row.name || ''),
    passwordHash: String(row.password_hash || ''),
    passwordSalt: String(row.password_salt || ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToAuthSession(row: any): AuthSessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id || ''),
    tokenHash: String(row.token_hash || ''),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    lastSeenAt: String(row.last_seen_at),
  }
}

function rowToAsset(row: any): AssetRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    userId: row.user_id || null,
    kind: String(row.kind) as AssetKind,
    source: String(row.source || ''),
    mime: String(row.mime || 'image/png'),
    sizeBytes: Number(row.size_bytes || 0),
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    r2Key: row.r2_key || null,
    sha256: String(row.sha256 || ''),
    createdAt: String(row.created_at),
    filename: row.filename || null,
  }
}

function rowToJob(row: any): JobRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    userId: row.user_id || null,
    type: row.type,
    status: row.status,
    configJson: parseJson<Record<string, unknown>>(row.config_json, {}),
    summaryJson: parseJson<Record<string, unknown>>(row.summary_json, {}),
    progressTotal: Number(row.progress_total || 0),
    progressDone: Number(row.progress_done || 0),
    progressFailed: Number(row.progress_failed || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToJobItem(row: any): JobItemRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    itemType: row.item_type,
    status: row.status,
    inputJson: parseJson<Record<string, unknown>>(row.input_json, {}),
    outputJson: parseJson<Record<string, unknown>>(row.output_json, {}),
    attemptCount: Number(row.attempt_count || 0),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
  }
}

function rowToEvent(row: any): RuntimeEvent {
  return {
    scope: row.scope as EventScope,
    scopeId: String(row.scope_id),
    type: row.type,
    seq: Number(row.seq || 0),
    timestamp: String(row.timestamp),
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
  }
}

function rowToConversation(row: any): ConversationRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    userId: row.user_id || null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToConversationTurn(row: any): ConversationTurnRecord {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    userMessage: String(row.user_message || ''),
    modelId: String(row.model_id || 'nano-banana-2'),
    useDesignAgent: Boolean(Number(row.use_design_agent ?? 1)),
    previousTurnId: row.previous_turn_id || null,
    requestJson: parseJson<Record<string, unknown>>(row.request_json, {}),
    traceJson: parseJson<Record<string, unknown> | null>(row.trace_json, null),
    status: row.status,
    resultAssetId: row.result_asset_id || null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToCanvasProject(row: any): CanvasProjectRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    ownerUserId: row.owner_user_id || null,
    title: String(row.title || 'Untitled canvas'),
    metadataJson: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToProjectMember(row: any): ProjectMemberRecord {
  return {
    projectId: String(row.project_id),
    userId: String(row.user_id),
    role: row.role as ProjectRole,
    invitedByUserId: row.invited_by_user_id || null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToProjectInvite(row: any): ProjectInviteRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    email: String(row.email || '').toLowerCase(),
    role: row.role,
    token: String(row.token || ''),
    status: row.status,
    invitedByUserId: row.invited_by_user_id || null,
    acceptedByUserId: row.accepted_by_user_id || null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    expiresAt: String(row.expires_at),
  }
}

function rowToUsageEvent(row: any): UsageEventRecord {
  return {
    id: String(row.id),
    userId: row.user_id || null,
    sessionId: row.session_id || null,
    projectId: row.project_id || null,
    jobId: row.job_id || null,
    eventType: String(row.event_type || ''),
    amount: Number(row.amount || 0),
    provider: row.provider || null,
    modelId: row.model_id || null,
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    apiCostUsd: Number(row.api_cost_usd || 0),
    metadataJson: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: String(row.created_at),
  }
}

function rowToCanvasProjectElement(row: any): CanvasProjectElementRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    elementType: String(row.element_type || 'unknown'),
    zIndex: Number(row.z_index || 0),
    dataJson: parseJson<Record<string, unknown>>(row.data_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToSealedCredential(row: any): SealedCredentialRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    ciphertext: String(row.ciphertext || ''),
    keyVersion: String(row.key_version || 'v1'),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
  }
}

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase()
}

export async function createUser(env: any, input: {
  email: string
  name?: string
  passwordHash: string
  passwordSalt: string
}): Promise<UserRecord> {
  const now = nowIso()
  const email = normalizeEmail(input.email)
  const record: UserRecord = {
    id: createId('user'),
    email,
    name: String(input.name || email.split('@')[0] || 'User').trim(),
    passwordHash: input.passwordHash,
    passwordSalt: input.passwordSalt,
    createdAt: now,
    updatedAt: now,
  }
  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      INSERT INTO users (id, email, name, password_hash, password_salt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(record.id, record.email, record.name, record.passwordHash, record.passwordSalt, record.createdAt, record.updatedAt).run()
  } else {
    memoryState.users.set(record.id, record)
    memoryState.usersByEmail.set(record.email, record.id)
  }
  return record
}

export async function getUser(env: any, userId: string): Promise<UserRecord | null> {
  const db = dbFor(env)
  if (db) {
    const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()
    return row ? rowToUser(row) : null
  }
  return memoryState.users.get(userId) || null
}

export async function getUserByEmail(env: any, emailInput: string): Promise<UserRecord | null> {
  const email = normalizeEmail(emailInput)
  const db = dbFor(env)
  if (db) {
    const row = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<any>()
    return row ? rowToUser(row) : null
  }
  const userId = memoryState.usersByEmail.get(email)
  return userId ? memoryState.users.get(userId) || null : null
}

export async function createAuthSession(env: any, input: {
  userId: string
  tokenHash: string
  expiresAt: string
}): Promise<AuthSessionRecord> {
  const now = nowIso()
  const record: AuthSessionRecord = {
    id: createId('authsess'),
    userId: input.userId,
    tokenHash: input.tokenHash,
    createdAt: now,
    expiresAt: input.expiresAt,
    lastSeenAt: now,
  }
  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(record.id, record.userId, record.tokenHash, record.createdAt, record.expiresAt, record.lastSeenAt).run()
  } else {
    memoryState.authSessions.set(record.id, record)
    memoryState.authSessionsByTokenHash.set(record.tokenHash, record.id)
  }
  return record
}

export async function getAuthSessionByTokenHash(env: any, tokenHash: string): Promise<AuthSessionRecord | null> {
  const db = dbFor(env)
  if (db) {
    const row = await db.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).first<any>()
    return row ? rowToAuthSession(row) : null
  }
  const id = memoryState.authSessionsByTokenHash.get(tokenHash)
  return id ? memoryState.authSessions.get(id) || null : null
}

export async function touchAuthSession(env: any, sessionId: string): Promise<void> {
  const now = nowIso()
  const db = dbFor(env)
  if (db) {
    await db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').bind(now, sessionId).run()
    return
  }
  const current = memoryState.authSessions.get(sessionId)
  if (current) memoryState.authSessions.set(sessionId, { ...current, lastSeenAt: now })
}

export async function deleteAuthSession(env: any, tokenHash: string): Promise<void> {
  const db = dbFor(env)
  if (db) {
    await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).run()
    return
  }
  const id = memoryState.authSessionsByTokenHash.get(tokenHash)
  if (id) memoryState.authSessions.delete(id)
  memoryState.authSessionsByTokenHash.delete(tokenHash)
}

export async function ensureSession(env: any, sessionId?: string, userId?: string | null): Promise<SessionRecord> {
  const id = sessionId || createId('sess')
  const now = nowIso()
  const db = dbFor(env)
  if (db) {
    const existing = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<any>()
    if (existing) {
      const nextUserId = userId || existing.user_id || null
      await db.prepare('UPDATE sessions SET last_active_at = ?, user_id = COALESCE(?, user_id) WHERE id = ?').bind(now, userId || null, id).run()
      return { ...rowToSession(existing), userId: nextUserId, lastActiveAt: now }
    }
    const created: SessionRecord = {
      id,
      createdAt: now,
      lastActiveAt: now,
      userId: userId || null,
      preferencesJson: null,
    }
    await db.prepare(`
      INSERT INTO sessions (id, created_at, last_active_at, user_id, client_fingerprint, preferences_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(created.id, created.createdAt, created.lastActiveAt, created.userId || null, null, null).run()
    return created
  }

  const existing = memoryState.sessions.get(id)
  if (existing) {
    existing.lastActiveAt = now
    if (userId) existing.userId = userId
    memoryState.sessions.set(id, existing)
    return existing
  }

  const created: SessionRecord = {
    id,
    createdAt: now,
    lastActiveAt: now,
    userId: userId || null,
    preferencesJson: null,
  }
  memoryState.sessions.set(id, created)
  return created
}

export async function claimSessionResourcesForUser(env: any, sessionId?: string | null, userId?: string | null): Promise<void> {
  if (!sessionId || !userId) return
  const db = dbFor(env)
  if (db) {
    await db.batch([
      db.prepare('UPDATE sessions SET user_id = COALESCE(user_id, ?) WHERE id = ?').bind(userId, sessionId),
      db.prepare('UPDATE assets SET user_id = COALESCE(user_id, ?) WHERE session_id = ?').bind(userId, sessionId),
      db.prepare('UPDATE jobs SET user_id = COALESCE(user_id, ?) WHERE session_id = ?').bind(userId, sessionId),
      db.prepare('UPDATE conversations SET user_id = COALESCE(user_id, ?) WHERE session_id = ?').bind(userId, sessionId),
      db.prepare('UPDATE canvas_projects SET owner_user_id = COALESCE(owner_user_id, ?) WHERE session_id = ?').bind(userId, sessionId),
    ])
    return
  }

  const session = memoryState.sessions.get(sessionId)
  if (session && !session.userId) memoryState.sessions.set(sessionId, { ...session, userId })
  for (const [id, asset] of memoryState.assets) {
    if (asset.sessionId === sessionId && !asset.userId) memoryState.assets.set(id, { ...asset, userId })
  }
  for (const [id, job] of memoryState.jobs) {
    if (job.sessionId === sessionId && !job.userId) memoryState.jobs.set(id, { ...job, userId })
  }
  for (const [id, conversation] of memoryState.conversations) {
    if (conversation.sessionId === sessionId && !conversation.userId) memoryState.conversations.set(id, { ...conversation, userId })
  }
  for (const [id, project] of memoryState.canvasProjects) {
    if (project.sessionId === sessionId && !project.ownerUserId) {
      memoryState.canvasProjects.set(id, { ...project, ownerUserId: userId })
    }
  }
}

export async function createAsset(env: any, input: {
  sessionId: string
  userId?: string | null
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
    userId: input.userId || null,
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

  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      INSERT INTO assets (
        id, session_id, user_id, kind, source, mime, size_bytes, width, height, r2_key, sha256, created_at, filename
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      record.id,
      record.sessionId,
      record.userId || null,
      record.kind,
      record.source,
      record.mime,
      record.sizeBytes,
      record.width,
      record.height,
      record.r2Key,
      record.sha256,
      record.createdAt,
      record.filename,
    ).run()
  } else {
    memoryState.assets.set(id, record)
  }
  return record
}

export async function getAsset(envOrAssetId: any, maybeAssetId?: string): Promise<AssetRecord | null> {
  const { env, id } = resolveEnvAndId(envOrAssetId, maybeAssetId)
  const db = dbFor(env)
  if (db) {
    const row = await db.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<any>()
    return row ? rowToAsset(row) : null
  }
  return memoryState.assets.get(id) || null
}

export async function getAssetDataUrl(env: any, assetId: string): Promise<string | null> {
  const record = await getAsset(env, assetId)
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
  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      INSERT INTO jobs (
        id, session_id, user_id, type, status, config_json, summary_json,
        progress_total, progress_done, progress_failed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      record.id,
      record.sessionId,
      record.userId || null,
      record.type,
      record.status,
      stringifyJson(record.configJson),
      stringifyJson(record.summaryJson),
      record.progressTotal,
      record.progressDone,
      record.progressFailed,
      record.createdAt,
      record.updatedAt,
    ).run()
  } else {
    memoryState.jobs.set(record.id, record)
  }
  return record
}

export async function getJob(envOrJobId: any, maybeJobId?: string): Promise<JobRecord | null> {
  const { env, id } = resolveEnvAndId(envOrJobId, maybeJobId)
  const db = dbFor(env)
  if (db) {
    const row = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<any>()
    return row ? rowToJob(row) : null
  }
  return memoryState.jobs.get(id) || null
}

export async function updateJob(envOrJobId: any, jobIdOrPatch: string | Partial<JobRecord>, maybePatch?: Partial<JobRecord>): Promise<JobRecord | null> {
  const legacy = maybePatch === undefined
  const env = legacy ? null : envOrJobId
  const jobId = legacy ? String(envOrJobId || '') : String(jobIdOrPatch || '')
  const patch = (legacy ? jobIdOrPatch : maybePatch) as Partial<JobRecord>
  const current = await getJob(env, jobId)
  if (!current) return null
  const next = { ...current, ...patch, id: current.id, updatedAt: nowIso() }

  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      UPDATE jobs
      SET session_id = ?, user_id = ?, type = ?, status = ?, config_json = ?, summary_json = ?,
          progress_total = ?, progress_done = ?, progress_failed = ?, created_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      next.sessionId,
      next.userId || null,
      next.type,
      next.status,
      stringifyJson(next.configJson),
      stringifyJson(next.summaryJson),
      next.progressTotal,
      next.progressDone,
      next.progressFailed,
      next.createdAt,
      next.updatedAt,
      next.id,
    ).run()
  } else {
    memoryState.jobs.set(jobId, next)
  }
  return next
}

export async function listJobsByStatus(env: any, statuses: string[]): Promise<JobRecord[]> {
  const normalized = statuses.map((status) => String(status || '').trim()).filter(Boolean)
  if (normalized.length === 0) return []
  const db = dbFor(env)
  if (db) {
    const placeholders = normalized.map(() => '?').join(', ')
    const result = await db.prepare(`
      SELECT * FROM jobs
      WHERE status IN (${placeholders})
      ORDER BY updated_at ASC
    `).bind(...normalized).all<any>()
    return (result.results || []).map(rowToJob)
  }
  return [...memoryState.jobs.values()]
    .filter((job) => normalized.includes(job.status))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}

export async function createJobItems(
  envOrJobId: any,
  jobIdOrItems: string | Array<Omit<JobItemRecord, 'id'>>,
  maybeItems?: Array<Omit<JobItemRecord, 'id'>>,
): Promise<JobItemRecord[]> {
  const legacy = Array.isArray(jobIdOrItems)
  const env = legacy ? null : envOrJobId
  const jobId = legacy ? String(envOrJobId || '') : String(jobIdOrItems || '')
  const items = (legacy ? jobIdOrItems : maybeItems) as Array<Omit<JobItemRecord, 'id'>>
  const created = items.map((item) => ({ ...item, id: createId('item') }))

  const db = dbFor(env)
  if (db) {
    const statements = created.map((record) => db.prepare(`
      INSERT INTO job_items (
        id, job_id, item_type, status, input_json, output_json, attempt_count,
        error_code, error_message, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      record.id,
      record.jobId,
      record.itemType,
      record.status,
      stringifyJson(record.inputJson),
      stringifyJson(record.outputJson),
      record.attemptCount,
      record.errorCode || null,
      record.errorMessage || null,
      record.startedAt || null,
      record.finishedAt || null,
    ))
    if (statements.length) await db.batch(statements)
  } else {
    const map = memoryState.jobItems.get(jobId) || new Map<string, JobItemRecord>()
    for (const record of created) map.set(record.id, record)
    memoryState.jobItems.set(jobId, map)
  }
  return created
}

export async function listJobItems(envOrJobId: any, maybeJobId?: string): Promise<JobItemRecord[]> {
  const { env, id } = resolveEnvAndId(envOrJobId, maybeJobId)
  const db = dbFor(env)
  if (db) {
    const result = await db.prepare('SELECT * FROM job_items WHERE job_id = ? ORDER BY id').bind(id).all<any>()
    return (result.results || []).map(rowToJobItem)
  }
  const map = memoryState.jobItems.get(id)
  return map ? [...map.values()] : []
}

export async function updateJobItem(
  envOrJobId: any,
  jobIdOrItemId: string,
  itemIdOrPatch: string | Partial<JobItemRecord>,
  maybePatch?: Partial<JobItemRecord>,
): Promise<JobItemRecord | null> {
  const legacy = maybePatch === undefined
  const env = legacy ? null : envOrJobId
  const jobId = legacy ? String(envOrJobId || '') : String(jobIdOrItemId || '')
  const itemId = legacy ? String(jobIdOrItemId || '') : String(itemIdOrPatch || '')
  const patch = (legacy ? itemIdOrPatch : maybePatch) as Partial<JobItemRecord>
  const current = (await listJobItems(env, jobId)).find((item) => item.id === itemId)
  if (!current) return null
  const next = { ...current, ...patch, id: current.id, jobId: current.jobId }

  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      UPDATE job_items
      SET item_type = ?, status = ?, input_json = ?, output_json = ?, attempt_count = ?,
          error_code = ?, error_message = ?, started_at = ?, finished_at = ?
      WHERE id = ? AND job_id = ?
    `).bind(
      next.itemType,
      next.status,
      stringifyJson(next.inputJson),
      stringifyJson(next.outputJson),
      next.attemptCount,
      next.errorCode || null,
      next.errorMessage || null,
      next.startedAt || null,
      next.finishedAt || null,
      next.id,
      next.jobId,
    ).run()
  } else {
    const map = memoryState.jobItems.get(jobId)
    if (!map) return null
    map.set(itemId, next)
  }
  return next
}

export async function appendEvent(envOrEvent: any, maybeEvent?: RuntimeEvent): Promise<RuntimeEvent> {
  const legacy = maybeEvent === undefined
  const env = legacy ? null : envOrEvent
  const event = (legacy ? envOrEvent : maybeEvent) as RuntimeEvent
  const db = dbFor(env)
  if (db) {
    const row = await db.prepare(`
      SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
      FROM runtime_events
      WHERE scope = ? AND scope_id = ?
    `).bind(event.scope, event.scopeId).first<any>()
    const next: RuntimeEvent = { ...event, seq: Number(row?.next_seq || event.seq || 1) }
    await db.prepare(`
      INSERT INTO runtime_events (scope, scope_id, type, seq, timestamp, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(next.scope, next.scopeId, next.type, next.seq, next.timestamp, stringifyJson(next.payload)).run()
    return next
  }

  const key = getScopeKey(event.scope, event.scopeId)
  const events = memoryState.events.get(key) || []
  events.push(event)
  memoryState.events.set(key, events)
  return event
}

export async function listEvents(envOrScope: any, scopeOrScopeId: string, scopeIdOrAfterSeq?: string | number, maybeAfterSeq = 0): Promise<RuntimeEvent[]> {
  const legacy = typeof scopeIdOrAfterSeq === 'number' || scopeIdOrAfterSeq === undefined
  const env = legacy ? null : envOrScope
  const scope = legacy ? String(envOrScope || '') : String(scopeOrScopeId || '')
  const scopeId = legacy ? String(scopeOrScopeId || '') : String(scopeIdOrAfterSeq || '')
  const afterSeq = legacy ? Number(scopeIdOrAfterSeq || 0) : Number(maybeAfterSeq || 0)

  const db = dbFor(env)
  if (db) {
    const result = await db.prepare(`
      SELECT * FROM runtime_events
      WHERE scope = ? AND scope_id = ? AND seq > ?
      ORDER BY seq ASC
    `).bind(scope, scopeId, afterSeq).all<any>()
    return (result.results || []).map(rowToEvent)
  }

  const events = memoryState.events.get(getScopeKey(scope, scopeId)) || []
  return events.filter((event) => event.seq > afterSeq)
}

export async function createConversation(envOrSessionId: any, maybeSessionId?: string, userId?: string | null): Promise<ConversationRecord> {
  const { env, id: sessionId } = resolveEnvAndId(envOrSessionId, maybeSessionId)
  const now = nowIso()
  const record: ConversationRecord = {
    id: createId('conv'),
    sessionId,
    userId: userId || null,
    createdAt: now,
    updatedAt: now,
  }
  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      INSERT INTO conversations (id, session_id, user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(record.id, record.sessionId, record.userId || null, record.createdAt, record.updatedAt).run()
  } else {
    memoryState.conversations.set(record.id, record)
    memoryState.turns.set(record.id, [])
  }
  return record
}

export async function getConversation(envOrConversationId: any, maybeConversationId?: string): Promise<ConversationRecord | null> {
  const { env, id } = resolveEnvAndId(envOrConversationId, maybeConversationId)
  const db = dbFor(env)
  if (db) {
    const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first<any>()
    return row ? rowToConversation(row) : null
  }
  return memoryState.conversations.get(id) || null
}

export async function createConversationTurn(envOrInput: any, maybeInput?: Omit<ConversationTurnRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ConversationTurnRecord> {
  const env = maybeInput ? envOrInput : null
  const input = (maybeInput || envOrInput) as Omit<ConversationTurnRecord, 'id' | 'createdAt' | 'updatedAt'>
  const now = nowIso()
  const record: ConversationTurnRecord = {
    ...input,
    id: createId('turn'),
    createdAt: now,
    updatedAt: now,
  }

  const db = dbFor(env)
  if (db) {
    await db.batch([
      db.prepare(`
        INSERT INTO conversation_turns (
          id, conversation_id, user_message, model_id, use_design_agent, previous_turn_id,
          request_json, trace_json, status, result_asset_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.id,
        record.conversationId,
        record.userMessage,
        record.modelId,
        record.useDesignAgent ? 1 : 0,
        record.previousTurnId || null,
        stringifyJson(record.requestJson),
        record.traceJson ? stringifyJson(record.traceJson) : null,
        record.status,
        record.resultAssetId || null,
        record.createdAt,
        record.updatedAt,
      ),
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').bind(now, record.conversationId),
    ])
  } else {
    const turns = memoryState.turns.get(record.conversationId) || []
    turns.push(record)
    memoryState.turns.set(record.conversationId, turns)

    const conversation = memoryState.conversations.get(record.conversationId)
    if (conversation) {
      conversation.updatedAt = now
      memoryState.conversations.set(conversation.id, conversation)
    }
  }

  return record
}

export async function listConversationTurns(envOrConversationId: any, maybeConversationId?: string): Promise<ConversationTurnRecord[]> {
  const { env, id } = resolveEnvAndId(envOrConversationId, maybeConversationId)
  const db = dbFor(env)
  if (db) {
    const result = await db.prepare(`
      SELECT * FROM conversation_turns
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).bind(id).all<any>()
    return (result.results || []).map(rowToConversationTurn)
  }
  return [...(memoryState.turns.get(id) || [])]
}

export async function getConversationTurn(envOrTurnId: any, maybeTurnId?: string): Promise<ConversationTurnRecord | null> {
  const { env, id } = resolveEnvAndId(envOrTurnId, maybeTurnId)
  const db = dbFor(env)
  if (db) {
    const row = await db.prepare('SELECT * FROM conversation_turns WHERE id = ?').bind(id).first<any>()
    return row ? rowToConversationTurn(row) : null
  }
  for (const turns of memoryState.turns.values()) {
    const turn = turns.find((entry) => entry.id === id)
    if (turn) return turn
  }
  return null
}

export async function updateConversationTurn(envOrTurnId: any, turnIdOrPatch: string | Partial<ConversationTurnRecord>, maybePatch?: Partial<ConversationTurnRecord>): Promise<ConversationTurnRecord | null> {
  const legacy = maybePatch === undefined
  const env = legacy ? null : envOrTurnId
  const turnId = legacy ? String(envOrTurnId || '') : String(turnIdOrPatch || '')
  const patch = (legacy ? turnIdOrPatch : maybePatch) as Partial<ConversationTurnRecord>
  const current = await getConversationTurn(env, turnId)
  if (!current) return null
  const next = { ...current, ...patch, id: current.id, conversationId: current.conversationId, updatedAt: nowIso() }

  const db = dbFor(env)
  if (db) {
    await db.batch([
      db.prepare(`
        UPDATE conversation_turns
        SET user_message = ?, model_id = ?, use_design_agent = ?, previous_turn_id = ?,
            request_json = ?, trace_json = ?, status = ?, result_asset_id = ?, created_at = ?, updated_at = ?
        WHERE id = ?
      `).bind(
        next.userMessage,
        next.modelId,
        next.useDesignAgent ? 1 : 0,
        next.previousTurnId || null,
        stringifyJson(next.requestJson),
        next.traceJson ? stringifyJson(next.traceJson) : null,
        next.status,
        next.resultAssetId || null,
        next.createdAt,
        next.updatedAt,
        next.id,
      ),
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').bind(next.updatedAt, next.conversationId),
    ])
  } else {
    const turns = memoryState.turns.get(next.conversationId) || []
    const index = turns.findIndex((entry) => entry.id === turnId)
    if (index === -1) return null
    turns[index] = next
    memoryState.turns.set(next.conversationId, turns)
  }
  return next
}

export async function listCanvasProjects(envOrSessionId?: any, maybeSessionId?: string): Promise<CanvasProjectRecord[]> {
  const legacy = typeof envOrSessionId === 'string' || envOrSessionId === undefined
  const env = legacy ? null : envOrSessionId
  const sessionId = legacy ? envOrSessionId : maybeSessionId
  const db = dbFor(env)
  if (db) {
    const result = sessionId
      ? await db.prepare('SELECT * FROM canvas_projects WHERE session_id = ? ORDER BY updated_at DESC').bind(sessionId).all<any>()
      : await db.prepare('SELECT * FROM canvas_projects ORDER BY updated_at DESC').all<any>()
    return (result.results || []).map(rowToCanvasProject)
  }
  const projects = [...memoryState.canvasProjects.values()]
  const filtered = sessionId ? projects.filter((project) => project.sessionId === sessionId) : projects
  return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function listCanvasProjectsForUser(env: any, userId: string, sessionId?: string): Promise<Array<CanvasProjectRecord & { accessRole?: ProjectRole | 'legacy' }>> {
  if (!userId) return listCanvasProjects(env, sessionId)
  const db = dbFor(env)
  if (db) {
    const result = sessionId
      ? await db.prepare(`
        SELECT cp.*, 'owner' AS access_role
        FROM canvas_projects cp
        WHERE cp.owner_user_id = ?
        UNION
        SELECT cp.*, pm.role AS access_role
        FROM canvas_projects cp
        INNER JOIN project_members pm ON pm.project_id = cp.id
        WHERE pm.user_id = ?
        UNION
        SELECT cp.*, 'legacy' AS access_role
        FROM canvas_projects cp
        WHERE cp.owner_user_id IS NULL AND cp.session_id = ?
        ORDER BY updated_at DESC
      `).bind(userId, userId, sessionId).all<any>()
      : await db.prepare(`
        SELECT cp.*, 'owner' AS access_role
        FROM canvas_projects cp
        WHERE cp.owner_user_id = ?
        UNION
        SELECT cp.*, pm.role AS access_role
        FROM canvas_projects cp
        INNER JOIN project_members pm ON pm.project_id = cp.id
        WHERE pm.user_id = ?
        ORDER BY updated_at DESC
      `).bind(userId, userId).all<any>()
    return (result.results || []).map((row) => ({
      ...rowToCanvasProject(row),
      accessRole: row.access_role as ProjectRole,
    }))
  }

  const projects = [...memoryState.canvasProjects.values()]
    .map((project) => {
      if (project.ownerUserId === userId) return { ...project, accessRole: 'owner' as ProjectRole }
      const member = memoryState.projectMembers.get(`${project.id}:${userId}`)
      if (member) return { ...project, accessRole: member.role }
      if (!project.ownerUserId && sessionId && project.sessionId === sessionId) return { ...project, accessRole: 'legacy' as const }
      return null
    })
    .filter(Boolean) as Array<CanvasProjectRecord & { accessRole: ProjectRole | 'legacy' }>
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function createCanvasProject(envOrInput: any, maybeInput?: {
  sessionId: string
  ownerUserId?: string | null
  title?: string
  metadataJson?: Record<string, unknown>
}): Promise<CanvasProjectRecord> {
  const env = maybeInput ? envOrInput : null
  const input = (maybeInput || envOrInput) as {
    sessionId: string
    ownerUserId?: string | null
    title?: string
    metadataJson?: Record<string, unknown>
  }
  const now = nowIso()
  const record: CanvasProjectRecord = {
    id: createId('canvas'),
    sessionId: input.sessionId,
    ownerUserId: input.ownerUserId || null,
    title: String(input.title || 'Untitled canvas').trim() || 'Untitled canvas',
    metadataJson: input.metadataJson || {},
    createdAt: now,
    updatedAt: now,
  }
  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      INSERT INTO canvas_projects (id, session_id, owner_user_id, title, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      record.id,
      record.sessionId,
      record.ownerUserId || null,
      record.title,
      stringifyJson(record.metadataJson),
      record.createdAt,
      record.updatedAt,
    ).run()
  } else {
    memoryState.canvasProjects.set(record.id, record)
    memoryState.canvasProjectElements.set(record.id, [])
  }
  return record
}

export async function getCanvasProject(envOrProjectId: any, maybeProjectId?: string): Promise<CanvasProjectRecord | null> {
  const { env, id } = resolveEnvAndId(envOrProjectId, maybeProjectId)
  const db = dbFor(env)
  if (db) {
    const row = await db.prepare('SELECT * FROM canvas_projects WHERE id = ?').bind(id).first<any>()
    return row ? rowToCanvasProject(row) : null
  }
  return memoryState.canvasProjects.get(id) || null
}

export async function updateCanvasProject(envOrProjectId: any, projectIdOrPatch: string | Partial<CanvasProjectRecord>, maybePatch?: Partial<CanvasProjectRecord>): Promise<CanvasProjectRecord | null> {
  const legacy = maybePatch === undefined
  const env = legacy ? null : envOrProjectId
  const projectId = legacy ? String(envOrProjectId || '') : String(projectIdOrPatch || '')
  const patch = (legacy ? projectIdOrPatch : maybePatch) as Partial<CanvasProjectRecord>
  const current = await getCanvasProject(env, projectId)
  if (!current) return null
  const next: CanvasProjectRecord = {
    ...current,
    ...patch,
    id: current.id,
    sessionId: patch.sessionId || current.sessionId,
    ownerUserId: patch.ownerUserId === undefined ? current.ownerUserId || null : patch.ownerUserId || null,
    title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : current.title,
    metadataJson: patch.metadataJson || current.metadataJson,
    updatedAt: nowIso(),
  }

  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      UPDATE canvas_projects
      SET session_id = ?, owner_user_id = ?, title = ?, metadata_json = ?, created_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      next.sessionId,
      next.ownerUserId || null,
      next.title,
      stringifyJson(next.metadataJson),
      next.createdAt,
      next.updatedAt,
      next.id,
    ).run()
  } else {
    memoryState.canvasProjects.set(projectId, next)
  }
  return next
}

export async function listCanvasProjectElements(envOrProjectId: any, maybeProjectId?: string): Promise<CanvasProjectElementRecord[]> {
  const { env, id } = resolveEnvAndId(envOrProjectId, maybeProjectId)
  const db = dbFor(env)
  if (db) {
    const result = await db.prepare(`
      SELECT * FROM canvas_project_elements
      WHERE project_id = ?
      ORDER BY z_index ASC
    `).bind(id).all<any>()
    return (result.results || []).map(rowToCanvasProjectElement)
  }
  return [...(memoryState.canvasProjectElements.get(id) || [])]
}

export async function replaceCanvasProjectElements(
  envOrProjectId: any,
  projectIdOrElements: string | Array<Record<string, unknown>>,
  maybeElements?: Array<Record<string, unknown>>,
): Promise<CanvasProjectElementRecord[] | null> {
  const legacy = Array.isArray(projectIdOrElements)
  const env = legacy ? null : envOrProjectId
  const projectId = legacy ? String(envOrProjectId || '') : String(projectIdOrElements || '')
  const elements = (legacy ? projectIdOrElements : maybeElements) as Array<Record<string, unknown>>
  const project = await getCanvasProject(env, projectId)
  if (!project) return null
  const now = nowIso()
  const records = elements.map((element, index) => {
    return {
      id: createId('cel'),
      projectId,
      elementType: typeof element.type === 'string' ? element.type : 'unknown',
      zIndex: index,
      dataJson: element,
      createdAt: now,
      updatedAt: now,
    }
  })

  const db = dbFor(env)
  if (db) {
    await db.batch([
      db.prepare('DELETE FROM canvas_project_elements WHERE project_id = ?').bind(projectId),
      ...records.map((record) => db.prepare(`
        INSERT INTO canvas_project_elements (
          id, project_id, element_type, z_index, data_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.id,
        record.projectId,
        record.elementType,
        record.zIndex,
        stringifyJson(record.dataJson),
        record.createdAt,
        record.updatedAt,
      )),
      db.prepare('UPDATE canvas_projects SET updated_at = ? WHERE id = ?').bind(now, projectId),
    ])
  } else {
    memoryState.canvasProjectElements.set(projectId, records)
    project.updatedAt = now
    memoryState.canvasProjects.set(projectId, project)
  }
  return records
}

export async function getProjectRole(env: any, projectId: string, userId?: string | null): Promise<ProjectRole | null> {
  if (!userId) return null
  const project = await getCanvasProject(env, projectId)
  if (!project) return null
  if (project.ownerUserId && project.ownerUserId === userId) return 'owner'

  const db = dbFor(env)
  if (db) {
    const row = await db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').bind(projectId, userId).first<any>()
    return row?.role || null
  }
  return memoryState.projectMembers.get(`${projectId}:${userId}`)?.role || null
}

export async function listProjectMembers(env: any, projectId: string): Promise<Array<ProjectMemberRecord & { user?: Pick<UserRecord, 'id' | 'email' | 'name'> }>> {
  const db = dbFor(env)
  if (db) {
    const result = await db.prepare(`
      SELECT pm.*, u.email, u.name
      FROM project_members pm
      INNER JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ?
      ORDER BY pm.created_at ASC
    `).bind(projectId).all<any>()
    return (result.results || []).map((row) => ({
      ...rowToProjectMember(row),
      user: { id: String(row.user_id), email: String(row.email || ''), name: String(row.name || '') },
    }))
  }

  return [...memoryState.projectMembers.values()]
    .filter((member) => member.projectId === projectId)
    .map((member) => {
      const user = memoryState.users.get(member.userId)
      return {
        ...member,
        user: user ? { id: user.id, email: user.email, name: user.name } : undefined,
      }
    })
}

export async function upsertProjectMember(env: any, input: {
  projectId: string
  userId: string
  role: Exclude<ProjectRole, 'owner'>
  invitedByUserId?: string | null
}): Promise<ProjectMemberRecord> {
  const now = nowIso()
  const existing = await getProjectRole(env, input.projectId, input.userId)
  if (existing === 'owner') {
    throw new Error('Owner role cannot be changed through members')
  }
  const record: ProjectMemberRecord = {
    projectId: input.projectId,
    userId: input.userId,
    role: input.role,
    invitedByUserId: input.invitedByUserId || null,
    createdAt: now,
    updatedAt: now,
  }
  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      INSERT INTO project_members (project_id, user_id, role, invited_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET
        role = excluded.role,
        updated_at = excluded.updated_at
    `).bind(record.projectId, record.userId, record.role, record.invitedByUserId, record.createdAt, record.updatedAt).run()
  } else {
    const current = memoryState.projectMembers.get(`${record.projectId}:${record.userId}`)
    memoryState.projectMembers.set(`${record.projectId}:${record.userId}`, {
      ...record,
      createdAt: current?.createdAt || record.createdAt,
    })
  }
  return record
}

export async function removeProjectMember(env: any, projectId: string, userId: string): Promise<void> {
  const db = dbFor(env)
  if (db) {
    await db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').bind(projectId, userId).run()
    return
  }
  memoryState.projectMembers.delete(`${projectId}:${userId}`)
}

export async function createProjectInvite(env: any, input: {
  projectId: string
  email: string
  role: Exclude<ProjectRole, 'owner'>
  token: string
  invitedByUserId?: string | null
  expiresAt: string
}): Promise<ProjectInviteRecord> {
  const now = nowIso()
  const record: ProjectInviteRecord = {
    id: createId('invite'),
    projectId: input.projectId,
    email: normalizeEmail(input.email),
    role: input.role,
    token: input.token,
    status: 'pending',
    invitedByUserId: input.invitedByUserId || null,
    acceptedByUserId: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt,
  }
  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      INSERT INTO project_invites (
        id, project_id, email, role, token, status, invited_by_user_id,
        accepted_by_user_id, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      record.id,
      record.projectId,
      record.email,
      record.role,
      record.token,
      record.status,
      record.invitedByUserId,
      record.acceptedByUserId,
      record.createdAt,
      record.updatedAt,
      record.expiresAt,
    ).run()
  } else {
    memoryState.projectInvites.set(record.id, record)
    memoryState.projectInvitesByToken.set(record.token, record.id)
  }
  return record
}

export async function listProjectInvites(env: any, projectId: string): Promise<ProjectInviteRecord[]> {
  const db = dbFor(env)
  if (db) {
    const result = await db.prepare(`
      SELECT * FROM project_invites
      WHERE project_id = ? AND status = 'pending'
      ORDER BY created_at ASC
    `).bind(projectId).all<any>()
    return (result.results || []).map(rowToProjectInvite)
  }
  return [...memoryState.projectInvites.values()].filter((invite) => invite.projectId === projectId && invite.status === 'pending')
}

export async function getProjectInviteByToken(env: any, token: string): Promise<ProjectInviteRecord | null> {
  const db = dbFor(env)
  if (db) {
    const row = await db.prepare('SELECT * FROM project_invites WHERE token = ?').bind(token).first<any>()
    return row ? rowToProjectInvite(row) : null
  }
  const id = memoryState.projectInvitesByToken.get(token)
  return id ? memoryState.projectInvites.get(id) || null : null
}

export async function updateProjectInvite(env: any, inviteId: string, patch: Partial<ProjectInviteRecord>): Promise<ProjectInviteRecord | null> {
  const db = dbFor(env)
  const current = db
    ? await db.prepare('SELECT * FROM project_invites WHERE id = ?').bind(inviteId).first<any>().then((row) => (row ? rowToProjectInvite(row) : null))
    : memoryState.projectInvites.get(inviteId) || null
  if (!current) return null
  const next = { ...current, ...patch, id: current.id, updatedAt: nowIso() }
  if (db) {
    await db.prepare(`
      UPDATE project_invites
      SET status = ?, accepted_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).bind(next.status, next.acceptedByUserId || null, next.updatedAt, next.id).run()
  } else {
    memoryState.projectInvites.set(next.id, next)
  }
  return next
}

export async function createUsageEvent(env: any, input: {
  userId?: string | null
  sessionId?: string | null
  projectId?: string | null
  jobId?: string | null
  eventType: string
  amount?: number
  provider?: string | null
  modelId?: string | null
  inputTokens?: number
  outputTokens?: number
  apiCostUsd?: number
  metadataJson?: Record<string, unknown>
}): Promise<UsageEventRecord> {
  const record: UsageEventRecord = {
    id: createId('usage'),
    userId: input.userId || null,
    sessionId: input.sessionId || null,
    projectId: input.projectId || null,
    jobId: input.jobId || null,
    eventType: input.eventType,
    amount: Number(input.amount || 1),
    provider: input.provider || null,
    modelId: input.modelId || null,
    inputTokens: Math.max(0, Math.floor(Number(input.inputTokens || 0))),
    outputTokens: Math.max(0, Math.floor(Number(input.outputTokens || 0))),
    apiCostUsd: Math.max(0, Number(input.apiCostUsd || 0)),
    metadataJson: input.metadataJson || {},
    createdAt: nowIso(),
  }
  const db = dbFor(env)
  if (db) {
    try {
      await db.prepare(`
        INSERT INTO usage_events (
          id, user_id, session_id, project_id, job_id, event_type, amount,
          provider, model_id, input_tokens, output_tokens, api_cost_usd,
          metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.id,
        record.userId,
        record.sessionId,
        record.projectId,
        record.jobId,
        record.eventType,
        record.amount,
        record.provider,
        record.modelId,
        record.inputTokens || 0,
        record.outputTokens || 0,
        record.apiCostUsd || 0,
        stringifyJson(record.metadataJson),
        record.createdAt,
      ).run()
    } catch (error) {
      if (!isMissingUsageCostColumn(error)) throw error
      await db.prepare(`
        INSERT INTO usage_events (
          id, user_id, session_id, project_id, job_id, event_type, amount, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.id,
        record.userId,
        record.sessionId,
        record.projectId,
        record.jobId,
        record.eventType,
        record.amount,
        stringifyJson(record.metadataJson),
        record.createdAt,
      ).run()
    }
  } else {
    memoryState.usageEvents.push(record)
  }
  return record
}

export async function getUsageSummary(env: any, opts: { userId?: string | null; sessionId?: string | null }): Promise<Record<string, unknown>> {
  const db = dbFor(env)
  if (db) {
    const where = opts.userId ? 'user_id = ?' : 'session_id = ?'
    const value = opts.userId || opts.sessionId || ''
    try {
      const result = await db.prepare(`
        SELECT
          event_type,
          COALESCE(SUM(amount), 0) AS total,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(api_cost_usd), 0) AS api_cost_usd
        FROM usage_events
        WHERE ${where}
          AND event_type NOT LIKE 'auth_%'
        GROUP BY event_type
      `).bind(value).all<any>()
      const byType: Record<string, number> = {}
      let inputTokens = 0
      let outputTokens = 0
      let apiCostUsd = 0
      for (const row of result.results || []) byType[String(row.event_type)] = Number(row.total || 0)
      for (const row of result.results || []) {
        inputTokens += Number(row.input_tokens || 0)
        outputTokens += Number(row.output_tokens || 0)
        apiCostUsd += Number(row.api_cost_usd || 0)
      }
      return {
        byType,
        total: Object.values(byType).reduce((sum, value) => sum + value, 0),
        inputTokens,
        outputTokens,
        apiCostUsd,
      }
    } catch (error) {
      if (!isMissingUsageCostColumn(error)) throw error
      const result = await db.prepare(`
        SELECT event_type, COALESCE(SUM(amount), 0) AS total
        FROM usage_events
        WHERE ${where}
          AND event_type NOT LIKE 'auth_%'
        GROUP BY event_type
      `).bind(value).all<any>()
      const byType: Record<string, number> = {}
      for (const row of result.results || []) byType[String(row.event_type)] = Number(row.total || 0)
      return {
        byType,
        total: Object.values(byType).reduce((sum, value) => sum + value, 0),
        inputTokens: 0,
        outputTokens: 0,
        apiCostUsd: 0,
      }
    }
  }
  const filtered = memoryState.usageEvents.filter((event) => (
    opts.userId ? event.userId === opts.userId : event.sessionId === opts.sessionId
  ) && !event.eventType.startsWith('auth_'))
  const byType = filtered.reduce((acc, event) => {
    acc[event.eventType] = (acc[event.eventType] || 0) + event.amount
    return acc
  }, {} as Record<string, number>)
  return {
    byType,
    total: Object.values(byType).reduce((sum, value) => sum + value, 0),
    inputTokens: filtered.reduce((sum, event) => sum + Number(event.inputTokens || 0), 0),
    outputTokens: filtered.reduce((sum, event) => sum + Number(event.outputTokens || 0), 0),
    apiCostUsd: filtered.reduce((sum, event) => sum + Number(event.apiCostUsd || 0), 0),
  }
}

export type AdminListResult<T> = {
  items: T[]
  total: number
  limit: number
  offset: number
}

export type AdminUserSummary = {
  id: string
  email: string
  name: string
  createdAt: string
  updatedAt: string
  loginCount: number
  lastLoginAt: string | null
  lastSeenAt: string | null
  activeSessionCount: number
  onlineSessionCount: number
  online: boolean
  usageTotal: number
  inputTokens: number
  outputTokens: number
  apiCostUsd: number
  jobCount: number
  runningJobCount: number
  failedJobCount: number
  projectCount: number
}

export type AdminUsageSummary = {
  date: string
  userId: string | null
  sessionId: string | null
  email: string | null
  name: string | null
  eventType: string
  provider: string | null
  modelId: string | null
  eventCount: number
  amount: number
  inputTokens: number
  outputTokens: number
  apiCostUsd: number
  firstAt: string | null
  lastAt: string | null
}

export type AdminJobSummary = JobRecord & {
  user?: Pick<UserRecord, 'id' | 'email' | 'name'> | null
  itemCount: number
  completedItemCount: number
  failedItemCount: number
  usageAmount: number
  inputTokens: number
  outputTokens: number
  apiCostUsd: number
}

function clampAdminLimit(value: unknown, fallback = 50, max = 200): number {
  const parsed = Math.floor(Number(value || fallback))
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(max, parsed))
}

function clampAdminOffset(value: unknown): number {
  const parsed = Math.floor(Number(value || 0))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeAdminSearch(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeAdminDateBound(value: unknown, endExclusive = false): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const date = new Date(dateOnly ? `${raw}T00:00:00.000Z` : raw)
  if (!Number.isFinite(date.getTime())) return null
  if (dateOnly && endExclusive) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function maxIso(values: Array<string | null | undefined>): string | null {
  const sorted = values.filter(Boolean).sort()
  return sorted.length ? sorted[sorted.length - 1] || null : null
}

function dateKey(iso: string): string {
  return String(iso || '').slice(0, 10) || 'unknown'
}

function userMatchesAdminSearch(user: UserRecord, q: string): boolean {
  if (!q) return true
  return user.email.toLowerCase().includes(q) || user.name.toLowerCase().includes(q) || user.id.toLowerCase().includes(q)
}

function isUsageEventBillable(event: UsageEventRecord): boolean {
  return !String(event.eventType || '').startsWith('auth_')
}

function usageTotals(events: UsageEventRecord[]) {
  return events.reduce((acc, event) => {
    acc.amount += Number(event.amount || 0)
    acc.inputTokens += Number(event.inputTokens || 0)
    acc.outputTokens += Number(event.outputTokens || 0)
    acc.apiCostUsd += Number(event.apiCostUsd || 0)
    return acc
  }, { amount: 0, inputTokens: 0, outputTokens: 0, apiCostUsd: 0 })
}

export async function getAdminOverview(env: any, opts: { onlineWindowMinutes?: number } = {}) {
  const onlineWindowMinutes = Math.max(1, Math.min(60, Number(opts.onlineWindowMinutes || 5)))
  const now = nowIso()
  const onlineCutoff = isoMinutesAgo(onlineWindowMinutes)
  const since24h = isoDaysAgo(1)
  const since30d = isoDaysAgo(30)
  const db = dbFor(env)
  if (db) {
    const userRow = await db.prepare('SELECT COUNT(*) AS total FROM users').first<any>()
    const activeRow = await db.prepare(`
      SELECT COUNT(*) AS active_sessions, COUNT(DISTINCT user_id) AS active_users
      FROM auth_sessions
      WHERE expires_at > ?
    `).bind(now).first<any>()
    const onlineRow = await db.prepare(`
      SELECT COUNT(*) AS online_sessions, COUNT(DISTINCT user_id) AS online_users, MAX(last_seen_at) AS last_seen_at
      FROM auth_sessions
      WHERE expires_at > ? AND last_seen_at >= ?
    `).bind(now, onlineCutoff).first<any>()
    const recentLoginRow = await db.prepare(`
      SELECT COUNT(*) AS login_events, COUNT(DISTINCT user_id) AS login_users
      FROM usage_events
      WHERE event_type IN ('auth_login', 'auth_register') AND created_at >= ?
    `).bind(since24h).first<any>()
    const usageRow = await db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) AS amount,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(api_cost_usd), 0) AS api_cost_usd
      FROM usage_events
      WHERE created_at >= ? AND event_type NOT LIKE 'auth_%'
    `).bind(since30d).first<any>()
    const jobRow = await db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_24h
      FROM jobs
    `).bind(since24h).first<any>()
    const statusRows = await db.prepare('SELECT status, COUNT(*) AS total FROM jobs GROUP BY status').all<any>()
    const projectRow = await db.prepare('SELECT COUNT(*) AS total FROM canvas_projects').first<any>()
    const byStatus: Record<string, number> = {}
    for (const row of statusRows.results || []) byStatus[String(row.status || '')] = Number(row.total || 0)
    return {
      generatedAt: now,
      onlineWindowMinutes,
      users: {
        total: Number(userRow?.total || 0),
        active: Number(activeRow?.active_users || 0),
        online: Number(onlineRow?.online_users || 0),
        onlineSessions: Number(onlineRow?.online_sessions || 0),
        loginUsers24h: Number(recentLoginRow?.login_users || 0),
        loginEvents24h: Number(recentLoginRow?.login_events || 0),
        lastSeenAt: onlineRow?.last_seen_at || null,
      },
      usage: {
        last30DaysAmount: Number(usageRow?.amount || 0),
        inputTokens: Number(usageRow?.input_tokens || 0),
        outputTokens: Number(usageRow?.output_tokens || 0),
        apiCostUsd: Number(usageRow?.api_cost_usd || 0),
      },
      jobs: {
        total: Number(jobRow?.total || 0),
        last24h: Number(jobRow?.last_24h || 0),
        byStatus,
      },
      projects: {
        total: Number(projectRow?.total || 0),
      },
    }
  }

  const users = [...memoryState.users.values()]
  const authSessions = [...memoryState.authSessions.values()]
  const onlineSessions = authSessions.filter((session) => session.expiresAt > now && session.lastSeenAt >= onlineCutoff)
  const activeSessions = authSessions.filter((session) => session.expiresAt > now)
  const loginEvents = memoryState.usageEvents.filter((event) =>
    ['auth_login', 'auth_register'].includes(event.eventType) && event.createdAt >= since24h)
  const recentUsage = memoryState.usageEvents.filter((event) => event.createdAt >= since30d && isUsageEventBillable(event))
  const totals = usageTotals(recentUsage)
  const byStatus = [...memoryState.jobs.values()].reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  return {
    generatedAt: now,
    onlineWindowMinutes,
    users: {
      total: users.length,
      active: new Set(activeSessions.map((session) => session.userId)).size,
      online: new Set(onlineSessions.map((session) => session.userId)).size,
      onlineSessions: onlineSessions.length,
      loginUsers24h: new Set(loginEvents.map((event) => event.userId)).size,
      loginEvents24h: loginEvents.length,
      lastSeenAt: maxIso(onlineSessions.map((session) => session.lastSeenAt)),
    },
    usage: {
      last30DaysAmount: totals.amount,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      apiCostUsd: totals.apiCostUsd,
    },
    jobs: {
      total: memoryState.jobs.size,
      last24h: [...memoryState.jobs.values()].filter((job) => job.createdAt >= since24h).length,
      byStatus,
    },
    projects: {
      total: memoryState.canvasProjects.size,
    },
  }
}

export async function listAdminUsers(env: any, opts: {
  q?: string
  limit?: number
  offset?: number
  onlineWindowMinutes?: number
} = {}): Promise<AdminListResult<AdminUserSummary>> {
  const q = normalizeAdminSearch(opts.q)
  const limit = clampAdminLimit(opts.limit, 50)
  const offset = clampAdminOffset(opts.offset)
  const now = nowIso()
  const onlineCutoff = isoMinutesAgo(Math.max(1, Math.min(60, Number(opts.onlineWindowMinutes || 5))))
  const db = dbFor(env)
  if (db) {
    const where = q ? 'WHERE LOWER(u.email) LIKE ? OR LOWER(u.name) LIKE ? OR LOWER(u.id) LIKE ?' : ''
    const qParams = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []
    const countStmt = db.prepare(`SELECT COUNT(*) AS total FROM users u ${where}`)
    const countRow = qParams.length
      ? await countStmt.bind(...qParams).first<any>()
      : await countStmt.first<any>()
    const result = await db.prepare(`
      SELECT
        u.id, u.email, u.name, u.created_at, u.updated_at,
        COALESCE(logins.login_count, 0) AS login_count,
        COALESCE(logins.last_login_at, sess.last_login_at) AS last_login_at,
        sess.last_seen_at,
        COALESCE(sess.active_session_count, 0) AS active_session_count,
        COALESCE(sess.online_session_count, 0) AS online_session_count,
        COALESCE(usage.total_amount, 0) AS usage_total,
        COALESCE(usage.input_tokens, 0) AS input_tokens,
        COALESCE(usage.output_tokens, 0) AS output_tokens,
        COALESCE(usage.api_cost_usd, 0) AS api_cost_usd,
        COALESCE(jobs.job_count, 0) AS job_count,
        COALESCE(jobs.running_job_count, 0) AS running_job_count,
        COALESCE(jobs.failed_job_count, 0) AS failed_job_count,
        COALESCE(projects.project_count, 0) AS project_count
      FROM users u
      LEFT JOIN (
        SELECT
          user_id,
          COUNT(*) AS session_count,
          MAX(created_at) AS last_login_at,
          MAX(last_seen_at) AS last_seen_at,
          SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END) AS active_session_count,
          SUM(CASE WHEN expires_at > ? AND last_seen_at >= ? THEN 1 ELSE 0 END) AS online_session_count
        FROM auth_sessions
        GROUP BY user_id
      ) sess ON sess.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS login_count, MAX(created_at) AS last_login_at
        FROM usage_events
        WHERE event_type IN ('auth_login', 'auth_register')
        GROUP BY user_id
      ) logins ON logins.user_id = u.id
      LEFT JOIN (
        SELECT
          user_id,
          COALESCE(SUM(amount), 0) AS total_amount,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(api_cost_usd), 0) AS api_cost_usd
        FROM usage_events
        WHERE user_id IS NOT NULL AND event_type NOT LIKE 'auth_%'
        GROUP BY user_id
      ) usage ON usage.user_id = u.id
      LEFT JOIN (
        SELECT
          user_id,
          COUNT(*) AS job_count,
          SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END) AS running_job_count,
          SUM(CASE WHEN status IN ('failed', 'partial_failed') THEN 1 ELSE 0 END) AS failed_job_count
        FROM jobs
        WHERE user_id IS NOT NULL
        GROUP BY user_id
      ) jobs ON jobs.user_id = u.id
      LEFT JOIN (
        SELECT owner_user_id AS user_id, COUNT(*) AS project_count
        FROM canvas_projects
        WHERE owner_user_id IS NOT NULL
        GROUP BY owner_user_id
      ) projects ON projects.user_id = u.id
      ${where}
      ORDER BY COALESCE(sess.last_seen_at, logins.last_login_at, u.created_at) DESC
      LIMIT ? OFFSET ?
    `).bind(now, now, onlineCutoff, ...qParams, limit, offset).all<any>()
    const items = (result.results || []).map((row) => ({
      id: String(row.id),
      email: String(row.email || ''),
      name: String(row.name || ''),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
      loginCount: Number(row.login_count || 0),
      lastLoginAt: row.last_login_at || null,
      lastSeenAt: row.last_seen_at || null,
      activeSessionCount: Number(row.active_session_count || 0),
      onlineSessionCount: Number(row.online_session_count || 0),
      online: Number(row.online_session_count || 0) > 0,
      usageTotal: Number(row.usage_total || 0),
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      apiCostUsd: Number(row.api_cost_usd || 0),
      jobCount: Number(row.job_count || 0),
      runningJobCount: Number(row.running_job_count || 0),
      failedJobCount: Number(row.failed_job_count || 0),
      projectCount: Number(row.project_count || 0),
    }))
    return { items, total: Number(countRow?.total || 0), limit, offset }
  }

  const users = [...memoryState.users.values()].filter((user) => userMatchesAdminSearch(user, q))
  const items = users.map((user) => {
    const authSessions = [...memoryState.authSessions.values()].filter((session) => session.userId === user.id)
    const activeSessions = authSessions.filter((session) => session.expiresAt > now)
    const onlineSessions = activeSessions.filter((session) => session.lastSeenAt >= onlineCutoff)
    const loginEvents = memoryState.usageEvents.filter((event) =>
      event.userId === user.id && ['auth_login', 'auth_register'].includes(event.eventType))
    const userUsage = memoryState.usageEvents.filter((event) => event.userId === user.id && isUsageEventBillable(event))
    const totals = usageTotals(userUsage)
    const jobs = [...memoryState.jobs.values()].filter((job) => job.userId === user.id)
    const projects = [...memoryState.canvasProjects.values()].filter((project) => project.ownerUserId === user.id)
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      loginCount: loginEvents.length,
      lastLoginAt: maxIso([...loginEvents.map((event) => event.createdAt), ...authSessions.map((session) => session.createdAt)]),
      lastSeenAt: maxIso(authSessions.map((session) => session.lastSeenAt)),
      activeSessionCount: activeSessions.length,
      onlineSessionCount: onlineSessions.length,
      online: onlineSessions.length > 0,
      usageTotal: totals.amount,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      apiCostUsd: totals.apiCostUsd,
      jobCount: jobs.length,
      runningJobCount: jobs.filter((job) => ['queued', 'running'].includes(job.status)).length,
      failedJobCount: jobs.filter((job) => ['failed', 'partial_failed'].includes(job.status)).length,
      projectCount: projects.length,
    }
  }).sort((a, b) => String(b.lastSeenAt || b.lastLoginAt || b.createdAt).localeCompare(String(a.lastSeenAt || a.lastLoginAt || a.createdAt)))
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset }
}

export async function listAdminUsage(env: any, opts: {
  from?: string | null
  to?: string | null
  userId?: string | null
  eventType?: string | null
  limit?: number
} = {}): Promise<AdminListResult<AdminUsageSummary>> {
  const limit = clampAdminLimit(opts.limit, 100, 500)
  const fromIso = normalizeAdminDateBound(opts.from)
  const toIso = normalizeAdminDateBound(opts.to, true)
  const userId = String(opts.userId || '').trim()
  const eventType = String(opts.eventType || '').trim()
  const db = dbFor(env)
  if (db) {
    const where: string[] = []
    const params: unknown[] = []
    if (fromIso) {
      where.push('ue.created_at >= ?')
      params.push(fromIso)
    }
    if (toIso) {
      where.push('ue.created_at < ?')
      params.push(toIso)
    }
    if (userId) {
      where.push('ue.user_id = ?')
      params.push(userId)
    }
    if (eventType) {
      where.push('ue.event_type = ?')
      params.push(eventType)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const result = await db.prepare(`
      SELECT
        substr(ue.created_at, 1, 10) AS usage_date,
        ue.user_id,
        ue.session_id,
        u.email,
        u.name,
        ue.event_type,
        COALESCE(ue.provider, '') AS provider,
        COALESCE(ue.model_id, '') AS model_id,
        COUNT(*) AS event_count,
        COALESCE(SUM(ue.amount), 0) AS amount,
        COALESCE(SUM(ue.input_tokens), 0) AS input_tokens,
        COALESCE(SUM(ue.output_tokens), 0) AS output_tokens,
        COALESCE(SUM(ue.api_cost_usd), 0) AS api_cost_usd,
        MIN(ue.created_at) AS first_at,
        MAX(ue.created_at) AS last_at
      FROM usage_events ue
      LEFT JOIN users u ON u.id = ue.user_id
      ${whereSql}
      GROUP BY usage_date, ue.user_id, ue.session_id, ue.event_type, provider, model_id
      ORDER BY usage_date DESC, amount DESC, last_at DESC
      LIMIT ?
    `).bind(...params, limit).all<any>()
    const items = (result.results || []).map((row) => ({
      date: String(row.usage_date || ''),
      userId: row.user_id || null,
      sessionId: row.session_id || null,
      email: row.email || null,
      name: row.name || null,
      eventType: String(row.event_type || ''),
      provider: row.provider || null,
      modelId: row.model_id || null,
      eventCount: Number(row.event_count || 0),
      amount: Number(row.amount || 0),
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      apiCostUsd: Number(row.api_cost_usd || 0),
      firstAt: row.first_at || null,
      lastAt: row.last_at || null,
    }))
    return { items, total: items.length, limit, offset: 0 }
  }

  const filtered = memoryState.usageEvents.filter((event) => {
    if (fromIso && event.createdAt < fromIso) return false
    if (toIso && event.createdAt >= toIso) return false
    if (userId && event.userId !== userId) return false
    if (eventType && event.eventType !== eventType) return false
    return true
  })
  const grouped = new Map<string, AdminUsageSummary>()
  for (const event of filtered) {
    const user = event.userId ? memoryState.users.get(event.userId) || null : null
    const key = [
      dateKey(event.createdAt),
      event.userId || '',
      event.sessionId || '',
      event.eventType,
      event.provider || '',
      event.modelId || '',
    ].join('|')
    const current = grouped.get(key) || {
      date: dateKey(event.createdAt),
      userId: event.userId || null,
      sessionId: event.sessionId || null,
      email: user?.email || null,
      name: user?.name || null,
      eventType: event.eventType,
      provider: event.provider || null,
      modelId: event.modelId || null,
      eventCount: 0,
      amount: 0,
      inputTokens: 0,
      outputTokens: 0,
      apiCostUsd: 0,
      firstAt: event.createdAt,
      lastAt: event.createdAt,
    }
    current.eventCount += 1
    current.amount += Number(event.amount || 0)
    current.inputTokens += Number(event.inputTokens || 0)
    current.outputTokens += Number(event.outputTokens || 0)
    current.apiCostUsd += Number(event.apiCostUsd || 0)
    current.firstAt = !current.firstAt || event.createdAt < current.firstAt ? event.createdAt : current.firstAt
    current.lastAt = !current.lastAt || event.createdAt > current.lastAt ? event.createdAt : current.lastAt
    grouped.set(key, current)
  }
  const items = [...grouped.values()]
    .sort((a, b) => `${b.date}:${b.amount}:${b.lastAt}`.localeCompare(`${a.date}:${a.amount}:${a.lastAt}`))
    .slice(0, limit)
  return { items, total: items.length, limit, offset: 0 }
}

export async function listAdminJobs(env: any, opts: {
  q?: string
  status?: string | null
  type?: string | null
  userId?: string | null
  limit?: number
  offset?: number
} = {}): Promise<AdminListResult<AdminJobSummary>> {
  const q = normalizeAdminSearch(opts.q)
  const status = String(opts.status || '').trim()
  const type = String(opts.type || '').trim()
  const userId = String(opts.userId || '').trim()
  const limit = clampAdminLimit(opts.limit, 50)
  const offset = clampAdminOffset(opts.offset)
  const db = dbFor(env)
  if (db) {
    const where: string[] = []
    const params: unknown[] = []
    if (q) {
      where.push('(LOWER(j.id) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.name) LIKE ?)')
      params.push(`%${q}%`, `%${q}%`, `%${q}%`)
    }
    if (status) {
      where.push('j.status = ?')
      params.push(status)
    }
    if (type) {
      where.push('j.type = ?')
      params.push(type)
    }
    if (userId) {
      where.push('j.user_id = ?')
      params.push(userId)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const countStmt = db.prepare(`
      SELECT COUNT(*) AS total
      FROM jobs j
      LEFT JOIN users u ON u.id = j.user_id
      ${whereSql}
    `)
    const countRow = params.length
      ? await countStmt.bind(...params).first<any>()
      : await countStmt.first<any>()
    const result = await db.prepare(`
      SELECT
        j.*,
        u.email,
        u.name,
        COALESCE(items.item_count, 0) AS item_count,
        COALESCE(items.completed_item_count, 0) AS completed_item_count,
        COALESCE(items.failed_item_count, 0) AS failed_item_count,
        COALESCE(usage.usage_amount, 0) AS usage_amount,
        COALESCE(usage.input_tokens, 0) AS input_tokens,
        COALESCE(usage.output_tokens, 0) AS output_tokens,
        COALESCE(usage.api_cost_usd, 0) AS api_cost_usd
      FROM jobs j
      LEFT JOIN users u ON u.id = j.user_id
      LEFT JOIN (
        SELECT
          job_id,
          COUNT(*) AS item_count,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_item_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_item_count
        FROM job_items
        GROUP BY job_id
      ) items ON items.job_id = j.id
      LEFT JOIN (
        SELECT
          job_id,
          COALESCE(SUM(amount), 0) AS usage_amount,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(api_cost_usd), 0) AS api_cost_usd
        FROM usage_events
        WHERE job_id IS NOT NULL
        GROUP BY job_id
      ) usage ON usage.job_id = j.id
      ${whereSql}
      ORDER BY j.updated_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<any>()
    const items = (result.results || []).map((row) => ({
      ...rowToJob(row),
      user: row.user_id ? {
        id: String(row.user_id),
        email: String(row.email || ''),
        name: String(row.name || ''),
      } : null,
      itemCount: Number(row.item_count || 0),
      completedItemCount: Number(row.completed_item_count || 0),
      failedItemCount: Number(row.failed_item_count || 0),
      usageAmount: Number(row.usage_amount || 0),
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      apiCostUsd: Number(row.api_cost_usd || 0),
    }))
    return { items, total: Number(countRow?.total || 0), limit, offset }
  }

  const jobs = [...memoryState.jobs.values()].filter((job) => {
    const user = job.userId ? memoryState.users.get(job.userId) || null : null
    if (q && !job.id.toLowerCase().includes(q) && !String(user?.email || '').toLowerCase().includes(q) && !String(user?.name || '').toLowerCase().includes(q)) return false
    if (status && job.status !== status) return false
    if (type && job.type !== type) return false
    if (userId && job.userId !== userId) return false
    return true
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const items = jobs.slice(offset, offset + limit).map((job) => {
    const user = job.userId ? memoryState.users.get(job.userId) || null : null
    const jobItems = [...(memoryState.jobItems.get(job.id)?.values() || [])]
    const jobUsage = memoryState.usageEvents.filter((event) => event.jobId === job.id)
    const totals = usageTotals(jobUsage)
    return {
      ...job,
      user: user ? { id: user.id, email: user.email, name: user.name } : null,
      itemCount: jobItems.length,
      completedItemCount: jobItems.filter((item) => item.status === 'completed').length,
      failedItemCount: jobItems.filter((item) => item.status === 'failed').length,
      usageAmount: totals.amount,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      apiCostUsd: totals.apiCostUsd,
    }
  })
  return { items, total: jobs.length, limit, offset }
}

export async function createSealedCredential(envOrJobId: any, jobIdOrCiphertext: string, ciphertextOrExpiresAt: string, maybeExpiresAt?: string): Promise<SealedCredentialRecord> {
  const legacy = maybeExpiresAt === undefined
  const env = legacy ? null : envOrJobId
  const jobId = legacy ? String(envOrJobId || '') : String(jobIdOrCiphertext || '')
  const ciphertext = legacy ? String(jobIdOrCiphertext || '') : String(ciphertextOrExpiresAt || '')
  const expiresAt = legacy ? String(ciphertextOrExpiresAt || '') : String(maybeExpiresAt || '')
  const record: SealedCredentialRecord = {
    id: createId('cred'),
    jobId,
    ciphertext,
    keyVersion: 'v1',
    expiresAt,
    createdAt: nowIso(),
  }
  const db = dbFor(env)
  if (db) {
    await db.prepare(`
      INSERT INTO sealed_credentials (id, job_id, ciphertext, key_version, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(record.id, record.jobId, record.ciphertext, record.keyVersion, record.expiresAt, record.createdAt).run()
  } else {
    memoryState.sealedCredentials.set(record.id, record)
  }
  return record
}

export async function getSealedCredential(envOrCredentialId: any, maybeCredentialId?: string): Promise<SealedCredentialRecord | null> {
  const { env, id } = resolveEnvAndId(envOrCredentialId, maybeCredentialId)
  const db = dbFor(env)
  if (db) {
    const row = await db.prepare('SELECT * FROM sealed_credentials WHERE id = ?').bind(id).first<any>()
    return row ? rowToSealedCredential(row) : null
  }
  return memoryState.sealedCredentials.get(id) || null
}

export async function deleteSealedCredential(envOrCredentialId: any, maybeCredentialId?: string): Promise<void> {
  const { env, id } = resolveEnvAndId(envOrCredentialId, maybeCredentialId)
  const db = dbFor(env)
  if (db) {
    await db.prepare('DELETE FROM sealed_credentials WHERE id = ?').bind(id).run()
    return
  }
  memoryState.sealedCredentials.delete(id)
}
