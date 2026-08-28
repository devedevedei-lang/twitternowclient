import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { UptimeMonitorUrl } from '@/constants/twitter-now';

export type NotificationPermissionStatus = 'granted' | 'undetermined' | 'denied' | 'unsupported';

/**
 * expo-notifications must be imported dynamically: importing it statically
 * throws at module-evaluation time in Expo Go on Android (remote push was
 * removed from Expo Go in SDK 53+), which would crash the whole module
 * graph before any of this module's own try/catch blocks ever run. A
 * dynamic import's rejection, by contrast, lands inside a surrounding
 * try/catch like any other awaited failure.
 */
async function loadNotifications() {
  return import('expo-notifications');
}

async function registerPushToken(Notifications: Awaited<ReturnType<typeof loadNotifications>>) {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return;

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

  await fetch(`${UptimeMonitorUrl}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

/**
 * Registers this device with the uptime-monitor Worker so it receives a
 * push notification when app.twitter.now goes down or comes back up. Best
 * effort — permission denial or a network hiccup here should never block
 * app usage, so every failure is swallowed. Only registers if permission is
 * already granted; it never prompts (see requestNotificationPermission).
 */
export async function registerForUptimeNotifications() {
  if (Platform.OS === 'web') return;

  try {
    const Notifications = await loadNotifications();

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('uptime-alerts', {
        name: 'Server status alerts',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    await registerPushToken(Notifications);
  } catch {
    // Best effort — see comment above.
  }
}

/** Current notification permission state, for deciding what UI to show. */
export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  if (Platform.OS === 'web') return 'unsupported';

  try {
    const Notifications = await loadNotifications();
    const { status } = await Notifications.getPermissionsAsync();
    return status;
  } catch {
    return 'unsupported';
  }
}

/**
 * Prompts for notification permission (only works pre-first-denial on iOS/
 * Android — once denied, the OS requires going through system settings
 * instead, which callers should do via Linking.openSettings()). Registers
 * the push token immediately on a fresh grant.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (Platform.OS === 'web') return 'unsupported';

  try {
    const Notifications = await loadNotifications();
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === 'granted') {
      await registerPushToken(Notifications);
    }
    return status;
  } catch {
    return 'unsupported';
  }
}
