import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ShiftCard, WorkerCard } from '@/components/cards';
import { MatchModal } from '@/components/MatchModal';
import { SwipeDeck, type SwipeDir } from '@/components/SwipeDeck';
import { Button, EmptyState, Screen } from '@/components/ui';
import { palette } from '@/constants/theme';
import { useSession } from '@/lib/session';
import type { InterestedWorker, Match, Shift } from '@/lib/types';

export default function Discover() {
  const { account, backend, isLive } = useSession();
  const router = useRouter();
  const role = account?.role;

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [workers, setWorkers] = useState<InterestedWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<Match | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (role === 'business') setWorkers(await backend.businessDeck());
      else setShifts(await backend.workerDeck());
    } finally {
      setLoading(false);
    }
  }, [backend, role]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onShiftSwipe = async (shift: Shift, dir: SwipeDir) => {
    const res = await backend.swipeShift(shift.id, dir);
    if (res.matched && res.match) setMatch(res.match);
  };
  const onWorkerSwipe = async (card: InterestedWorker, dir: SwipeDir) => {
    const res = await backend.swipeWorker(card.shift.id, card.worker.id, dir);
    if (res.matched && res.match) setMatch(res.match);
  };

  const goToMatch = () => {
    const id = match?.id;
    setMatch(null);
    if (id) router.push(`/match/${id}`);
  };

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{role === 'business' ? 'Applicants' : 'Discover'}</Text>
          <Text style={styles.subtitle}>
            {role === 'business' ? 'Workers who liked your shifts' : 'Open shifts near you'}
          </Text>
        </View>
        {!isLive && (
          <View style={styles.demoPill}>
            <Text style={styles.demoText}>Demo</Text>
          </View>
        )}
      </View>

      <View style={styles.deckArea}>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={palette.primary} />
          </View>
        ) : role === 'business' ? (
          <SwipeDeck<InterestedWorker>
            data={workers}
            keyExtractor={(c) => `${c.shift.id}:${c.worker.id}`}
            renderCard={(c) => <WorkerCard card={c} />}
            onSwipe={onWorkerSwipe}
            renderEmpty={() => (
              <EmptyState
                icon="people-outline"
                title="No applicants yet"
                subtitle="When workers swipe on your open shifts, they'll show up here to review. Post more shifts to get seen."
              />
            )}
          />
        ) : (
          <SwipeDeck<Shift>
            data={shifts}
            keyExtractor={(s) => s.id}
            renderCard={(s) => <ShiftCard shift={s} />}
            onSwipe={onShiftSwipe}
            renderEmpty={() => (
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon="checkmark-done-outline"
                  title="You're all caught up"
                  subtitle="You've seen every open shift for now. Check back soon — new shifts get posted all the time."
                />
                <Button title="Refresh" variant="secondary" icon="refresh" onPress={load} style={styles.refreshBtn} />
              </View>
            )}
          />
        )}
      </View>

      <MatchModal match={match} onMessage={goToMatch} onKeepSwiping={() => setMatch(null)} />
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
  demoPill: { backgroundColor: '#FFE7F0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  demoText: { color: palette.primaryDeep, fontWeight: '800', fontSize: 12 },
  deckArea: { flex: 1, paddingHorizontal: 16, paddingBottom: 8 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { alignItems: 'center' },
  refreshBtn: { marginTop: 8, minWidth: 160 },
});
