import { TwitterNowWebView } from '@/components/twitter-now-webview';
import { TwitterNowUrls } from '@/constants/twitter-now';

export default function HomeScreen() {
  return <TwitterNowWebView initialUrl={TwitterNowUrls.login} />;
}
