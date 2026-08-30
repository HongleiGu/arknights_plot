// OpenAI-compatible LLM client for the AI assistant (AP-15).
// Points the openai SDK at OpenRouter (or any OpenAI-compatible base). Swap the
// model/base/key freely — DeepSeek via OpenRouter is the default. Server-only.

import OpenAI from 'openai'

export const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-v4-flash'

const BASE_URL = process.env.OPENAI_API_BASE || 'https://openrouter.ai/api/v1'
const API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY

/** True when the deployment has its own key (the shared, budgeted path). */
export function aiConfigured(): boolean {
  return !!API_KEY
}

const HEADERS = {
  // OpenRouter attribution headers (harmless on other providers).
  'HTTP-Referer': process.env.NEXT_PUBLIC_R2_PUBLIC_URL ? 'https://viglio.xyz' : 'http://localhost:3000',
  'X-Title': 'Arknights Plot',
}

let shared: OpenAI | null = null

/**
 * A client for the server's own key. Cached, since it's the same client for
 * every request on the shared path.
 */
export function llm(): OpenAI {
  if (!shared) shared = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL, defaultHeaders: HEADERS })
  return shared
}

/**
 * A client for a caller-supplied key (035, BYOK). Deliberately NOT cached: the
 * key differs per user, and a module-level cache keyed by nothing would leak
 * one user's credentials into another's request.
 */
export function llmWithKey(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: BASE_URL, defaultHeaders: HEADERS })
}
