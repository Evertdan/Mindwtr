# ADR 0006: Zustand como modelo de estado compartido principal

Fecha: 2026-03-14
Estado: Aceptado

## Contexto

Mindwtr necesita un modelo de estado que pueda compartirse entre escritorio y móvil mientras sigue siendo utilizable desde componentes de React, código de sincronización en segundo plano, notificaciones, widgets y otros puntos de integración imperativos.

El almacén también tiene que coordinar:

- mutaciones de tarea/proyecto/sección/área
- persistencia local y colas de guardado
- metadatos de sincronización y reconciliación
- comportamiento que debe ejecutarse fuera de un árbol de React montado

## Decisión

Mantenemos Zustand como modelo de estado compartido principal en `packages/core` y construimos adaptadores de plataforma delgados alrededor de él.

Los componentes de React consumen fragmentos de almacén como de costumbre, mientras que los servicios de plataforma también pueden acceder al mismo almacén imperativamente a través de `useTaskStore.getState()` cuando necesitan lógica comercial compartida fuera del árbol de interfaz de usuario.

## Consecuencias

- El comportamiento GTD principal permanece alineado entre escritorio y móvil.
- Los servicios en segundo plano como sincronización, notificaciones y widgets pueden reutilizar las mismas acciones y estado derivado.
- El almacén compartido debe mantenerse disciplinado: los efectos secundarios específicos de plataforma pertenecen a adaptadores y servicios, no a mutaciones de estado central genérico.
- A medida que crece la base de código, los módulos grandes adyacentes al almacén deben dividirse a lo largo de límites de tiempo de ejecución en lugar de reemplazar el modelo de estado por completo.
