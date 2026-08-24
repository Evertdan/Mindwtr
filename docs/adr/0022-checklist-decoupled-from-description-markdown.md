# 22. Lista de verificación desacoplada del markdown de descripción

Fecha: 2026-07-03

## Estado

Aceptado

## Contexto

La lista de verificación de tareas y las líneas de casilla de verificación markdown (`- [ ]`) en la descripción de la tarea se mantenían como dos representaciones espejadas de una lista: editar la lista de verificación reescribía las líneas de lista de tareas de la descripción, y guardar una tarea reconstruía la lista de verificación desde el markdown de la descripción siempre que había una línea de casilla de verificación.

Este acoplamiento fue la causa raíz de una clase de error de pérdida de datos: cada lado se sincronizaba sobrescribiendo al otro por mayoría desde un estado potencialmente obsoleto. Los elementos de la lista de verificación construidos en la interfaz de usuario fueron eliminados silenciosamente cuando apareció una casilla de verificación markdown en las notas; las líneas markdown mecanografiadas fueron eliminadas por interacciones de lista de verificación; una corrección requería maquinaria de reconciliación de estado obsoleto (`reconcileChecklistWithMarkdown`, `absorbMarkdownChecklistItems`) cuyas invariantes cada característica de editor futuro habría tenido que preservar. El acoplamiento también era invisible para los usuarios — un informe de error describía elementos de la lista de verificación que "simplemente desaparecen" sin insinuación de que el campo de notas estaba implicado.

El valor original del acoplamiento — entrada en masa de elementos de lista de verificación escribiendo una lista markdown — ahora se cubre directamente por pegado de varias líneas en el campo de lista de verificación (un elemento por línea, marcadores de viñeta/numerados/`[x]` reconocidos).

## Decisión

La lista de verificación de tareas y la descripción son completamente independientes:

- Las líneas de casilla de verificación markdown en una descripción son texto renderizado simple. Nunca populan, actualizan o eliminan elementos de lista de verificación.
- Las ediciones de lista de verificación (alternar, cambiar título, agregar, eliminar, reordenar, restablecer) nunca modifican la descripción.
- La maquinaria de reconciliación/espejo fue eliminada del núcleo y ambas aplicaciones (`extractChecklistFromMarkdown`, `syncMarkdownChecklistCompletion`, `syncMarkdownChecklistWithCanonical`, `reconcileChecklistWithMarkdown`, `absorbMarkdownChecklistItems`).
- La entrada en masa se sirve mediante pegado de varias líneas en un elemento de lista de verificación (`parsePastedChecklistItems` en core).

Las tareas existentes que tienen ambas copias espejadas guardan ambas; las copias simplemente dejan de rastrearse mutuamente. Sin migración automática: adivinar qué copia eliminar riesgo exactamente la pérdida de datos que esta decisión elimina.

## Consecuencias

- Un escritor por superficie: la lista de verificación solo se edita a través de la interfaz de usuario de lista de verificación, la descripción solo a través del editor de texto. La clase de error de sobrescritura obsoleta se ha ido estructuralmente.
- Los usuarios que confiaban en escribir casillas de verificación markdown para construir listas de verificación deben pegar las líneas en el campo de lista de verificación (documentado en las notas de lanzamiento y guías de usuario).
- Las tareas con listas previamente espejadas muestran la lista dos veces (texto de notas más lista de verificación) hasta que el usuario elimina manualmente un lado.
