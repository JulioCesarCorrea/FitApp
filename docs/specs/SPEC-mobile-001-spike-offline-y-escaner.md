# SPEC-mobile-001 — Spike: registro sin conexión, sincronización y escáner

Estado: aprobada (spike de Fase 1; código desechable en lo visual, la lógica de sincronización sí es base)
Constitución: P2 (offline e idempotencia)
Depende de: SPEC-progress-001

## Problema
Antes de construir el producto hay que comprobar, en un Android y en un iPhone reales, que el camino teléfono → SQLite local → API → Postgres funciona sin perder ni duplicar datos, y que la cámara lee códigos de barras de alimentos.

## Alcance
Incluye: pantalla para registrar peso, lista local con estado, botón de sincronizar, escáner de códigos EAN/UPC que muestra el código leído.
Excluye: login real (usa `X-User-Id` de desarrollo), búsqueda del alimento por código, diseño visual, navegación con Expo Router, sincronización automática en segundo plano.

## Criterios de aceptación
- AC-mobile-001-01: Dado el teléfono sin conexión, cuando la persona guarda un peso, entonces se guarda en SQLite local con un UUID generado en el dispositivo y estado `pendiente`, sin llamar a la red.
- AC-mobile-001-02: Dados registros pendientes y conexión, cuando se sincroniza, entonces se envían en orden de creación y cada uno que la API acepta (201 o 200) pasa a `sincronizado`.
- AC-mobile-001-03: Dada una falla de red o un error 5xx/401 durante la sincronización, cuando ocurre, entonces el registro y los siguientes quedan `pendiente`, la sincronización se detiene y no se pierde ningún dato; al reintentar se reenvía el mismo UUID.
- AC-mobile-001-04: Dada una respuesta 400 o 409 de la API, cuando se sincroniza, entonces ese registro pasa a `rechazado` con el motivo y la sincronización continúa con los demás.
- AC-mobile-001-05 (manual en dispositivo): Dado un código EAN-13, EAN-8, UPC-A o UPC-E frente a la cámara, cuando se escanea, entonces la app muestra el tipo y el valor leído, en Android y en iPhone.

## Reglas y datos
- El UUID se genera una sola vez al guardar; es la clave de idempotencia con la API.
- Los pendientes se envían por fecha de creación ascendente.
- Solo se reintenta lo recuperable (red, 5xx, 401); 400 y 409 no se reintentan.

## Contratos
Usa `POST /weights` de SPEC-progress-001 con el encabezado `X-User-Id`.
Configuración: `EXPO_PUBLIC_API_URL` y `EXPO_PUBLIC_DEV_USER_ID` (ver `.env.example`).

## Pruebas
- AC-01 a AC-04: pruebas automáticas de la lógica con almacén y cliente simulados.
- AC-05 y el viaje completo: lista de verificación manual en Android e iPhone (README de `src/mobile`).
