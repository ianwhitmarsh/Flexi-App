import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { palette } from '@/constants/theme';
import { SessionProvider, useSession } from '@/lib/session';
import type { Account } from '@/lib/types';

export const unstable_settings = { anchor: '(tabs)' };

function isOnboarded(account: Account | null) {
  if (!account?.role) return false;
  return account.role === 'worker' ? !!account.worker : !!account.business;
}

/** Redirects between auth → onboarding → app based on session state. */
function AuthGate() {
  const { account, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const root = segments[0] as string | undefined;
    const inAuth = root === '(auth)';
    const inOnboarding = root === 'onboarding';

    if (!account) {
      if (!inAuth) router.replace('/(auth)/welcome');
      return;
    }

    if (!isOnboarded(account)) {
      const target = !account.role
        ? '/onboarding/role'
        : account.role === 'worker'
          ? '/onboarding/worker'
          : '/onboarding/business';
      if (!inOnboarding) router.replace(target);
      return;
    }

    if (inAuth || inOnboarding || root === undefined) {
      router.replace('/(tabs)');
    }
  }, [account, loading, segments, router]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.bg,
        }}
      >
        <ActivityIndicator size="large" color={palette.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="match/[id]" />
      <Stack.Screen name="shift/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="shift/[id]/interested" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <StatusBar style="dark" />
          <AuthGate />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
