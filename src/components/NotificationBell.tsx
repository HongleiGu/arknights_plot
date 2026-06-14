'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from '@/app/actions/notifications'

interface Props {
  userId: number       // users.id of the signed-in user (for the Realtime filter)
  initialUnread: number
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}天前`
  return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function actionText(type: string): string {
  return type === 'mention' ? '提到了你' : '回复了你'
}

export default function NotificationBell({ userId, initialUnread }: Props) {
  const [supabase] = useState(() => createClient())
  const [unread, setUnread] = useState(initialUnread)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(false)

  // Live: bump the badge when a new notification lands; refresh the list if open.
  useEffect(() => {
    const ch = supabase
      .channel(`notif-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => {
          setUnread(u => u + 1)
          setOpen(o => { if (o) void refresh(); return o })
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [userId, supabase])

  async function refresh() {
    setLoading(true)
    const rows = await listNotifications()
    setItems(rows)
    setUnread(rows.filter(r => r.read_at == null).length)
    setLoading(false)
  }

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next) await refresh()
  }

  function onItemClick(n: NotificationRow) {
    if (n.read_at == null) {
      setItems(prev => prev.map(x => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
      setUnread(u => Math.max(0, u - 1))
      void markNotificationRead(n.id)
    }
    setOpen(false)
  }

  async function markAll() {
    setItems(prev => prev.map(x => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })))
    setUnread(0)
    await markAllNotificationsRead()
  }

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={toggle}
        aria-label="通知"
        className="relative flex items-center px-2 py-1 tracking-widest uppercase
                   border border-ark-border text-ark-muted
                   hover:border-ark-accent hover:text-ark-accent transition-colors duration-200"
      >
        {/* bell glyph */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="ml-1.5 min-w-4 px-1 text-[10px] leading-4 text-ark-bg bg-ark-accent rounded-full text-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 max-h-[70vh] overflow-y-auto
                          bg-ark-bg border border-ark-border shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between px-3 py-2
                            bg-ark-bg border-b border-ark-border">
              <span className="text-[10px] tracking-widest uppercase text-ark-accent">
                {'//'} 通知
              </span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAll}
                  className="text-[10px] tracking-widest uppercase text-ark-border hover:text-ark-accent transition-colors"
                >
                  全部已读
                </button>
              )}
            </div>

            {loading ? (
              <p className="px-3 py-4 text-[10px] tracking-widest text-ark-muted">{'// 加载中…'}</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-4 text-[10px] tracking-widest text-ark-border">{'// 暂无通知'}</p>
            ) : (
              <ul>
                {items.map(n => {
                  const body = (
                    <div className={`flex gap-2 px-3 py-2.5 border-b border-ark-border/60
                                     hover:bg-ark-surface transition-colors
                                     ${n.read_at == null ? 'bg-ark-accent/[0.04]' : ''}`}>
                      <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0
                                        ${n.read_at == null ? 'bg-ark-accent' : 'bg-transparent'}`} />
                      <div className="min-w-0">
                        <p className="text-xs text-ark-text leading-snug">
                          <span className="text-ark-accent">{n.actor_name ?? '有人'}</span>{' '}
                          <span className="text-ark-muted">{actionText(n.type)}</span>
                        </p>
                        <p className="font-mono text-[10px] text-ark-border tracking-widest mt-0.5">
                          {relativeTime(n.created_at)}
                        </p>
                      </div>
                    </div>
                  )
                  return (
                    <li key={n.id}>
                      {n.href ? (
                        <Link href={n.href} onClick={() => onItemClick(n)}>{body}</Link>
                      ) : (
                        <button type="button" className="block w-full text-left" onClick={() => onItemClick(n)}>
                          {body}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
