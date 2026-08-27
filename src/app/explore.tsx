import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Collapsible } from '@/components/ui/collapsible';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { TwitterNowUrls } from '@/constants/twitter-now';
import { useTheme } from '@/hooks/use-theme';

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingBottom: insets.bottom + Spacing.four },
      ]}>
      <ThemedView style={styles.container}>
        <ThemedView style={styles.titleContainer}>
          <ThemedText type="subtitle">About this app</ThemedText>
          <ThemedText style={styles.centerText} themeColor="textSecondary">
            An unofficial, open-source mobile wrapper for twitter.now.
          </ThemedText>

          <ExternalLink href={TwitterNowUrls.marketing} asChild>
            <Pressable style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundElement" style={styles.linkButton}>
                <ThemedText type="link">Open twitter.now</ThemedText>
                <SymbolView
                  tintColor={theme.text}
                  name={{ ios: 'arrow.up.right.square', android: 'link', web: 'link' }}
                  size={12}
                />
              </ThemedView>
            </Pressable>
          </ExternalLink>
        </ThemedView>

        <ThemedView style={styles.sectionsWrapper}>
          <Collapsible title="Not affiliated with Operation Bluebird">
            <ThemedText type="small">
              This app is an independent, community-built project. It is not affiliated with,
              endorsed by, or sponsored by Operation Bluebird, Inc. or twitter.now.
            </ThemedText>
          </Collapsible>

          <Collapsible title="How it works">
            <ThemedText type="small">
              twitter.now doesn&apos;t publish a public API, and its{' '}
              <ThemedText type="code">Terms of Service</ThemedText> prohibit automated access,
              scraping, and reverse engineering. So this app doesn&apos;t talk to any private API
              — it simply displays the official twitter.now web app inside a native screen, the
              same way your mobile browser would.
            </ThemedText>
            <ExternalLink href={TwitterNowUrls.termsOfService}>
              <ThemedText type="linkPrimary">Read the twitter.now Terms of Service</ThemedText>
            </ExternalLink>
          </Collapsible>

          <Collapsible title="Your account">
            <ThemedText type="small">
              You sign in with your own twitter.now account, the same as on the web. This app
              doesn&apos;t collect, store, or transmit your credentials or activity anywhere.
            </ThemedText>
          </Collapsible>

          <Collapsible title="Open source">
            <ThemedText type="small">
              This client is open source. Contributions, bug reports, and feature requests are
              welcome from anyone who wants a better mobile experience for twitter.now.
            </ThemedText>
          </Collapsible>
        </ThemedView>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  container: {
    maxWidth: MaxContentWidth,
    flexGrow: 1,
  },
  titleContainer: {
    gap: Spacing.three,
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
  },
  centerText: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  linkButton: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    justifyContent: 'center',
    gap: Spacing.one,
    alignItems: 'center',
  },
  sectionsWrapper: {
    gap: Spacing.five,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
});
