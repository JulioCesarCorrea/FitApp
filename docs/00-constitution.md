# Constitución del proyecto

Principios no negociables. Cualquier spec o cambio que los contradiga debe modificar primero este documento y registrar un ADR.

## P1 — Útil sin IA
Registro, cálculo de calorías y macros, estadísticas y reglas de progresión son deterministas y funcionan sin IA. La IA añade análisis y personalización; ninguna operación básica depende de ella.

## P2 — Datos bajo control del usuario
PostgreSQL propio como fuente de verdad. La app permite registrar sin conexión (cola local con reintentos idempotentes). Cada persona puede exportar y borrar sus datos. Hay copias de seguridad propias, no solo las del proveedor de hosting.

## P3 — Restricciones médicas como datos
Cada persona registra sus restricciones (condición, zonas, movimientos a evitar, origen, nivel). La IA las recibe en cada generación. Niveles:
- `contexto`: solo informa a la IA.
- `aviso`: avisa si una propuesta choca.
- `bloqueo`: impide ofrecer o aceptar una propuesta incompatible sin pasar por el aviso de bloqueo.

Cada persona decide el nivel de sus propias restricciones. La app no diagnostica ni sustituye a profesionales sanitarios.

## P4 — Cálculos deterministas, IA explicable
Las métricas (macros, volumen, tendencia de peso, series efectivas) se calculan con código. La IA distingue entre dato registrado, estimación e inferencia, y cita las fuentes de cada afirmación. No inventa mediciones ni modifica el historial: sus escrituras son propuestas que el usuario confirma.

## P5 — Privacidad de datos hacia la IA
| Clase | Ejemplos | ¿Sale a la IA? |
|---|---|---|
| A | Nombre, correo, ubicación, historial clínico detallado, documentos médicos | Nunca |
| B | Restricciones como etiquetas funcionales, tendencias, macros diarios | Solo agregados, sin identificadores |
| C | Series y comidas concretas, fotos de comida | Solo con opt-in por función |

Cada llamada a la IA se construye desde un contrato tipado y se guarda en una tabla de auditoría (datos enviados, modelo, tokens, coste, respuesta).

## P6 — Coste acotado
Tope global de 30 USD/mes solo para IA, y un tope por persona (~5 USD). Si se supera, la IA se desactiva; el resto de la app sigue funcionando.

## P7 — Aislamiento entre usuarios
Todo dato lleva `user_id`. Un test automático verifica que una persona no puede leer datos de otra.

## P8 — Alcance
Fuera de alcance: diagnóstico clínico, app propia en reloj, publicación en tiendas abiertas, uso comercial.
