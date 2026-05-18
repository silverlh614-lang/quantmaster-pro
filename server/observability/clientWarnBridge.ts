// @responsibility Isolate UI/client-only warnings from server operational warn streams.

export interface ClientWarnInput {
  code?: string;
  message: string;
  details?: Record<string, unknown>;
}

export function clientWarn(input: ClientWarnInput): void {
  if (process.env.CLIENT_WARN_DEBUG !== 'true' && process.env.NODE_ENV === 'production') return;
  console.warn(`[P4][UI][${input.code ?? 'P4_CLIENT_ONLY_WARN'}] clientOnly=true ${input.message}`, {
    priority: 'P4',
    domain: 'UI',
    code: input.code ?? 'P4_CLIENT_ONLY_WARN',
    executionImpact: 'NONE',
    clientOnly: true,
    details: input.details,
  });
}
