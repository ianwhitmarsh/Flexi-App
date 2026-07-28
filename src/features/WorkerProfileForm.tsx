/** Worker profile form — shared by onboarding and profile editing. */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Field } from '@/components/ui';
import { ChipMultiSelect, ResumePicker, TagInput } from '@/components/inputs';
import { palette } from '@/constants/theme';
import { AVAILABILITY_OPTIONS } from '@/lib/constants';
import { useSession } from '@/lib/session';
import type { ResumeFile, WorkerProfile } from '@/lib/types';
import { centsToInput, dollarsToCents } from '@/lib/util';

export function WorkerProfileForm({
  initial,
  ctaLabel = 'Save & start swiping',
  onSaved,
}: {
  initial?: WorkerProfile;
  ctaLabel?: string;
  onSaved: () => void;
}) {
  const { backend } = useSession();
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [headline, setHeadline] = useState(initial?.headline ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [bio, setBio] = useState(initial?.bio ?? '');
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? []);
  const [years, setYears] = useState(initial?.yearsExperience ? String(initial.yearsExperience) : '');
  const [rate, setRate] = useState(
    initial?.desiredRateCents ? centsToInput(initial.desiredRateCents) : '',
  );
  const [availability, setAvailability] = useState<string[]>(initial?.availability ?? []);
  const [resume, setResume] = useState<ResumeFile | null>(null);
  const [resumeName, setResumeName] = useState(initial?.resumeName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    if (!fullName.trim()) return setError('Please add your name.');
    if (skills.length === 0) return setError('Add at least one skill.');
    setBusy(true);
    try {
      let resumeUrl = initial?.resumeUrl;
      let savedResumeName = resumeName;
      if (resume) {
        const uploaded = await backend.uploadResume(resume);
        resumeUrl = uploaded.url;
        savedResumeName = uploaded.name;
      }
      await backend.saveWorkerProfile({
        fullName: fullName.trim(),
        headline: headline.trim(),
        city: city.trim(),
        bio: bio.trim(),
        skills,
        yearsExperience: Number(years) || 0,
        desiredRateCents: rate ? (dollarsToCents(rate) ?? undefined) : undefined,
        availability,
        resumeUrl,
        resumeName: savedResumeName,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Jordan Avery" />
      <Field
        label="Headline"
        value={headline}
        onChangeText={setHeadline}
        placeholder="Barista · Espresso nerd"
        hint="A short tagline shown on your card."
      />
      <Field label="City" value={city} onChangeText={setCity} placeholder="Oakland, CA" />
      <View style={styles.row}>
        <Field
          label="Years experience"
          value={years}
          onChangeText={setYears}
          keyboardType="number-pad"
          placeholder="3"
          style={{ flex: 1 }}
        />
        <Field
          label="Desired $/hr"
          value={rate}
          onChangeText={setRate}
          keyboardType="number-pad"
          placeholder="22"
          style={{ flex: 1 }}
        />
      </View>
      <Field
        label="About you"
        value={bio}
        onChangeText={setBio}
        placeholder="A sentence or two about your experience and what you're great at."
        multiline
      />
      <TagInput label="Skills" tags={skills} onChange={setSkills} />
      <ChipMultiSelect
        label="Availability"
        options={AVAILABILITY_OPTIONS}
        selected={availability}
        onChange={setAvailability}
      />
      <ResumePicker
        resumeName={resume?.name ?? resumeName}
        onPick={(f) => {
          setResume(f);
          setResumeName(f.name);
        }}
      />
      {error && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color={palette.pass} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <Button title={ctaLabel} onPress={save} loading={busy} style={{ marginTop: 8 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  row: { flexDirection: 'row', gap: 12 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { color: palette.pass, fontSize: 13, flex: 1 },
});
