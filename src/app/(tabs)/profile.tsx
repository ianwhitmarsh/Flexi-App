import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button, Card, Screen } from '@/components/ui';
import { BusinessProfileForm } from '@/features/BusinessProfileForm';
import { EmployerVoiceForm } from '@/features/EmployerVoiceForm';
import { WorkerProfileForm } from '@/features/WorkerProfileForm';
import { palette, radius } from '@/constants/theme';
import type { PayrollStatus } from '@/lib/payroll';
import { useSession } from '@/lib/session';
import { formatRate } from '@/lib/util';

/** What each payroll state means to a worker, in their terms. */
const PAYROLL_COPY: Record<PayrollStatus, string> = {
  not_started:
    'Flexi employs you as a W-2 worker, so we need your tax and payment details before you can be booked.',
  in_progress: 'Almost there — a few details are still outstanding.',
  blocked: 'Something needs attention before you can be booked. Finish setup to see what.',
  ready: 'Your tax and payment details are on file. You can accept shifts.',
};

export default function Profile() {
  const { account, backend, signOut, refresh, isLive } = useSession();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [editingVoice, setEditingVoice] = useState(false);
  const [payrollBusy, setPayrollBusy] = useState(false);
  const isWorker = account?.role === 'worker';
  const worker = account?.worker;
  const payrollStatus: PayrollStatus = worker?.payrollStatus ?? 'not_started';
  const payrollReady = payrollStatus === 'ready';

  /**
   * Open the provider's hosted W-4 / I-9 / direct-deposit flow, then re-read
   * the status. None of that data passes through Flexi. In demo mode the
   * provider has no real form, so this resolves immediately — the call
   * sequence is the same one a live provider would need.
   */
  const runPayrollSetup = async () => {
    setPayrollBusy(true);
    try {
      const { onboardingUrl } = await backend.startPayrollSetup();
      if (isLive) await WebBrowser.openBrowserAsync(onboardingUrl);
      await backend.refreshPayrollStatus();
      await refresh();
    } catch (e: any) {
      Alert.alert('Could not start payroll setup', e?.message ?? 'Something went wrong.');
    } finally {
      setPayrollBusy(false);
    }
  };
  const business = account?.business;
  const displayName = isWorker ? worker?.fullName ?? 'You' : business?.companyName ?? 'Your business';

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

  const switchRole = () => {
    const other = isWorker ? 'business' : 'worker';
    Alert.alert(
      `Switch to ${other === 'business' ? 'hiring' : 'finding shifts'}?`,
      'You can switch back anytime from your profile.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            await backend.setRole(other);
            await refresh();
          },
        },
      ],
    );
  };

  if (editingVoice && business) {
    return (
      <Screen edges={['top']}>
        <View style={styles.editHeader}>
          <Text style={styles.title}>Your voice</Text>
          <Pressable onPress={() => setEditingVoice(false)} hitSlop={8}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.editBody} keyboardShouldPersistTaps="handled">
          <EmployerVoiceForm
            business={business}
            ctaLabel="Save changes"
            onSaved={() => {
              refresh();
              setEditingVoice(false);
            }}
          />
        </ScrollView>
      </Screen>
    );
  }

  if (editing) {
    return (
      <Screen edges={['top']}>
        <View style={styles.editHeader}>
          <Text style={styles.title}>Edit profile</Text>
          <Pressable onPress={() => setEditing(false)} hitSlop={8}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.editBody} keyboardShouldPersistTaps="handled">
          {isWorker ? (
            <WorkerProfileForm
              initial={worker}
              ctaLabel="Save changes"
              onSaved={() => {
                refresh();
                setEditing(false);
              }}
            />
          ) : (
            <BusinessProfileForm
              initial={business}
              ctaLabel="Save changes"
              onSaved={() => {
                refresh();
                setEditing(false);
              }}
            />
          )}
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={palette.gradient} locations={palette.gradientLocations} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.35 }} style={styles.banner}>
          <Avatar name={displayName} size={84} />
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.role}>
            {isWorker ? worker?.headline || 'Worker' : `${business?.category ?? 'Business'} · ${business?.city ?? ''}`}
          </Text>
        </LinearGradient>

        <View style={styles.content}>
          {isWorker && worker && (
            <Card style={[styles.card, styles.payrollCard]}>
              <View style={styles.payrollTop}>
                <Ionicons
                  name={payrollReady ? 'shield-checkmark' : 'shield-outline'}
                  size={20}
                  color={payrollReady ? palette.likeDeep : palette.primary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.payrollTitle}>
                    {payrollReady ? 'Ready to get paid' : 'Get set up to get paid'}
                  </Text>
                  <Text style={styles.payrollSub}>{PAYROLL_COPY[payrollStatus]}</Text>
                </View>
              </View>
              {!payrollReady && (
                <Button
                  title={payrollStatus === 'in_progress' ? 'Finish setup' : 'Get set up to get paid'}
                  icon="arrow-forward-circle"
                  onPress={runPayrollSetup}
                  loading={payrollBusy}
                  style={styles.payrollBtn}
                />
              )}
            </Card>
          )}

          {isWorker && worker && (
            <Card style={styles.card}>
              <Detail icon="location" label="City" value={worker.city || '—'} />
              <Detail icon="briefcase" label="Experience" value={`${worker.yearsExperience} yrs`} />
              {worker.desiredRateCents ? (
                <Detail icon="cash" label="Desired rate" value={`${formatRate(worker.desiredRateCents)}/hr`} />
              ) : null}
              {worker.bio ? <Text style={styles.bio}>{worker.bio}</Text> : null}
              {worker.skills.length > 0 && <ChipWrap items={worker.skills} title="Skills" />}
              {worker.availability.length > 0 && <ChipWrap items={worker.availability} title="Availability" />}
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
          )}

          {!isWorker && business && (
            <Card style={styles.card}>
              <Detail icon="business" label="Category" value={business.category} />
              <Detail icon="location" label="City" value={business.city} />
              {business.contactName ? <Detail icon="person" label="Contact" value={business.contactName} /> : null}
              {business.about ? <Text style={styles.bio}>{business.about}</Text> : null}
            </Card>
          )}

          <Button title="Edit profile" variant="secondary" icon="create-outline" onPress={() => setEditing(true)} />
          {!isWorker && business && (
            <Button
              title="Edit your voice"
              variant="secondary"
              icon="chatbubble-ellipses-outline"
              onPress={() => setEditingVoice(true)}
            />
          )}
          <Button
            title="Terms & privacy"
            variant="ghost"
            icon="document-text-outline"
            onPress={() => router.push('/legal')}
          />
          <Button
            title={isWorker ? 'Switch to hiring' : 'Switch to finding shifts'}
            variant="ghost"
            icon="swap-horizontal"
            onPress={switchRole}
          />

          <Pressable onPress={signOut} style={styles.signOut}>
            <Ionicons name="log-out-outline" size={18} color={palette.pass} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>

          <Text style={styles.footer}>
            Flexi · {isLive ? 'Connected to Supabase' : 'Demo mode (local data)'}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Detail({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Ionicons name={icon} size={18} color={palette.primary} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ChipWrap({ items, title }: { items: string[]; title: string }) {
  return (
    <View style={{ gap: 8, marginTop: 4 }}>
      <Text style={styles.chipTitle}>{title}</Text>
      <View style={styles.chips}>
        {items.map((i) => (
          <View key={i} style={styles.chip}>
            <Text style={styles.chipText}>{i}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 40 },
  banner: { alignItems: 'center', paddingTop: 24, paddingBottom: 28, gap: 8 },
  name: { fontSize: 24, fontWeight: '900', color: palette.onPrimary, letterSpacing: -0.5 },
  role: { fontSize: 14.5, color: palette.onPrimary, opacity: 0.95, fontWeight: '600' },
  content: { padding: 20, gap: 14, marginTop: -16 },
  card: { gap: 12 },
  payrollCard: { gap: 10 },
  payrollTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  payrollTitle: { fontSize: 15.5, fontWeight: '800', color: palette.text },
  payrollSub: { fontSize: 13.5, color: palette.textMuted, lineHeight: 19, marginTop: 2 },
  payrollBtn: { marginTop: 2 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailLabel: { fontSize: 14, color: palette.textMuted, fontWeight: '600', width: 90 },
  detailValue: { fontSize: 14.5, color: palette.text, fontWeight: '700', flex: 1 },
  bio: { fontSize: 14.5, color: palette.textMuted, lineHeight: 21 },
  chipTitle: { fontSize: 12, fontWeight: '800', color: palette.textFaint, textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { backgroundColor: palette.chipBg, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  chipText: { fontSize: 12.5, fontWeight: '600', color: palette.chipText },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.cardAlt,
    borderRadius: radius.md,
    padding: 12,
  },
  resumeText: { fontSize: 14, color: palette.text, fontWeight: '600', flex: 1 },
  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  signOutText: { color: palette.pass, fontSize: 15, fontWeight: '700' },
  footer: { textAlign: 'center', color: palette.textFaint, fontSize: 12, marginTop: 4 },
  editHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  title: { fontSize: 24, fontWeight: '900', color: palette.text, letterSpacing: -0.5 },
  cancel: { color: palette.primary, fontSize: 16, fontWeight: '700' },
  editBody: { paddingHorizontal: 20, paddingBottom: 48 },
});
