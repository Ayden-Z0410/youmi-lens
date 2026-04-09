/** Internal provider ids (BYOK advanced UI + server routing only). */
export type ByokProviderId = 'openai' | 'deepseek' | 'qwen'

export type AiCapability = 'transcribe' | 'translate' | 'summarize'

/** Declared BYOK capabilities (hosted Youmi AI is always full via platform). */
export const BYOK_PROVIDER_CAPABILITIES: Record<
  ByokProviderId,
  Record<AiCapability, boolean>
> = {
  openai: { transcribe: true, translate: true, summarize: true },
  deepseek: { transcribe: false, translate: true, summarize: true },
  qwen: { transcribe: false, translate: true, summarize: true },
}
