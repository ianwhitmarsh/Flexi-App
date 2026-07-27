import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ChipSingleSelect, TagInput } from '@/components/inputs';
import { Button, Field, IconButton, Screen } from '@/components/ui';
import { palette, radius } from '@/constants/theme';
import { SHIFT_ROLES } from '@/lib/constants';
import { useSession } from '@/lib/session';
import type { FillMode } from '@/lib/types';
import { formatDate } from '@/lib/util';

/**
 * `standard` is shown but not selectable: one-at-a-time exclusive offers with
 * expiry and auto-advance are BIG-47, and nothing enforces `fill_mode` today —
 * `sendOffers` and the RLS insert policy both ignore it. Offering the choice
 * meant an employer picked "one by one" and got batch first-accept-wins.
 *
 * Re-enable it in the same change that builds BIG-47, not before.
 */
const FILL_MODES: { value: FillMode; label: string; hint: string; available: boolean }[] = [
  {
    value: 'race',
    label: 'Fastest fill',
    hint: 'Offer the shift to several workers at once — first to accept books it.',
    available: true,
  },
  {
    value: 'standard',
    label: 'One at a time',
    hint: 'Coming soon — offer the shift to one worker at a time, each with a window to accept.',
    available: false,
  },
];

/** Next 7 calendar days as selectable chips. */
function useDayOptions() {
  return useMemo(() => {
    const days: { iso: string; label: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      days.push({ iso, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDate(iso) });
    }
    return days;
  }, []);
}

export default function NewShift() {
  const router = useRouter();
  const { backend, account } = useSession();
  const days = useDayOptions();

  const [title, setTitle] = useState('');
  const [role, setRole] = useState(SHIFT_ROLES[0]);
  const [payRate, setPayRate] = useState('');
  const [payType, setPayType] = useState<'hour' | 'shift'>('hour');
  const [date, setDate] = useState(days[0].iso);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [location, setLocation] = useState(account?.business?.city ?? '');
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState<string[]>([]);
  // `race` is the only mode the app implements; see FILL_MODES above.
  const [fillMode, setFillMode] = useState<FillMode>('race');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validTime = (t: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t);

  const submit = async () => {
    setError(null);
    if (!title.trim()) return setError('Give the shift a title.');
    if (!payRate || Number(payRate) <= 0) return setError('Enter a valid pay rate.');
    if (!validTime(startTime) || !validTime(endTime)) return setError('Times must be in HH:MM (24h) format.');
    setBusy(true);
    try {
      await backend.createShift({
        title: title.trim(),
        role,
        payRate: Number(payRate),
        payType,
        date,
        startTime,
        endTime,
        location: location.trim(),
        description: description.trim(),
        requirements,
        fillMode,
      });
      router.back();
    } catch (e: any) {
      setError(e?.message ?? 'Could not post the shift.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>Post a shift</Text>
          <IconButton icon="close" onPress={() => router.back()} />
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Field label="Shift title" value={title} onChangeText={setTitle} placeholder="Weekend Barista" />
          <ChipSingleSelect label="Role" options={SHIFT_ROLES} value={role} onChange={setRole} />

          <View style={styles.row}>
            <Field
              label="Pay rate ($)"
              value={payRate}
              onChangeText={setPayRate}
              keyboardType="number-pad"
              placeholder="22"
              style={{ flex: 1 }}
            />
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={styles.label}>Per</Text>
              <View style={styles.toggle}>
                {(['hour', 'shift'] as const).map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setPayType(p)}
                    style={[styles.toggleBtn, payType === p && styles.toggleOn]}
                  >
                    <Text style={[styles.toggleText, payType === p && styles.toggleTextOn]}>{p}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={styles.label}>Date</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
              {days.map((d) => {
                const on = d.iso === date;
                return (
                  <Pressable key={d.iso} onPress={() => setDate(d.iso)} style={[styles.day, on && styles.dayOn]}>
                    <Text style={[styles.dayText, on && styles.dayTextOn]}>{d.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.row}>
            <Field label="Start (HH:MM)" value={startTime} onChangeText={setStartTime} placeholder="09:00" style={{ flex: 1 }} />
            <Field label="End (HH:MM)" value={endTime} onChangeText={setEndTime} placeholder="17:00" style={{ flex: 1 }} />
          </View>

          <Field label="Location" value={location} onChangeText={setLocation} placeholder="Lakeshore Ave, Oakland" />
          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="What the shift involves, the vibe, what a great fit looks like."
            multiline
          />
          <TagInput label="Requirements" tags={requirements} onChange={setRequirements} placeholder="e.g. Food handler card" />

          <View style={{ gap: 8 }}>
            <Text style={styles.label}>How do you want it filled?</Text>
            <View style={styles.fillModes}>
              {FILL_MODES.map((m) => {
                const on = m.value === fillMode;
                return (
                  <Pressable
                    key={m.value}
                    onPress={() => m.available && setFillMode(m.value)}
                    disabled={!m.available}
                    accessibilityState={{ selected: on, disabled: !m.available }}
                    style={[
                      styles.fillMode,
                      on && styles.fillModeOn,
                      !m.available && styles.fillModeUnavailable,
                    ]}
                  >
                    <View style={styles.fillModeTop}>
                      <Ionicons
                        name={on ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={on ? palette.primary : palette.textFaint}
                      />
                      <Text style={[styles.fillModeLabel, on && styles.fillModeLabelOn]}>{m.label}</Text>
                    </View>
                    <Text style={styles.fillModeHint}>{m.hint}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {error && (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color={palette.pass} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          <Button title="Post shift" onPress={submit} loading={busy} icon="add-circle" style={{ marginTop: 4 }} />
        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingBottom: 6,
  },
  title: { fontSize: 24, fontWeight: '900', color: palette.text, letterSpacing: -0.5 },
  body: { paddingHorizontal: 20, paddingBottom: 48, gap: 16 },
  row: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 13, fontWeight: '700', color: palette.textMuted, marginLeft: 2 },
  toggle: { flexDirection: 'row', backgroundColor: palette.chipBg, borderRadius: radius.md, padding: 4, height: 50 },
  toggleBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  toggleOn: { backgroundColor: palette.card, ...{ shadowColor: palette.shadow, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } } },
  toggleText: { fontSize: 14, fontWeight: '700', color: palette.textMuted, textTransform: 'capitalize' },
  toggleTextOn: { color: palette.text },
  dayRow: { gap: 8, paddingRight: 8 },
  day: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: palette.chipBg },
  dayOn: { backgroundColor: palette.primary },
  dayText: { fontSize: 13.5, fontWeight: '700', color: palette.chipText },
  dayTextOn: { color: palette.onPrimary },
  fillModes: { gap: 10 },
  fillMode: {
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.card,
    borderRadius: radius.md,
    padding: 14,
    gap: 6,
  },
  fillModeOn: { borderColor: palette.primary, backgroundColor: palette.tintPrimarySoft },
  fillModeUnavailable: { opacity: 0.45 },
  fillModeTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fillModeLabel: { fontSize: 15, fontWeight: '800', color: palette.text },
  fillModeLabelOn: { color: palette.primaryDeep },
  fillModeHint: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { color: palette.pass, fontSize: 13, flex: 1 },
});
