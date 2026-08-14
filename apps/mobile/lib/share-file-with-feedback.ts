import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

type Translator = (key: string) => string;

export async function shareFileWithFeedback(
    uri: string,
    t: Translator,
    onError: (error: unknown) => void,
): Promise<void> {
    try {
        const available = await Sharing.isAvailableAsync();
        if (!available) {
            Alert.alert(t('attachments.title'), t('share.unavailable'));
            return;
        }

        await Sharing.shareAsync(uri);
    } catch (error) {
        onError(error);
        Alert.alert(t('attachments.title'), t('share.unavailable'));
    }
}
