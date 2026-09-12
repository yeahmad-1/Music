import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { PaperProvider, MD3LightTheme, MD3DarkTheme, adaptNavigationTheme } from 'react-native-paper';
import { AudioProvider } from './src/context/AudioContext';
import LibraryScreen from './src/screens/LibraryScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

const Stack = createStackNavigator();

// Aesthetic "Sakura Minimalist" Light Theme
const customLightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#D81B60',
    primaryContainer: '#FCE4EC',
    secondary: '#00ACC1',
    secondaryContainer: '#E0F7FA',
    surface: '#FFFFFF',
    background: '#FFF8FA', // Softest Pink Tint
    outline: '#E1E1E1',
    onSurface: '#2D2D2D',
  },
};

// Aesthetic "Synthwave Night" Dark Theme
const customDarkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#FF2E63', // Neon Pink
    primaryContainer: '#252A34',
    secondary: '#08D9D6', // Neon Cyan
    secondaryContainer: '#1A1A2E',
    surface: '#16213E', // Deep Navy Surface
    background: '#1A1A2E', // Deep Space Blue Background
    outline: '#393E46',
    onSurface: '#EAEAEA',
  },
};

const { LightTheme: navLightTheme, DarkTheme: navDarkTheme } = adaptNavigationTheme({
  reactNavigationLight: DefaultTheme,
  reactNavigationDark: DarkTheme,
  materialLight: customLightTheme,
  materialDark: customDarkTheme,
});

export default function App() {
  const systemColorScheme = useColorScheme();
  const [isDarkMode, setIsDarkMode] = useState(systemColorScheme === 'dark');

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    const savedTheme = await AsyncStorage.getItem('theme');
    if (savedTheme) {
      setIsDarkMode(savedTheme === 'dark');
    }
  };

  const toggleTheme = async () => {
    setIsDarkMode(prev => {
      const newMode = !prev;
      AsyncStorage.setItem('theme', newMode ? 'dark' : 'light');
      return newMode;
    });
  };

  const theme = isDarkMode ? customDarkTheme : customLightTheme;
  const navigationTheme = isDarkMode ? navDarkTheme : navLightTheme;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AudioProvider>
        <PaperProvider theme={theme}>
          <NavigationContainer theme={navigationTheme}>
            <Stack.Navigator initialRouteName="Library">
              <Stack.Screen 
                name="Library"
                component={LibraryScreen}
              />
              <Stack.Screen
                name="Player"
                component={PlayerScreen}
                options={{
                  title: 'Now Playing',
                  headerStyle: { backgroundColor: theme.colors.surface, elevation: 0, shadowOpacity: 0 },
                  headerTintColor: theme.colors.onSurface,
                  headerTitleStyle: { fontWeight: '900', letterSpacing: 1 },
                }}
              />
              <Stack.Screen
                name="Settings"
                component={SettingsScreen}
                initialParams={{ toggleTheme }}
                options={{
                  title: 'Settings',
                  headerStyle: { backgroundColor: theme.colors.surface, elevation: 0, shadowOpacity: 0 },
                  headerTintColor: theme.colors.onSurface,
                  headerTitleStyle: { fontWeight: '900', letterSpacing: 1 },
                }}
              />
            </Stack.Navigator>
          </NavigationContainer>
        </PaperProvider>
      </AudioProvider>
    </GestureHandlerRootView>
  );
}
