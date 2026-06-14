// Chapter URL segment: `<order_in_story>-<readable slug>`.
//
// Only the leading integer (order_in_story, unique within a story) is
// load-bearing — the resolver looks the chapter up by (story_id, order).
// The slug tail is decoration, so renaming a level never breaks an old link,
// and BEG/END pairs that share a level_code (e.g. `0-1 坍塌`) stay distinct
// because their order differs.

interface ChapterLike {
  order_in_story: number
  level_code: string | null
  level_name: string | null
}

export function chapterSlug(ch: ChapterLike): string {
  const name = [ch.level_code, ch.level_name].filter(Boolean).join('-')
  const slug = name
    .trim()
    .toLowerCase()                 // ASCII only; Chinese is untouched
    .replace(/[\s/\\]+/g, '-')     // whitespace + slashes → dash
    .replace(/[·:*?"<>|.]+/g, '-') // wiki punctuation → dash
    .replace(/-+/g, '-')           // collapse runs
    .replace(/^-|-$/g, '')         // trim
  return slug ? `${ch.order_in_story}-${slug}` : `${ch.order_in_story}`
}

/** Recover the order_in_story from a chapter URL segment (the leading int). */
export function parseChapterOrder(segment: string): number {
  return parseInt(segment, 10)
}
