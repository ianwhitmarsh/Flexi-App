import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, EmptyState, Screen } from '@/components/ui';
import { palette, radius } from '@/constants/theme';
import { useSession } from '@/lib/session';
import type { Shift } from '@/lib/types';
import { formatDate, formatTimeRange } from '@/lib/util';

export default function MyShifts() {
  const router = useRouter();
  const { backend } = useSession();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setShifts(await backend.myShifts());
    } finally {
      setLoading(false);
    }
  }, [backend]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const close = async (id: string) => {
    await backend.closeShift(id);
    load();
  };

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>My Shifts</Text>
          <Text style={styles.subtitle}>Manage your open postings</Text>
        </View>
        <Pressable style={styles.addBtn} onPress={() => router.push('/shift/new')}>
          <Ionicons name="add" size={24} color="#fff" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={palette.primary} />
        </View>
      ) : shifts.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="briefcase-outline"
            title="No shifts yet"
            subtitle="Post your first open shift and start matching with local workers."
          />
          <Button title="Post a shift" icon="add-circle" onPress={() => router.push('/shift/new')} style={styles.cta} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {shifts.map((s) => (
            <Card key={s.id} style={styles.shiftCard}>
              <View style={styles.shiftTop}>
                <Text style={styles.shiftTitle} numberOfLines={1}>
                  {s.title}
                </Text>
                <View style={[styles.status, s.status === 'open' ? styles.statusOpen : styles.statusClosed]}>
                  <Text style={[styles.statusText, s.status === 'open' ? styles.statusTextOpen : styles.statusTextClosed]}>
                    {s.status}
                  </Text>
                </View>
              </View>
              <Text style={styles.pay}>
                ${s.payRate}/{s.payType} · {s.role}
              </Text>
              {s.fillMode === 'race' && (
                <View style={styles.raceBadge}>
                  <Ionicons name="flash" size={12} color={palette.primaryDeep} />
                  <Text style={styles.raceText}>Fastest fill</Text>
                </View>
              )}
              <View style={styles.metaRow}>
                <Ionicons name="calendar" size={14} color={palette.textMuted} />
                <Text style={styles.meta}>{formatDate(s.date)}</Text>
                <Ionicons name="time" size={14} color={palette.textMuted} style={{ marginLeft: 10 }} />
                <Text style={styles.meta}>{formatTimeRange(s.startTime, s.endTime)}</Text>
              </View>
              {s.status === 'open' && s.fillMode === 'race' && (
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/shift/[id]/interested', params: { id: s.id } })
                  }
                  style={styles.interestedBtn}
                >
                  <Ionicons name="people" size={15} color={palette.primary} />
                  <Text style={styles.interestedText}>Interested workers</Text>
                  <Ionicons name="chevron-forward" size={15} color={palette.primary} />
                </Pressable>
              )}
              {s.status === 'open' && (
                <Pressable onPress={() => close(s.id)} style={styles.closeBtn}>
                  <Ionicons name="lock-closed-outline" size={15} color={palette.textMuted} />
                  <Text style={styles.closeText}>Close shift</Text>
                </Pressable>
              )}
            </Card>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  title: { fontSize: 28, fontWeight: '900', color: palette.text, letterSpacing: -0.6 },
  subtitle: { fontSize: 14, color: palette.textMuted, marginTop: 2 },
  addBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cta: { marginHorizontal: 40, marginTop: 8 },
  list: { padding: 16, gap: 12 },
  shiftCard: { gap: 6 },
  shiftTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  shiftTitle: { fontSize: 17, fontWeight: '800', color: palette.text, flex: 1 },
  status: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  statusOpen: { backgroundColor: '#E3F9ED' },
  statusClosed: { backgroundColor: palette.chipBg },
  statusText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  statusTextOpen: { color: palette.likeDeep },
  statusTextClosed: { color: palette.textMuted },
  pay: { fontSize: 14.5, fontWeight: '700', color: palette.primaryDeep },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  meta: { fontSize: 13, color: palette.textMuted, fontWeight: '600' },
  raceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#FFE7F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  raceText: { fontSize: 11.5, fontWeight: '800', color: palette.primaryDeep },
  interestedBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  interestedText: { fontSize: 13.5, color: palette.primary, fontWeight: '800', flex: 1 },
  closeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  closeText: { fontSize: 13.5, color: palette.textMuted, fontWeight: '700' },
});
