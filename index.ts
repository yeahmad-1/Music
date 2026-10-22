import { LogBox, Platform } from 'react-native';

LogBox.ignoreLogs([
  'Animated: `useNativeDriver` is not supported',
  '[expo-av]: Expo AV has been deprecated',
  'Cannot record touch end without a touch start',
  'Cannot record touch move without a touch start',
]);

if (typeof console !== 'undefined') {
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string') {
      if (
        args[0].includes('useNativeDriver` is not supported') ||
        args[0].includes('Expo AV has been deprecated')
      ) {
        return;
      }
    }
    originalWarn.apply(console, args);
  };

  const originalError = console.error;
  console.error = (...args: any[]) => {
    if (typeof args[0] === 'string') {
      if (
        args[0].includes('Cannot record touch end without a touch start') ||
        args[0].includes('Cannot record touch move without a touch start')
      ) {
        return;
      }
    }
    originalError.apply(console, args);
  };
}

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
