import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { TwitterNowWebView } from '@/components/twitter-now-webview';
import { Spacing } from '@/constants/theme';
import { TwitterNowUrls } from '@/constants/twitter-now';
import { useTheme } from '@/hooks/use-theme';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  return (
    <ThemedView style={styles.container}>
      <TwitterNowWebView initialUrl={TwitterNowUrls.login} />
      <Pressable
        onPress={() => router.push('/explore')}
        hitSlop={Spacing.two}
        style={({ pressed }) => [
          styles.infoButton,
          { top: insets.top + Spacing.two, right: insets.right + Spacing.two },
          pressed && styles.pressed,
        ]}>
        <ThemedView type="backgroundElement" style={styles.infoButtonInner}>
          <SymbolView
            tintColor={theme.textSecondary}
            name={{ ios: 'info.circle', android: 'info', web: 'info' }}
            size={18}
          />
        </ThemedView>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  infoButton: {
    position: 'absolute',
  },
  infoButtonInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
