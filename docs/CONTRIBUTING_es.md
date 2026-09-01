# Contribuyendo a Mindwtr

Gracias por tu interés en mejorar Mindwtr. Esta guía cubre:

- Antes de comenzar
- Proceso de contribución de código
- Configuración de desarrollo y flujo de trabajo
- Pruebas y verificaciones de calidad
- Directrices de solicitud de extracción
- Contribuciones de documentación y traducción

Mindwtr es un monorepo de Bun con:

- Aplicación de escritorio (`apps/desktop`): Tauri + React + Vite
- Aplicación móvil (`apps/mobile`): Expo + React Native
- Paquete principal compartido (`packages/core`): modelos de estado, adaptadores de almacenamiento y lógica compartida


## Antes de comenzar

### 1) Sigue nuestros estándares comunitarios

- Lee y sigue el [Código de conducta](https://github.com/dongdongbh/Mindwtr/blob/main/.github/CODE_OF_CONDUCT.md).
- Sé respetuoso en problemas, discusiones, revisiones y commits.

### 2) Reporta problemas de seguridad de forma privada

- No abras problemas públicos para vulnerabilidades de seguridad.
- Usa [SECURITY.md](https://github.com/dongdongbh/Mindwtr/blob/main/SECURITY.md) para instrucciones de divulgación responsable.

### 3) Comienza con un problema para cambios no triviales

Para cambios de comportamiento, correcciones de errores significativas o características nuevas, abre (o confirma) un problema primero.
Esto ayuda a evitar trabajo duplicado y mantiene los cambios alineados con los objetivos del proyecto.

Cuando abras un problema, incluye:

- Plataforma y versión (`desktop`, `mobile`, o ambos)
- Pasos de reproducción y comportamiento esperado
- Comportamiento real
- Capturas de pantalla, grabaciones de pantalla y registros cuando sea relevante

### 4) Ten en cuenta la adecuación del producto

Mindwtr se enfoca en GTD y ejecución práctica, y se construye para ser **simple por defecto y potente cuando lo necesitas**: divulgación progresiva, menos por defecto, sin expansión de características. *No me muestres un panel cuando solo quiero andar en bicicleta.* Las contribuciones tienen más probabilidades de ser aceptadas cuando:

- Mantienen flujos de trabajo simples por defecto
- Evitan complejidad de interfaz de usuario innecesaria
- Prefieren automático sobre manual: si el resultado correcto se puede inferir (plataforma, canal de instalación, datos existentes, contexto), la aplicación simplemente debe hacerlo — sin nueva configuración, sin aviso, sin paso de flujo de trabajo adicional o control de interfaz de usuario — y reutiliza un conmutador existente antes de crear uno nuevo (por ejemplo, las verificaciones de actualización se adaptan al canal de instalación en lugar de ofrecer un conmutador)
- Preservan la seguridad y confiabilidad de datos
- Funcionan consistentemente entre plataformas cuando sea aplicable

## Proceso de contribución de código

1. Encuentra un problema en el que trabajar, o abre uno para discusión.
2. Bifurca el repositorio y crea una rama en tu bifurcación.
3. Implementa el cambio con alcance enfocado.
4. Ejecuta verificaciones relevantes localmente.
5. Abre una solicitud de extracción a `dongdongbh/Mindwtr:main`.
6. Vincula el problema en la PR (ejemplo: `Fixes #123`).

Ejemplos de nombres de ramas:

- `fix/tray-preference-persistence`
- `feature/date-format-setting`
- `docs/contributing-update`

## Configuración de desarrollo y flujo de trabajo

Ejecuta todos los comandos desde la raíz del repositorio.

### Requisitos previos

- Bun (gestor de espacio de trabajo/paquete) — usa la versión en `.bun-version` (actualmente 1.3.5) o más nueva
- Node.js 20 o más nuevo — `apps/mcp-server` declara `"node": ">=20"` y se publica a npm, por lo que debe compilarse y ejecutarse en Node plano
- Git
- Cadena de herramientas Rust (requerida para compilación/desarrollo de Tauri de escritorio)
- Dependencias de webview del sistema para Tauri en tu SO
- En Windows: las herramientas de compilación de C++ de Visual Studio 2022. La cadena de herramientas 2026 actualmente falla al vincular los enlaces de transcripción `whisper-rs` (LNK1120 símbolos externos no resueltos de tiempo de ejecución C), así que fija el conjunto de herramientas MSVC v143 hasta que se corrija upstream.
- Herramientas de Expo para desarrollo móvil
- SDK de Android y/o Xcode si compilas móvil de forma nativa

### Instalar dependencias

```bash
bun install
```

### Ejecutar las aplicaciones

Escritorio (Tauri):

```bash
bun desktop:dev
```

Interfaz de usuario de escritorio solo (navegador/Vite):

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
- `apps/mobile`: interfaz de usuario móvil y código puente nativo
- `packages/core/src`: lógica empresarial compartida, almacén, sincronización y utilidades
- `scripts/`: scripts de lanzamiento y utilidad
- `docs/`: documentos markdown utilizados por el proyecto

El código de escritorio no debe importar `invoke` de `@tauri-apps/api/core` directamente. Llama a
`invokeNative` (rechaza cuando no hay tiempo de ejecución de Tauri) o `invokeNativeOr(fallback, ...)`
(se resuelve en el fallback) desde `apps/desktop/src/lib/tauri-invoke.ts`, para que cada sitio de llamada
indique qué debe hacer en la compilación web del navegador. Una prueba de trinquete en
`tauri-invoke.test.ts` falla en CI en una importación sin procesar.

## Pruebas y verificaciones de calidad

Antes de enviar, ejecuta la puerta de verificación local de línea base:

```bash
bun run verify
```

`bun run verify` encadena verificación de tipos (core, cloud, desktop, mobile y mcp), linting
para cada aplicación de espacio de trabajo, los cinco conjuntos de pruebas unitarias del espacio de trabajo, la suite de Rust
(`native:test`, algunos segundos una vez que el caché de cargo está caliente), verificaciones de gobernanza y
esquema, paridad de configuración regional e paridad de LÉEME. CI también ejecuta presupuestos de rendimiento, umbrales de cobertura, Expo Doctor y tienda/verificaciones de metadatos de flujo de trabajo.

Ejecuta `bun run native:test` por su cuenta mientras iteras sobre
`apps/desktop/src-tauri/`, y ejecuta
`bun run test:perf` para lista, almacén, recurrencia u otros cambios de ruta caliente.
`bun run test:e2e` necesita un navegador y sigue siendo una puerta opcional separada.

Mientras iteras, los comandos por área a continuación son más rápidos.

Linting de escritorio:

```bash
bun run --filter mindwtr lint
```

Pruebas de escritorio (paso único, sin vigilancia):

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

- TypeScript en primer lugar.
- Prefiere componentes de React funcionales y hooks.
- Mantén las importaciones agrupadas: externas, espacio de trabajo/internas, luego relativas.
- Coincide con convenciones de formato local:
  - desktop/core generalmente 4 espacios
  - móvil generalmente 2 espacios
- Mantén comentarios de código concisos y solo donde la lógica no sea obvia.
- Favorece consultas de prueba orientadas a la accesibilidad (`getByRole`, `getByLabelText`).
- Ventanas emergentes móviles: cualquier ventana emergente modal transparente que contenga un `TextInput` debe usar el hook `useAndroidKeyboardInset` compartido para que permanezca por encima del teclado suave de Android.
- Los cambios del editor de Markdown necesitan pruebas de regresión para los modos de falla históricos (salto de cursor en toque, desplazamiento a la vista, relleno de altura de teclado, tiempo de barra de herramientas) — estos se han enviado como errores de producción antes.

Nombrado:

- Componentes/proveedores: `PascalCase`
- Hooks: `useSomething`
- Módulos de utilidad: kebab-case (ejemplo: `storage-adapter.ts`)
- Pruebas: nombre de archivo de origen de espejo con `.test.ts`/`.test.tsx`

## Codificación asistida por LLM ("vibe coding")

Mindwtr no es estrictamente contrario a la codificación asistida por LLM. Las herramientas de LLM están mejorando rápidamente y pueden ser productivas cuando se usan correctamente.

Si usas agentes LLM/codificación para contribuciones, sigue estas reglas:

1. No uses interfaces de chat web como tu herramienta principal de codificación.
   Usa agentes de codificación en un IDE o CLI con indexación de repositorio y contexto de código base completo.
2. Usa agentes enfocados en codificación, no modelos de chat general.
   Ejemplo: usa Codex o agente de Claude Code para tareas de codificación, no modo de chatbot genérico.
3. Comienza con un objetivo de implementación claro.
   Define el error/característica, comportamiento esperado e implementación prevista antes de solicitar.
4. Evita la ingeniería excesiva.
   Prefiere cambios pequeños y mantenibles que coincidan con la filosofía "simple por defecto" de Mindwtr.
5. TÚ revisa la salida antes de abrir una PR que no sea borrador.
   No solicites revisión hasta que hayas leído y entendido cada cambio generado, ejecutado pruebas relevantes y verificado el comportamiento en dispositivos/plataformas reales. Eres responsable del código que envías, no de la herramienta.
6. Elimina verbosidad y charla.
   Elimina relleno de comentarios de código, documentación, descripciones de PR y mensajes de commit. Todos estos — incluidos los nombres — deben ser concisos, claros y contener información útil, nada más.
7. Elimina y desduplica código, pruebas y explicaciones redundantes.
   La explicitación y claridad son buenas; la verbosidad, la sobre-explicación y la redundancia son malas.
8. Mantén la seguridad en el alcance.
   No introduzca valores predeterminados inseguros, análisis inseguro, fugas de tokens o nuevas superficies de ataque.

## Directrices de solicitud de extracción

Todos los envíos pasan a través de solicitudes de extracción de GitHub y revisión del mantenedor.

Mantenga las PR pequeñas y enfocadas:

- Una corrección de error, una característica o una refactorización aislada por PR
- Evita agrupar cambios no relacionados

Antes de abrir una PR:

- Asegúrate de que las verificaciones relevantes pasen localmente
- Rebase/merge tu rama según sea necesario para resolver conflictos
- Verifica que no se incluyen archivos no relacionados

En tu descripción de PR, incluye:

- Qué cambió
- Por qué cambió
- Problema vinculado (`Fixes #...`)
- Evidencia de prueba (comandos ejecutados y resultados)
- Capturas de pantalla/grabaciones para cambios de interfaz de usuario
- Impacto de plataforma (`desktop`, `mobile`, `core`, o combinaciones)

Estilo de commit:

- Usa Conventional Commits cuando sea posible
- Ejemplos:
  - `fix(desktop): persist tray preference on macOS`
  - `feat(core): add date format normalization`
  - `docs: clarify sync troubleshooting`

## Contribuciones de documentación

Las actualizaciones de documentación son bienvenidas en el repositorio del sitio de documentación, `README.md`, `README_zh.md` y documentación local del repositorio.

La mayoría de la documentación orientada al usuario debe ir al sitio de documentación de Mindwtr, que construye el sitio de documentación público en https://docs.mindwtr.app/. Usa el directorio `docs/` de este repositorio para documentación local del repositorio como guías de contribución, resúmenes de arquitectura, ADR y notas de lanzamiento. El directorio `wiki/` contiene solo la página de destino del GitHub Wiki retirada, que dirige a los lectores al sitio de documentación; no agregues páginas de contenido allí.

Cuando cambies docs:

- Mantén las instrucciones precisas y ejecutables
- Prefiere ejemplos concretos sobre orientación vaga
- Valida enlaces
- Actualiza documentación en inglés y chino cuando el contenido se espeja
- Mantén la estructura de encabezado de `README.md` y `README_zh.md` alineada; CI ejecuta `bun run docs:check-readme`
- Prefiere actualizar la [fuente de documentación web de Mindwtr](https://github.com/dongdongbh/mindwtr-web/tree/main/docs) cuando el contenido es documentación pública de usuario/desarrollador

Referencias útiles:

- [Documentación oficial](https://docs.mindwtr.app/)
- [Fuente de documentación](https://github.com/dongdongbh/mindwtr-web/tree/main/docs)
- [Guía del desarrollador](https://docs.mindwtr.app/developers/developer-guide)
- [Arquitectura](https://docs.mindwtr.app/developers/architecture)

## Contribuciones de traducción

La mayoría de las cadenas de traducción viven en:

- [`packages/core/src/i18n/locales/`](https://github.com/dongdongbh/Mindwtr/tree/main/packages/core/src/i18n/locales/)

Cuando actualices traducciones:

- Mantén los marcadores de posición e integraciones de clave sin cambios
- Mantén los tokens de comando intactos donde el comportamiento del analizador depende de comandos en inglés
- Para un nuevo idioma, registra la configuración regional en los registros i18n compartidos, mapeo de configuración regional de fecha, selectores de idioma de escritorio/móvil y verificaciones de paridad de configuración regional
- Después de cambiar cualquier cadena `starter.*`, ejecuta `bun run scripts/i18n-locale-parity.ts --fix` para regenerar `packages/core/src/i18n/starter-seed-strings.ts`. Ese archivo se genera, nunca se edita manualmente, y `bun run i18n:check` falla hasta que esté de nuevo en sincronización
- Ejecuta `bun run i18n:check` y pruebas i18n principales relevantes
- Confirma que la interfaz de usuario aún se ajusta a diseños móviles pequeños

## ¿Necesitas ayuda?

Si no estás seguro sobre el alcance o detalles de implementación:

- Abre un problema de GitHub con una propuesta corta
- Únete al chat de la comunidad en Discord: https://discord.gg/gc4h5t58PR
- Solicita comentarios del mantenedor antes de implementar cambios grandes

Gracias de nuevo por contribuir a Mindwtr.
