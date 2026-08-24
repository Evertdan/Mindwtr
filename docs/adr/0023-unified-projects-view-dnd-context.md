# 23. DndContext unificado de vista de proyectos

Fecha: 2026-07-04

## Estado

Aceptado

## Contexto

La vista de Proyectos de escritorio acumuló cuatro `DndContext`s de dnd-kit separados: uno en el
espacio de trabajo para reordenamiento de tareas, y uno por grupo de proyecto de barra lateral (activo, diferido,
archivado) para reordenamiento de proyecto y movimientos de proyecto→área (#812). Los arrastradores de dnd-kit no pueden
cruzar límites de contexto, por lo que una fila de tarea nunca pudo alcanzar un proyecto de barra lateral — la
mitad restante de #812 (mover tareas entre proyectos por arrastrar) era estructuralmente
imposible. Alternativas consideradas: arrastrar nativo HTML5 desde el cuerpo de la fila reutilizando el
canalización de arrastrar de calendario (dos gestos de arrastrar competidores por fila e introduce nuevamente el
conflicto de selección de texto corregido en #815) y prueba de impacto manual `elementFromPoint`
en la parte superior del contexto del espacio de trabajo existente (omite el modelo de colisión de dnd-kit con
pegamento hecho a mano).

## Decisión

La vista de Proyectos aloja un solo `DndContext` que abarca la barra lateral y el espacio de trabajo. Cada
elemento arrastreable declara datos tipados (`{ type: 'task', sortable }` o
`{ type: 'project', section }`), y una sola función de detección de colisión se ramifica en
el tipo de arrastrador activo: los arrastradores de proyecto solo ven contenedores de su propia
sección de barra lateral (preservando los límites antiguos por sección), los arrastradores de tareas ven la lista de tareas
(solo en modo de orden manual) más filas de proyecto de barra lateral no archivadas y zonas de área.
Las identificaciones de zona de caída de área se espacian por nombre de sección (`project-area:<section>:<areaId>`)
porque la misma área puede renderizar una zona en varias secciones bajo un contexto. Un
`DragOverlay` lleva el chip de tarea a través de contenedores de desplazamiento de panel; las caídas en objetivos de barra lateral
escriben a través de la ruta de asignación de contenedor central existente en `updateTask`.

## Consecuencias

Un gesto de arrastrado (la manija de agarre) ahora sirve para reordenamiento en lista y movimientos entre paneles,
y los nuevos objetivos de caída solo necesitan un droppable con datos tipados más una rama en el
despachador de final de arrastre. El costo es que todas las interacciones de arrastrado de vista de Proyectos comparten uno
configuración de sensor y función de colisión, por lo que los cambios allí deben considerar cada
tipo de arrastre; los filtros de datos tipados son los guardagujas que mantienen los comportamientos antiguos
(reordenamiento de proyecto, proyecto→área, reordenamiento de tareas) aislados entre sí.
