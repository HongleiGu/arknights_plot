import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAiKeyStatus } from '@/app/actions/aikey'
import KeyForm from './KeyForm'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const status = await getAiKeyStatus()

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="h-0.5 w-16 bg-ark-accent mb-8" />
      <h1 className="text-2xl font-light tracking-widest text-ark-text mb-1">设置</h1>
      <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-8">
        {'// SETTINGS · AI'}
      </p>

      <section className="border border-ark-border p-4">
        <p className="font-mono text-[10px] text-ark-muted tracking-widest uppercase mb-3">
          {'//'} 自备 API Key
        </p>
        <p className="text-sm text-ark-muted leading-relaxed mb-4">
          填入自己的 API Key 后，AI 分析终端将用你的额度调用模型，不再占用本站的每月公共额度，
          也不受每用户上限约束。密钥经 AES-256-GCM 加密后存储，本站只保留密文与末四位；
          页面永远不会再把明文显示出来。
        </p>

        <KeyForm initial={status} />

        <p className="font-mono text-[10px] text-ark-border tracking-widest mt-4 pt-3 border-t border-ark-border/60">
          {'//'} 用量仍会记入你自己的账本，可在 AI 面板每轮结束时看到 token 与花费。
        </p>
      </section>

      <p className="mt-6 font-mono text-[10px] text-ark-muted tracking-widest uppercase">
        <Link href="/ai" className="hover:text-ark-accent">{'// AI 会话 →'}</Link>
      </p>
    </div>
  )
}
