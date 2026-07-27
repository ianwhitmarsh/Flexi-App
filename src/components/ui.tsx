/** Shared UI primitives for Flexi. */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { hairline, palette, radius, shadow, Spacing } from '@/constants/theme';

export function Screen({
  children,
  style,
  edges = ['top', 'bottom'],
}: {
  children: ReactNode;
  style?: ViewStyle;
  edges?: Edge[];
}) {
  return (
    <SafeAreaView edges={edges} style={[styles.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}) {
  const isPrimary = variant === 'primary';
  const content = (
    <View style={styles.btnRow}>
      {loading ? (
        <ActivityIndicator color={isPrimary ? palette.onPrimary : palette.primary} />
      ) : (
        <>
          {icon && (
            <Ionicons
              name={icon}
              size={18}
              color={isPrimary ? palette.onPrimary : palette.primary}
            />
          )}
          <Text
            style={[
              styles.btnText,
              isPrimary ? styles.btnTextPrimary : styles.btnTextSecondary,
              variant === 'ghost' && styles.btnTextGhost,
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </View>
  );

  const pressable = (inner: ReactNode, extra?: ViewStyle) => (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        extra,
        (disabled || loading) && styles.btnDisabled,
        pressed && styles.btnPressed,
      ]}
    >
      {inner}
    </Pressable>
  );

  if (isPrimary) {
    return (
      <View style={[shadow.button, { borderRadius: radius.pill }, style]}>
        <Pressable
          onPress={onPress}
          disabled={disabled || loading}
          style={({ pressed }) => [
            { borderRadius: radius.pill, overflow: 'hidden' },
            (disabled || loading) && styles.btnDisabled,
            pressed && styles.btnPressed,
          ]}
        >
          <LinearGradient
            colors={palette.gradientCta}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.3 }}
            style={styles.btn}
          >
            {content}
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={style}>
      {pressable(content, variant === 'secondary' ? styles.btnSecondary : styles.btnGhost)}
    </View>
  );
}

export function Field({
  label,
  hint,
  style,
  ...props
}: TextInputProps & { label?: string; hint?: string; style?: ViewStyle }) {
  return (
    <View style={[styles.fieldWrap, style]}>
      {label && <Text style={styles.fieldLabel}>{label}</Text>}
      <TextInput
        placeholderTextColor={palette.textFaint}
        style={[styles.input, props.multiline && styles.inputMultiline]}
        {...props}
      />
      {hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const Comp: any = onPress ? Pressable : View;
  return (
    <Comp
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={13}
          color={selected ? palette.onPrimary : palette.chipText}
          style={{ marginRight: 4 }}
        />
      )}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Comp>
  );
}

export function Avatar({ name, size = 56, url }: { name: string; size?: number; url?: string }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <LinearGradient
      colors={palette.gradientSoft}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: palette.onPrimary, fontWeight: '800', fontSize: size * 0.36 }}>
        {initials || '?'}
      </Text>
    </LinearGradient>
  );
}

export function IconButton({
  icon,
  onPress,
  color = palette.text,
  size = 22,
  bg,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  color?: string;
  size?: number;
  bg?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconBtn,
        bg ? { backgroundColor: bg } : null,
        pressed && { opacity: 0.6 },
      ]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={34} color={palette.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle && <Text style={styles.emptySub}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  btn: {
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnSecondary: { backgroundColor: palette.card, borderWidth: 1.5, borderColor: palette.border },
  btnGhost: { backgroundColor: 'transparent' },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  btnText: { fontSize: 16, fontWeight: '700' },
  btnTextPrimary: { color: palette.onPrimary },
  btnTextSecondary: { color: palette.text },
  btnTextGhost: { color: palette.primary },

  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: palette.textMuted, marginLeft: 2 },
  fieldHint: { fontSize: 12, color: palette.textFaint, marginLeft: 2 },
  input: {
    backgroundColor: palette.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: palette.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: palette.text,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.chipBg,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  chipSelected: { backgroundColor: palette.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: palette.chipText },
  chipTextSelected: { color: palette.onPrimary },

  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: palette.card,
    borderRadius: radius.lg,
    padding: Spacing.three,
    // On dark, the border does most of the separating; the shadow only
    // lifts the card off the page.
    ...hairline,
    ...shadow.soft,
  },
  empty: { alignItems: 'center', justifyContent: 'center', padding: Spacing.five, gap: 10 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: palette.tintPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: palette.text, textAlign: 'center' },
  emptySub: {
    fontSize: 14,
    color: palette.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
});
