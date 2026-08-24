# ADR 0010: Servidor de sincronización en la nube alojado por el usuario

Fecha: 2026-04-24
Estado: Aceptado

## Contexto

Mindwtr admite sincronización BYOS a través de sincronización de archivos, WebDAV, Dropbox en compilaciones admitidas, iCloud en plataformas Apple y el servidor en la nube alojado opcionalmente.

El servidor en la nube es intencionalmente pequeño:

- almacena un espacio de nombres de instantánea JSON por token portador
- almacena archivos adjuntos por separado en rutas desinfectadas
- utiliza la lógica de fusión central compartida en lugar de inventar reglas de conflicto solo de servidor
- está destinado a auto-alojamiento detrás de HTTPS, no como SaaS alojado multiinquilino

El principal riesgo es tratar el servidor como un backend de colaboración general. Eso atraería a Mindwtr hacia gestión de cuentas, autorización por fila, fan-out en tiempo real y complejidad operativa que no se ajusta a una aplicación GTD local-primero personal.

## Decisión

Mindwtr mantiene el servidor en la nube como un punto final de sincronización alojado por el usuario.

Las responsabilidades del servidor se limitan a:

1. Autenticar solicitudes con tokens portadores u opción explícita de espacio de nombres de token.
2. Asignar cada token a un espacio de nombres aislado.
3. Validar instantáneas entrantes y cargas útiles de mutación de tareas.
4. Serializar operaciones de lectura-modificación-escritura por espacio de nombres en cada proceso de servidor que comparta el directorio de datos.
5. Fusionar instantáneas entrantes con el estado en disco existente utilizando semántica de sincronización central compartida.
6. Almacenar archivos adjuntos con protecciones de traversal de ruta y contenido ejecutable.
7. Admitir la primera escritura durable de espacio de nombres bajo un bloqueo global seguro de proceso para que el límite de espacio de nombres configurado no pueda ser sobresuscrito por tokens concurrentes.

Los clientes siguen siendo responsables del estado normal de la aplicación, persistencia de SQLite local y recuperación de sincronización orientada al usuario. El servidor en la nube no debe convertirse en una autoridad de estado de producto separada con comportamiento de fusión divergente.

## Consecuencias

- El servidor sigue siendo simple de desplegar y razonar.
- El comportamiento de sincronización permanece consistente entre rutas locales, WebDAV/archivo y nube porque se utilizan las mismas reglas de fusión central.
- Las escrituras concurrentes necesitan serialización por espacio de nombres para evitar actualizaciones perdidas a nivel de archivo. Los bloqueos de proceso utilizan un conjunto limitado de fragmentos de bloqueo de SQLite para que los tokens controlados por atacantes no puedan crear archivos de bloqueo ilimitados; el sistema operativo libera cada transacción cuando un trabajador sale. La eliminación de bloqueo obsoleto basada en marca de tiempo no es segura.
- Las comprobaciones dinámicas de cuota de espacio de nombres y la reserva de un documento de sincronización vacío válido forman una sección crítica corta en procesos. Los espacios de nombres existentes no toman ese bloqueo de admisión global, y los cuerpos de solicitud se leen solo después de que se libera la admisión.
- Los operadores deben manejar TLS, secreto de token, configuración de proxy inverso, copias de seguridad y endurecimiento de host.
- Si Mindwtr más tarde necesita colaboración multiusuario alojada, ese debe ser un ADR separado porque requeriría un modelo de confianza, autorización y almacenamiento diferente.
