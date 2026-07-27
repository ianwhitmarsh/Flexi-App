/** Higher-level form inputs: tag entry, chip multi-select, résumé picker. */

import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette, radius } from '@/constants/theme';
import type { ResumeFile } from '@/lib/types';

export function TagInput({
  label,
  tags,
  onChange,
  placeholder = 'Type a skill and press +',
}: {
  label?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !tags.some((t) => t.toLowerCase() === v.toLowerCase())) {
      onChange([...tags, v]);
    }
    setDraft('');
  };
  return (
    <View style={{ gap: 8 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.tagRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          returnKeyType="done"
          placeholder={placeholder}
          placeholderTextColor={palette.textFaint}
          style={styles.tagInput}
        />
        <Pressable onPress={add} style={styles.addBtn}>
          <Ionicons name="add" size={22} color={palette.onPrimary} />
        </Pressable>
      </View>
      {tags.length > 0 && (
        <View style={styles.tags}>
          {tags.map((t) => (
            <Pressable key={t} onPress={() => onChange(tags.filter((x) => x !== t))} style={styles.tag}>
              <Text style={styles.tagText}>{t}</Text>
              <Ionicons name="close" size={14} color={palette.chipText} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export function ChipMultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label?: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (o: string) =>
    onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
  return (
    <View style={{ gap: 8 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.tags}>
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <Pressable key={o} onPress={() => toggle(o)} style={[styles.choice, on && styles.choiceOn]}>
              <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ChipSingleSelect({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.tags}>
        {options.map((o) => {
          const on = value === o;
          return (
            <Pressable key={o} onPress={() => onChange(o)} style={[styles.choice, on && styles.choiceOn]}>
              <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ResumePicker({
  resumeName,
  onPick,
}: {
  resumeName?: string;
  onPick: (file: ResumeFile) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const pick = async () => {
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      onPick({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size ?? undefined });
    } catch {
      setError('Could not open the file picker.');
    }
  };
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>Résumé (optional)</Text>
      <Pressable onPress={pick} style={styles.resumeBtn}>
        <Ionicons
          name={resumeName ? 'document-text' : 'cloud-upload-outline'}
          size={22}
          color={palette.primary}
        />
        <Text style={styles.resumeText} numberOfLines={1}>
          {resumeName ?? 'Upload a PDF or Word résumé'}
        </Text>
        {resumeName && <Ionicons name="checkmark-circle" size={20} color={palette.like} />}
      </Pressable>
      {error && <Text style={styles.err}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: palette.textMuted, marginLeft: 2 },
  tagRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  tagInput: {
    flex: 1,
    backgroundColor: palette.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: palette.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: palette.text,
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.chipBg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  tagText: { fontSize: 13.5, fontWeight: '600', color: palette.chipText },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: palette.chipBg,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  choiceOn: { backgroundColor: palette.tintPrimary, borderColor: palette.primary },
  choiceText: { fontSize: 13.5, fontWeight: '600', color: palette.chipText },
  choiceTextOn: { color: palette.primaryDeep },
  resumeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: palette.borderStrong,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  resumeText: { flex: 1, fontSize: 15, color: palette.text, fontWeight: '600' },
  err: { color: palette.pass, fontSize: 12 },
});
