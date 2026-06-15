'use client'

import { useState } from 'react'
import { signIn, signUp } from '@/app/actions/auth'
import TurnstileWidget, { turnstileConfigured } from '@/components/TurnstileWidget'

export default function AuthPage() {
  const [tab, setTab] = useState<'signin' | 'signup'>('signin')
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [tsKey, setTsKey] = useState(0)

  // Turnstile gates signup only; bump the key to get a fresh challenge.
  const turnstileBlocks = tab === 'signup' && turnstileConfigured && !token

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const formData = new FormData(e.currentTarget)
    const result = tab === 'signin' ? await signIn(formData) : await signUp(formData)
    setLoading(false)
    if (result?.error) {
      setMessage({ text: result.error, error: true })
      setToken(null)
      setTsKey(k => k + 1) // token is single-use; refresh it after a failed attempt
    }
    if (result && 'message' in result) setMessage({ text: result.message, error: false })
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.03]"
           style={{ backgroundImage: 'linear-gradient(var(--ark-accent) 1px, transparent 1px), linear-gradient(90deg, var(--ark-accent) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <div className="relative w-full max-w-sm">
        {/* Top accent */}
        <div className="h-0.5 w-16 bg-ark-accent mb-8" />

        <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">
          {tab === 'signin' ? '登录' : '注册'}
        </h1>
        <p className="text-xs text-ark-muted tracking-wide mb-8">
          明日方舟剧情阅览
        </p>

        {/* Tabs */}
        <div className="flex gap-0 mb-8 border-b border-ark-border">
          {(['signin', 'signup'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setMessage(null) }}
              className={`px-4 py-2 text-xs tracking-widest transition-colors duration-200
                ${tab === t
                  ? 'text-ark-accent border-b-2 border-ark-accent -mb-px'
                  : 'text-ark-muted hover:text-ark-text'
                }`}
            >
              {t === 'signin' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {tab === 'signup' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-ark-muted tracking-widest uppercase">显示名称</label>
              <input
                name="display_name"
                type="text"
                placeholder="博士"
                className="bg-ark-surface border border-ark-border px-3 py-2 text-sm text-ark-text
                           placeholder:text-ark-muted focus:outline-none focus:border-ark-accent
                           transition-colors duration-200"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ark-muted tracking-widest uppercase">邮箱</label>
            <input
              name="email"
              type="email"
              required
              placeholder="example@mail.com"
              className="bg-ark-surface border border-ark-border px-3 py-2 text-sm text-ark-text
                         placeholder:text-ark-muted focus:outline-none focus:border-ark-accent
                         transition-colors duration-200"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ark-muted tracking-widest uppercase">密码</label>
            <input
              name="password"
              type="password"
              required
              minLength={6}
              placeholder="••••••"
              className="bg-ark-surface border border-ark-border px-3 py-2 text-sm text-ark-text
                         placeholder:text-ark-muted focus:outline-none focus:border-ark-accent
                         transition-colors duration-200"
            />
          </div>

          {tab === 'signup' && (
            <>
              <TurnstileWidget onToken={setToken} remountKey={tsKey} />
              <input type="hidden" name="cf-turnstile-response" value={token ?? ''} />
            </>
          )}

          {message && (
            <p className={`text-xs px-3 py-2 border ${
              message.error
                ? 'border-ark-danger text-ark-danger bg-ark-danger/10'
                : 'border-ark-accent text-ark-accent bg-ark-accent/10'
            }`}>
              {message.text}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || turnstileBlocks}
            className="mt-2 py-2.5 text-xs tracking-widest uppercase font-medium
                       bg-ark-accent text-ark-bg hover:bg-ark-accent-bright
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors duration-200"
          >
            {loading ? '处理中...' : tab === 'signin' ? '登录' : '注册'}
          </button>
        </form>
      </div>
    </div>
  )
}
