import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Text, TextInput } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';
import AppNavigator from './src/navigation/AppNavigator';
import { useAppFonts, getFontFamily } from './src/constants/fonts';
import { queryClient } from './src/services/queryClient';

SplashScreen.preventAutoHideAsync();

export default function App() {
  const fontsLoaded = useAppFonts();

  React.useEffect(() => {
    if (fontsLoaded) {
      // Set default font for all Text components
      Text.defaultProps = Text.defaultProps || {};
      Text.defaultProps.style = { fontFamily: getFontFamily('regular') };
      
      // Set default font for all TextInput components
      TextInput.defaultProps = TextInput.defaultProps || {};
      TextInput.defaultProps.style = { fontFamily: getFontFamily('regular') };
      
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <AppNavigator />
          <StatusBar style="dark" />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
