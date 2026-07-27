import { Ionicons } from '@expo/vector-icons';
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
          <View style={styles.logoBadge}>
            <Ionicons name="flash" size={40} color={palette.primary} />
          </View>
          <Text style={styles.wordmark}>ShiftMatch</Text>
          <Text style={styles.tagline}>Swipe into your next shift.</Text>
          <Text style={styles.sub}>
            Local gigs and open shifts, matched to your skills. Workers swipe, businesses swipe
            back — when you both like, it&apos;s a match.
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
  logoBadge: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: palette.onGradientStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  wordmark: { fontSize: 40, fontWeight: '900', color: palette.onPrimary, letterSpacing: -1 },
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
