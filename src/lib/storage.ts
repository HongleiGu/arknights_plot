/**
 * Cloudflare R2 Storage URL helpers.
 *
 * All image assets live in the R2 bucket `arknights-assets`, with one
 * subdirectory per image kind. The DB stores only the SHA1 of the original
 * relative path (40 hex chars); this helper assembles the public URL.
 *
 *   stories.icon_sha1   →  story-icons/<sha1>.png
 *   stories.title_sha1  →  story-titles/<sha1>.png
 *   stories.cover_sha1  →  story-covers/<sha1>.png
 *   gadgets.icon_sha1   →  gadget-icons/<sha1>.png
 */

export type StoryImageKind = 'icon' | 'title' | 'cover'

const SUBDIR: Record<StoryImageKind, string> = {
  icon:  'story-icons',
  title: 'story-titles',
  cover: 'story-covers',
}

const R2 = process.env.NEXT_PUBLIC_R2_PUBLIC_URL

export function storyImageUrl(kind: StoryImageKind, sha1: string | null | undefined): string | null {
  if (!sha1) return null
  return `${R2}/${SUBDIR[kind]}/${sha1}.png`
}

/** gadgets.icon_sha1 → public URL (gadget-icons/<sha1>.png). */
export function gadgetIconUrl(sha1: string | null | undefined): string | null {
  if (!sha1) return null
  return `${R2}/gadget-icons/${sha1}.png`
}

/** text_clusters.image_sha1 → public URL (ending-images/<sha1>.png). */
export function endingImageUrl(sha1: string | null | undefined): string | null {
  if (!sha1) return null
  return `${R2}/ending-images/${sha1}.png`
}

/** furniture_themes/furniture_items.icon_sha1 → public URL (furniture-icons/<sha1>.png). */
export function furnitureIconUrl(sha1: string | null | undefined): string | null {
  if (!sha1) return null
  return `${R2}/furniture-icons/${sha1}.png`
}

/** enemies.icon_sha1 → public URL (enemy-icons/<sha1>.png). */
export function enemyIconUrl(sha1: string | null | undefined): string | null {
  if (!sha1) return null
  return `${R2}/enemy-icons/${sha1}.png`
}

/** items.icon_sha1 → public URL (item-icons/<sha1>.png). */
export function itemIconUrl(sha1: string | null | undefined): string | null {
  if (!sha1) return null
  return `${R2}/item-icons/${sha1}.png`
}
