// Shared vocabulary for the world graph (migration 044).
//
// This is a plain module, NOT part of `app/actions/entities.ts`, because a
// `'use server'` file may only export async functions — Next does not merely
// warn, it treats the whole module as having no exports, so one `export const`
// takes every server action in the file down with it. That is exactly how
// `actions/descriptions.ts` broke the build with `export const MANUAL_SOURCE`.
// Constants and types therefore live here and are imported by both the actions
// and the client components.

export const IDENTITIES = ['unverified', 'named', 'scoped', 'device'] as const
export const REVIEWS = ['none', 'suspicious', 'reviewed'] as const

export type Identity = (typeof IDENTITIES)[number]
export type Review = (typeof REVIEWS)[number]

/**
 * What the three judgements mean. Measured over all 715 stories: 6,889 distinct
 * speakers, 5,633 of them in exactly one story.
 *
 *  named   a real person, globally unique — 塔露拉 (17 stories, 1,605 lines),
 *          魏彦吾, 特蕾西娅. They are not operators, which is not the same as not
 *          being characters.
 *  scoped  a real being with no name given, so identity holds only inside one
 *          story — 医疗干员 speaks in 44 of them and is 44 different people.
 *  device  not an entity at all — 众人 is a chorus, 父亲 is a different man each
 *          time, 广播 is a loudspeaker.
 */
export const IDENTITY_LABEL: Record<Identity, string> = {
  unverified: '未判定',
  named: '具名',
  scoped: '泛指',
  device: '非人物',
}

export interface ReviewRow {
  id: number
  type: string
  name: string
  nameEn: string | null
  aliases: string[]
  identity: Identity
  review: Review
  reviewNote: string | null
  mentionCount: number
  hasSummary: boolean
}

export interface EvidenceStory {
  storyId: number
  storyName: string
  category: string
  lines: number
  samples: string[]
}

/** One story's review state, from `story_review_progress()` (045). */
export interface StoryProgress {
  storyId: number
  storyName: string
  category: string
  speakers: number
  unresolved: number
  lines: number
}

/**
 * One speaker inside one story — the unit review actually works on.
 *
 * Review is per story because name similarity ACROSS stories is where
 * coincidence lives: 安娜 is not 薇薇安娜 and 瑟琳 is not 凯瑟琳, and a rule that
 * pairs them by spelling produces confident mistakes. Inside one story the cast
 * is a few dozen names, and "is 模糊的声音 someone who also speaks here" is
 * answerable by reading it.
 *
 * `linesHere` vs `linesTotal` is the one comparison that matters for judging:
 * a name with 40 lines here and 40 in total belongs to this story, while 医疗干员
 * with 14 here and 634 across 44 stories is a role every story reuses.
 */
export interface CastRow {
  /** NULL when the speaker has no entity row at all — itself worth seeing. */
  entityId: number | null
  name: string
  linesHere: number
  linesTotal: number
  storiesTotal: number | null
  identity: Identity | null
  review: Review | null
  reviewNote: string | null
  /**
   * Whether the game keeps its own 人员档案 for this name. The documentary
   * discriminator for merge-vs-link, and the only part of alias detection that
   * is NOT name-based: if a separate official record exists, it is a separate
   * record, so link as 同一人 rather than merging one away.
   */
  hasRecord: boolean
  samples: string[]
}
