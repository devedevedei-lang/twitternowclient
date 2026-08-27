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

// Hides posts from a list of usernames, ported from the "Block Specific
// Users' Posts (twitter.now)" userscript. Runs once per WebView page load;
// the MutationObserver keeps it applied as the SPA renders new posts.
const BLOCK_USERS_INJECTION_SCRIPT = `
(function () {
  if (window.__twitterNowBlockUsersInjected) return true;
  window.__twitterNowBlockUsersInjected = true;

  var STORAGE_KEY = 'blocked_users_twitternow';
  // Default usernames blocked out of the box (lowercase, no @)
  var DEFAULT_BLOCKED_USERS = ['kaitlyn', 'not_lake', 'lake', 'karaa', 'elonmask'];
  var ARIA_USERNAME_RE = /@([A-Za-z0-9_]+)/;

  function normalize(name) {
    return name.trim().toLowerCase().replace(/^@/, '');
  }

  function loadBlockedUsers() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : DEFAULT_BLOCKED_USERS.slice();
    } catch (e) {
      return DEFAULT_BLOCKED_USERS.slice();
    }
  }

  function saveBlockedUsers(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  var blockedUsers = loadBlockedUsers();

  function findPostCard(el) {
    return el.closest('article') || el;
  }

  function resetCheckedFlags() {
    document.querySelectorAll('[data-block-checked="1"]').forEach(function (el) {
      delete el.dataset.blockChecked;
    });
  }

  function hideBlockedPosts() {
    var candidates = document.querySelectorAll('[aria-label*="@"]');
    candidates.forEach(function (el) {
      if (el.dataset.blockChecked === '1') return;
      el.dataset.blockChecked = '1';

      var label = el.getAttribute('aria-label') || '';
      var match = label.match(ARIA_USERNAME_RE);
      if (!match) return;

      var username = normalize(match[1]);
      if (blockedUsers.indexOf(username) === -1) return;

      var card = findPostCard(el);
      if (card) card.style.display = 'none';
    });
  }

  function blockUserNow(username) {
    if (blockedUsers.indexOf(username) === -1) {
      blockedUsers.push(username);
      saveBlockedUsers(blockedUsers);
    }
    resetCheckedFlags();
    hideBlockedPosts();
  }

  function makeBlockButton(username) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Block @' + username;
    btn.setAttribute('aria-label', 'Block @' + username);
    btn.dataset.blockBtn = '1';
    btn.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;' +
      'width:32px;height:32px;padding:0;margin-left:2px;border:none;' +
      'border-radius:9999px;background:rgba(127,127,127,0.15);' +
      'cursor:pointer;opacity:1;flex-shrink:0;position:relative;z-index:5;';
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" ' +
      'fill="none" stroke="#71767b" stroke-width="2.25" stroke-linecap="round" ' +
      'stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle>' +
      '<line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>';

    var svg = btn.querySelector('svg');

    btn.addEventListener('mouseenter', function () {
      btn.style.background = 'rgba(239,68,68,0.18)';
      svg.setAttribute('stroke', '#ef4444');
    });
    btn.addEventListener('mouseleave', function () {
      btn.style.background = 'rgba(127,127,127,0.15)';
      svg.setAttribute('stroke', '#71767b');
    });

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      // window.confirm()/alert() aren't reliably wired up to a native dialog
      // inside a WebView, so block immediately instead of gating on them.
      blockUserNow(username);
    });

    return btn;
  }

  function addBlockButtons() {
    var optionButtons = document.querySelectorAll(
      'button[aria-label="Post options"]:not([data-block-btn-added])'
    );
    optionButtons.forEach(function (optionsBtn) {
      optionsBtn.dataset.blockBtnAdded = '1';

      var article = optionsBtn.closest('article');
      if (!article) return;

      var profileLink = article.querySelector('[aria-label^="View @"]');
      if (!profileLink) return;

      var label = profileLink.getAttribute('aria-label') || '';
      var match = label.match(ARIA_USERNAME_RE);
      if (!match) return;

      var username = normalize(match[1]);
      var blockBtn = makeBlockButton(username);
      optionsBtn.parentElement.insertBefore(blockBtn, optionsBtn);
    });
  }

  var observer = new MutationObserver(function () {
    hideBlockedPosts();
    addBlockButtons();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  hideBlockedPosts();
  addBlockButtons();
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
          injectedJavaScript={BLOCK_USERS_INJECTION_SCRIPT}
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
