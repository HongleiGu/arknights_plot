// OpenAI-compatible LLM client for the AI assistant (AP-15).
// Points the openai SDK at OpenRouter (or any OpenAI-compatible base). Swap the
// model/base/key freely — DeepSeek via OpenRouter is the default. Server-only.

import OpenAI from 'openai'

export const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-v4-flash'

const BASE_URL = process.env.OPENAI_API_BASE || 'https://openrouter.ai/api/v1'
const API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY

export function aiConfigured(): boolean {
  return !!API_KEY
}

let client: OpenAI | null = null
export function llm(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: API_KEY,
      baseURL: BASE_URL,
      // OpenRouter attribution headers (harmless on other providers).
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXT_PUBLIC_R2_PUBLIC_URL ? 'https://viglio.xyz' : 'http://localhost:3000',
        'X-Title': 'Arknights Plot',
      },
    })
  }
  return client
}
