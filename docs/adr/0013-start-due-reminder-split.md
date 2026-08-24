# ADR 0013: Recordatorios de inicio y vencimiento divididos

Fecha: 2026-05-04
Estado: Aceptado

## Contexto

Las tareas de Mindwtr pueden tener una hora de inicio y una fecha de vencimiento. Estos campos responden diferentes preguntas de GTD:

- hora de inicio: cuándo la tarea debe volverse activa
- fecha de vencimiento: cuándo la tarea debe estar terminada

Usar un ajuste de recordatorio para ambos hizo que el comportamiento de notificación fuera ambiguo. Los usuarios que querían una advertencia de fecha de vencimiento podrían accidentalmente recibir alertas de hora de inicio, y los usuarios que querían nudges de inicio no podían ajustarlos por separado de los plazos.

## Decisión

Mindwtr mantiene recordatorios de inicio y recordatorios de vencimiento como configuraciones de notificación separadas y claves de programación.

1. Los recordatorios de inicio se programan desde `startTime`.
2. Los recordatorios de vencimiento se programan desde `dueDate`.
3. El enrutamiento de notificación preserva el tipo de recordatorio para que abrir una notificación pueda aterrizar en el flujo de trabajo correcto.
4. La reprogramación local trata los dos flujos de recordatorio independientemente, luego ajusta y agrupa las alarmas próximas más cercanas para que se respeten los límites de notificación del sistema operativo móvil.

## Consecuencias

- Los usuarios pueden razonar sobre nudges de inicio y alertas de plazo de forma independiente.
- La configuración de recordatorio y el texto deben nombrar ambos conceptos explícitamente.
- Las cargas útiles de sincronización aún almacenan fechas de tareas en la tarea; la división es comportamiento de notificación, no un nuevo modelo de propiedad de tareas.
- Las características futuras de notificación deben evitar acoplarse nuevamente a semántica de inicio y vencimiento a menos que el producto deliberadamente introduzca una política de programación de nivel superior.
