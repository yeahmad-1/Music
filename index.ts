import { LogBox, Platform } from 'react-native';

LogBox.ignoreLogs([
  'Animated: `useNativeDriver` is not supported',
]);

if (Platform.OS === 'web' && typeof console !== 'undefined') {
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useNativeDriver` is not supported')) {
      return;
    }
    originalWarn.apply(console, args);
  };
}

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
