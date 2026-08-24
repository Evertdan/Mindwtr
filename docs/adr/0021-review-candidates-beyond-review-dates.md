# ADR 0021: Candidatos de revisión más allá de fechas de revisión

Fecha: 2026-07-01
Estado: Aceptado

## Contexto

El flujo de trabajo de revisión fue estrictamente impulsado por fecha de revisión: los artículos se muestran en Revisión diaria y la sección de revisión de enfoque debida solo cuando `reviewAt` es debido. El problema #804 (consolidación de #685, #317, #724) preguntó si la revisión también debería mostrar candidatos para personas que nunca establecen fechas de revisión.

Las señales de los usuarios se dividen de dos maneras:

- Los usuarios avanzados impulsan todo a través de `someday + review date` y tratan los plazos como compromisos duros solo (#724). Para ellos el modelo impulsado por la fecha funciona y los artículos adicionales son ruido.
- Los usuarios que no establecen fechas de revisión encontraron que las superficies de fecha de revisión estaban vacías y revisaron ad-hoc desde Proyectos/Siguiente/Algún día (#317, #685).

La detección de artículos obsoletos ya existía en núcleo (`getStaleItems`, umbral de 14 días sobre tareas siguiente/en espera y proyectos activos) pero solo fue consumida por el paso de revisión de IA, por lo que los usuarios sin un proveedor de IA nunca la vieron. Por separado, #317 diferido una acción "avanzar fecha de revisión" porque necesitaba una decisión de intervalo.

## Decisión

1. **Revisión semanal obtiene un paso "Artículos obsoletos"; la revisión diaria permanece impulsada por la fecha.** El asistente semanal muestra la lista de `getStaleItems` plana a todos (no se requiere IA). Cuando la revisión de IA está habilitada, las herramientas de análisis de IA aparecen dentro del mismo paso en lugar de un paso solo de IA separado — una superficie, sin duplicación. El paso se salta automáticamente cuando no hay artículos obsoletos, por lo que los usuarios impulsados por la fecha no ven nada nuevo a menos que los artículos realmente se vuelvan obsoletos.
2. **"Revisar en 1 semana" se une a "Marcar revisado" como acción posterior a la revisión.** El intervalo es un fijo de 7 días a partir de ahora (`getAdvancedReviewDate` en core), coincidiendo con el ritmo de revisión semanal. Sin campo de intervalo por tarea y sin perilla de configuración: los intervalos por tarea son complejidad de estilo de recurrencia para una necesidad de nicho y editar `reviewAt` directamente sigue disponible para ritmos personalizados. La nueva fecha preserva la forma de solo fecha vs datetime del valor original.
3. **La lógica candidata se mantiene un predicado central.** Ambas plataformas consumen `getStaleItems` y `getAdvancedReviewDate` de `@mindwtr/core`; sin copias por plataforma.

## Consecuencias

- Los usuarios sin fechas de revisión obtienen una superficie semanal listando artículos descuidados; los usuarios con fechas de revisión disciplinadas no ven cambios a menos que los artículos se bloqueen durante 14+ días.
- Sin nuevos campos de tarea, sin nueva configuración, sin cambio de esquema de sincronización (los escritos de `reviewAt` pasan a través de la ruta de actualización existente).
- El umbral de 14 días obsoleto permanece como predeterminado central en lugar de un ajuste; revisar solo si el uso real muestra el umbral fijo fallando.
