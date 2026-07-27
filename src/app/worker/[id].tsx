/**
 * A worker's full profile, for an employer deciding whether to offer them a
 * shift.
 *
 * This is the information the employer swipe deck used to show before BIG-40
 * replaced it with the Interested queue. Choosing who gets paid work off a name
 * and a headline was never enough — and the résumé a worker uploads is only
 * worth collecting if somebody can read it.
 *
 * `getWorkerProfile` returns null unless the caller is an employer connected to
 * this worker through one of their own shifts, so a missing profile here means
 * "not yours to see" as much as "not found".
 */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Avatar, Button, Card, EmptyState, IconButton, Screen } from '@/components/ui';
import { palette, radius } from '@/constants/theme';
import { useSession } from '@/lib/session';
import type { InterestedWorker, WorkerProfile } from '@/lib/types';

export default function WorkerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { backend } = useSession();

  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [rows, setRows] = useState<InterestedWorker[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profile, interested] = await Promise.all([
        backend.getWorkerProfile(id),
        backend.listInterested(),
      ]);
      setWorker(profile);
      setRows(interested);
    } finally {
      setLoading(false);
    }
  }, [backend, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /** The thread this worker's interest opened, if there is one to reuse. */
  const threadId = rows.find((r) => r.worker.id === id)?.threadId;

  const openResume = async () => {
    if (!worker?.resumeUrl) return;
    try {
      // Never opened directly: what is stored is a private storage path, and
      // the signed URL that makes it readable is minted here and expires.
      const url = await backend.resolveResumeUrl(worker.resumeUrl);
      if (!url) {
        Alert.alert('Résumé unavailable', 'This résumé could not be opened right now.');
        return;
      }
      if (url.startsWith('http')) {
        await WebBrowser.openBrowserAsync(url);
      } else {
        await Linking.openURL(url);
      }
    } catch {
      Alert.alert('Résumé', worker.resumeName ?? 'Saved résumé');
    }
  };

  if (loading) {
    return (
      <Screen edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={palette.primary} />
        </View>
      </Screen>
    );
  }

  if (!worker) {
    return (
      <Screen edges={['top']}>
        <View style={styles.header}>
          <IconButton icon="chevron-back" onPress={() => router.back()} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="person-outline"
            title="Profile not available"
            subtitle="You can only see workers who are interested in one of your shifts, or who you've offered or booked."
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={palette.gradient}
          locations={palette.gradientLocations}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0.35 }}
          style={styles.hero}
        >
          <View style={styles.heroTop}>
            <IconButton icon="chevron-back" onPress={() => router.back()} />
          </View>
          <Avatar name={worker.fullName} size={92} />
          <Text style={styles.name}>{worker.fullName}</Text>
          {worker.headline ? <Text style={styles.headline}>{worker.headline}</Text> : null}
        </LinearGradient>

        <View style={styles.content}>
          <Card style={styles.card}>
            <Detail icon="location" label="City" value={worker.city || '—'} />
            <Detail
              icon="briefcase"
              label="Experience"
              value={`${worker.yearsExperience} yr${worker.yearsExperience === 1 ? '' : 's'}`}
            />
            {worker.desiredRate ? (
              <Detail icon="cash" label="Desired rate" value={`$${worker.desiredRate}/hr`} />
            ) : null}

            {worker.bio ? <Text style={styles.bio}>{worker.bio}</Text> : null}

            {worker.skills.length > 0 && <ChipWrap title="Skills" items={worker.skills} />}
            {worker.availability.length > 0 && (
              <ChipWrap title="Availability" items={worker.availability} />
            )}

            {worker.resumeName ? (
              <Pressable onPress={openResume} style={styles.resume}>
                <Ionicons name="document-text" size={18} color={palette.primary} />
                <Text style={styles.resumeText} numberOfLines={1}>
                  {worker.resumeName}
                </Text>
                <Ionicons name="open-outline" size={16} color={palette.textMuted} />
              </Pressable>
            ) : null}
          </Card>

          {threadId ? (
            <Button
              title="Message"
              icon="chatbubble-ellipses"
              onPress={() => router.push(`/match/${threadId}`)}
              style={styles.messageBtn}
            />
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Detail({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detail}>
      <Ionicons name={icon} size={18} color={palette.primary} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ChipWrap({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.section}>{title}</Text>
      <View style={styles.chips}>
        {items.map((item) => (
          <View key={item} style={styles.chip}>
            <Text style={styles.chipText}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 32 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 12, paddingTop: 4 },
  hero: { alignItems: 'center', paddingBottom: 26, gap: 6 },
  heroTop: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6 },
  name: {
    fontSize: 25,
    fontWeight: '900',
    color: palette.onPrimary,
    letterSpacing: -0.5,
    marginTop: 10,
  },
  headline: { fontSize: 15, color: palette.onPrimary, opacity: 0.92, fontWeight: '600' },
  content: { padding: 16, gap: 14 },
  card: { gap: 12 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailLabel: { fontSize: 14, color: palette.textMuted, fontWeight: '600', width: 96 },
  detailValue: { fontSize: 14.5, color: palette.text, fontWeight: '700', flex: 1 },
  bio: { fontSize: 14.5, color: palette.textMuted, lineHeight: 21, marginTop: 2 },
  section: {
    fontSize: 12,
    fontWeight: '800',
    color: palette.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    backgroundColor: palette.chipBg,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  chipText: { fontSize: 12.5, fontWeight: '600', color: palette.chipText },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    backgroundColor: palette.cardAlt,
    borderRadius: radius.md,
    padding: 12,
  },
  resumeText: { fontSize: 13.5, color: palette.text, fontWeight: '600', flex: 1 },
  messageBtn: { marginTop: 2 },
});
