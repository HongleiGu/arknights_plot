import Link from 'next/link'

// `href` overrides the default `/<id>` category route — the catalogs that
// aren't a stories.category live on their own paths.
const CATEGORIES: {
  id: string; latin: string; name: string; desc: string; href?: string
}[] = [
  { id: '主线',     latin: 'MAIN STORY',     name: '主线剧情', desc: '罗德岛主线故事' },
  { id: '支线',     latin: 'SIDE STORY',     name: '支线剧情', desc: '干员与势力的外传故事' },
  { id: '故事集',   latin: 'STORY SET',      name: '故事集',   desc: '活动与特别故事' },
  { id: '集成战略', latin: 'INTEGRATED STR.', name: '集成战略', desc: '集成战略随机剧情' },
  { id: '生息演算', latin: 'RECLAMATION',    name: '生息演算', desc: '生息演算剧情' },
  { id: '特殊',     latin: 'SPECIAL',        name: '特殊剧情', desc: '隐藏与特殊内容' },
  { id: '干员',     latin: 'OPERATOR',       name: '干员密录', desc: '干员个人故事档案' },
  { id: '家具',     latin: 'FURNITURE',      name: '家具图鉴', desc: '基建家具与装饰主题' },
  { id: '敌人',     latin: 'ENEMY',          name: '敌人图鉴', desc: '敌方单位与描述', href: '/enemies' },
  { id: '道具',     latin: 'ITEM',           name: '道具图鉴', desc: '材料、信物与凭证', href: '/items' },
]

export default function HomePage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem-1.75rem)] flex flex-col">
      {/* Hero */}
      <div className="relative flex flex-col items-center justify-center py-24 px-6 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.025]"
             style={{ backgroundImage: 'linear-gradient(var(--ark-accent) 1px, transparent 1px), linear-gradient(90deg, var(--ark-accent) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="absolute inset-0"
             style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 50%, transparent 30%, var(--ark-bg) 100%)' }} />

        <div className="relative flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-3 mb-4 font-mono text-[11px]">
            <div className="h-px w-12 bg-ark-accent" />
            <span className="tracking-[0.3em] text-ark-accent uppercase">Rhodes Island</span>
            <span className="text-ark-accent">{'//'}</span>
            <span className="tracking-[0.3em] text-ark-muted">PRTS.RECORDS</span>
            <div className="h-px w-12 bg-ark-accent" />
          </div>
          <h1 className="text-5xl font-thin tracking-[0.15em] text-ark-text">明日方舟</h1>
          <p className="text-lg tracking-[0.5em] text-ark-muted mt-1">剧情阅览</p>
        </div>
      </div>

      {/* Category grid */}
      <div className="flex-1 px-6 pb-16 max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-8 font-mono text-[11px]">
          <span className="text-ark-accent">[</span>
          <span className="tracking-widest text-ark-muted uppercase">INDEX</span>
          <span className="text-ark-accent">]</span>
          <span className="text-ark-accent">{'//'}</span>
          <span className="font-sans tracking-widest text-ark-muted">选择类别</span>
          <div className="flex-1 h-px bg-ark-border" />
          <span className="tracking-widest text-ark-muted">{CATEGORIES.length.toString().padStart(2, '0')} ENTRIES</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-ark-border">
          {CATEGORIES.map((cat, i) => (
            <Link
              key={cat.id}
              href={cat.href ?? `/${encodeURIComponent(cat.id)}`}
              className="group relative flex flex-col justify-between p-8 bg-ark-bg
                         hover:bg-ark-surface transition-colors duration-300 overflow-hidden min-h-40"
            >
              {/* Index number */}
              <span className="absolute top-4 right-5 text-6xl font-thin leading-none select-none
                               text-ark-border group-hover:text-ark-border/60 transition-colors duration-300">
                {(i + 1).toString().padStart(2, '0')}
              </span>

              <div className="relative">
                <p className="font-mono text-[10px] text-ark-muted tracking-widest mb-3 uppercase
                              group-hover:text-ark-accent transition-colors duration-300">
                  {cat.latin} <span className="text-ark-border">{'//'}</span> {cat.id}
                </p>
                <h2 className="text-xl font-light tracking-wide text-ark-text
                               group-hover:text-ark-accent-bright transition-colors duration-300">
                  {cat.name}
                </h2>
              </div>

              <p className="relative text-xs text-ark-muted mt-4 tracking-wide">{cat.desc}</p>

              {/* Bottom accent */}
              <div className="absolute bottom-0 left-0 h-0.5 w-0 bg-ark-accent
                              group-hover:w-full transition-all duration-300" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
