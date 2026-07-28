/**
 * The Interested queue for one shift: every worker who liked it, with
 * multi-select so the employer can offer the shift to several at once.
 */

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button, Card, EmptyState, IconButton, Screen } from '@/components/ui';
import { palette, radius } from '@/constants/theme';
import { MAX_OFFERS_PER_BATCH } from '@/lib/backend';
import { useSession } from '@/lib/session';
import type { InterestedWorker, Shift } from '@/lib/types';
import { formatDate, formatRate, formatTimeRange } from '@/lib/util';

export default function InterestedQueue() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { backend } = useSession();

  const [shift, setShift] = useState<Shift | null>(null);
  const [cards, setCards] = useState<InterestedWorker[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mine, interested] = await Promise.all([
        backend.myShifts(),
        backend.interestedWorkers(id),
      ]);
      setShift(mine.find((s) => s.id === id) ?? null);
      setCards(interested);
    } finally {
      setLoading(false);
    }
  }, [backend, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const atCap = selected.length >= MAX_OFFERS_PER_BATCH;

  const toggle = (workerId: string) => {
    setSelected((prev) => {
      if (prev.includes(workerId)) return prev.filter((w) => w !== workerId);
      if (prev.length >= MAX_OFFERS_PER_BATCH) return prev;
      return [...prev, workerId];
    });
  };

  const send = async () => {
    if (selected.length === 0 || !shift) return;
    setSending(true);
    try {
      const batch = await backend.sendOffers(shift.id, selected);
      setSelected([]);
      Alert.alert(
        'Offers sent',
        `${batch.offers.length} worker${batch.offers.length === 1 ? '' : 's'} notified. The first to accept books the shift.`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (e: any) {
      Alert.alert('Could not send offers', e?.message ?? 'Something went wrong.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Interested</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {shift ? shift.title : 'Loading…'}
          </Text>
        </View>
        <IconButton icon="close" onPress={() => router.back()} />
      </View>

      {shift && (
        <View style={styles.shiftStrip}>
          <Ionicons name="calendar" size={14} color={palette.textMuted} />
          <Text style={styles.stripText}>{formatDate(shift.date)}</Text>
          <Ionicons name="time" size={14} color={palette.textMuted} style={{ marginLeft: 8 }} />
          <Text style={styles.stripText}>{formatTimeRange(shift.startTime, shift.endTime)}</Text>
          <View style={styles.payPill}>
            <Text style={styles.payText}>
              {formatRate(shift.payRateCents)}/{shift.payType}
            </Text>
          </View>
        </View>
      )}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={palette.primary} />
        </View>
      ) : cards.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="people-outline"
            title="Nobody yet"
            subtitle="When workers swipe right on this shift they'll show up here, ready to be offered it."
          />
        </View>
      ) : (
        <>
          <Text style={styles.hint}>
            Pick up to {MAX_OFFERS_PER_BATCH}. Everyone you pick gets the offer at once — the first
            to accept books the shift.
          </Text>
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {cards.map(({ worker }) => {
              const on = selected.includes(worker.id);
              const disabled = !on && atCap;
              return (
                /*
                  Card is a plain View, so these three controls are siblings.
                  Wrapping the whole row in a Pressable would put the profile
                  button inside it — a <button> in a <button> on web, with the
                  focus and screen-reader problems that brings (BIG-83).

                  Selecting stays the row's job: this screen exists to pick up
                  to ten people, so that is the primary action and it keeps the
                  large target. Opening a profile is its own control.
                */
                <Card
                  key={worker.id}
                  style={[styles.row, on && styles.rowOn, disabled && styles.rowDisabled]}
                >
                  <Pressable
                    onPress={() => toggle(worker.id)}
                    disabled={disabled}
                    style={styles.rowMain}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled }}
                    accessibilityLabel={`${on ? 'Deselect' : 'Select'} ${worker.fullName}`}
                  >
                    <Avatar name={worker.fullName} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {worker.fullName}
                      </Text>
                      <Text style={styles.headline} numberOfLines={1}>
                        {worker.headline || `${worker.yearsExperience} yrs experience`}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push(`/worker/${worker.id}`)}
                    style={({ pressed }) => [styles.viewBtn, pressed && styles.viewBtnPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${worker.fullName}'s profile`}
                  >
                    <Ionicons name="person-circle-outline" size={22} color={palette.textMuted} />
                  </Pressable>
                  <Pressable
                    onPress={() => toggle(worker.id)}
                    disabled={disabled}
                    style={styles.checkBtn}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled }}
                    accessibilityLabel={`${on ? 'Deselect' : 'Select'} ${worker.fullName}`}
                  >
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'ellipse-outline'}
                      size={24}
                      color={on ? palette.primary : palette.textFaint}
                    />
                  </Pressable>
                </Card>
              );
            })}
          </ScrollView>
          <View style={styles.footer}>
            <Button
              title={selected.length ? `Send offer (${selected.length})` : 'Send offer'}
              icon="paper-plane"
              onPress={send}
              loading={sending}
              disabled={selected.length === 0}
            />
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 6,
  },
  title: { fontSize: 26, fontWeight: '900', color: palette.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: palette.textMuted, marginTop: 2 },
  shiftStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  stripText: { fontSize: 13, color: palette.textMuted, fontWeight: '600' },
  payPill: {
    marginLeft: 'auto',
    backgroundColor: palette.chipBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  payText: { fontSize: 12.5, fontWeight: '800', color: palette.primaryDeep },
  hint: {
    fontSize: 13,
    color: palette.textMuted,
    lineHeight: 18,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: 'transparent' },
  rowOn: { borderColor: palette.primary, backgroundColor: palette.tintPrimarySoft },
  rowDisabled: { opacity: 0.45 },
  /** The selection target: avatar and name, the bulk of the row. */
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  // Both icon controls get a 44pt box so they are reachable by thumb, which the
  // bare icons were not.
  viewBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  viewBtnPressed: { opacity: 0.6 },
  checkBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '800', color: palette.text },
  headline: { fontSize: 13.5, color: palette.textMuted, marginTop: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
});
