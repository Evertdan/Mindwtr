# Arquitectura de Mindwtr

Mindwtr es un sistema GTD nativo-primero construido como un monorepo de espacio de trabajo de Bun. El paquete compartido `@mindwtr/core` es propietario del modelo de datos, comportamiento de persistencia y reglas de sincronización; las capas de escritorio, móvil, nube y MCP se mantienen delgadas alrededor de ese núcleo.

## Forma del sistema

- `packages/core`
  Modelo de dominio compartido, almacén Zustand, análisis de adición rápida, recurrencia, sincronización/fusión, adaptadores de almacenamiento y pruebas compartidas.
- `apps/desktop`
  Shell de Tauri + React. Utiliza el almacén central compartido con estado de interfaz específico del escritorio, diálogos nativos, acceso al sistema de archivos y persistencia respaldada por SQLite.
- `apps/mobile`
  Shell de Expo + React Native. Reutiliza la lógica de almacén central y sincronización con almacenamiento, navegación, notificaciones e integraciones de calendario específicas del móvil.
- `apps/cloud`
  Punto final de sincronización alojado por el usuario. Almacena un espacio de nombres JSON más archivos adjuntos por token portador y fusiona datos de aplicaciones entrantes utilizando la misma semántica de sincronización compartida.
- `apps/mcp-server`
  Servidor MCP para herramientas de IA, sobre stdio de forma predeterminada o HTTP transmisible cuando se establece `--http` (autenticado por token portador). Lee y opcionalmente modifica la base de datos SQLite local con aceptación explícita de `--write`, o se comunica con un punto final `apps/cloud` alojado por el usuario en su lugar cuando se apunta a uno. Consulta [integración MCP](https://docs.mindwtr.app/power-users/mcp) para la configuración orientada al usuario.

## Flujo de datos

1. Las acciones de la interfaz de usuario actualizan el almacén Zustand compartido en `packages/core`.
2. El almacén desinfecta y persiste la instantánea completa de la aplicación a través de un adaptador de almacenamiento de plataforma.
3. Los servicios de sincronización opcionales leen el estado remoto, fusionan en memoria y luego escriben instantáneas locales y remotas.
4. Las vistas derivadas se recalculan desde datos de almacén canónicos más filtros de vista en lugar de mutar registros persistidos para la presentación.

El objetivo de diseño es que el comportamiento de GTD, la lógica de fusión y la validación existan una sola vez en el núcleo, mientras que las aplicaciones de plataforma manejan entrada, renderizado e integración del sistema operativo.

## Modelo de persistencia

- El escritorio y el móvil utilizan SQLite como almacén estructurado principal.
- Las instantáneas JSON permanecen como parte del historial de durabilidad y sincronización, pero como representación derivada de sincronización/copia de seguridad en lugar de una segunda fuente de verdad local equivalente.
- Los archivos adjuntos se tratan por separado de los datos de tareas/proyectos estructurados.
- Los eliminados son suaves de forma predeterminada utilizando marcas de eliminación `deletedAt` para que la sincronización pueda converger de forma segura entre dispositivos.

El contrato de puente SQLite<->JSON se registra en [ADR 0009](./adr/0009-sqlite-json-sync-bridge.md).

Mindwtr prefiere lógica de reparación y fusión explícita en la capa de aplicación sobre suposiciones de solo base de datos. Es por eso que las relaciones sensibles a la sincronización se normalizan y reparan mediante código compartido en lugar de depender puramente de la ejecución de clave externa.

## Modelo de sincronización

La sincronización es opcional e independiente del backend. Los backends admitidos incluyen sincronización de archivos, WebDAV, Dropbox en compilaciones admitidas y el servidor en la nube alojado por el usuario.

Propiedades importantes:

- La fusión se basa en elementos, no en sobrescritura de archivo completo.
- Las revisiones y marcas de tiempo se utilizan para la resolución de conflictos.
- Las marcas de eliminación evitan que los registros eliminados se resuciten silenciosamente.
- Los archivos adjuntos se fusionan y transfieren por separado de la carga útil JSON principal.
- Los backends de blob (sincronización de archivos, WebDAV, Dropbox) pueden cifrar opcionalmente todo lo escrito en la ubicación de sincronización con una frase de contraseña con clave de usuario (Argon2id -> AES-256-GCM, contenedor MWENC1); los backends de fusión de servidor (nube alojada, CloudKit) se excluyen porque su fusión debe leer el documento (ADR 0025).
- Los destinos de sincronización nuevos o modificados permanecen inactivos hasta que un sondeo candidato verifica la E/S de instantánea y todos los archivos adjuntos activos. Las confirmaciones fallidas restauran la última configuración verificada o dejan la sincronización desactivada.

El algoritmo detallado, casos extremos y reglas de desempate se documentan en el sitio de documentación pública. La fuente de esas páginas vive en la fuente de documentación web de Mindwtr:

- [Fuente de documentación](https://github.com/dongdongbh/mindwtr-web/tree/main/docs)
- [Arquitectura](https://docs.mindwtr.app/developers/architecture)
- [Algoritmo de sincronización](https://docs.mindwtr.app/data-sync/sync-algorithm)
- [Datos y sincronización](https://docs.mindwtr.app/data-sync/)
- [Guía de rendimiento](https://docs.mindwtr.app/developers/performance)

## Límites y responsabilidades

- Core decide qué significan los datos.
- Desktop/mobile deciden cómo los usuarios interactúan con esos datos.
- Cloud decide cómo se almacenan y validan las instantáneas remotas.
- MCP decide cómo las herramientas de IA externas pueden leer o escribir datos locales de forma segura.

Esa separación mantiene el comportamiento del producto consistente entre plataformas y hace posibles la mayoría de las pruebas de regresión en código compartido en lugar de duplicar lógica por aplicación.
