/**
 * Agent personality enums — mirrors of Prisma enums.
 *
 * `ProfileType` = restaurant archetype (drives system prompt + TTS voice defaults).
 * `FillerStyle` = how the agent handles silence/hesitation ("euh", "donc", etc.).
 *
 * Source of truth: `packages/database/prisma/schema.prisma`.
 */

export const PROFILE_TYPE_VALUES = [
  'BISTROT_BRASSERIE',
  'GASTRONOMIQUE',
  'SEMI_GASTRO',
] as const;
export type ProfileType = (typeof PROFILE_TYPE_VALUES)[number];

export const PROFILE_TYPE_LABELS: Record<ProfileType, string> = {
  BISTROT_BRASSERIE: 'Bistrot / Brasserie',
  GASTRONOMIQUE: 'Gastronomique',
  SEMI_GASTRO: 'Semi-gastro',
};

export const FILLER_STYLE_VALUES = ['CASUAL', 'FORMAL', 'WARM'] as const;
export type FillerStyle = (typeof FILLER_STYLE_VALUES)[number];

export const FILLER_STYLE_LABELS: Record<FillerStyle, string> = {
  CASUAL: 'Décontracté',
  FORMAL: 'Soutenu',
  WARM: 'Chaleureux',
};
