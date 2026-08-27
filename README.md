# twitter.now (unofficial mobile client)

An open-source, unofficial mobile app for [twitter.now](https://twitter.now/), built with Expo. Not affiliated with, endorsed by, or sponsored by Operation Bluebird, Inc. or twitter.now.

## Download

**Android**: [Download the latest APK](https://github.com/devedevedei-lang/twitternowclient/releases/latest/download/twitternowclient.apk). You'll need to allow "install unknown apps" for your browser/file manager, since this isn't distributed through the Play Store.

**iOS**: not available yet. Apple doesn't allow installing apps outside the App Store / TestFlight without a paid Apple Developer account, so this needs more setup before it can ship.

## Why a WebView wrapper?

twitter.now doesn't publish a public API, and its [Terms of Service](https://twitter.now/terms-of-service/) prohibit automated access, scraping, and reverse-engineering the software behind the service. So instead of talking to a private API, this app displays the official twitter.now web app (`https://app.twitter.now/`) inside a native screen — the same content you'd see in a mobile browser, just wrapped in a proper app shell:

- Full-screen native app shell with a splash screen (via Expo Router)
- Persistent login across app restarts (the WebView's cookie jar is not cleared between launches)
- Android hardware back button navigates the WebView history
- Links to third-party domains (payment, OAuth, etc.) open in the system browser instead of being trapped inside the app
- Offline / error states with a retry button

If twitter.now ever ships a public API or an official SDK, a native client built on top of that would be the better long-term path — see `src/components/twitter-now-webview.tsx` for where that logic lives today.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

This project uses [file-based routing](https://docs.expo.dev/router/introduction) — screens live in `src/app`.

## Before publishing to an app store

- Consider a name/icon that doesn't imply official affiliation, to avoid trademark confusion with twitter.now / Operation Bluebird.
- Re-check the [Terms of Service](https://twitter.now/terms-of-service/) for changes — this app's approach depends on staying within them.

## Contributing

Issues and PRs are welcome.
