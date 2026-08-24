import { isEntityOpenUrl, isOpenFeatureUrl, parseOpenFeatureUrl, resolveOpenFeaturePath } from '@/lib/capture-deeplink';

// Expo Router enruta URLs del sistema entrantes por ruta, por lo que mindwtr://open-feature
// would land on the Unmatched Route screen before the root-layout hook can
// redirect. Rewrite it to the destination route up front (#755).
//
// Entity-open links (mindwtr://open?task=...) get the same treatment (#1017):
// land on /inbox immediately so there's no Unmatched Route flash, then
// useRootLayoutExternalCapture's incoming-URL effect (which still sees the
// original URL via Linking.useURL()) resolves the real entity once data is
// ready and re-navigates.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
    try {
        if (isOpenFeatureUrl(path)) {
            return resolveOpenFeaturePath(parseOpenFeatureUrl(path)?.feature ?? null);
        }
        if (isEntityOpenUrl(path)) {
            return '/inbox';
        }
    } catch {
        // redirectSystemPath must never throw; fall through to the original path.
    }
    return path;
}
