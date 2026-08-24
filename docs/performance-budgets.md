# Presupuestos de Rendimiento

Mindwtr usa pruebas de almacén grande generadas para capturar regresiones de rendimiento antes de que los usuarios las encuentren. La suite no recopila telemetría de usuarios.

## Comando

Ejecuta la suite de presupuesto actual desde la raíz del repositorio:

```bash
bun run test:perf
```

Esto ejecuta:

- `packages/core/src/performance-large-store.test.ts`
- `apps/desktop/src/components/views/ListView.performance.test.tsx`
- `apps/mobile/tests/large-store-performance.test.tsx`

La suite principal genera almacenes con 1k, 10k y 50k tareas, muchos proyectos, muchas secciones, estados mixtos, fechas de vencimiento, fechas de inicio, etiquetas, contextos, registros eliminados y un proyecto con muchas tareas de proyecto seleccionado.

## Presupuestos Principales

Los presupuestos son intencionalmente explícitos y conservadores. Solo deben cambiar en PR que expliquen la razón medida.

| Operación | 1k tareas | 10k tareas | 50k tareas | Guardia de Crecimiento |
| --- | ---: | ---: | ---: | ---: |
| Búsqueda y clasificación de detalles de proyecto | 25ms | 90ms | 450ms | 50k <= 12x 10k |
| Estado derivado de tarea de producción | 50ms | 250ms | 1200ms | 50k <= 8x 10k |
| Derivación de enfoque | 40ms | 500ms | 2500ms | 50k <= 12x 10k |
| Derivación de búsqueda/filtro/clasificación | 30ms | 130ms | 650ms | 50k <= 12x 10k |
| Huella digital de cambio de sincronización de producción | 20ms | 80ms | 350ms | 50k <= 8x 10k |

La suite también ejecuta la mutación real de `updateTask` de Zustand y la ruta de persistencia incremental en cada tamaño de conjunto de datos. Sus presupuestos absolutos son 100ms en 1k, 250ms en 10k y 1000ms en 50k, con un crecimiento máximo de 12x de 10k a 50k. Como las filas de ruta caliente pura, esta ruta usa la mejor de tres ejecuciones medidas para reducir el ruido del ejecutor y recolección de basura. Los casos de huella digital afirman tanto el comportamiento de no operación determinista para datos alineados como la sensibilidad a un cambio de revisión sincronizado.

La ruta de mutación en lote (`batchMoveTasks` sobre cada tarea en el almacén, lo que envía "Seleccionar todo -> Mover") se presupuesta en 75ms en 1k, 250ms en 10k y 2000ms en 50k, con un crecimiento máximo de 15x de 10k a 50k, tomando la mejor de dos ejecuciones. Es la mutación más grande que un usuario puede activar en una escritura de almacén sincrónica.

Los presupuestos absolutos atrapan regresiones obvias. La guardia de crecimiento atrapa mal escalado, especialmente patrones O(n^2) que aún pueden pasar en conjuntos de datos pequeños. Las comparaciones de crecimiento usan un piso de denominador de 5ms para que las mediciones 10k muy rápidas no fallen solo por ruido de tiempo de ejecución.

## Presupuestos de Renderizado de Plataforma

Las pruebas de plataforma ejercen las costuras de componentes de producción con 5,000 tareas generadas. Los presupuestos de renderizado usan la mejor de tres montajes para reducir el ruido del ejecutor y recolección de basura, mientras aún afirman que la superficie de virtualización/lista real se montó correctamente.

| Superficie | Conjunto de Datos | Presupuesto |
| --- | ---: | ---: |
| `ListView` de Escritorio | 5,000 próximas acciones | 500ms |
| `TaskList` Móvil | 5,000 tareas de estado mixto | 350ms |
| `ProjectDetailModal` Móvil | 5,000 tareas en un proyecto | 500ms |

La suite móvil también retiene presupuestos para Enfoque, Proyectos, Archivado, Papelera, apertura/guardado del editor, finalización, despido del selector y selección en lote. Estas son puertas de regresión de ruta de renderizado de JavaScript; usa perfiles de dispositivo en modo de lanzamiento para conclusiones de diseño nativo, subproceso de UI y sincronización de fotogramas.

## Cuándo Agregar un Presupuesto

Agrega o actualiza un presupuesto cuando una PR toca una ruta caliente:

- apertura de captura o disponibilidad de primer pulsación de tecla
- apertura de detalles de proyecto
- Derivación de Enfoque, Bandeja de entrada o Proyectos
- lógica de búsqueda/filtro/clasificación
- resúmenes de proyecto/contexto/etiqueta
- mutación de tarea o persistencia
- renderizado de lista grande

Prefiere pruebas principales para derivación pura y pruebas de plataforma para comportamiento de renderizado o subproceso nativo. Esta suite es el radar de regresión de CI; usa perfiles de dispositivo en modo de lanzamiento para diagnosticar regresiones que cruzan límites de subproceso nativo o renderizado.
