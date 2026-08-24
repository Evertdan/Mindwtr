# ADR 0019: Contrato de audio móvil local Whisper

Fecha: 2026-06-28
Estado: Aceptado

## Contexto

Mindwtr admite transcripción local de Whisper en móvil a través de `whisper.rn`. Dos historias de errores expusieron el mismo problema de contrato subyacente:

- El problema de Android #95 se corrigió solo después de que la captura rápida dejó de enviar salida de grabadora comprimida directamente a Whisper local y utilizó una ruta de captura PCM/WAV.
- El problema de Android #424 evitó un fallo de paquete de producción saltando el ayudante en tiempo real en Android, pero eso hizo que Android retrocediera a archivos grabador de Expo `.m4a`. Esos archivos podrían guardarse como notas de audio, pero Whisper local devolvió texto de paréntesis vacío o alucinado como `[Intro]`.
- Un informe privado de comentarios de la tienda de aplicaciones de iOS describió la aplicación volviéndose sin respuesta después de seleccionar `whisper-base` o `whisper-tiny` local y tocar el micrófono, con el modelo pareciendo desaparecer después. Esa ruta debe fallar suavemente en la producción y mantener útiles los diagnósticos.
- El problema de iOS #788 mostró dos riesgos adicionales de límite nativo: el almacenamiento del modelo Whisper propio de la aplicación puede corromperse por escrituras ambiguas de archivo/directorio, y `whisper.rn` puede abortar si la transcripción de datos en tiempo real y la transcripción de archivo se ejecutan espalda con espalda en el mismo contexto nativo para una captura.

La dependencia de Whisper local admite transcripción de archivo, transcripción en tiempo real y rutas de datos PCM directas, pero los decodificadores de archivo nativo actual en `whisper.rn` son más estrictos que una API de archivo de audio genérica: Android e iOS leen los bytes del archivo, eliminan los primeros 44 bytes del encabezado WAV e interpretar el resto como muestras de PCM de 16 bits. La salida del grabador de Expo es normalmente audio de contenedor comprimido como `.m4a`, por lo que permitir que archivos de grabador arbitrarios alcancen a Whisper local no es seguro.

## Decisión

Mindwtr trata ASR local móvil como un límite de contrato de audio, no un detalle de carga de modelo.

1. La transcripción local de Whisper solo acepta `LocalWhisperAudio`, una entrada preparada producida por `prepareAudioForLocalWhisper(captured: CapturedAudio)`.
2. `prepareAudioForLocalWhisper` lee los bytes del archivo y valida el encabezado WAV real. No confía solo en la extensión del archivo.
3. El formato local aceptado es WAV PCM de 16 kHz, mono, 16 bits con encabezado RIFF/WAVE, fragmento `fmt `, fragmento `data`, datos no vacíos y duración mínima. Los contenedores comprimidos, archivos desconocidos, archivos vacíos y archivos cortos se rechazan antes de que se llame a Whisper nativo.
4. Los rechazos registran `ASR_INPUT_REJECTED_UNSUPPORTED_FORMAT` con el modo de captura, plataforma, esquema de URI, extensión, formato olfateado, tamaño de archivo, duración, frecuencia de muestreo, canales, bits por muestra, motivo de respaldo e `local_whisper_called: false`.
5. Las entradas aceptadas registran `ASR_INPUT_ACCEPTED_LOCAL_WHISPER` antes de que se llame a Whisper nativo; los fallos nativos registran una advertencia, mientras que las transcripciones exitosas evitan registros de éxito pesados de ruta.
6. La captura rápida de Android utiliza el ayudante en tiempo real de `whisper.rn` solo como grabadora PCM/WAV. Android establece `onBeginTranscribe` para devolver `false`, ignora cortes de transcripción activos y después de detener ejecuta Whisper local sin conexión contra el WAV generado.
7. La captura rápida de iOS también registra la ruta WAV y puede usar texto de transcripción en tiempo real como respaldo si la transcripción sin conexión falla. Los errores de tiempo de ejecución en tiempo real se resuelven en una transcripción vacía en lugar de rechazar a mitad de grabación, por lo que la hoja y las entradas se mantienen utilizables.
8. Una transcripción en tiempo real exitosa de iOS es la transcripción para esa captura. No ejecute inmediatamente la transcripción de archivo sin conexión para el mismo WAV en el mismo contexto de Whisper nativo; la transcripción de archivo sin conexión se reserva para salida en tiempo real vacía/no disponible y para reintentos posteriores activados por el usuario de los archivos adjuntos guardados.
9. `Documents/whisper-models` es un invariante de directorio. El código puede crear el directorio y archivos de modelo dentro de él, pero no debe crear archivos paralelos o usar API de archivo ambiguas que pueden dirigirse a la ruta del directorio en sí. Si la ruta es un archivo, repáralo como caché corrupto propio de la aplicación y registra la reparación.
10. Las comprobaciones de disponibilidad del modelo deben usar el solucionador de modelo nativo consciente usado por la inicialización de Whisper, no solo metadatos de Expo sincrónico. Un error transitorio de metadatos no debe eliminar ni marcar un modelo verificado como no disponible.
11. Si el ayudante PCM en tiempo real no está disponible o un archivo no es entrada local válida, la transcripción local de Whisper se omite. La nota de audio aún se puede guardar con su archivo adjunto; la transcripción en la nube/BYOK puede manejar audio comprimido a través de su ruta de proveedor existente.
12. Las cargas del módulo auxiliar en tiempo real deben usar rutas `require(...)` literales y visibles por Metro. Los requeros computados y las importaciones dinámicas no se permiten para esta ruta porque causaron diferencias de paquete de producción/dev-client en #424.
13. Whisper local es una característica de módulo nativo. Expo Go no es un tiempo de ejecución admitido para él; la validación debe incluir compilaciones de desarrollo y compilaciones móviles similares a lanzamiento.

## Consecuencias

- `.m4a` ya no puede llegar silenciosamente a Whisper local, por lo que el modo de falla de transcripción `[Intro]`/vacío se bloquea en el límite de entrada.
- Los archivos adjuntos de audio comprimido anterior no se pueden reintentar con Whisper local a menos que un futuro conversor nativo los normalice a WAV PCM mono de 16 kHz primero. El comportamiento actual es informar entrada local no soportada en lugar de producir texto deficiente.
- Android mantiene la corrección de fallo de #424 mientras restaura el comportamiento de captura PCM/WAV de funcionamiento de #95.
- Los fallos locales de Whisper de iOS no son fatales: ayudantes nativos faltantes, archivos no soportados, errores en tiempo real y problemas de ruta del modelo se registran y manejan sin congelar entradas de captura.
- La captura rápida de iOS evita trabajos duplicados de Whisper nativo para una grabación. Esto cambia un intento de respaldo redundante para la seguridad del contexto nativo; reintentar el WAV guardado se mantiene disponible como una acción de usuario separada.
- La reparación de caché del modelo solo se permite para rutas de caché local de Whisper propiedad de Mindwtr. No debe generalizarse a archivos seleccionados por usuario, archivos adjuntos o datos sincronizados.
- El desinfectante de transcripción solo entre corchetes se mantiene como defensa en profundidad, no como la corrección de formato de audio principal.
- Un futuro conversor debe escribir un `LocalWhisperAudio` validado antes de poder alimentar Whisper local.

## Referencias

- Introducción a whisper.rn: https://mybigday-whisper-rn.mintlify.app/introduction
- Requisito de audio de inicio rápido de whisper.cpp: https://github.com/ggml-org/whisper.cpp#quick-start
- API del módulo Metro: https://metrobundler.dev/docs/module-api/
- Código nativo personalizado de Expo: https://docs.expo.dev/workflow/customizing/
- Evidencia del decodificador interno: `apps/mobile/node_modules/whisper.rn/android/src/main/java/com/rnwhisper/AudioUtils.java` y `apps/mobile/node_modules/whisper.rn/ios/RNWhisperAudioUtils.m`
