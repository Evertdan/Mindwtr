# Contribuir a Mindwtr

Gracias por tu interés en mejorar Mindwtr. Esta guía cubre:

- Antes de comenzar
- Proceso de contribución de código
- Configuración y flujo de trabajo de desarrollo
- Pruebas y verificaciones de calidad
- Directrices de solicitud de extracción
- Contribuciones de documentación y traducción

Mindwtr es un monorepo de Bun con:

- Aplicación de escritorio (`apps/desktop`): Tauri + React + Vite
- Aplicación móvil (`apps/mobile`): Expo + React Native
- Paquete central compartido (`packages/core`): modelos de estado, adaptadores de almacenamiento y lógica compartida


## Antes de comenzar

### 1) Sigue nuestros estándares comunitarios

- Lee y sigue el [Código de conducta](https://github.com/Evertdan/Mindwtr/blob/main/.github/CODE_OF_CONDUCT.md).
- Sé respetuoso en problemas, discusiones, revisiones y confirmaciones.

### 2) Reporta problemas de seguridad en privado

- No abras problemas públicos para vulnerabilidades de seguridad.
- Utiliza [SECURITY.md](https://github.com/Evertdan/Mindwtr/blob/main/SECURITY.md) para las instrucciones de divulgación responsable.

### 3) Comienza con un problema para cambios no triviales

Para cambios de comportamiento, correcciones de errores significativas o nuevas características, abre (o confirma) primero un problema.
Esto ayuda a evitar trabajo duplicado y mantiene los cambios alineados con los objetivos del proyecto.

Al abrir un problema, incluye:

- Plataforma y versión (`desktop`, `mobile` o ambas)
- Pasos de reproducción y comportamiento esperado
- Comportamiento real
- Capturas de pantalla, grabaciones de pantalla y registros cuando sea relevante

### 4) Ten en cuenta el ajuste del producto

Mindwtr se enfoca en GTD y ejecución práctica, y está construido para ser **simple por defecto y poderoso cuando lo necesitas**: divulgación progresiva, menos por defecto, sin aumento de características. *No me muestres un panel cuando solo quiero andar en bicicleta.* Las contribuciones tienen más probabilidad de ser aceptadas cuando:

- Mantienen los flujos de trabajo simples por defecto
- Evitan la complejidad innecesaria de la interfaz de usuario
- Prefieren lo automático sobre lo manual: si el resultado correcto puede ser inferido (plataforma, canal de instalación, datos existentes, contexto), la aplicación simplemente debe hacerlo — sin nueva configuración, sin mensaje, sin paso de flujo de trabajo adicional o control de interfaz de usuario — y reutilizar un interruptor existente antes de crear uno nuevo (por ejemplo, las comprobaciones de actualización se adaptan al canal de instalación en lugar de ofrecer un botón)
- Preservan la seguridad y confiabilidad de los datos
- Funcionan consistentemente entre plataformas cuando sea aplicable

## Proceso de contribución de código

1. Encuentra un problema en el que trabajar, o abre uno para discusión.
2. Bifurca el repositorio y crea una rama en tu bifurcación.
3. Implementa el cambio con alcance enfocado.
4. Ejecuta verificaciones relevantes localmente.
5. Abre una solicitud de extracción a `Evertdan/Mindwtr:main`.
6. Vincula el problema en el PR (ejemplo: `Fixes #123`).

Ejemplos de nombres de rama:

- `fix/tray-preference-persistence`
- `feature/date-format-setting`
- `docs/contributing-update`

## Configuración y flujo de trabajo de desarrollo

Ejecuta todos los comandos desde la raíz del repositorio.

### Requisitos previos

- Bun (gestor de espacio de trabajo/paquetes) — usa la versión en `.bun-version` (actualmente 1.3.5) o más nueva
- Node.js 20 o más nuevo — `apps/mcp-server` declara `"node": ">=20"` y se publica en npm, por lo que debe construirse y ejecutarse en Node simple
- Git
- Cadena de herramientas Rust (requerida para compilación/desarrollo de escritorio Tauri)
- Dependencias de webview del sistema para Tauri en tu sistema operativo
- En Windows: las herramientas de compilación de C++ de Visual Studio 2022. La cadena de herramientas de 2026 actualmente falla al vincular `whisper-rs` (LNK1120 símbolos externos de C++ no resueltos), así que utiliza el conjunto de herramientas MSVC v143 hasta que se corrija en sentido ascendente.
- Herramientas de Expo para desarrollo móvil
- Android SDK y/o Xcode si construyes móvil de forma nativa

### Instalar dependencias

```bash
bun install
```

### Ejecutar las aplicaciones

Escritorio (Tauri):

```bash
bun desktop:dev
```

Solo interfaz de usuario de escritorio (navegador/Vite):

```bash
bun desktop:web
```

Móvil (Expo):

```bash
bun mobile:start
```

Móvil en dispositivo/emulador:

```bash
bun mobile:android
bun mobile:ios
```

### Referencia de estructura útil

- `apps/desktop/src`: interfaz de usuario de escritorio e integraciones de escritorio
- `apps/mobile`: interfaz de usuario móvil y código de puente nativo
- `packages/core/src`: lógica comercial compartida, almacén, sincronización y utilidades
- `scripts/`: scripts de lanzamiento y utilidad
- `docs/`: documentación en markdown utilizada por el proyecto

El código de escritorio no debe importar `invoke` de `@tauri-apps/api/core` directamente. Llama a `invokeNative` (rechaza cuando no hay tiempo de ejecución de Tauri) o `invokeNativeOr(fallback, ...)` (resuelve el respaldo) desde `apps/desktop/src/lib/tauri-invoke.ts`, para que cada sitio de llamada indique lo que debe hacer en la compilación web del navegador. Una prueba de trinquete en `tauri-invoke.test.ts` falla en CI en una importación sin procesar.

## Pruebas y verificaciones de calidad

Antes de presionar, ejecuta la puerta de verificación local de línea de base:

```bash
bun run verify
```

`bun run verify` encadena verificación de tipos (core, cloud, desktop, mobile y mcp), linting para cada aplicación del espacio de trabajo, los cinco conjuntos de pruebas unitarias del espacio de trabajo, la suite de Rust (`native:test`, unos pocos segundos una vez que la caché de carga está caliente), verificaciones de gobernanza y esquema, paridad de configuración regional y paridad de README. CI también ejecuta presupuestos de rendimiento, umbrales de cobertura, Expo Doctor y verificaciones de metadatos de almacén/flujo de trabajo.

Ejecuta `bun run native:test` por sí solo mientras iteras en `apps/desktop/src-tauri/`, y ejecuta `bun run test:perf` para cambios de lista, almacén, recurrencia u otra ruta crítica. `bun run test:e2e` necesita un navegador y sigue siendo una puerta opcional separada.

Mientras iteras, los comandos por área a continuación son más rápidos.

Linting de escritorio:

```bash
bun run --filter mindwtr lint
```

Pruebas de escritorio (paso único, sin reloj):

```bash
bun run --filter mindwtr test -- --run
```

Pruebas principales:

```bash
bun run --filter @mindwtr/core test
```

Pruebas móviles:

```bash
bun run --filter mobile test
```

E2E opcional:

```bash
bun run test:e2e
```

## Convenciones de codificación

- TypeScript primero.
- Prefiere componentes de React funcionales y ganchos.
- Mantén las importaciones agrupadas: externas, espacio de trabajo/internas, luego relativas.
- Coincide con las convenciones de formato local de archivo:
  - desktop/core generalmente 4 espacios
  - móvil generalmente 2 espacios
- Mantén los comentarios de código concisos y solo donde la lógica no es obvia.
- Favorece consultas de prueba orientadas a la accesibilidad (`getByRole`, `getByLabelText`).
- Elementos emergentes móviles: cualquier elemento emergente modal transparente que contenga un `TextInput` debe usar el hook compartido `useAndroidKeyboardInset` para que permanezca encima del teclado suave de Android.
- Los cambios del editor de markdown necesitan pruebas de regresión para los modos de falla históricos (salto del cursor al tocar, desplazamiento a la vista, relleno de altura de teclado, sincronización de barra de herramientas) — estos se han enviado como errores de producción antes.

Denominación:

- Componentes/proveedores: `PascalCase`
- Hooks: `useSomething`
- Módulos de utilidad: kebab-case (ejemplo: `storage-adapter.ts`)
- Pruebas: reflejar el nombre del archivo de origen con `.test.ts`/`.test.tsx`

## Codificación asistida por IA ("coding assistants")

Mindwtr no es estrictamente contrario a la codificación asistida por IA. Las herramientas de IA están mejorando rápidamente y pueden ser productivas cuando se usan correctamente.

Si utilizas agentes de IA/codificación para contribuciones, sigue estas reglas:

1. No uses interfaces de chat web como tu herramienta de codificación principal.
   Utiliza agentes de codificación en un IDE o CLI con indexación de repositorio y contexto completo de base de código.
2. Usa agentes enfocados en codificación, no modelos de chat generales.
   Ejemplo: usa Codex o el agente de Claude Code para tareas de codificación, no modo de chatbot genérico.
3. Comienza con un objetivo de implementación claro.
   Define el error/característica, comportamiento esperado e implementación prevista antes de solicitar.
4. Evita la sobre-ingeniería.
   Prefiere cambios pequeños y mantenibles que coincidan con la filosofía "simple por defecto" de Mindwtr.
5. TÚ revisa el resultado antes de abrir un PR que no sea borrador.
   No solicites revisión hasta que hayas leído y comprendido cada cambio generado, ejecutado pruebas relevantes y verificado el comportamiento en dispositivos/plataformas reales. Eres responsable del código que envíes, no de la herramienta.
6. Elimina la verbosidad y la charla.
   Quita relleno de comentarios de código, documentación, descripciones de PR y mensajes de confirmación. Todos estos — incluidos los nombres — deben ser concisos, claros y contener información útil, nada más.
7. Elimina y desduplica código, pruebas y explicaciones redundantes.
   La explicititud y la claridad son buenas; la verbosidad, la sobre-explicación y la redundancia son malas.
8. Mantén la seguridad en el alcance.
   No introduzas valores por defecto inseguros, análisis inseguro, filtraciones de tokens o nuevas superficies de ataque.

## Directrices de solicitud de extracción

Todos los envíos pasan por solicitudes de extracción de GitHub y revisión de mantenedor.

Por favor, mantén los PR pequeños y enfocados:

- Una corrección de error, una característica o un refactor aislado por PR
- Evita agrupar cambios no relacionados

Antes de abrir un PR:

- Asegúrate de que las verificaciones relevantes pasen localmente
- Rebase/fusión tu rama según sea necesario para resolver conflictos
- Verifica que no se incluyan archivos no relacionados

En tu descripción de PR, incluye:

- Qué cambió
- Por qué cambió
- Problema vinculado (`Fixes #...`)
- Evidencia de prueba (comandos ejecutados y resultados)
- Capturas de pantalla/grabaciones para cambios de interfaz de usuario
- Impacto de plataforma (`desktop`, `mobile`, `core` o combinaciones)

Estilo de confirmación:

- Usa Confirmaciones convencionales cuando sea posible
- Ejemplos:
  - `fix(desktop): persist tray preference on macOS`
  - `feat(core): add date format normalization`
  - `docs: clarify sync troubleshooting`

## Contribuciones de documentación

Las actualizaciones de documentación son bienvenidas en `README.md`, `README_zh.md` y la documentación local del repositorio.

Utiliza el directorio `docs/` de este repositorio para documentación local como guías de contribución, resúmenes de arquitectura, ADRs y notas de lanzamiento. El directorio `wiki/` contiene solo la página de inicio de la wiki de GitHub retirada, que dirige a los lectores al sitio de documentación; no agregues páginas de contenido allí.

Al cambiar documentos:

- Mantén las instrucciones precisas y ejecutables
- Prefiere ejemplos concretos sobre orientación vaga
- Valida enlaces
- Actualiza tanto documentación en inglés como en chino cuando el contenido se refleja
- Mantén la estructura de encabezado de `README.md` y `README_zh.md` alineada; CI ejecuta `bun run docs:check-readme`

Referencias útiles:

- [Documentación oficial](https://docs.mindwtr.app/)
- [Guía del desarrollador](https://docs.mindwtr.app/developers/developer-guide)
- [Arquitectura](https://docs.mindwtr.app/developers/architecture)

## Contribuciones de traducción

La mayoría de las cadenas de traducción viven en:

- [`packages/core/src/i18n/locales/`](https://github.com/Evertdan/Mindwtr/tree/main/packages/core/src/i18n/locales/)

Al actualizar traducciones:

- Mantén los marcadores de posición e interpolaciones sin cambios
- Mantén intactos los tokens de comando donde el comportamiento del analizador depende de comandos en inglés
- Para un nuevo idioma, registra la configuración regional en los registros de i18n compartidos, mapeo de configuración regional de fecha, selectores de idioma de escritorio/móvil y verificaciones de paridad de configuración regional
- Después de cambiar cualquier cadena `starter.*`, ejecuta `bun run scripts/i18n-locale-parity.ts --fix` para regenerar `packages/core/src/i18n/starter-seed-strings.ts`. Ese archivo se genera, nunca se edita a mano, y `bun run i18n:check` falla hasta que vuelve a estar sincronizado
- Ejecuta `bun run i18n:check` y pruebas de i18n principales relevantes
- Confirma que la interfaz de usuario aún cabe en diseños móviles pequeños

## ¿Necesitas ayuda?

Si no estás seguro sobre el alcance o detalles de implementación:

- Abre un problema de GitHub con una propuesta breve
- Únete al chat comunitario en Discord: https://discord.gg/gc4h5t58PR
- Solicita retroalimentación del mantenedor antes de implementar cambios grandes

Gracias de nuevo por contribuir a Mindwtr.
