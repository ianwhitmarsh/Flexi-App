/**
 * Employer voice and expectations — shared by onboarding and profile editing.
 *
 * Pure data capture. The preview is string templating, deliberately: no model
 * is called here, and none should be. Generating the real opener is separate
 * work; this only shows the employer why the questions are worth answering.
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChipSingleSelect } from '@/components/inputs';
import { Button, Field } from '@/components/ui';
import { palette, radius } from '@/constants/theme';
import { buildOpenerPreview } from '@/lib/opener';
import { useSession } from '@/lib/session';
import type { AiFaq, AiProfile, AiTone, Business } from '@/lib/types';

const TONES: AiTone[] = ['casual', 'professional', 'warm'];
const MAX_FAQS = 10;

export function EmployerVoiceForm({
  business,
  ctaLabel = 'Save',
  onSaved,
  onSkip,
}: {
  business: Business;
  ctaLabel?: string;
  onSaved: () => void;
  /** Rendered only when provided — onboarding shows it, profile editing does not. */
  onSkip?: () => void;
}) {
  const { backend } = useSession();
  const initial = business.aiProfile ?? {};

  const [tone, setTone] = useState<AiTone>(initial.tone ?? 'warm');
  const [dressCode, setDressCode] = useState(initial.dressCode ?? '');
  const [arrival, setArrival] = useState(initial.arrivalInstructions ?? '');
  const [parking, setParking] = useState(initial.parkingNotes ?? '');
  const [different, setDifferent] = useState(initial.whatMakesUsDifferent ?? '');
  const [faqs, setFaqs] = useState<AiFaq[]>(initial.faqs ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const profile: AiProfile = useMemo(
    () => ({
      tone,
      dressCode: dressCode.trim() || undefined,
      arrivalInstructions: arrival.trim() || undefined,
      parkingNotes: parking.trim() || undefined,
      whatMakesUsDifferent: different.trim() || undefined,
      // Drop blank rows so an untouched pair never persists.
      faqs: faqs.filter((f) => f.question.trim() || f.answer.trim()),
    }),
    [tone, dressCode, arrival, parking, different, faqs],
  );

  const preview = buildOpenerPreview(business.companyName, profile);

  const setFaq = (i: number, patch: Partial<AiFaq>) =>
    setFaqs((prev) => prev.map((f, n) => (n === i ? { ...f, ...patch } : f)));

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await backend.saveBusinessProfile({
        companyName: business.companyName,
        category: business.category,
        city: business.city,
        about: business.about,
        contactName: business.contactName,
        logoUrl: business.logoUrl,
        aiProfile: profile,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <ChipSingleSelect
        label="Tone"
        options={TONES}
        value={tone}
        onChange={(t) => setTone(t as AiTone)}
      />
      <Field
        label="Dress code"
        value={dressCode}
        onChangeText={setDressCode}
        placeholder="Black shirt, closed-toe shoes"
      />
      <Field
        label="Arrival instructions"
        value={arrival}
        onChangeText={setArrival}
        placeholder="Come to the side door and ask for Dana"
      />
      <Field
        label="Parking"
        value={parking}
        onChangeText={setParking}
        placeholder="Free lot behind the building"
      />
      <Field
        label="What makes you different"
        value={different}
        onChangeText={setDifferent}
        placeholder="Small team, we eat together after close"
        multiline
      />

      <View style={styles.faqHeader}>
        <Text style={styles.label}>Common questions</Text>
        <Text style={styles.count}>
          {faqs.length}/{MAX_FAQS}
        </Text>
      </View>
      {faqs.map((f, i) => (
        <View key={i} style={styles.faq}>
          <Field
            label={`Question ${i + 1}`}
            value={f.question}
            onChangeText={(question) => setFaq(i, { question })}
            placeholder="Do I need my own tools?"
          />
          <Field
            label="Answer"
            value={f.answer}
            onChangeText={(answer) => setFaq(i, { answer })}
            placeholder="No, everything is provided"
          />
          <Pressable onPress={() => setFaqs((prev) => prev.filter((_, n) => n !== i))}>
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        </View>
      ))}
      {faqs.length < MAX_FAQS && (
        <Button
          title="Add a question"
          variant="secondary"
          icon="add"
          onPress={() => setFaqs((prev) => [...prev, { question: '', answer: '' }])}
        />
      )}

      <View style={styles.preview}>
        <Text style={styles.previewLabel}>Sample opener</Text>
        <Text style={styles.previewBody}>{preview}</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={ctaLabel} onPress={save} loading={busy} />
      {onSkip && <Button title="Skip for now" variant="ghost" onPress={onSkip} disabled={busy} />}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  label: { fontSize: 13, fontWeight: '800', color: palette.textSecondary },
  faqHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontSize: 12.5, color: palette.textFaint, fontWeight: '700' },
  faq: {
    gap: 10,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: palette.cardAlt,
    borderWidth: 1,
    borderColor: palette.border,
  },
  remove: { color: palette.pass, fontWeight: '700', fontSize: 13 },
  preview: {
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: palette.tintPrimarySoft,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 6,
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: palette.primaryDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  previewBody: { fontSize: 14, color: palette.text, lineHeight: 21 },
  error: { color: palette.pass, fontSize: 13.5, fontWeight: '600' },
});
