import * as Localization from 'expo-localization';

type DownScreenStrings = {
  title: string;
  message: string;
  notifyPromise: string;
  retry: string;
  enableNotifications: string;
  openNotificationSettings: string;
};

const STRINGS: Record<'en' | 'ja', DownScreenStrings> = {
  en: {
    title: "Can't reach twitter.now",
    message: 'The server looks like it might be down right now.',
    notifyPromise: "We'll send you a notification the moment it's back up.",
    retry: 'Retry',
    enableNotifications: 'Enable notifications',
    openNotificationSettings: 'Open notification settings',
  },
  ja: {
    title: 'twitter.now に接続できません',
    message: '現在サーバーがダウンしている可能性があります。',
    notifyPromise: '復旧次第、通知でお知らせします。',
    retry: '再試行',
    enableNotifications: '通知を有効にする',
    openNotificationSettings: '通知設定を開く',
  },
};

/** English by default; Japanese only when the device locale is Japanese. */
export function getDownScreenStrings(): DownScreenStrings {
  const languageCode = Localization.getLocales()[0]?.languageCode;
  return STRINGS[languageCode === 'ja' ? 'ja' : 'en'];
}
