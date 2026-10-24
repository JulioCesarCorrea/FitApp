# ADR-0002 — Handlers simples en lugar de librería mediadora

Estado: aceptado (2026-10-23).

## Contexto
Se quiere separar comandos y consultas dentro de cada funcionalidad. MediatR cambió a doble licencia desde la v13 (las fuentes discrepan en umbrales y precios). La alternativa Mediator (MIT) depende de un único mantenedor, sin verificar en esta sesión.

## Decisión
Cada caso de uso es una clase con un método, registrada en el contenedor de dependencias; el endpoint de Minimal API la invoca directamente. La validación va en endpoint filters con FluentValidation, la transacción en un único punto con EF Core, y la auditoría de IA en el servicio de IA.

## Consecuencias
- Sin dependencia ni licencia que revisar.
- Los comportamientos transversales se escriben a mano; si se repiten demasiado, se reevalúa Mediator (las interfaces son casi iguales a las de MediatR).
