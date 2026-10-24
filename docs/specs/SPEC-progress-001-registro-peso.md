# SPEC-progress-001 — Registro de peso corporal (esqueleto)

Estado: aprobada (esqueleto de Fase 1)
Constitución: P2 (idempotencia/offline), P7 (aislamiento)

## Problema
Es el registro mínimo para probar el camino completo app → API → Postgres, incluyendo reintentos desde una cola offline y aislamiento entre personas. No pretende ser la funcionalidad final de seguimiento de peso.

## Alcance
Incluye: crear un registro de peso, listar los propios.
Excluye: tendencias, edición, borrado, autenticación real (se usa un usuario de desarrollo detrás de `ICurrentUser`; el login real es otra spec).

## Criterios de aceptación
- AC-progress-001-01: Dado un cliente con un `id` (GUID) generado en el dispositivo, cuando envía `POST /weights` con peso 80.5 kg y fecha, entonces responde 201 y el registro queda guardado con ese `id` y su `user_id`.
- AC-progress-001-02: Dado un registro ya guardado, cuando el mismo cliente reenvía exactamente la misma petición (mismo `id`), entonces responde 200 con el registro existente y no se crea un duplicado.
- AC-progress-001-03: Dado un `id` existente de otra persona, cuando otro usuario envía `POST /weights` con ese `id`, entonces responde 409 y no se modifica ni revela el registro ajeno.
- AC-progress-001-04: Dado un peso fuera de (20, 500) kg o una fecha en el futuro lejano (más de 1 día adelante), cuando se envía, entonces responde 400 con ProblemDetails y no guarda nada.
- AC-progress-001-05: Dados registros de dos usuarios, cuando un usuario lista `GET /weights`, entonces recibe solo los suyos, ordenados por fecha descendente.

## Reglas y datos
- Peso en kilogramos con hasta 2 decimales; fecha-hora en UTC.
- Datos clase C si algún día se envían a la IA (detalle de registros); las tendencias serán clase B.

## Contratos
- `POST /weights` body `{ id, weightKg, measuredAt }` → 201 | 200 | 400 | 409
- `GET /weights` → 200 `[ { id, weightKg, measuredAt } ]`

## Pruebas
Los tests de integración usan Postgres real (Testcontainers) y citan su AC en el nombre.
