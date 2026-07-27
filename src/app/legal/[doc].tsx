/** A single legal document. Reachable signed out — see legal/index.tsx. */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState, IconButton, Screen } from '@/components/ui';
import { getLegalDoc } from '@/constants/legal';
import { palette, radius } from '@/constants/theme';

export default function LegalDocScreen() {
  const router = useRouter();
  const { doc: docId } = useLocalSearchParams<{ doc: string }>();
  const doc = getLegalDoc(docId ?? '');

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
      </View>

      {!doc ? (
        <EmptyState
          icon="document-text-outline"
          title="Document not found"
          subtitle="That agreement does not exist. Go back and pick one from the list."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>{doc.title}</Text>
          <Text style={styles.meta}>
            Version {doc.version} · Last updated {doc.updated}
          </Text>

          {doc.isPlaceholder && (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Placeholder — not a binding agreement</Text>
              <Text style={styles.noticeBody}>
                This text is a stand-in so the app can be reviewed end to end. It has not been
                written or checked by a lawyer, and nothing in it binds you or Flexi.
              </Text>
            </View>
          )}

          {doc.body.map((para, i) => (
            <Text key={i} style={styles.para}>
              {para}
            </Text>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 12, paddingTop: 4 },
  body: { paddingHorizontal: 24, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '900', color: palette.text, letterSpacing: -0.5 },
  meta: { fontSize: 13, color: palette.textFaint, marginTop: 6, fontWeight: '600' },
  notice: {
    marginTop: 20,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: palette.tintPrimary,
    borderWidth: 1,
    borderColor: palette.primary,
    gap: 6,
  },
  noticeTitle: { fontSize: 14, fontWeight: '900', color: palette.primaryDeep },
  noticeBody: { fontSize: 13.5, color: palette.textSecondary, lineHeight: 20 },
  para: { fontSize: 15, color: palette.text, lineHeight: 23, marginTop: 16 },
});
