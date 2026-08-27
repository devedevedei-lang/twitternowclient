import { openBrowserAsync } from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewNavigation } from 'react-native-webview/lib/WebViewTypes';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { isAllowedWebViewHost } from '@/constants/twitter-now';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  initialUrl: string;
};

export function TwitterNowWebView({ initialUrl }: Props) {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const handleShouldStartLoad = useCallback((request: ShouldStartLoadRequest) => {
    // Auth/payment SDKs (Firebase, Stripe, ...) load their own helper iframes
    // from third-party hosts as part of a normal page load. Only top-frame
    // navigations are candidates for bouncing out to the system browser —
    // subframes must always be allowed to load wherever they point.
    if (!request.isTopFrame || isAllowedWebViewHost(request.url)) {
      return true;
    }
    // A real top-level navigation to a third-party host (checkout, OAuth
    // consent screens, ...) opens in the system browser instead of being
    // trapped inside the in-app WebView.
    openBrowserAsync(request.url);
    return false;
  }, []);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    canGoBackRef.current = navState.canGoBack;
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBackRef.current) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, []);

  if (Platform.OS === 'web') {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.centeredContent}>
          <ThemedText type="subtitle" style={styles.centerText}>
            twitter.now
          </ThemedText>
          <ThemedText style={styles.centerText} themeColor="textSecondary">
            The in-app browser view is only available on iOS and Android. Open twitter.now
            directly in your browser instead.
          </ThemedText>
          <Pressable
            onPress={() => openBrowserAsync(initialUrl)}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <ThemedView type="backgroundElement" style={styles.retryButtonInner}>
              <ThemedText type="link">Open twitter.now</ThemedText>
            </ThemedView>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <WebView
          key={reloadKey}
          ref={webViewRef}
          source={{ uri: initialUrl }}
          style={styles.webView}
          bounces={false}
          overScrollMode="never"
          sharedCookiesEnabled
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          onNavigationStateChange={handleNavigationStateChange}
          onLoadEnd={() => setLoading(false)}
          onError={(syntheticEvent) => {
            setLoading(false);
            setError(syntheticEvent.nativeEvent.description || 'Failed to load twitter.now');
          }}
          onHttpError={(syntheticEvent) => {
            setLoading(false);
            setError(`twitter.now returned an error (${syntheticEvent.nativeEvent.statusCode})`);
          }}
        />
        {loading && !error && (
          <ThemedView style={styles.overlay} pointerEvents="none">
            <ActivityIndicator size="large" color={theme.text} />
          </ThemedView>
        )}
        {error && (
          <ThemedView style={styles.overlay}>
            <SafeAreaView style={styles.centeredContent}>
              <ThemedText type="subtitle" style={styles.centerText}>
                Can&apos;t reach twitter.now
              </ThemedText>
              <ThemedText style={styles.centerText} themeColor="textSecondary">
                {error}
              </ThemedText>
              <Pressable
                onPress={retry}
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
                <ThemedView type="backgroundElement" style={styles.retryButtonInner}>
                  <ThemedText type="link">Retry</ThemedText>
                </ThemedView>
              </Pressable>
            </SafeAreaView>
          </ThemedView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webView: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.two,
  },
  retryButtonInner: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  pressed: {
    opacity: 0.7,
  },
});
