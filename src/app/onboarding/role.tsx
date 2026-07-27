import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui';
import { palette, radius, shadow } from '@/constants/theme';
import { useSession } from '@/lib/session';
import type { Role } from '@/lib/types';

const OPTIONS: {
  role: Role;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  blurb: string;
}[] = [
  {
    role: 'worker',
    icon: 'person',
    title: "I'm looking for shifts",
    blurb: 'Build a profile, upload your résumé, and swipe through open shifts near you.',
  },
  {
    role: 'business',
    icon: 'business',
    title: "I'm hiring for shifts",
    blurb: 'Post open shifts and swipe through interested local workers to fill them fast.',
  },
];

export default function RolePicker() {
  const router = useRouter();
  const { backend } = useSession();
  const [busy, setBusy] = useState<Role | null>(null);

  const choose = async (role: Role) => {
    setBusy(role);
    try {
      await backend.setRole(role);
    } catch {
      // role is also persisted when the profile is saved; safe to continue.
    }
    router.push(role === 'worker' ? '/onboarding/worker' : '/onboarding/business');
    setBusy(null);
  };

  return (
    <Screen>
      <View style={styles.body}>
        <Text style={styles.kicker}>Welcome to ShiftMatch</Text>
        <Text style={styles.title}>How do you want to use the app?</Text>
        <Text style={styles.sub}>You can switch later from your profile.</Text>

        <View style={styles.options}>
          {OPTIONS.map((o) => (
            <Pressable
              key={o.role}
              onPress={() => choose(o.role)}
              disabled={!!busy}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <LinearGradient
                colors={palette.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cardIcon}
              >
                <Ionicons name={o.icon} size={26} color="#fff" />
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{o.title}</Text>
                <Text style={styles.cardBlurb}>{o.blurb}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={palette.textFaint} />
            </Pressable>
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  kicker: { color: palette.primary, fontWeight: '800', fontSize: 14, letterSpacing: 0.4 },
  title: { fontSize: 28, fontWeight: '900', color: palette.text, marginTop: 8, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: palette.textMuted, marginTop: 6 },
  options: { gap: 16, marginTop: 32 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: palette.card,
    borderRadius: radius.lg,
    padding: 18,
    ...shadow.soft,
  },
  cardPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  cardIcon: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  cardBlurb: { fontSize: 13.5, color: palette.textMuted, marginTop: 4, lineHeight: 19 },
});
