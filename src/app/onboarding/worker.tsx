import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { IconButton, Screen } from '@/components/ui';
import { WorkerProfileForm } from '@/features/WorkerProfileForm';
import { palette } from '@/constants/theme';
import { useSession } from '@/lib/session';

export default function WorkerOnboarding() {
  const router = useRouter();
  const { refresh } = useSession();

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <IconButton icon="chevron-back" onPress={() => router.back()} />
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.kicker}>Worker profile</Text>
          <Text style={styles.title}>Show businesses who you are</Text>
          <Text style={styles.sub}>This is the card businesses see when you swipe on a shift.</Text>
          <View style={{ marginTop: 24 }}>
            <WorkerProfileForm onSaved={refresh} />
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
