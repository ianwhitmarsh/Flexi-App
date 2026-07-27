/** Full-screen "It's a match!" celebration overlay. */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui';
import { palette, radius } from '@/constants/theme';
import type { Match } from '@/lib/types';

export function MatchModal({
  match,
  onMessage,
  onKeepSwiping,
}: {
  match: Match | null;
  onMessage: () => void;
  onKeepSwiping: () => void;
}) {
  const visible = !!match;
  const workerName = match?.worker?.fullName ?? 'You';
  const businessName = match?.business?.companyName ?? match?.shift?.business?.companyName ?? 'Business';
  const shiftTitle = match?.shift?.title ?? 'this shift';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onKeepSwiping}>
      <LinearGradient colors={palette.gradient} locations={palette.gradientLocations} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.35 }} style={styles.fill}>
        <View style={styles.center}>
          <Text style={styles.matchWord}>It&apos;s a match!</Text>
          <Text style={styles.sub}>
            You and {businessName} both liked it. Say hi about {shiftTitle}.
          </Text>

          <View style={styles.avatars}>
            <Avatar name={workerName} size={92} />
            <View style={styles.heart}>
              <Ionicons name="heart" size={26} color={palette.primary} />
            </View>
            <Avatar name={businessName} size={92} />
          </View>

          <View style={styles.actions}>
            <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={onMessage}>
              <Text style={styles.primaryText}>Send a message</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.ghost, pressed && styles.pressed]} onPress={onKeepSwiping}>
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
  matchWord: { fontSize: 40, fontWeight: '900', color: palette.onPrimary, letterSpacing: -1, fontStyle: 'italic' },
  sub: { fontSize: 16, color: palette.onPrimary, opacity: 0.95, textAlign: 'center', lineHeight: 23, marginBottom: 24 },
  avatars: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 40 },
  heart: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.onGradientStrong,
    alignItems: 'center',
    justifyContent: 'center',
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
