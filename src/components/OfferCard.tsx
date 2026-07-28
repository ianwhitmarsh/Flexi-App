/** A live race-mode offer, shown above the worker's swipe deck. */

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { palette, radius, shadow } from '@/constants/theme';
import type { Offer } from '@/lib/types';
import { formatDate, formatRate, formatTimeRange } from '@/lib/util';

export function OfferCard({
  offer,
  onAccept,
  onDecline,
  busy,
}: {
  offer: Offer;
  onAccept: () => void;
  onDecline: () => void;
  busy?: boolean;
}) {
  const shift = offer.shift;
  if (!shift) return null;

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.badge}>
          <Ionicons name="flash" size={12} color={palette.onPrimary} />
          <Text style={styles.badgeText}>Offer</Text>
        </View>
        <Text style={styles.pay}>
          {formatRate(shift.payRateCents)}
          <Text style={styles.payUnit}>/{shift.payType}</Text>
        </Text>
      </View>

      <Text style={styles.title} numberOfLines={1}>
        {shift.title}
      </Text>
      <Text style={styles.company} numberOfLines={1}>
        {shift.business?.companyName ?? 'A local business'} · {shift.role}
      </Text>

      <View style={styles.metaRow}>
        <Ionicons name="calendar" size={13} color={palette.textMuted} />
        <Text style={styles.meta}>{formatDate(shift.date)}</Text>
        <Ionicons name="time" size={13} color={palette.textMuted} style={{ marginLeft: 8 }} />
        <Text style={styles.meta}>{formatTimeRange(shift.startTime, shift.endTime)}</Text>
      </View>
      {shift.location ? (
        <View style={styles.metaRow}>
          <Ionicons name="location" size={13} color={palette.textMuted} />
          <Text style={styles.meta} numberOfLines={1}>
            {shift.location}
          </Text>
        </View>
      ) : null}

      <Text style={styles.note}>Sent to a few workers — first to accept gets it.</Text>
      <Button title="Accept shift" icon="checkmark-circle" onPress={onAccept} loading={busy} />
      <Button title="Not this one" variant="ghost" onPress={onDecline} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.card,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: palette.primary,
    padding: 16,
    gap: 4,
    ...shadow.soft,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.primary,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeText: { color: palette.onPrimary, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  pay: { fontSize: 18, fontWeight: '900', color: palette.primaryDeep },
  payUnit: { fontSize: 12, fontWeight: '700' },
  title: { fontSize: 19, fontWeight: '900', color: palette.text, marginTop: 6 },
  company: { fontSize: 14, color: palette.textMuted, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  meta: { fontSize: 13, color: palette.textMuted, fontWeight: '600' },
  note: { fontSize: 12.5, color: palette.textFaint, marginTop: 8, marginBottom: 10 },
});
