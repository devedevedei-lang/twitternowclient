import { openBrowserAsync } from 'expo-web-browser';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewNavigation } from 'react-native-webview/lib/WebViewTypes';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { isAllowedWebViewHost } from '@/constants/twitter-now';
import { useTheme } from '@/hooks/use-theme';

// Loads Google's client-side page-translate widget into the WebView, the
// same mechanism sites use to embed a "Translate this page" banner. Safe to
// call repeatedly — it no-ops once the widget is already initialized, and
// re-initializes it if the SPA has re-rendered the page since.
const TRANSLATE_INJECTION_SCRIPT = `
(function () {
  var targetLang = (navigator.language || 'en').split('-')[0];

  function selectLanguage() {
    var select = document.querySelector('select.goog-te-combo');
    if (!select) return false;
    if (select.value !== targetLang) {
      select.value = targetLang;
      select.dispatchEvent(new Event('change'));
    }
    return true;
  }

  function pollForSelect() {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (selectLanguage() || attempts > 40) {
        clearInterval(timer);
      }
    }, 250);
  }

  function initTranslate() {
    if (window.google && window.google.translate && window.google.translate.TranslateElement) {
      var containerId = 'google_translate_element';
      if (!document.getElementById(containerId)) {
        var container = document.createElement('div');
        container.id = containerId;
        // Off-screen rather than display:none — some versions of the widget
        // fail to initialize its language <select> when the host is hidden.
        container.style.cssText = 'position:absolute;top:-9999px;left:-9999px;';
        document.body.appendChild(container);
      }
      if (!window.__twitterNowTranslateElement) {
        window.__twitterNowTranslateElement = new window.google.translate.TranslateElement(
          { pageLanguage: 'auto', autoDisplay: false },
          containerId
        );
      }
      pollForSelect();
      return true;
    }
    return false;
  }

  if (initTranslate()) {
    return true;
  }

  if (!document.getElementById('google-translate-script')) {
    window.googleTranslateElementInit = initTranslate;
    var script = document.createElement('script');
    script.id = 'google-translate-script';
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    document.body.appendChild(script);
  }
})();
true;
`;

type Props = {
  initialUrl: string;
};

export function TwitterNowWebView({ initialUrl }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const translatePage = useCallback(() => {
    webViewRef.current?.injectJavaScript(TRANSLATE_INJECTION_SCRIPT);
  }, []);

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
        {!loading && !error && (
          <Pressable
            onPress={translatePage}
            hitSlop={Spacing.two}
            style={({ pressed }) => [
              styles.translateButton,
              { bottom: insets.bottom + Spacing.three, right: insets.right + Spacing.three },
              pressed && styles.pressed,
            ]}>
            <ThemedView type="backgroundElement" style={styles.translateButtonInner}>
              <SymbolView
                tintColor={theme.textSecondary}
                name={{ ios: 'globe', android: 'translate', web: 'translate' }}
                size={20}
              />
            </ThemedView>
          </Pressable>
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
  translateButton: {
    position: 'absolute',
  },
  translateButtonInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
