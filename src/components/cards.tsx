/** Card faces shown inside the swipe deck. */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette, radius } from '@/constants/theme';
import type { InterestedWorker, Shift, WorkerProfile } from '@/lib/types';
import { formatDate, formatTimeRange } from '@/lib/util';

function MetaRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={16} color={palette.primary} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <View style={styles.chips}>
      {items.map((c) => (
        <View key={c} style={styles.chip}>
          <Text style={styles.chipText}>{c}</Text>
        </View>
      ))}
    </View>
  );
}

export function ShiftCard({ shift }: { shift: Shift }) {
  return (
    <View style={styles.card}>
      <LinearGradient colors={palette.gradient} locations={palette.gradientLocations} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.35 }} style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.logo}>
            <Ionicons name="business" size={20} color={palette.primary} />
          </View>
          <View style={styles.payPill}>
            <Text style={styles.payText}>
              ${shift.payRate}
              <Text style={styles.payUnit}>/{shift.payType}</Text>
            </Text>
          </View>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {shift.title}
        </Text>
        <Text style={styles.company}>
          {shift.business?.companyName ?? 'Local business'} · {shift.role}
        </Text>
      </LinearGradient>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        <MetaRow icon="calendar" text={formatDate(shift.date)} />
        <MetaRow icon="time" text={formatTimeRange(shift.startTime, shift.endTime)} />
        <MetaRow icon="location" text={shift.location || shift.business?.city || 'Nearby'} />

        {shift.description ? <Text style={styles.desc}>{shift.description}</Text> : null}

        {shift.requirements.length > 0 && (
          <>
            <Text style={styles.section}>Requirements</Text>
            <Chips items={shift.requirements} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

export function WorkerCard({ card }: { card: InterestedWorker }) {
  const w = card.worker;
  return (
    <View style={styles.card}>
      <LinearGradient colors={palette.gradient} locations={palette.gradientLocations} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.35 }} style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.logo}>
            <Text style={styles.logoInitials}>
              {w.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
            </Text>
          </View>
          {w.desiredRate ? (
            <View style={styles.payPill}>
              <Text style={styles.payText}>
                ${w.desiredRate}
                <Text style={styles.payUnit}>/hr</Text>
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {w.fullName}
        </Text>
        <Text style={styles.company}>{w.headline}</Text>
      </LinearGradient>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        <View style={styles.interest}>
          <Ionicons name="heart" size={14} color={palette.primary} />
          <Text style={styles.interestText} numberOfLines={1}>
            Interested in {card.shift.title}
          </Text>
        </View>

        <MetaRow icon="briefcase" text={`${w.yearsExperience} yr${w.yearsExperience === 1 ? '' : 's'} experience`} />
        <MetaRow icon="location" text={w.city || 'Nearby'} />

        {w.bio ? <Text style={styles.desc}>{w.bio}</Text> : null}

        {w.skills.length > 0 && (
          <>
            <Text style={styles.section}>Skills</Text>
            <Chips items={w.skills} />
          </>
        )}
        {w.availability.length > 0 && (
          <>
            <Text style={styles.section}>Availability</Text>
            <Chips items={w.availability} />
          </>
        )}
        {w.resumeName ? (
          <View style={styles.resume}>
            <Ionicons name="document-text" size={16} color={palette.primary} />
            <Text style={styles.resumeText} numberOfLines={1}>
              {w.resumeName}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: palette.card },
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 22, gap: 4 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: palette.onGradientStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInitials: { color: palette.primary, fontWeight: '900', fontSize: 16 },
  payPill: { backgroundColor: palette.onGradientStrong, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  payText: { color: palette.primaryDeep, fontWeight: '900', fontSize: 16 },
  payUnit: { fontSize: 12, fontWeight: '700' },
  title: { color: palette.onPrimary, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  company: { color: palette.onPrimary, opacity: 0.92, fontSize: 14.5, fontWeight: '600' },

  body: { flex: 1 },
  bodyContent: { padding: 20, gap: 10 },
  interest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.tintPrimary,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    marginBottom: 2,
  },
  interestText: { color: palette.primaryDeep, fontWeight: '700', fontSize: 12.5, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontSize: 15, color: palette.text, fontWeight: '600' },
  desc: { fontSize: 14.5, color: palette.textMuted, lineHeight: 21, marginTop: 4 },
  section: { fontSize: 12, fontWeight: '800', color: palette.textFaint, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { backgroundColor: palette.chipBg, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  chipText: { fontSize: 12.5, fontWeight: '600', color: palette.chipText },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    backgroundColor: palette.cardAlt,
    borderRadius: radius.md,
    padding: 10,
  },
  resumeText: { fontSize: 13.5, color: palette.text, fontWeight: '600', flex: 1 },
});
