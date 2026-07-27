/**
 * Confirmation shown after a worker right-swipes a shift.
 *
 * Deliberately not a celebration: a like registers interest and opens a
 * conversation, it does not book anything and does not mean the employer
 * agreed. The copy avoids "match", "booked" and "confirmed" so nobody reads a
 * swipe as a commitment.
 */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, radius } from '@/constants/theme';
import type { Match } from '@/lib/types';

export function InterestSentModal({
  thread,
  onMessage,
  onKeepSwiping,
}: {
  thread: Match | null;
  onMessage: () => void;
  onKeepSwiping: () => void;
}) {
  const visible = !!thread;
  const businessName =
    thread?.business?.companyName ?? thread?.shift?.business?.companyName ?? 'the employer';
  const shiftTitle = thread?.shift?.title ?? 'this shift';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onKeepSwiping}>
      <LinearGradient
        colors={palette.gradient}
        locations={palette.gradientLocations}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.35 }}
        style={styles.fill}
      >
        <View style={styles.center}>
          <View style={styles.badge}>
            <Ionicons name="paper-plane" size={34} color={palette.onGradientText} />
          </View>

          <Text style={styles.heading}>Interest sent</Text>
          <Text style={styles.sub}>
            {businessName} can see you&apos;re interested in {shiftTitle}. You can message them now —
            they&apos;ll send an offer if it&apos;s a fit.
          </Text>

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              onPress={onMessage}
            >
              <Text style={styles.primaryText}>Send a message</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
              onPress={onKeepSwiping}
            >
              <Text style={styles.ghostText}>Keep swiping</Text>
            </Pressable>
          </View>
        </View>
      </LinearGradient>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  badge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: palette.onGradientStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heading: {
    fontSize: 34,
    fontWeight: '900',
    color: palette.onPrimary,
    letterSpacing: -0.8,
  },
  sub: {
    fontSize: 16,
    color: palette.onPrimary,
    opacity: 0.95,
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: 40,
  },
  actions: { alignSelf: 'stretch', gap: 12 },
  primary: {
    backgroundColor: palette.onGradientStrong,
    height: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: palette.onGradientText, fontSize: 16, fontWeight: '800' },
  ghost: { height: 50, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: palette.onPrimary, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
