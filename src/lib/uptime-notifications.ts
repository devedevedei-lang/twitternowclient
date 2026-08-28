import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { UptimeMonitorUrl } from '@/constants/twitter-now';

/**
 * Registers this device with the uptime-monitor Worker so it receives a
 * push notification when app.twitter.now goes down or comes back up. Best
 * effort — permission denial or a network hiccup here should never block
 * app usage, so every failure is swallowed.
 *
 * expo-notifications must be imported dynamically: importing it statically
 * throws at module-evaluation time in Expo Go on Android (remote push was
 * removed from Expo Go in SDK 53+), which would crash the whole module
 * graph before this function's own try/catch ever runs. A dynamic import's
 * rejection, by contrast, lands inside the try/catch below like any other
 * awaited failure — so this remains a no-op in Expo Go instead of a crash.
 */
export async function registerForUptimeNotifications() {
  if (Platform.OS === 'web') return;

  try {
    const Notifications = await import('expo-notifications');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('uptime-alerts', {
        name: 'Server status alerts',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    await fetch(`${UptimeMonitorUrl}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    // Best effort — see comment above.
  }
}
