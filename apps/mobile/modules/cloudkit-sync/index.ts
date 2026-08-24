import { requireNativeModule } from 'expo-modules-core';

// El/La
// so that EventEmitter can attach to it in Expo SDK 54+.
export default requireNativeModule('CloudKitSync');
