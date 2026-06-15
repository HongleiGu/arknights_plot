'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { verifyTurnstile } from '@/lib/turnstile'

export async function signIn(formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })
  if (error) return { error: error.message }
  redirect('/')
}

export async function signUp(formData: FormData) {
  // Anti-bot on account creation (no-op until Turnstile is configured). The
  // widget injects this hidden field into the form.
  const token = formData.get('cf-turnstile-response') as string | null
  if (!(await verifyTurnstile(token))) {
    return { error: '人机验证失败，请重试' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
    options: {
      data: { display_name: formData.get('display_name') as string },
    },
  })
  if (error) return { error: error.message }
  return { message: '注册成功，请检查邮箱验证链接。' }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/auth')
}
