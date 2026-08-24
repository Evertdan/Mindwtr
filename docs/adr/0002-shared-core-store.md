# ADR 0002: Almacén central compartido entre escritorio y móvil

Fecha: 2026-03-06
Estado: Aceptado

## Contexto

Mindwtr admite clientes de escritorio y móvil con los mismos conceptos de GTD, reglas de sincronización y modelo de almacenamiento. Duplicar la lógica del almacén por plataforma aumentaría el riesgo de desviación en áreas críticas como:

- comportamiento de mutación de tarea/proyecto/área
- reglas de recurrencia y lista de verificación
- normalización de sincronización y manejo de lápidas
- semántica de búsqueda/consulta

Al mismo tiempo, cada plataforma aún necesita su propio shell, convenciones de interfaz de usuario y adaptadores de almacenamiento/tiempo de ejecución.

## Decisión

Mantenemos el modelo de dominio y almacén Zustand principal en `packages/core`, y tratamos el escritorio/móvil como shells de plataforma alrededor de ese núcleo compartido.

El código específico de plataforma puede variar en:

- componentes de interfaz de usuario y navegación
- cableado de adaptador de almacenamiento local
- integraciones nativas
- comportamiento de diagnósticos y empaque

Pero el modelo de datos, reglas de fusión y acciones del almacén permanecen compartidas a menos que haya una restricción fuerte de plataforma que fuerce la divergencia.

## Consecuencias

- Las correcciones de integridad de datos generalmente se pueden implementar una sola vez en `packages/core`.
- El escritorio y el móvil permanecen alineados conductualmente para operaciones GTD principales.
- Las aplicaciones de plataforma aún necesitan pegamento de adaptador y pruebas específicas alrededor de integraciones locales.
- Los cambios grandes en `packages/core` requieren cuidado adicional porque afectan a cada cliente.
