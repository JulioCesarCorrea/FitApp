import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DataProvider } from '../data/DataContext';
import { createDeps, type Deps } from '../data/deps';
import { ThemeProvider, useTheme } from '../theme';

export default function RootLayout() {
  const [deps, setDeps] = useState<Deps | null>(null);

  useEffect(() => {
    createDeps().then(setDeps);
  }, []);

  if (!deps) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <DataProvider deps={deps}>
      <ThemeProvider store={deps.store}>
        <Navigation />
      </ThemeProvider>
    </DataProvider>
  );
}

function Navigation() {
  const { colors, scheme } = useTheme();

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="exercise/[id]" options={{ title: 'Ejercicio', presentation: 'modal' }} />
        <Stack.Screen name="session/[exerciseId]" options={{ title: 'Registrar sesión', presentation: 'modal' }} />
      </Stack>
    </>
  );
}
