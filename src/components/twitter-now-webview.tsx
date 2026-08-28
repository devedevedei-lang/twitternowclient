import { openBrowserAsync } from 'expo-web-browser';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewMessageEvent,
  WebViewNavigation,
} from 'react-native-webview/lib/WebViewTypes';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { isAllowedWebViewHost } from '@/constants/twitter-now';
import { useTheme } from '@/hooks/use-theme';
import { getDownScreenStrings } from '@/lib/down-screen-strings';
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  type NotificationPermissionStatus,
} from '@/lib/uptime-notifications';

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

// twitter.now has no native block feature, so this adds one client-side.
// Each tweet is an <article> containing a "Post options" "..." button whose
// dropdown is rendered inline as its next sibling (not a portal), with a
// report item marked by a lucide "flag" icon. The dropdown/menu wording is
// English natively, but the WebView's own translate button (see
// TRANSLATE_INJECTION_SCRIPT above) can rewrite that text into the device's
// language, so nothing here matches on menu wording — only on the lucide
// icon class (untouched by translation) and on "@handle" mentions in
// aria-label/title attributes, which machine translation leaves intact.
// This adds a "Block @{handle}" item after the report item; blocking hides
// every <article> by that author (now and any added later) and remembers
// the block in the page's own localStorage, so it survives reloads without
// native storage. `window.__twitterNowGetBlockedUsers`/`__twitterNowUnblockUser`
// let the native "manage blocked users" UI read and edit that list.
const BLOCK_INJECTION_SCRIPT = `
(function () {
  if (window.__twitterNowBlockInit) return;
  window.__twitterNowBlockInit = true;

  var STORAGE_KEY = 'twitterNowBlockedUsers';
  var BAN_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'class="lucide lucide-ban shrink-0 text-tl-app-text-muted" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="10"></circle><path d="m4.9 4.9 14.2 14.2"></path></svg>';

  function loadBlocked() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  }

  function saveBlocked(set) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {}
  }

  var blocked = loadBlocked();

  // "@handle" mentions survive translation (and are present natively either
  // way) in aria-label/title attributes such as the avatar's "View
  // @handle's profile" or the follow badge's "Follow @handle" — check every
  // such attribute in the article rather than any specific one's wording.
  function articleHandle(article) {
    var candidates = article.querySelectorAll('[aria-label], [title]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var value = el.getAttribute('aria-label') || el.getAttribute('title') || '';
      var match = /@(\\w+)/.exec(value);
      if (match) return match[1].toLowerCase();
    }
    return null;
  }

  function sweepBlocked() {
    if (!blocked.size) return;
    var articles = document.querySelectorAll('article');
    Array.prototype.forEach.call(articles, function (article) {
      var handle = articleHandle(article);
      if (handle && blocked.has(handle)) {
        article.style.setProperty('display', 'none', 'important');
      }
    });
  }

  function unhideAuthor(handle) {
    var articles = document.querySelectorAll('article');
    Array.prototype.forEach.call(articles, function (article) {
      if (articleHandle(article) === handle) {
        article.style.removeProperty('display');
      }
    });
  }

  function postToNative(payload) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  // Exposed so the native side (which owns the "manage blocked users" UI,
  // since the block list itself lives only in this page's localStorage) can
  // read and edit it via injectJavaScript + these globals, then get the
  // result back through postMessage.
  window.__twitterNowGetBlockedUsers = function () {
    postToNative({ type: 'blockedUsers', list: Array.from(blocked) });
  };

  window.__twitterNowUnblockUser = function (handle) {
    blocked.delete(handle);
    saveBlocked(blocked);
    unhideAuthor(handle);
    postToNative({ type: 'blockedUsers', list: Array.from(blocked) });
  };

  function injectBlockMenuItem(menu) {
    var flagIcon = menu.querySelector('svg.lucide-flag');
    var reportButton = flagIcon && flagIcon.closest('button');
    if (!reportButton || reportButton.__twitterNowHandled) return;

    var article = menu.closest('article');
    var handle = article && articleHandle(article);
    if (!handle) return;
    reportButton.__twitterNowHandled = true;

    var triggerButton = menu.previousElementSibling;
    var blockButton = reportButton.cloneNode(true);
    var svg = blockButton.querySelector('svg');
    if (svg) svg.outerHTML = BAN_ICON_SVG;
    var label = blockButton.querySelector('span');
    if (label) label.textContent = 'Block @' + handle;

    blockButton.addEventListener(
      'click',
      function (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        blocked.add(handle);
        saveBlocked(blocked);
        sweepBlocked();
        postToNative({ type: 'blockedUsers', list: Array.from(blocked) });
        if (triggerButton) triggerButton.click();
      },
      true
    );

    reportButton.parentElement.insertBefore(blockButton, reportButton.nextSibling);
  }

  function handleAddedNode(node) {
    if (node.nodeType !== 1) return;
    if (typeof node.querySelector === 'function' && node.querySelector('svg.lucide-flag')) {
      injectBlockMenuItem(node);
    }
  }

  var sweepScheduled = false;
  function scheduleSweep() {
    if (sweepScheduled) return;
    sweepScheduled = true;
    requestAnimationFrame(function () {
      sweepScheduled = false;
      sweepBlocked();
    });
  }

  function start() {
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        Array.prototype.forEach.call(mutation.addedNodes, handleAddedNode);
      });
      scheduleSweep();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    sweepBlocked();
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})();
true;
`;

const FLOAT_BUTTON_SIZE = 40;

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
  const [menuVisible, setMenuVisible] = useState(false);
  const [manageBlockedVisible, setManageBlockedVisible] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermissionStatus | null>(null);

  useEffect(() => {
    if (!error) return;
    getNotificationPermissionStatus().then(setNotificationStatus);
  }, [error]);

  const handleEnableNotifications = useCallback(async () => {
    if (notificationStatus === 'denied') {
      Linking.openSettings();
      return;
    }
    setNotificationStatus(await requestNotificationPermission());
  }, [notificationStatus]);

  const translatePage = useCallback(() => {
    webViewRef.current?.injectJavaScript(TRANSLATE_INJECTION_SCRIPT);
  }, []);

  const requestBlockedUsers = useCallback(() => {
    webViewRef.current?.injectJavaScript(
      'window.__twitterNowGetBlockedUsers && window.__twitterNowGetBlockedUsers(); true;'
    );
  }, []);

  const unblockUser = useCallback((handle: string) => {
    webViewRef.current?.injectJavaScript(
      `window.__twitterNowUnblockUser && window.__twitterNowUnblockUser(${JSON.stringify(handle)}); true;`
    );
  }, []);

  const openManageBlockedUsers = useCallback(() => {
    setMenuVisible(false);
    setManageBlockedVisible(true);
    requestBlockedUsers();
  }, [requestBlockedUsers]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data?.type === 'blockedUsers' && Array.isArray(data.list)) {
        setBlockedUsers(data.list);
      }
    } catch {
      // Ignore malformed/unrelated messages from the page.
    }
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
          // Hardware-accelerated Android WebViews composite in their own
          // layer and can render above sibling views like our Modals
          // regardless of paint order; forcing software compositing keeps
          // the modal backdrop's dimming visible over the whole screen.
          androidLayerType="software"
          injectedJavaScriptBeforeContentLoaded={BLOCK_INJECTION_SCRIPT}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          onNavigationStateChange={handleNavigationStateChange}
          onMessage={handleMessage}
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
            onPress={() => setMenuVisible(true)}
            hitSlop={Spacing.two}
            style={({ pressed }) => [
              styles.floatButton,
              { top: insets.top + Spacing.six, right: insets.right + Spacing.three },
              pressed && styles.pressed,
            ]}>
            <ThemedView type="backgroundElement" style={styles.floatButtonInner}>
              <SymbolView
                tintColor={theme.textSecondary}
                name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
                size={20}
              />
            </ThemedView>
          </Pressable>
        )}
        <Modal
          visible={menuVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuVisible(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setMenuVisible(false)}>
            <View style={[styles.actionSheet, { marginBottom: insets.bottom + Spacing.three }]}>
              <ThemedView type="backgroundElement" style={styles.actionSheetInner}>
                <Pressable
                  onPress={() => {
                    setMenuVisible(false);
                    translatePage();
                  }}
                  style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}>
                  <SymbolView
                    tintColor={theme.text}
                    name={{ ios: 'globe', android: 'translate', web: 'translate' }}
                    size={20}
                  />
                  <ThemedText style={styles.actionRowLabel}>Translate Page</ThemedText>
                </Pressable>
                <View style={[styles.actionDivider, { backgroundColor: theme.backgroundSelected }]} />
                <Pressable
                  onPress={openManageBlockedUsers}
                  style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}>
                  <SymbolView
                    tintColor={theme.text}
                    name={{ ios: 'person.crop.circle.badge.xmark', android: 'person_off', web: 'person_off' }}
                    size={20}
                  />
                  <ThemedText style={styles.actionRowLabel}>Manage Blocked Users</ThemedText>
                </Pressable>
              </ThemedView>
            </View>
          </Pressable>
        </Modal>
        <Modal
          visible={manageBlockedVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setManageBlockedVisible(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setManageBlockedVisible(false)}>
            <Pressable onPress={() => {}} style={styles.manageSheet}>
              <ThemedView
                type="backgroundElement"
                style={[styles.manageSheetInner, { paddingBottom: insets.bottom + Spacing.three }]}>
                <View style={styles.manageHeader}>
                  <ThemedText type="subtitle" style={styles.manageTitle}>
                    Blocked Users
                  </ThemedText>
                  <Pressable onPress={() => setManageBlockedVisible(false)} hitSlop={Spacing.two}>
                    <SymbolView
                      tintColor={theme.textSecondary}
                      name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }}
                      size={22}
                    />
                  </Pressable>
                </View>
                {blockedUsers.length === 0 ? (
                  <ThemedText themeColor="textSecondary" style={styles.manageEmpty}>
                    No blocked users
                  </ThemedText>
                ) : (
                  <ScrollView style={styles.manageList}>
                    {blockedUsers.map((handle) => (
                      <View key={handle} style={styles.manageRow}>
                        <ThemedText style={styles.manageHandle}>@{handle}</ThemedText>
                        <Pressable
                          onPress={() => unblockUser(handle)}
                          style={({ pressed }) => [styles.unblockButton, pressed && styles.pressed]}>
                          <ThemedView type="backgroundSelected" style={styles.unblockButtonInner}>
                            <ThemedText type="link">Unblock</ThemedText>
                          </ThemedView>
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </ThemedView>
            </Pressable>
          </Pressable>
        </Modal>
        {error &&
          (() => {
            const strings = getDownScreenStrings();
            const needsNotificationAction =
              notificationStatus === 'undetermined' || notificationStatus === 'denied';
            return (
              <ThemedView style={styles.overlay}>
                <SafeAreaView style={styles.centeredContent}>
                  <ThemedText type="subtitle" style={styles.centerText}>
                    {strings.title}
                  </ThemedText>
                  <ThemedText style={styles.centerText} themeColor="textSecondary">
                    {strings.message}
                  </ThemedText>
                  <ThemedText style={styles.centerText} themeColor="textSecondary">
                    {error}
                  </ThemedText>
                  {notificationStatus && notificationStatus !== 'unsupported' && (
                    <ThemedText style={styles.centerText} themeColor="textSecondary">
                      {strings.notifyPromise}
                    </ThemedText>
                  )}
                  {needsNotificationAction && (
                    <Pressable
                      onPress={handleEnableNotifications}
                      style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
                      <ThemedView type="backgroundElement" style={styles.retryButtonInner}>
                        <ThemedText type="link">
                          {notificationStatus === 'denied'
                            ? strings.openNotificationSettings
                            : strings.enableNotifications}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={retry}
                    style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
                    <ThemedView type="backgroundElement" style={styles.retryButtonInner}>
                      <ThemedText type="link">{strings.retry}</ThemedText>
                    </ThemedView>
                  </Pressable>
                </SafeAreaView>
              </ThemedView>
            );
          })()}
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
  floatButton: {
    position: 'absolute',
  },
  floatButtonInner: {
    width: FLOAT_BUTTON_SIZE,
    height: FLOAT_BUTTON_SIZE,
    borderRadius: FLOAT_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  actionSheet: {
    marginHorizontal: Spacing.three,
  },
  actionSheetInner: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  actionRowLabel: {
    fontWeight: '600',
  },
  actionDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.three,
  },
  manageSheet: {
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    overflow: 'hidden',
    maxHeight: '70%',
  },
  manageSheetInner: {
    paddingTop: Spacing.three,
  },
  manageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  manageTitle: {
    fontSize: 20,
    lineHeight: 24,
  },
  manageEmpty: {
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  manageList: {
    paddingHorizontal: Spacing.four,
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  manageHandle: {
    flex: 1,
  },
  unblockButton: {
    marginLeft: Spacing.three,
  },
  unblockButtonInner: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.four,
  },
});
