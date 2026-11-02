// The server enforces execution policy independently of planner instructions.
export function normalizeDesignAgentPolicy(value: unknown) {
  const policy = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { mode: policy.mode === 'plan' ? 'plan' as const : 'auto' as const, maxActions: 8 }
}

export function applyDesignAgentPolicy<T extends { shouldGenerate: boolean; prompt: string; actions: unknown[]; mode: string }>(result: T, policy: ReturnType<typeof normalizeDesignAgentPolicy>): T {
  return policy.mode === 'plan'
    ? { ...result, shouldGenerate: false, prompt: '', actions: [], mode: result.mode === 'analyze' ? 'analyze' : 'plan' }
    : result
}
