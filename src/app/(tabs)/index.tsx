import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ShiftCard, WorkerCard } from '@/components/cards';
import { MatchModal } from '@/components/MatchModal';
import { OfferCard } from '@/components/OfferCard';
import { SwipeDeck, type SwipeDir } from '@/components/SwipeDeck';
import { Button, EmptyState, Screen } from '@/components/ui';
import { palette } from '@/constants/theme';
import { useSession } from '@/lib/session';
import type { Booking, InterestedWorker, Match, Offer, Shift } from '@/lib/types';
import { formatDate, formatTimeRange } from '@/lib/util';

export default function Discover() {
  const { account, backend, isLive } = useSession();
  const router = useRouter();
  const role = account?.role;

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [workers, setWorkers] = useState<InterestedWorker[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<Match | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (role === 'business') {
        setWorkers(await backend.businessDeck());
      } else {
        const [deck, myOffers, myBookings] = await Promise.all([
          backend.workerDeck(),
          backend.listMyOffers(),
          backend.listMyBookings(),
        ]);
        setShifts(deck);
        setOffers(myOffers);
        setBookings(myBookings);
      }
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

  const acceptOffer = async (offer: Offer) => {
    setAcceptingId(offer.id);
    try {
      const res = await backend.acceptOffer(offer.id);
      if (res.status === 'accepted') {
        Alert.alert("You're booked", `${offer.shift?.title ?? 'The shift'} is yours.`);
      } else if (res.status === 'filled') {
        Alert.alert('This shift was just filled', 'Another worker accepted it first.');
      } else {
        Alert.alert("You're already booked during this time", 'Free up that slot to take this one.');
      }
    } catch (e: any) {
      Alert.alert('Could not accept', e?.message ?? 'Something went wrong.');
    } finally {
      setAcceptingId(null);
      // Refresh either way: an accepted or filled offer is no longer live.
      await load();
    }
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

      {role !== 'business' && !loading && bookings.length > 0 && (
        <View style={styles.booked}>
          {bookings.map((b) => (
            <View key={b.id} style={styles.bookedRow}>
              <Ionicons name="checkmark-circle" size={18} color={palette.likeDeep} />
              <Text style={styles.bookedText} numberOfLines={1}>
                Booked: {b.shift?.title ?? 'Shift'}
                {b.shift ? ` · ${formatDate(b.shift.date)}, ${formatTimeRange(b.shift.startTime, b.shift.endTime)}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      {role !== 'business' && !loading && offers.length > 0 && (
        <View style={styles.offers}>
          <Text style={styles.offersHeading}>
            {offers.length === 1 ? 'You have an offer' : `You have ${offers.length} offers`}
          </Text>
          <ScrollView
            style={styles.offerScroll}
            contentContainerStyle={styles.offerList}
            showsVerticalScrollIndicator={false}
          >
            {offers.map((o) => (
              <OfferCard
                key={o.id}
                offer={o}
                busy={acceptingId === o.id}
                onAccept={() => acceptOffer(o)}
              />
            ))}
          </ScrollView>
        </View>
      )}

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
  demoPill: { backgroundColor: palette.tintPrimary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  demoText: { color: palette.primaryDeep, fontWeight: '800', fontSize: 12 },
  booked: { paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  bookedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.tintLike,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bookedText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: palette.likeDeep },
  offers: { paddingHorizontal: 16, paddingBottom: 4 },
  offersHeading: {
    fontSize: 12,
    fontWeight: '900',
    color: palette.primaryDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 2,
  },
  offerScroll: { maxHeight: 300 },
  offerList: { gap: 10, paddingBottom: 4 },
  deckArea: { flex: 1, paddingHorizontal: 16, paddingBottom: 8 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { alignItems: 'center' },
  refreshBtn: { marginTop: 8, minWidth: 160 },
});
