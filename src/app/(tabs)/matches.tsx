import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, EmptyState, Screen } from '@/components/ui';
import { palette } from '@/constants/theme';
import { useSession } from '@/lib/session';
import type { Match } from '@/lib/types';
import { timeAgo } from '@/lib/util';

export default function Matches() {
  const router = useRouter();
  const { backend, account } = useSession();
  const isWorker = account?.role === 'worker';
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMatches(await backend.listMatches());
    } finally {
      setLoading(false);
    }
  }, [backend]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const counterpartName = (m: Match) =>
    isWorker ? m.business?.companyName ?? m.shift?.business?.companyName ?? 'Business' : m.worker?.fullName ?? 'Worker';

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.subtitle}>Your conversations about open shifts</Text>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={palette.primary} />
        </View>
      ) : matches.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="chatbubbles-outline"
            title="No conversations yet"
            subtitle={
              isWorker
                ? 'Swipe right on a shift you want. That opens a conversation with the employer, right here.'
                : 'When a worker shows interest in one of your shifts, the conversation opens here.'
            }
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {matches.map((m) => (
            <Pressable
              key={m.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push(`/match/${m.id}`)}
            >
              <Avatar name={counterpartName(m)} size={56} />
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.name} numberOfLines={1}>
                    {counterpartName(m)}
                  </Text>
                  <Text style={styles.time}>{timeAgo(m.lastMessageAt ?? m.createdAt)}</Text>
                </View>
                <Text style={styles.shift} numberOfLines={1}>
                  {m.shift?.title ?? 'Shift'}
                </Text>
                <Text style={styles.preview} numberOfLines={1}>
                  {m.lastMessage ?? 'Say hello 👋'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={palette.textFaint} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
  title: { fontSize: 28, fontWeight: '900', color: palette.text, letterSpacing: -0.6 },
  subtitle: { fontSize: 14, color: palette.textMuted, marginTop: 2 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: palette.card,
    borderRadius: 16,
    padding: 14,
  },
  rowPressed: { opacity: 0.7 },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '800', color: palette.text, flex: 1 },
  time: { fontSize: 12, color: palette.textFaint, fontWeight: '600' },
  shift: { fontSize: 13, color: palette.primaryDeep, fontWeight: '700' },
  preview: { fontSize: 14, color: palette.textMuted },
});
