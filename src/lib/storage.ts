/**
 * Supabase Storage URL helpers.
 *
 * All image assets live in the public bucket `data`, with one subdirectory
 * per image kind. The DB stores only the SHA1 of the original relative path
 * (40 hex chars); this helper assembles the public URL.
 *
 *   stories.icon_sha1   →  data/story-icons/<sha1>.png
 *   stories.title_sha1  →  data/story-titles/<sha1>.png
 *   stories.cover_sha1  →  data/story-covers/<sha1>.png
 */

export type StoryImageKind = 'icon' | 'title' | 'cover'

const SUBDIR: Record<StoryImageKind, string> = {
  icon:  'story-icons',
  title: 'story-titles',
  cover: 'story-covers',
}

const BUCKET = 'data'

export function storyImageUrl(kind: StoryImageKind, sha1: string | null | undefined): string | null {
  if (!sha1) return null
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${SUBDIR[kind]}/${sha1}.png`
}
