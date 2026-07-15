import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/app/actions/auth'
import NotificationBell from '@/components/NotificationBell'

export default async function Header() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName = user?.user_metadata?.display_name ?? user?.email ?? null

  // Seed the notification bell (users.id + unread count) for signed-in users.
  let bellUserId: number | null = null
  let bellUnread = 0
  if (user) {
    const { data: me } = await supabase.from('users').select('id').eq('clerk_id', user.id).maybeSingle()
    if (me) {
      bellUserId = me.id
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', me.id)
        .is('read_at', null)
      bellUnread = count ?? 0
    }
  }

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 h-14
                 bg-ark-bg/90 backdrop-blur-sm
                 border-b border-ark-border
                 font-mono text-[11px]"
    >
      {/* Hairline scanline at the bottom edge — faint cyan */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-ark-accent/30" />

      <div className="h-full flex items-stretch justify-between px-6">
        {/* ---- Brand ---- */}
        <Link href="/" className="flex items-center gap-3 group">
          {/* Rhomboid mark — Arknights operator-class shape */}
          <span
            className="block w-3 h-3 bg-ark-accent
                       group-hover:bg-ark-accent-bright transition-colors duration-200"
            style={{ clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }}
          />

          <span className="flex items-baseline gap-2">
            <span className="tracking-[0.25em] text-ark-text uppercase">ARKNIGHTS</span>
            <span className="text-ark-accent">{'//'}</span>
            <span className="font-sans text-sm font-light tracking-widest text-ark-text">
              明日方舟
            </span>
            <span className="hidden md:inline text-ark-border">·</span>
            <span className="hidden md:inline tracking-[0.25em] text-ark-muted uppercase">RECORD</span>
            <span className="hidden md:inline text-ark-accent">{'//'}</span>
            <span className="hidden md:inline font-sans tracking-widest text-ark-muted">
              剧情阅览
            </span>
          </span>
        </Link>

        {/* ---- Auth strip ---- */}
        <div className="flex items-center gap-3 text-ark-muted">
          <Link
            href="/boards"
            className="hidden sm:inline tracking-widest uppercase text-ark-muted
                       hover:text-ark-accent transition-colors duration-200"
          >
            {'// 线索板'}
          </Link>
          {user ? (
            <>
              {bellUserId != null && (
                <NotificationBell userId={bellUserId} initialUnread={bellUnread} />
              )}
              <span className="tracking-widest uppercase">
                [ <span className="text-ark-success">●</span>{' '}
                <span className="text-ark-text normal-case">{displayName}</span>{' '}]
              </span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="tracking-widest uppercase px-2 py-1
                             border border-ark-border text-ark-muted
                             hover:border-ark-accent hover:text-ark-accent
                             transition-colors duration-200"
                >
                  {'// LOG OUT'}
                </button>
              </form>
            </>
          ) : (
            <>
              <span className="tracking-widest uppercase">
                [ <span className="text-ark-muted">○</span> GUEST ]
              </span>
              <Link
                href="/auth"
                className="tracking-widest uppercase px-2 py-1
                           border border-ark-accent text-ark-accent
                           hover:bg-ark-accent hover:text-ark-bg
                           transition-colors duration-200"
              >
                {'// LOG IN'}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
