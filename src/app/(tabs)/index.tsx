import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ShiftCard } from '@/components/cards';
import { InterestSentModal } from '@/components/InterestSentModal';
import { OfferCard } from '@/components/OfferCard';
import { SwipeDeck, type SwipeDir } from '@/components/SwipeDeck';
import { Avatar, Button, EmptyState, Screen } from '@/components/ui';
import { palette, radius } from '@/constants/theme';
import { useSession } from '@/lib/session';
import type { Booking, InterestedWorker, Match, Offer, Shift } from '@/lib/types';
import { formatDate, formatTimeRange } from '@/lib/util';

/** Interested workers bucketed under the shift they liked, newest shift first. */
function groupByShift(rows: InterestedWorker[]) {
  const groups = new Map<string, { shift: Shift; rows: InterestedWorker[] }>();
  for (const row of rows) {
    const existing = groups.get(row.shift.id);
    if (existing) existing.rows.push(row);
    else groups.set(row.shift.id, { shift: row.shift, rows: [row] });
  }
  return [...groups.values()];
}

export default function Discover() {
  const { account, backend, isLive } = useSession();
  const router = useRouter();
  const role = account?.role;

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [interested, setInterested] = useState<InterestedWorker[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [thread, setThread] = useState<Match | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (role === 'business') {
        setInterested(await backend.listInterested());
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

  const groups = useMemo(() => groupByShift(interested), [interested]);

  const onShiftSwipe = async (shift: Shift, dir: SwipeDir) => {
    const res = await backend.swipeShift(shift.id, dir);
    if (res.interested && res.thread) setThread(res.thread);
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

  const declineOffer = async (offer: Offer) => {
    setAcceptingId(offer.id);
    try {
      await backend.declineOffer(offer.id);
    } catch (e: any) {
      Alert.alert('Could not decline', e?.message ?? 'Something went wrong.');
    } finally {
      setAcceptingId(null);
      // The declined offer is no longer live, so the list has to be re-read.
      await load();
    }
  };

  const openThread = () => {
    const id = thread?.id;
    setThread(null);
    if (id) router.push(`/match/${id}`);
  };

  const messageWorker = (card: InterestedWorker) => {
    if (card.threadId) router.push(`/match/${card.threadId}`);
    else Alert.alert('No conversation yet', 'This conversation could not be opened. Pull to refresh and try again.');
  };

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{role === 'business' ? 'Interested' : 'Discover'}</Text>
          <Text style={styles.subtitle}>
            {role === 'business' ? 'Workers who want your shifts' : 'Open shifts near you'}
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
                onDecline={() => declineOffer(o)}
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
          groups.length === 0 ? (
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <EmptyState
                icon="people-outline"
                title="Nobody interested yet"
                subtitle="When workers swipe right on your open shifts they'll show up here, grouped by shift. Post more shifts to get seen."
              />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.groupList} showsVerticalScrollIndicator={false}>
              {groups.map(({ shift, rows }) => (
                <View key={shift.id} style={styles.group}>
                  <View style={styles.groupHeader}>
                    <Text style={styles.groupTitle} numberOfLines={1}>
                      {shift.title}
                    </Text>
                    <Text style={styles.groupMeta}>
                      {formatDate(shift.date)} · {rows.length} interested
                    </Text>
                  </View>

                  {rows.map((card) => (
                    <Pressable
                      key={`${shift.id}:${card.worker.id}`}
                      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                      onPress={() => router.push(`/worker/${card.worker.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${card.worker.fullName}'s profile`}
                    >
                      <Avatar name={card.worker.fullName} size={46} />
                      <View style={styles.rowBody}>
                        <Text style={styles.name} numberOfLines={1}>
                          {card.worker.fullName}
                        </Text>
                        {card.worker.headline ? (
                          <Text style={styles.headline} numberOfLines={1}>
                            {card.worker.headline}
                          </Text>
                        ) : null}
                        <Text style={styles.years}>
                          {card.worker.yearsExperience} yr
                          {card.worker.yearsExperience === 1 ? '' : 's'} experience
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => messageWorker(card)}
                        style={({ pressed }) => [styles.messageBtn, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Message ${card.worker.fullName}`}
                      >
                        <Ionicons name="chatbubble-ellipses" size={16} color={palette.onGradientText} />
                        <Text style={styles.messageText}>Message</Text>
                      </Pressable>
                    </Pressable>
                  ))}

                  <Button
                    title="Send offer"
                    variant="secondary"
                    icon="paper-plane"
                    onPress={() => router.push(`/shift/${shift.id}/interested`)}
                    style={styles.offerBtn}
                  />
                </View>
              ))}
            </ScrollView>
          )
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

      <InterestSentModal thread={thread} onMessage={openThread} onKeepSwiping={() => setThread(null)} />
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

  // ---- employer Interested queue ----
  groupList: { paddingBottom: 16, gap: 16 },
  group: { backgroundColor: palette.card, borderRadius: radius.lg, padding: 14, gap: 10 },
  groupHeader: { gap: 2 },
  groupTitle: { fontSize: 17, fontWeight: '900', color: palette.text, letterSpacing: -0.3 },
  groupMeta: { fontSize: 12.5, color: palette.textMuted, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowPressed: { opacity: 0.7 },
  rowBody: { flex: 1, gap: 1 },
  name: { fontSize: 15.5, fontWeight: '800', color: palette.text },
  headline: { fontSize: 13, color: palette.textMuted },
  years: { fontSize: 12.5, color: palette.textFaint, fontWeight: '600' },
  messageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.primary,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  messageText: { color: palette.onGradientText, fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  offerBtn: { marginTop: 2 },
});
