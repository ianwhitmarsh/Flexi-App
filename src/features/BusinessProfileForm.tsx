/** Business profile form — shared by onboarding and profile editing. */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Field } from '@/components/ui';
import { ChipSingleSelect } from '@/components/inputs';
import { palette } from '@/constants/theme';
import { BUSINESS_CATEGORIES } from '@/lib/constants';
import { useSession } from '@/lib/session';
import type { Business } from '@/lib/types';

export function BusinessProfileForm({
  initial,
  ctaLabel = 'Save & post shifts',
  onSaved,
}: {
  initial?: Business;
  ctaLabel?: string;
  onSaved: () => void;
}) {
  const { backend } = useSession();
  const [companyName, setCompanyName] = useState(initial?.companyName ?? '');
  const [category, setCategory] = useState(initial?.category ?? BUSINESS_CATEGORIES[0]);
  const [city, setCity] = useState(initial?.city ?? '');
  const [contactName, setContactName] = useState(initial?.contactName ?? '');
  const [about, setAbout] = useState(initial?.about ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    if (!companyName.trim()) return setError('Please add your business name.');
    if (!city.trim()) return setError('Please add your city.');
    setBusy(true);
    try {
      await backend.saveBusinessProfile({
        companyName: companyName.trim(),
        category,
        city: city.trim(),
        contactName: contactName.trim(),
        about: about.trim(),
      });
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save your business profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Field
        label="Business name"
        value={companyName}
        onChangeText={setCompanyName}
        placeholder="Blue Harbor Coffee"
      />
      <ChipSingleSelect
        label="Category"
        options={BUSINESS_CATEGORIES}
        value={category}
        onChange={setCategory}
      />
      <Field label="City" value={city} onChangeText={setCity} placeholder="Oakland, CA" />
      <Field
        label="Contact name"
        value={contactName}
        onChangeText={setContactName}
        placeholder="Dana Reyes"
        hint="Who workers will be chatting with."
      />
      <Field
        label="About"
        value={about}
        onChangeText={setAbout}
        placeholder="A short description of your business and team."
        multiline
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
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { color: palette.pass, fontSize: 13, flex: 1 },
});
