# App móvil (Expo)

Spike de `SPEC-mobile-001`: registro de peso sin conexión, sincronización y escáner de códigos.

## Correr el spike

1. Arrancar la API visible desde la red local (desde la raíz del repo, con Postgres en marcha y migraciones aplicadas):
   `dotnet run --project src/Api --urls http://0.0.0.0:5080`
   La primera vez, Windows pedirá permitir el acceso en el firewall (red privada).
2. Copiar `.env.example` a `.env` y poner la IP de tu PC (`ipconfig`) y un GUID cualquiera.
3. `pnpm install` y `pnpm start`; abrir con **Expo Go** (escanear el QR). Teléfono y PC en la misma WiFi.

## Lista de verificación manual (Android e iPhone)

- [ ] AC-01: con modo avión, guardar un peso → aparece `pendiente`.
- [ ] AC-02: quitar modo avión, pulsar *Sincronizar ahora* → pasa a `sincronizado` y aparece en `GET /weights`.
- [ ] AC-03: apagar la API, guardar un peso → sigue `pendiente`; encender la API y sincronizar → se envía una sola vez.
- [ ] AC-04: guardar un peso de 600 kg → `rechazado` con el motivo.
- [ ] AC-05: escanear un código EAN-13 de un producto → muestra tipo y valor.
- [ ] Cerrar y reabrir la app: los registros siguen ahí.

## Comandos

```
pnpm run typecheck
pnpm run test      # lógica de sincronización (AC-01..04 simulados)
```

Nota: usa `pnpm` (no npm). Para módulos nativos que Expo Go no incluya hará falta un *development build* (EAS).
