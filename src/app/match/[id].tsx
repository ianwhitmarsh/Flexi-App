import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar, IconButton, Screen } from '@/components/ui';
import { palette, radius } from '@/constants/theme';
import { useSession } from '@/lib/session';
import type { Match, Message } from '@/lib/types';
import { formatDate, formatTimeRange } from '@/lib/util';

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { backend, account } = useSession();
  const me = account?.session.userId;
  const isWorker = account?.role === 'worker';

  const [match, setMatch] = useState<Match | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  const append = useCallback((m: Message) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);

  useEffect(() => {
    if (!id) return;
    let unsub = () => {};
    (async () => {
      const [mt, msgs] = await Promise.all([backend.getMatch(id), backend.listMessages(id)]);
      setMatch(mt);
      setMessages(msgs);
      setLoading(false);
      unsub = backend.subscribeMessages(id, append);
    })();
    return () => unsub();
  }, [id, backend, append]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !id) return;
    setDraft('');
    try {
      const msg = await backend.sendMessage(id, body);
      append(msg);
    } catch {
      setDraft(body);
    }
  };

  const counterpartName = isWorker
    ? match?.business?.companyName ?? match?.shift?.business?.companyName ?? 'Business'
    : match?.worker?.fullName ?? 'Worker';

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <Avatar name={counterpartName} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName} numberOfLines={1}>
            {counterpartName}
          </Text>
          {match?.shift && (
            <Text style={styles.headerShift} numberOfLines={1}>
              {match.shift.title}
            </Text>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={palette.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.messages}
            showsVerticalScrollIndicator={false}
          >
            {match?.shift && (
              <View style={styles.contextCard}>
                <Text style={styles.contextTitle}>{match.shift.title}</Text>
                <Text style={styles.contextMeta}>
                  ${match.shift.payRate}/{match.shift.payType} · {formatDate(match.shift.date)} ·{' '}
                  {formatTimeRange(match.shift.startTime, match.shift.endTime)}
                </Text>
                <Text style={styles.contextHint}>You matched 🎉 — sort out the details below.</Text>
              </View>
            )}
            {messages.map((m) => {
              const mine = m.senderId === me;
              return (
                <View key={m.id} style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{m.body}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.inputBar}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message…"
              placeholderTextColor={palette.textFaint}
              style={styles.input}
              multiline
              onSubmitEditing={send}
            />
            <Pressable
              onPress={send}
              disabled={!draft.trim()}
              style={[styles.sendBtn, !draft.trim() && styles.sendDisabled]}
            >
              <Ionicons name="arrow-up" size={22} color="#fff" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  headerName: { fontSize: 16, fontWeight: '800', color: palette.text },
  headerShift: { fontSize: 12.5, color: palette.primaryDeep, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messages: { padding: 16, gap: 8 },
  contextCard: {
    backgroundColor: palette.card,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: palette.border,
  },
  contextTitle: { fontSize: 15, fontWeight: '800', color: palette.text },
  contextMeta: { fontSize: 13, color: palette.textMuted, marginTop: 3, fontWeight: '600' },
  contextHint: { fontSize: 13, color: palette.primaryDeep, marginTop: 8, fontWeight: '700' },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  bubbleMine: { backgroundColor: palette.primary, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: palette.card, borderBottomLeftRadius: 6 },
  bubbleText: { fontSize: 15, color: palette.text, lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.bg,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: palette.card,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: palette.border,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: palette.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
});
