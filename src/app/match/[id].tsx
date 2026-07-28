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
import { buildOpener } from '@/lib/opener';
import { useSession } from '@/lib/session';
import type { Match, Message } from '@/lib/types';
import { formatDate, formatRate, formatTimeRange, isShiftLive } from '@/lib/util';

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
  /** Hides the opener for this visit without recording a discard. */
  const [openerHidden, setOpenerHidden] = useState(false);
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

  const send = async (text?: string) => {
    const body = (text ?? draft).trim();
    if (!body || !id) return;
    if (text === undefined) setDraft('');
    try {
      const msg = await backend.sendMessage(id, body);
      append(msg);
    } catch {
      if (text === undefined) setDraft(body);
    }
  };

  /**
   * The opener Flexi suggests to the employer, built from their own voice
   * profile. It is derived here and never stored, so nothing exists that could
   * leak to the worker — they see a message only once it is actually sent.
   *
   * BIG-46 replaces the text source with a generated one behind this same
   * shape; everything about who sees it and who sends it stays as it is.
   */
  const opener =
    match && !isWorker
      ? buildOpener(match.business?.companyName ?? '', match.business?.aiProfile ?? {}, {
          workerFirstName: match.worker?.fullName?.split(' ')[0],
          shiftTitle: match.shift?.title,
        })
      : '';

  /**
   * Whether this shift is still something a worker could end up doing. A
   * `filled` shift went to somebody else, `closed` was called off, and an ended
   * one is simply over.
   */
  const shiftIsLive = !!match?.shift && isShiftLive(match.shift);

  const showOpener =
    !loading &&
    !isWorker &&
    !!match &&
    messages.length === 0 &&
    !match.openerDismissedAt &&
    !openerHidden &&
    // The opener ends "Any questions before the shift?", which reads as *you
    // are working this*. On a shift that is gone, that is not true and one tap
    // would send it. The employer can still write whatever they like.
    shiftIsLive;

  const discardOpener = async () => {
    setOpenerHidden(true);
    try {
      if (id) await backend.dismissOpenerDraft(id);
    } catch {
      // Discarding is a preference, not data: if it fails the draft simply
      // comes back next time rather than the employer seeing an error.
      setOpenerHidden(false);
    }
  };

  /**
   * What the thread is about, in the present tense only while that is true.
   * Once a shift is filled, called off, or over, saying somebody "is
   * interested" describes work that is no longer on offer.
   */
  const contextHint = (() => {
    const status = match?.shift?.status;
    if (shiftIsLive) {
      return isWorker
        ? "You're interested in this shift — sort out the details below."
        : 'They’re interested in this shift — sort out the details below.';
    }
    if (status === 'filled') {
      return isWorker
        ? 'This shift has been filled.'
        : 'This shift is filled — you can still message them.';
    }
    if (status === 'closed') {
      return isWorker
        ? 'This shift was closed by the employer.'
        : 'You closed this shift — you can still message them.';
    }
    return isWorker ? 'This shift has ended.' : 'This shift has ended — you can still message them.';
  })();

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
                  {formatRate(match.shift.payRateCents)}/{match.shift.payType} · {formatDate(match.shift.date)} ·{' '}
                  {formatTimeRange(match.shift.startTime, match.shift.endTime)}
                </Text>
                <Text style={styles.contextHint}>{contextHint}</Text>
              </View>
            )}

            {showOpener && (
              <View style={styles.openerCard}>
                <View style={styles.openerTop}>
                  <Ionicons name="sparkles" size={14} color={palette.primaryDeep} />
                  <Text style={styles.openerLabel}>Draft — only you can see this</Text>
                </View>
                <Text style={styles.openerBody}>{opener}</Text>
                <View style={styles.openerActions}>
                  <Pressable
                    onPress={() => send(opener)}
                    style={({ pressed }) => [styles.openerSend, pressed && styles.pressed]}
                  >
                    <Text style={styles.openerSendText}>Send</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setDraft(opener);
                      setOpenerHidden(true);
                    }}
                    style={({ pressed }) => [styles.openerGhost, pressed && styles.pressed]}
                  >
                    <Text style={styles.openerGhostText}>Edit</Text>
                  </Pressable>
                  <Pressable
                    onPress={discardOpener}
                    style={({ pressed }) => [styles.openerGhost, pressed && styles.pressed]}
                  >
                    <Text style={styles.openerGhostText}>Discard</Text>
                  </Pressable>
                </View>
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
              onSubmitEditing={() => send()}
            />
            <Pressable
              onPress={() => send()}
              disabled={!draft.trim()}
              style={[styles.sendBtn, !draft.trim() && styles.sendDisabled]}
            >
              <Ionicons name="arrow-up" size={22} color={palette.onPrimary} />
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

  // ---- suggested opener, employer-only ----
  openerCard: {
    backgroundColor: palette.cardAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderStyle: 'dashed',
    padding: 14,
    gap: 10,
    marginBottom: 4,
  },
  openerTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  openerLabel: {
    fontSize: 11.5,
    fontWeight: '900',
    color: palette.primaryDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  openerBody: { fontSize: 14.5, color: palette.text, lineHeight: 21 },
  openerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  openerSend: {
    backgroundColor: palette.primary,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  openerSendText: { color: palette.onGradientText, fontSize: 13.5, fontWeight: '800' },
  openerGhost: { paddingHorizontal: 12, paddingVertical: 9 },
  openerGhostText: { color: palette.textMuted, fontSize: 13.5, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  bubbleMine: { backgroundColor: palette.primary, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: palette.card, borderBottomLeftRadius: 6 },
  bubbleText: { fontSize: 15, color: palette.text, lineHeight: 20 },
  bubbleTextMine: { color: palette.onPrimary },
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
