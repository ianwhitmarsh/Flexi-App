/** Index of legal documents. Deliberately outside `(tabs)`, so it is reachable
 *  while signed out — the tab navigator sits behind the auth gate. */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { IconButton, Screen } from '@/components/ui';
import { LEGAL_DOCS, LEGAL_DOC_ORDER } from '@/constants/legal';
import { palette, radius } from '@/constants/theme';

export default function LegalIndex() {
  const router = useRouter();

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Legal</Text>
        <Text style={styles.sub}>
          The agreements that govern Flexi. Available whether or not you have an account.
        </Text>

        <View style={styles.list}>
          {LEGAL_DOC_ORDER.map((id) => {
            const doc = LEGAL_DOCS[id];
            return (
              <Pressable
                key={id}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() => router.push(`/legal/${id}`)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{doc.title}</Text>
                  <Text style={styles.rowMeta}>
                    v{doc.version} · updated {doc.updated}
                    {doc.isPlaceholder ? ' · placeholder' : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={palette.textFaint} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 12, paddingTop: 4 },
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '900', color: palette.text, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: palette.textMuted, marginTop: 6, lineHeight: 21 },
  list: { marginTop: 24, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: radius.md,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
  },
  pressed: { opacity: 0.85 },
  rowTitle: { fontSize: 15.5, fontWeight: '800', color: palette.text },
  rowMeta: { fontSize: 12.5, color: palette.textFaint, marginTop: 3, fontWeight: '600' },
});
