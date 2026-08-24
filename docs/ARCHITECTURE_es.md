# Arquitectura de Mindwtr

Mindwtr es un sistema GTD local-first construido como un monorepo de espacio de trabajo Bun. El paquete compartido `@mindwtr/core` posee el modelo de datos, comportamiento de persistencia y reglas de sincronización; las capas de escritorio, móvil, nube y MCP permanecen delgadas alrededor de ese núcleo.

## Forma del sistema

- `packages/core`
  Modelo de dominio compartido, almacén Zustand, análisis de adición rápida, recurrencia, sincronización/fusión, adaptadores de almacenamiento y pruebas compartidas.
- `apps/desktop`
  Shell de Tauri + React. Usa el almacén principal compartido con estado de interfaz de usuario específico de escritorio, diálogos nativos, acceso al sistema de archivos y persistencia respaldada por SQLite.
- `apps/mobile`
  Shell de Expo + React Native. Reutiliza la lógica central del almacén y sincronización con almacenamiento específico móvil, navegación, notificaciones e integraciones de calendario.
- `apps/cloud`
  Punto final de sincronización auto hospedado. Almacena un espacio de nombres JSON más archivos adjuntos por token portador y fusiona datos de aplicación entrantes usando la misma semántica de sincronización compartida.
- `apps/mcp-server`
  Servidor MCP para herramientas de IA, sobre stdio por defecto o HTTP transmisible cuando se establece `--http` (autenticado por token portador). Lee y opcionalmente muta la base de datos SQLite local con opt-in explícito `--write`, o habla con un punto final `apps/cloud` auto hospedado cuando se apunta a uno. Ver [integración de MCP](https://docs.mindwtr.app/power-users/mcp) para la configuración orientada al usuario.

## Flujo de datos

1. Las acciones de interfaz de usuario actualizan el almacén Zustand compartido en `packages/core`.
2. El almacén sanitiza y persiste la instantánea completa de la aplicación a través de un adaptador de almacenamiento específico de plataforma.
3. Los servicios de sincronización opcionales leen el estado remoto, fusionan en memoria, luego escriben instantáneas locales y remotas.
4. Las vistas derivadas se recalculan a partir de datos canónicos de almacén más filtros de vista en lugar de mutar registros persistentes para presentación.

El objetivo de diseño es que el comportamiento GTD, lógica de fusión y validación vivan una sola vez en core, mientras que las aplicaciones de plataforma manejan entrada, representación e integración del SO.

## Modelo de persistencia

- Escritorio y móvil usan SQLite como almacén estructurado principal.
- Las instantáneas JSON permanecen como parte de la historia de durabilidad y sincronización, pero como una representación derivada de sincronización/copia de seguridad en lugar de una segunda fuente de verdad local igual.
- Los archivos adjuntos se tratan por separado de datos de tareas/proyectos estructurados.
- Las eliminaciones son suaves por defecto usando lápidas `deletedAt` para que la sincronización converja con seguridad en dispositivos.

El contrato de puente SQLite<->JSON se registra en [ADR 0009](./adr/0009-sqlite-json-sync-bridge.md).

Mindwtr prefiere lógica de reparación y fusión explícita en la capa de aplicación sobre suposiciones de solo base de datos difícil. Es por eso que las relaciones sensibles a la sincronización se normalizan y reparan mediante código compartido en lugar de depender únicamente de aplicación de clave externa.

## Modelo de sincronización

La sincronización es opcional e agnóstica del backend. Los backends admitidos incluyen sincronización de archivos, WebDAV, Dropbox en compilaciones admitidas y el servidor de nube auto hospedado.

Propiedades importantes:

- La fusión se basa en elementos, no en sobrescritura de archivo completo.
- Las revisiones y marcas de tiempo se utilizan para la resolución de conflictos.
- Las lápidas evitan que los registros eliminados resuciten silenciosamente.
- Los archivos adjuntos se fusionan y transfieren por separado de la carga útil JSON principal.
- Los backends de blob (sincronización de archivos, WebDAV, Dropbox) pueden cifrar opcionalmente todo lo escrito en la ubicación de sincronización con una frase de paso mantenida por el usuario (Argon2id -> AES-256-GCM, contenedor MWENC1); los backends fusionados por servidor (nube auto hospedada, CloudKit) se excluyen porque su fusión debe leer el documento (ADR 0025).
- Nuevos destinos de sincronización o destinos modificados permanecen inactivos hasta que una sonda candidata verifica la instantánea IO y cada archivo adjunto vivo. Las confirmaciones fallidas restauran la última configuración verificada o dejan la sincronización apagada.

El algoritmo detallado, casos límite y reglas de desempate se documentan en el sitio de documentación público. La fuente para esas páginas vive en la fuente de documentación web de Mindwtr:

- [Fuente de documentación](https://github.com/dongdongbh/mindwtr-web/tree/main/docs)
- [Arquitectura](https://docs.mindwtr.app/developers/architecture)
- [Algoritmo de sincronización](https://docs.mindwtr.app/data-sync/sync-algorithm)
- [Datos y sincronización](https://docs.mindwtr.app/data-sync/)
- [Guía de rendimiento](https://docs.mindwtr.app/developers/performance)

## Límites y responsabilidades

- Core decide qué significan los datos.
- Desktop/mobile deciden cómo interactúan los usuarios con esos datos.
- Cloud decide cómo se almacenan y validan las instantáneas remotas.
- MCP decide cómo las herramientas de IA externas pueden leer o escribir de forma segura datos locales.

Esa separación mantiene el comportamiento del producto consistente entre plataformas y hace que la mayoría de las pruebas de regresión sean posibles en código compartido en lugar de duplicar lógica por aplicación.
