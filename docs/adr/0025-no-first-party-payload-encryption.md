# 25. Sin encriptación de la carga útil de sincronización combinada por el servidor; backends de blob encriptados con frase de contraseña son de primera parte

Fecha: 2026-08-06

## Estado

Aceptado; enmendado 2026-08-22.

Resuelto en discusión #1001. Fechado a cuando se decidió la postura, no a cuándo
se escribió este registro. Enmendado después de que #1056 envió encriptación opcional con clave de usuario
(frase de contraseña) para los backends de sincronización de blob — Sincronización de archivo, WebDAV y
Dropbox — como una característica de primera parte. El razonamiento de la decisión original se mantiene
sin cambios para las superficies que el servidor debe leer: el backend en la nube alojado por el usuario
y CloudKit permanecen sin encriptar porque su fusión se ejecuta donde se almacena el documento. La redacción general "sin encriptación de primera parte" a continuación fue reemplazada por
ese lanzamiento; la rechazo de clave administrada por la aplicación y el análisis de fusión de servidor no lo fueron.

## Contexto

"Encriptar los datos en reposo" es la solicitud más re-argumentada en el rastreador, y
llega como una oración cubriendo dos modelos de amenaza diferentes que necesitan
separación antes de que algo pueda decidirse.

**Robo de dispositivo / acceso a disco sin conexión.** Mindwtr almacena sus datos en SQLite en el
directorio propio de la aplicación. En iOS y Android modernos, ese directorio se encripta
en reposo por el sistema operativo (Protección de datos de iOS, encriptación basada en archivos de Android). En escritorio
está protegido exactamente cuando el usuario tiene encriptación de disco habilitada — FileVault en
macOS, BitLocker en Windows, LUKS en Linux — que es el predeterminado en macOS actual, común pero no universal en Windows, y una opción de tiempo de instalación en Linux.
La encriptación a nivel de aplicación con una clave administrada por la aplicación no mejoraría en los casos sin encriptar:
la clave tendría que vivir en el mismo disco (ver abajo). Este modelo de amenaza
pertenece a la encriptación de disco de la plataforma, y Mindwtr nunca debe afirmar agregar
protección allí que no tiene.

**Acceso del operador del servidor.** El servidor de sincronización en la nube alojado por el usuario (ADR 0010) almacena
el documento sincronizado como JSON en disco. Un operador con acceso al sistema de archivos puede leerlo.
Para una implementación alojada por el usuario, el operador suele ser el usuario, por lo que esto es
el mismo límite de confianza que el dispositivo; para una implementación compartida u alojada es
uno genuinamente diferente.

La regla de rigor de reclamos de seguridad se aplica a cada oración a continuación: un reclamo de encriptación
solo vale la pena hacer si nombra quién tiene la clave.

## Decisión

Mindwtr no encripta la carga útil de sincronización en ningún backend cuyo servidor deba leerlo
para fusionar — el servidor en la nube alojado por el usuario y CloudKit — y no ofrece
encriptación de clave administrada por la aplicación en ninguna parte. Para los backends de blob que la ruta de sincronización de archivo
escribe a través (Sincronización de archivo, WebDAV, Dropbox), Mindwtr envía encriptación opcional de primera parte
con una frase de contraseña de usuario (#1056, formato MWENC1): el dispositivo
encripta antes de escribir, la frase de contraseña nunca deja al usuario, y perderla
hace que las copias sincronizadas no sean legibles por diseño.

### Por qué las claves administradas por la aplicación no valen la pena enviar

En un esquema administrado por la aplicación, Mindwtr genera la clave y la almacena para que la aplicación pueda
descifrar sin que el usuario escriba nada. Esa clave debe vivir en cada dispositivo sincronizado,
en el almacenamiento propio de la aplicación, junto a los datos que protege. Un atacante que
puede leer el archivo de base de datos puede leer la clave del mismo lugar — así que el esquema
protege contra nada que la encriptación de disco de la plataforma ya no cubre.
Nos permitiría poner la palabra "encriptado" en una lista de características, que es exactamente el
tipo de reclamo que la regla de rigor existe para detener. La descripción honesta de esa
característica es "ofuscada", y cuesta complejidad real en rotación de claves, copia de seguridad,
restauración e incorporación de múltiples dispositivos para comprarlo.

### Por qué las claves de usuario rompen la fusión del lado del servidor

En un esquema verdaderamente de extremo a extremo, el usuario tiene una clave que el servidor nunca ve.
Esa es una propiedad de seguridad real — e incompatible con cómo funciona la sincronización hoy.

El servidor en la nube no almacena un blob opaco. `PUT /v1/data`
(`apps/cloud/src/server.ts`) valida el cuerpo entrante como una estructura `AppData`
y luego llama a `mergeAppDataWithStats(existingData, incomingData)`,
fusionando **por entidad, revisión-sabio**: para cada tarea, proyecto, sección, área y
persona compara la `rev` entrante contra la almacenada y resuelve
campo por campo, con manejo determinista de lápida. Escribe el
resultado fusionado, no la carga útil que recibió. Dos dispositivos que ambos se sincronizan mientras están sin conexión
convergen porque el servidor puede leer y reconciliar ambos documentos.

Un servidor sosteniendo ciphertext no puede hacer nada de eso. No puede comparar revisiones, por lo que
no puede fusionar; la única operación que queda es último-a-escribir-gana en todo el
documento, que descarta silenciosamente las ediciones simultáneas del otro dispositivo — el
exacto clase de pérdida de datos que el diseño consciente de revisión (ADR 0003) existe para prevenir.
Preservar E2E y fusión de múltiples dispositivos juntos significa mover la fusión a los
clientes: una arquitectura de sincronización diferente, en territorio de CRDT, que ADR 0017
deliberadamente difiere.

### Lo que se envía en su lugar: backends de blob encriptados (enmendado 2026-08-22)

El registro original cerró con "un backend de blob encriptado conectable contribuido
por un usuario sigue siendo bienvenido; no lo prometeremos como una característica de primera parte."
#1056 envió esa forma de primera parte después de que la especificación convergió en #1001: los
backends de blob (Sincronización de archivo, WebDAV, Dropbox) pueden encriptar todo lo escrito en
la ubicación de sincronización con una clave derivada de una frase de contraseña de usuario (Argon2id →
AES-256-GCM, contenedor MWENC1). Esto no contradice la preocupación de gestión de claves que motivó la redacción original — Mindwtr aún no administra claves.
La frase de contraseña es de usuario, local del dispositivo, nunca sincronizada y nunca recuperable;
la fusión sigue ocurriendo en dispositivos que tienen el texto plano, por lo que la
fusión consciente de revisión no se toca. El intercambio se movió exactamente a donde esta sección dijo que
pertenece: el usuario que lo habilita acepta que una frase de contraseña perdida pierde las
copias remotas. Los backends que el servidor debe leer (nube alojada, CloudKit)
permanecen excluidos por las razones de fusión anteriores.

## Consecuencias

Los datos en reposo en un dispositivo están protegidos por la plataforma, y la aplicación no hace
reclamo de encriptación propio — las respuestas públicas dicen "la plataforma la encripta",
nunca "Mindwtr la encripta". Los usuarios que necesitan que el servidor no sea de confianza
lo alojan por sí mismos o usan un backend de sincronización de archivo que encriptan ellos mismos. La
fusión de servidor consciente de revisión se mantiene intacta, que es lo que hace que la
edición simultánea de múltiples dispositivos converja sin perder ediciones.

El costo es real: un operador de implementación alojado puede leer el documento, y
Mindwtr no puede anunciar encriptación E2E. Cualquiera cuyo modelo de amenaza incluya un
operador de servidor no confiable debe auto-alojar o encriptar el objetivo de transporte
ellos mismos.

## Lo que reabrería esto

- Sincronización pasando a fusión del lado del cliente (CRDT o equivalente, per ADR 0017), que
  elimina la necesidad del servidor de leer el documento y hace que E2E sea compatible con
  convergencia de múltiples dispositivos.
- Un backend de blob contribuido probando que la ruta de destino encriptado es mantenible,
  lo que haría que valga la pena documentarla como una configuración admitida — aún
  de usuario-clave, aún no una promesa de gestión de claves de primera parte.
- Un servicio alojado de primera parte, que cambiaría el límite de confianza del operador
  de "el usuario" a "nosotros" y forzaría la pregunta de nuevo en términos diferentes.
