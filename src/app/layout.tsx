import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Header from '@/components/Header'
import StatusStrip from '@/components/StatusStrip'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: '明日方舟剧情阅览',
  description: '明日方舟剧情阅览与注释',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-ark-bg text-ark-text">
        <Header />
        <main className="flex-1 pt-14 pb-7">
          {children}
        </main>
        <StatusStrip />
      </body>
    </html>
  )
}
