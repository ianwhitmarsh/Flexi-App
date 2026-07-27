/** Generic Tinder-style swipe deck (gesture + Reanimated), with action buttons. */

import { Ionicons } from '@expo/vector-icons';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { palette, radius, shadow } from '@/constants/theme';

const SCREEN = Dimensions.get('window').width;
const THRESHOLD = SCREEN * 0.26;
const OFF = SCREEN * 1.5;

export type SwipeDir = 'like' | 'pass' | 'super';

export function SwipeDeck<T>({
  data,
  keyExtractor,
  renderCard,
  onSwipe,
  onDepleted,
  renderEmpty,
  showSuper = true,
}: {
  data: T[];
  keyExtractor: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onSwipe: (item: T, dir: SwipeDir) => void;
  onDepleted?: () => void;
  renderEmpty?: () => ReactNode;
  showSuper?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  // Reset when a fresh deck is loaded.
  useEffect(() => {
    setIndex(0);
    x.value = 0;
    y.value = 0;
  }, [data, x, y]);

  useEffect(() => {
    if (data.length > 0 && index >= data.length) onDepleted?.();
  }, [index, data.length, onDepleted]);

  const commit = useCallback(
    (dir: SwipeDir) => {
      const item = data[index];
      if (item) onSwipe(item, dir);
      setIndex((i) => i + 1);
      x.value = 0;
      y.value = 0;
    },
    [data, index, onSwipe, x, y],
  );

  const fling = useCallback(
    (dir: SwipeDir) => {
      if (dir === 'super') {
        x.value = withTiming(0, { duration: 260 });
        y.value = withTiming(-OFF, { duration: 260 }, (f) => {
          if (f) runOnJS(commit)(dir);
        });
      } else {
        x.value = withTiming(dir === 'like' ? OFF : -OFF, { duration: 260 }, (f) => {
          if (f) runOnJS(commit)(dir);
        });
      }
    },
    [commit, x, y],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          x.value = e.translationX;
          y.value = e.translationY;
        })
        .onEnd((e) => {
          if (e.translationX > THRESHOLD) {
            x.value = withTiming(OFF, { duration: 220 }, (f) => {
              if (f) runOnJS(commit)('like');
            });
          } else if (e.translationX < -THRESHOLD) {
            x.value = withTiming(-OFF, { duration: 220 }, (f) => {
              if (f) runOnJS(commit)('pass');
            });
          } else if (showSuper && e.translationY < -THRESHOLD && Math.abs(e.translationX) < THRESHOLD) {
            y.value = withTiming(-OFF, { duration: 220 }, (f) => {
              if (f) runOnJS(commit)('super');
            });
          } else {
            x.value = withSpring(0);
            y.value = withSpring(0);
          }
        }),
    [commit, showSuper, x, y],
  );

  const topStyle = useAnimatedStyle(() => {
    const rot = interpolate(x.value, [-SCREEN / 2, SCREEN / 2], [-9, 9], Extrapolation.CLAMP);
    return {
      transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${rot}deg` }],
    };
  });
  const likeBadge = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [12, THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const nopeBadge = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-THRESHOLD, -12], [1, 0], Extrapolation.CLAMP),
  }));
  const superBadge = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [-THRESHOLD, -12], [1, 0], Extrapolation.CLAMP),
  }));

  const top = data[index];
  const behind = data[index + 1];

  if (!top) {
    return <View style={styles.deck}>{renderEmpty?.() ?? null}</View>;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.deck}>
        {behind && (
          <View key={keyExtractor(behind)} style={[styles.card, styles.behind]} pointerEvents="none">
            {renderCard(behind)}
          </View>
        )}
        <GestureDetector gesture={pan}>
          <Animated.View key={keyExtractor(top)} style={[styles.card, topStyle]}>
            {renderCard(top)}
            <Animated.View style={[styles.badge, styles.badgeLike, likeBadge]}>
              <Text style={[styles.badgeText, { color: palette.like }]}>LIKE</Text>
            </Animated.View>
            <Animated.View style={[styles.badge, styles.badgeNope, nopeBadge]}>
              <Text style={[styles.badgeText, { color: palette.pass }]}>NOPE</Text>
            </Animated.View>
            {showSuper && (
              <Animated.View style={[styles.badge, styles.badgeSuper, superBadge]}>
                <Text style={[styles.badgeText, { color: palette.superlike }]}>SUPER</Text>
              </Animated.View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.actions}>
        <ActionButton icon="close" color={palette.pass} size={28} onPress={() => fling('pass')} />
        {showSuper && (
          <ActionButton
            icon="star"
            color={palette.superlike}
            size={22}
            small
            onPress={() => fling('super')}
          />
        )}
        <ActionButton icon="heart" color={palette.like} size={28} onPress={() => fling('like')} />
      </View>
    </View>
  );
}

function ActionButton({
  icon,
  color,
  size,
  small,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  size: number;
  small?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        small && styles.actionSmall,
        pressed && { transform: [{ scale: 0.92 }] },
      ]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  deck: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.xl,
    backgroundColor: palette.card,
    ...shadow.card,
  },
  behind: { transform: [{ scale: 0.94 }, { translateY: 14 }] },
  badge: {
    position: 'absolute',
    top: 28,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 4,
    backgroundColor: palette.onGradientStrong,
  },
  badgeLike: { left: 22, transform: [{ rotate: '-14deg' }], borderColor: palette.like },
  badgeNope: { right: 22, transform: [{ rotate: '14deg' }], borderColor: palette.pass },
  badgeSuper: {
    alignSelf: 'center',
    bottom: 90,
    top: undefined,
    borderColor: palette.superlike,
  },
  badgeText: { fontSize: 26, fontWeight: '900', letterSpacing: 1 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 22,
    paddingVertical: 16,
  },
  action: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: palette.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
  },
  actionSmall: { width: 48, height: 48, borderRadius: 24 },
});
