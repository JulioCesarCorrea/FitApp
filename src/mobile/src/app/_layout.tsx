import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { DataProvider } from '../data/DataContext';
import { createDeps, type Deps } from '../data/deps';
import { useDeps } from '../data/DataContext';
import { useAuthState, useProfileGate } from '../data/hooks';
import { ThemeProvider, useTheme } from '../theme';

export default function RootLayout() {
  const [deps, setDeps] = useState<Deps | null>(null);

  useEffect(() => {
    // La sesión guardada se lee antes de pintar nada: así no hay un parpadeo de «Entrar» al abrir.
    createDeps().then(async (d) => {
      await d.auth.restore();
      setDeps(d);
    });
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
  const auth = useAuthState();
  const gate = useProfileGate();
  const { profile, reminders } = useDeps();
  const router = useRouter();

  const signedIn = auth.status === 'signedIn';
  const mustChange = signedIn && auth.user.mustChangePassword;
  const inApp = signedIn && !mustChange;

  // Con la sesión lista se mira si la cuenta tiene perfil; al salir se vuelve a empezar (SPEC-profile-001, AC-11 y 20).
  useEffect(() => {
    if (inApp && gate === 'idle') void profile.resolve();
    else if (!inApp && gate !== 'idle') profile.reset();
  }, [inApp, gate, profile]);

  // SPEC-notify-001, AC-06: los avisos se reprograman al abrir la app, al volver a ella y al salir (así no avisan de lo ya registrado
  // ni se pierden); sin sesión se cancelan todos (AC-07). Tocar un aviso abre su pantalla (AC-08).
  useEffect(() => {
    if (auth.status === 'loading') return;
    void reminders.refresh().catch(() => {});
    const state = AppState.addEventListener('change', () => { void reminders.refresh().catch(() => {}); });
    const tap = reminders.onTap((route) => { if (inApp) router.push(route as never); });
    return () => { state.remove(); tap(); };
  }, [auth.status, inApp, reminders, router]);

  if (auth.status === 'loading' || (inApp && (gate === 'idle' || gate === 'loading'))) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

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
        {/* AC-mobile-004-01: sin sesión solo se ve Entrar y Crear cuenta; el resto redirige a Entrar. */}
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ title: 'Entrar', headerShown: false }} />
          <Stack.Screen name="register" options={{ title: 'Crear cuenta' }} />
        </Stack.Protected>
        <Stack.Protected guard={inApp && gate === 'ready'}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="exercise/[id]" options={{ title: 'Ejercicio', presentation: 'modal' }} />
          <Stack.Screen name="session/[exerciseId]" options={{ title: 'Registrar sesión', presentation: 'modal' }} />
          <Stack.Screen name="food/add" options={{ title: 'Añadir alimento', presentation: 'modal' }} />
          <Stack.Screen name="chat" options={{ title: 'Preguntas' }} />
          <Stack.Screen name="assistant" options={{ title: 'Análisis y planes' }} />
          <Stack.Screen name="ai" options={{ title: 'Inteligencia artificial' }} />
          <Stack.Screen name="reminders" options={{ title: 'Recordatorios' }} />
          <Stack.Screen name="progress/training" options={{ title: 'Progreso de entrenamiento' }} />
          <Stack.Screen name="progress/nutrition" options={{ title: 'Progreso de nutrición' }} />
          <Stack.Screen name="progress/weight" options={{ title: 'Progreso de peso' }} />
          <Stack.Screen name="recipes/index" options={{ title: 'Mis recetas' }} />
          <Stack.Screen name="recipes/edit" options={{ title: 'Receta' }} />
          <Stack.Screen name="profile" options={{ title: 'Mi perfil' }} />
          <Stack.Screen name="restrictions" options={{ title: 'Mis restricciones' }} />
        </Stack.Protected>
        {/* AC-profile-001-11: la cuenta sin perfil ve el asistente de bienvenida. */}
        <Stack.Protected guard={inApp && gate === 'onboarding'}>
          <Stack.Screen name="welcome" options={{ title: 'Bienvenida', headerBackVisible: false, gestureEnabled: false }} />
        </Stack.Protected>
        {/* AC-profile-001-19: sin perfil local y sin servidor no se enseña el asistente. */}
        <Stack.Protected guard={inApp && gate === 'needsConnection'}>
          <Stack.Screen name="connect" options={{ title: 'Sin conexión', headerBackVisible: false }} />
        </Stack.Protected>
        {/* AC-mobile-004-10: con el cambio obligatorio pendiente solo se puede abrir esta pantalla. */}
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="change-password" options={{ title: 'Cambiar contraseña', headerBackVisible: !mustChange }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
