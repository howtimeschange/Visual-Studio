export type AssetKind = 'upload' | 'reference' | 'generated' | 'result'

export type JobType =
  | 'translate_batch'
  | 'generate_turn'
  | 'outfit_batch'
  | 'generate_batch'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial_failed'
  | 'failed'
  | 'cancelled'

export type JobItemType =
  | 'translate_cell'
  | 'outfit_cell'
  | 'generate_turn_step'
  | 'generate_batch_item'

export type JobItemStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type EventScope = 'job' | 'turn' | 'item'

export type EventType =
  | 'status'
  | 'trace'
  | 'progress'
  | 'job_progress'
  | 'item_started'
  | 'item_completed'
  | 'item_failed'
  | 'job_completed'
  | 'live_brief'
  | 'result'
  | 'error'

export interface SessionRecord {
  id: string
  createdAt: string
  lastActiveAt: string
  clientFingerprint?: string
  preferencesJson?: Record<string, unknown> | null
}

export interface AssetRecord {
  id: string
  sessionId: string
  kind: AssetKind
  source: string
  mime: string
  sizeBytes: number
  width?: number | null
  height?: number | null
  r2Key?: string | null
  sha256: string
  createdAt: string
  filename?: string | null
}

export interface JobRecord {
  id: string
  sessionId: string
  type: JobType
  status: JobStatus
  configJson: Record<string, unknown>
  summaryJson: Record<string, unknown>
  progressTotal: number
  progressDone: number
  progressFailed: number
  createdAt: string
  updatedAt: string
}

export interface JobItemRecord {
  id: string
  jobId: string
  itemType: JobItemType
  status: JobItemStatus
  inputJson: Record<string, unknown>
  outputJson: Record<string, unknown>
  attemptCount: number
  errorCode?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

export interface ConversationRecord {
  id: string
  sessionId: string
  createdAt: string
  updatedAt: string
}

export interface ConversationTurnRecord {
  id: string
  conversationId: string
  userMessage: string
  modelId: string
  useDesignAgent: boolean
  previousTurnId?: string | null
  requestJson: Record<string, unknown>
  traceJson: Record<string, unknown> | null
  status: JobStatus
  resultAssetId?: string | null
  createdAt: string
  updatedAt: string
}

export interface CanvasProjectRecord {
  id: string
  sessionId: string
  title: string
  metadataJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CanvasProjectElementRecord {
  id: string
  projectId: string
  elementType: string
  zIndex: number
  dataJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface SealedCredentialRecord {
  id: string
  jobId: string
  ciphertext: string
  keyVersion: string
  expiresAt: string
  createdAt: string
}

export interface RuntimeEvent<T = Record<string, unknown>> {
  scope: EventScope
  scopeId: string
  type: EventType
  seq: number
  timestamp: string
  payload: T
}
