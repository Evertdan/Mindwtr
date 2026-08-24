import { Redirect } from 'expo-router';

// El/La
// as a redirect so direct links/back navigation cannot show the retired menu.
export default function MenuScreen() {
  return <Redirect href="/inbox" />;
}
