# ADR-0001 — Stack tecnológico

Estado: aceptado (2026-10-23), sujeto a verificación en el spike de Fase 1.

## Contexto
Uso por ~6 personas cercanas, 2 con iPhone y el resto Android. El responsable técnico tiene experiencia en Vue y .NET, y poca en móvil. Requisitos: registro offline, IA sobre datos estructurados, posibles datos de salud del reloj en el futuro.

## Decisión
- **Móvil:** React Native con Expo y TypeScript.
- **Backend:** .NET 10 Minimal API, vertical slices, handlers simples (ver ADR-0002).
- **Base de datos y hosting:** PostgreSQL y API en Railway.
- **Contrato:** cliente TypeScript generado desde OpenAPI.
- **Offline:** SQLite local (expo-sqlite) con cola de sincronización idempotente (IDs generados en el cliente).

## Alternativas descartadas
- Vue con Quasar/Ionic y Capacitor: encaja con la experiencia previa, pero se prefirió React Native por el acceso más establecido a funciones nativas y la integración futura con salud.
- Flutter, .NET MAUI, Kotlin nativo: sin ventaja clara para este perfil.
- Local-first sin backend: descartado por el uso multiusuario y los agentes de IA.

## Consecuencias
- Curva de aprendizaje de React Native.
- Cuenta de Apple Developer para los iPhones; compilar iOS requiere EAS Build o CI macOS.
- Plugins de salud (HealthKit/Health Connect) son de terceros: se verifican al llegar a esa fase.

## Verificación pendiente
Spike de Fase 1: instalar en iPhone con TestFlight, escanear código de barras, registro offline que sincroniza, build Android.
