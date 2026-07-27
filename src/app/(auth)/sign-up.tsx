import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Field, IconButton, Screen } from '@/components/ui';
import { palette } from '@/constants/theme';
import { useSession } from '@/lib/session';

export default function SignUp() {
  const router = useRouter();
  const { signUp } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.includes('@') || password.length < 6) {
      setError('Enter a valid email and a password of at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      await signUp(email, password);
      // AuthGate routes to onboarding next.
    } catch (e: any) {
      setError(e?.message ?? 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <IconButton icon="chevron-back" onPress={() => router.back()} />
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>One account works for both finding shifts and posting them.</Text>

          <View style={styles.form}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="you@example.com"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 6 characters"
              hint="Use 6 or more characters."
            />
            {error && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle" size={16} color={palette.pass} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            <Button title="Continue" onPress={submit} loading={busy} />
          </View>

          <Pressable onPress={() => router.replace('/(auth)/sign-in')} style={styles.switch}>
            <Text style={styles.switchText}>
              Already have an account? <Text style={styles.switchLink}>Sign in</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 12, paddingTop: 4 },
  body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 40, gap: 8 },
  title: { fontSize: 28, fontWeight: '900', color: palette.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: palette.textMuted, lineHeight: 21, marginTop: 2 },
  form: { gap: 16, marginTop: 24 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { color: palette.pass, fontSize: 13, flex: 1 },
  switch: { marginTop: 24, alignItems: 'center' },
  switchText: { color: palette.textMuted, fontSize: 15 },
  switchLink: { color: palette.primary, fontWeight: '800' },
});
