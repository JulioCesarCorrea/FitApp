# fitness-app

Aplicación personal (círculo cercano, ~6 personas) de nutrición, entrenamiento y análisis con asistentes de IA.

Estado: **Fase 1 — fundamentos**. Aún no hay funcionalidades de producto.

## Stack

- App móvil: React Native + Expo + TypeScript (Android e iOS)
- Backend: .NET 10 Minimal API, handlers simples, vertical slices
- Base de datos: PostgreSQL (Railway)
- IA: detrás de una interfaz de proveedor; solo datos agregados, tope mensual

## Requisitos de desarrollo

- .NET SDK 10 (fijado en `global.json`)
- Node 24 y **pnpm** (no usar npm; el lockfile es `pnpm-lock.yaml`)
- Docker (Postgres local con `docker compose up -d` y tests con Testcontainers; en Windows requiere WSL2)
- Android Studio / SDK para compilar Android; iOS se compila con EAS Build

## Comandos

```
docker compose up -d                          # Postgres local
dotnet ef database update --project src/Api   # aplicar migraciones
dotnet run --project src/Api                  # API (usa X-User-Id como usuario de desarrollo)
dotnet test FitnessApp.slnx                   # tests (Testcontainers si hay Docker)
# Sin Docker: apuntar a un Postgres local con permiso CREATEDB; cada ejecución crea y borra su propia base
$env:FITNESS_TEST_PG='Host=localhost;Username=fitness;Password=fitness_dev;Database=postgres'
cd src/mobile && pnpm install && pnpm start   # app móvil
# Imágenes del catálogo (fuera del repo): crea src/Api/appsettings.Local.json (ignorado por git) con
#   { "Exercises": { "ImagesPath": "C:\\ruta\\a\\ejercicios" } }   y deja allí las <ejercicio>-0.jpg y -1.jpg
```

## Cómo trabajamos (SDD ligero)

1. Cada funcionalidad tiene una ficha con criterios de aceptación (`AC-...`).
2. Cada test cita el `AC-...` que verifica.
3. Las decisiones técnicas se registran como ADR.

La documentación de trabajo (constitución, specs, ADR, arquitectura) vive en `.claude/` y no se publica en este repositorio.

## Estructura

```
src/           api (.NET) y mobile (Expo)
tests/         pruebas del backend
```
