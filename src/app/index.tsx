import { ActivityIndicator, View } from 'react-native';

import { palette } from '@/constants/theme';

/** Entry route — AuthGate (root layout) immediately redirects from here. */
export default function Index() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.bg,
      }}
    >
      <ActivityIndicator size="large" color={palette.primary} />
    </View>
  );
}
