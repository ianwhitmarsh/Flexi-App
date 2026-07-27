import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette, radius } from '@/constants/theme';
import { useSession } from '@/lib/session';

export default function Welcome() {
  const router = useRouter();
  const { isLive } = useSession();

  return (
    <LinearGradient colors={palette.gradient} locations={palette.gradientLocations} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.35 }} style={styles.fill}>
      <SafeAreaView style={styles.fill}>
        <View style={styles.hero}>
          <Image
            source={require('@/../assets/images/flexi-lockup.webp')}
            style={styles.lockup}
            contentFit="contain"
            accessibilityLabel="Flexi"
          />
          <Text style={styles.tagline}>Swipe into your next shift.</Text>
          <Text style={styles.sub}>
            Local gigs and open shifts, picked for your skills. Swipe right on the ones you want —
            the employer sees your interest and can offer you the shift.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            onPress={() => router.push('/(auth)/sign-up')}
          >
            <Text style={styles.primaryText}>Create account</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
            onPress={() => router.push('/(auth)/sign-in')}
          >
            <Text style={styles.secondaryText}>I already have an account</Text>
          </Pressable>
          {!isLive && (
            <Text style={styles.demoNote}>
              Demo mode — sign up with any email & password to explore.
            </Text>
          )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: 12 },
  /**
   * The brand lockup ships without an alpha channel — its background is baked
   * in as `--ink` — so it is given the same rounded-card treatment the logo
   * chip had rather than being floated directly on the gradient.
   */
  lockup: {
    width: 232,
    height: 102,
    borderRadius: radius.lg,
    marginBottom: 12,
  },
  tagline: { fontSize: 19, fontWeight: '700', color: palette.onPrimary, opacity: 0.95 },
  sub: {
    fontSize: 15,
    color: palette.onPrimary,
    opacity: 0.9,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 6,
  },
  actions: { paddingHorizontal: 24, paddingBottom: 16, gap: 12 },
  primaryBtn: {
    backgroundColor: palette.onGradientStrong,
    height: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: palette.onGradientText, fontSize: 16, fontWeight: '800' },
  secondaryBtn: {
    height: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: palette.onGradientBorder,
  },
  secondaryText: { color: palette.onPrimary, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  demoNote: { color: palette.onPrimary, opacity: 0.85, fontSize: 13, textAlign: 'center', marginTop: 4 },
});
