/**
 * Design tokens for ShiftMatch.
 *
 * `Colors` powers the themed primitives (light/dark aware). `palette`, `radius`,
 * `shadow`, and `Spacing` are fixed brand tokens used directly by screens — the
 * app is designed light-first for a consistent swipe-deck look.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * The app is dark-only, matching the Flexi marketing site, so both schemes
 * resolve to the same values — a device set to light must not produce a
 * half-light UI.
 */
const scheme = {
  text: '#F2F3F8',
  background: '#0D0F1D',
  backgroundElement: '#151827',
  backgroundSelected: '#1B1F31',
  textSecondary: '#C9CCDD',
  border: 'rgba(255,255,255,0.07)',
} as const;

export const Colors = {
  light: scheme,
  dark: scheme,
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Fixed brand palette — used directly across screens.
 *
 * Values come from the Flexi marketing site's CSS custom properties; the
 * comment beside each accent is the site's token name.
 */
export const palette = {
  primary: '#FF3D8A', // --pulse
  /** --pulse-tint. Reads as the emphasis colour on dark surfaces. */
  primaryDeep: '#FF7FB2',

  /** The four brand accents, in gradient order. */
  flare: '#FFA03C',
  flareTint: '#FFB765',
  pulse: '#FF3D8A',
  pulseTint: '#FF7FB2',
  flux: '#8B5CF6',
  fluxTint: '#B0A6FA',
  current: '#3B6BFF',

  /** Signature gradient. Pass `gradientLocations` or the stops spread evenly. */
  gradient: ['#FFA03C', '#FF3D8A', '#8B5CF6', '#3B6BFF'] as const,
  gradientLocations: [0, 0.38, 0.68, 1] as const,
  /** CTA gradient — the site's "Get Flexi" button. */
  gradientCta: ['#FF3D8A', '#8B5CF6'] as const,
  gradientSoft: ['#FF7FB2', '#B0A6FA'] as const,

  like: '#2DD36F',
  likeDeep: '#4ADE80',
  pass: '#F1414E',
  passDeep: '#FF6B75',
  superlike: '#3B6BFF', // --current

  text: '#F2F3F8',
  textSecondary: '#C9CCDD',
  textMuted: '#9BA0B4',
  textFaint: '#6B7089',
  onPrimary: '#FFFFFF',

  bg: '#0D0F1D', // --ink
  card: '#151827', // --slate
  cardAlt: '#121422', // --surface-alt
  border: 'rgba(255,255,255,0.07)', // --hairline
  borderStrong: 'rgba(255,255,255,0.14)', // --hairline-strong

  chipBg: 'rgba(255,255,255,0.08)',
  chipText: '#C9CCDD',

  /**
   * Low-alpha accent washes. On dark these replace the old pale tints
   * (#FFE7F0, #FFF5F8, #E3F9ED), which read as light blocks.
   */
  tintPrimary: 'rgba(255,61,138,0.16)',
  tintPrimarySoft: 'rgba(255,61,138,0.10)',
  tintLike: 'rgba(45,211,111,0.15)',
  /**
   * Surfaces that sit on top of a gradient rather than on the page. These stay
   * light on purpose — the gradient is the background there, not `bg`.
   */
  onGradientSurface: 'rgba(255,255,255,0.16)',
  onGradientStrong: 'rgba(255,255,255,0.95)',
  onGradientBorder: 'rgba(255,255,255,0.7)',

  star: '#FBBF24',
  overlayDark: 'rgba(5,6,14,0.72)',
  shadow: '#000000',
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

/**
 * On a #0D0F1D page a soft grey shadow is invisible, so elevation comes
 * primarily from surface lightness (--slate on --ink) plus `hairline`
 * borders, the way the site does it. These are deeper and tighter than the
 * light-mode values they replace, and exist mainly to separate a floating
 * card from the page rather than to imply height.
 */
export const shadow = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  soft: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  /** Coloured glow — the one place a shadow reads as light on dark. */
  button: {
    shadowColor: '#FF3D8A',
    shadowOpacity: 0.38,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

/** Borders are how surfaces separate on dark. */
export const hairline = {
  borderWidth: 1,
  borderColor: palette.border,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
