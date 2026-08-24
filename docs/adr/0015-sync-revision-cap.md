# ADR 0015: Límite de revisiones de sincronización en techo de entero seguro

Fecha: 2026-05-06
Estado: Aceptado

## Contexto

Mindwtr utiliza valores `rev` por entidad para romper conflictos de sincronización de otra manera ambiguos. Las revisiones se almacenan en instantáneas JSON y pueden pasar a través de puentes de JavaScript, SQLite y plataforma.

El uso normal no alcanzará los límites de enteros, pero una migración mala o un bucle de reparación podría inflar los valores de revisión. Si las revisiones se desbordan o se vuelven no finitas, la resolución de conflicto determinista se vuelve poco confiable.

## Decisión

Limitar revisiones de sincronización a `2_147_483_647`, el techo de entero de 32 bits con signo.

Cuando una revisión está por encima del techo, normalizar hacia abajo al límite e registrar una advertencia de sincronización. Al incrementar una revisión en o por encima del techo, preservar el valor limitado e registrar una advertencia en lugar de desbordarse. Cuando una revisión cruza el 90% del techo, registrar una advertencia para que una migración defectuosa pueda detectarse antes de que el valor se estabilice.

## Consecuencias

- El ordenamiento de conflictos permanece determinista incluso para valores de revisión corruptos u oversized.
- Un dispositivo en el techo ya no puede expresar cambios más recientes a través de `rev`; las reglas de marca de tiempo y eliminación/activa aún se aplican.
- La advertencia es intencionalmente ruidosa porque alcanzar este rango solo debe suceder después de un error o un problema de reparación de datos.
