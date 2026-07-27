import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { IconButton, Screen } from '@/components/ui';
import { BusinessProfileForm } from '@/features/BusinessProfileForm';
import { EmployerVoiceForm } from '@/features/EmployerVoiceForm';
import { palette } from '@/constants/theme';
import { useSession } from '@/lib/session';
import type { Business } from '@/lib/types';

export default function BusinessOnboarding() {
  const router = useRouter();
  const { refresh } = useSession();
  // The profile has to exist before the voice step can save against it, so this
  // is two steps rather than one long form. `refresh` only runs after the voice
  // step, so the AuthGate does not redirect out from under step two.
  const [saved, setSaved] = useState<Business | null>(null);

  if (saved) {
    return (
      <Screen>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.kicker}>Your voice</Text>
            <Text style={styles.title}>How should we talk to workers for you?</Text>
            <Text style={styles.sub}>
              Flexi writes the first message for you. This is all optional — skip it and we&apos;ll
              keep it simple.
            </Text>
            <View style={{ marginTop: 24 }}>
              <EmployerVoiceForm
                business={saved}
                ctaLabel="Save & post shifts"
                onSaved={refresh}
                onSkip={refresh}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <IconButton icon="chevron-back" onPress={() => router.back()} />
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.kicker}>Business profile</Text>
          <Text style={styles.title}>Tell workers about your business</Text>
          <Text style={styles.sub}>Workers see this when they swipe on your shifts.</Text>
          <View style={{ marginTop: 24 }}>
            <BusinessProfileForm
              ctaLabel="Continue"
              onSaved={setSaved}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 12, paddingTop: 4 },
  body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 48 },
  kicker: { color: palette.primary, fontWeight: '800', fontSize: 14 },
  title: { fontSize: 26, fontWeight: '900', color: palette.text, marginTop: 8, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: palette.textMuted, marginTop: 6, lineHeight: 21 },
});
