/**
 * Design tokens for ShiftMatch.
 *
 * `Colors` powers the themed primitives (light/dark aware). `palette`, `radius`,
 * `shadow`, and `Spacing` are fixed brand tokens used directly by screens — the
 * app is designed light-first for a consistent swipe-deck look.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1A1D29',
    background: '#F4F5FA',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#EDEEF5',
    textSecondary: '#6B7280',
    border: '#E6E8F0',
  },
  dark: {
    text: '#F4F5FA',
    background: '#0E0F14',
    backgroundElement: '#1A1C22',
    backgroundSelected: '#23262E',
    textSecondary: '#9CA3AF',
    border: '#2A2D36',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Fixed brand palette — used directly across screens. */
export const palette = {
  primary: '#FD297B',
  primaryDeep: '#E01F69',
  /** Tinder-style hero gradient (orange → pink). */
  gradient: ['#FF7854', '#FD297B'] as const,
  gradientSoft: ['#FF9A6C', '#FD5B8F'] as const,

  like: '#2DD36F',
  likeDeep: '#1FB85C',
  pass: '#F1414E',
  passDeep: '#D8313D',
  superlike: '#3AB4F2',

  text: '#1A1D29',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  onPrimary: '#FFFFFF',

  bg: '#F4F5FA',
  card: '#FFFFFF',
  cardAlt: '#FAFAFC',
  border: '#E6E8F0',
  borderStrong: '#D5D8E4',

  chipBg: '#F0F1F8',
  chipText: '#4B5161',

  star: '#FBBF24',
  overlayDark: 'rgba(20,22,30,0.55)',
} as const;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', serif: 'ui-serif', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', serif: 'serif', rounded: 'normal', mono: 'monospace' },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
})!;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

export const shadow = {
  card: {
    shadowColor: '#1A1D29',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  soft: {
    shadowColor: '#1A1D29',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  button: {
    shadowColor: '#FD297B',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
