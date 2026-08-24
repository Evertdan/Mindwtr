# Mindwtr Mobile

React Native mobile app for the Mindwtr productivity system.

## Features

### GTD Workflow
- **Inbox Processing** - Guided clarify workflow with 2-minute rule
- **Context Filtering** - Slash-delimited contexts with parent matching (@work/meetings)
- **Dark Mode** - Full dark theme support with system preference
- **Swipe Actions** - Quick task management gestures
- **Smart Tags** - Frequent and recommended context tags
- **Quick Status** - Instant status change via status badge tap
- **Auto-Archive** - Automatically archive completed tasks
- **Android Widget** - Home screen focus/next widget (adaptive, 2x2 default)
- **iOS Widget** - Home screen focus/next widget with quick capture
- **iOS Quick Actions** - Long-press app icon shortcuts for Add task, Focus, Calendar
- **AI Assistant (Optional)** - Clarify, break down, and review with BYOK AI
- **Copilot Suggestions** - Context/tag/time hints while typing

### Productivity
- **Global Search** - Search operators (status:, context:, due:<=7d)
- **Saved Searches** - Save and reuse search filters
- **Task Dependencies** - Block tasks until prerequisites complete
- **Markdown Notes** - Rich text descriptions
- **Attachments** - Files, images, and links on tasks
- **Reusable Lists** - Duplicate tasks or reset checklists
- **Task View/Edit** - Swipe between Task and View modes
- **Checklist Mode** - Fast list-style checking for checklist tasks
- **Share Sheet** - Capture from any app

### Notifications
- **Due Date Reminders** - Push notifications with snooze
- **Daily Digest** - Morning briefing + evening review prompts
- **Weekly Review** - Reminder to start your weekly review

### Screens
| Screen        | Description                        |
| ------------- | ---------------------------------- |
| Inbox         | Capture and process incoming items |
| Next Actions  | Context-filtered actionable tasks  |
| Agenda        | Daily focus and upcoming tasks     |
| Projects      | Multi-step outcomes                |
| Menu          | Board, Review, Calendar, Settings  |
| Contexts      | Hierarchical filtering (menu)      |
| Waiting For   | Delegated items (menu)             |
| Someday/Maybe | Deferred ideas (menu)              |
| Board         | Kanban drag-and-drop (menu)        |
| Calendar      | Tasks + external events (menu)     |
| Review        | Daily + weekly review (menu)       |
| Settings      | Theme, sync, notifications         |

## Tech Stack

- React Native + Expo SDK 54
- TypeScript
- Zustand (shared with desktop via @mindwtr/core)
- Expo Router (file-based navigation)

## Quick Start

```bash
# From monorepo root
bun install

# Start Expo dev server
bun mobile:start

# Run on Android
bun mobile:android

# Run on iOS
bun mobile:ios
```

## Prerequisites

- Node.js
- Bun package manager
- Expo Go app (for device testing) OR
- Android Studio (for emulator) OR
- Xcode (for iOS Simulator)

## Building APK Locally

To build an Android APK locally (without using Expo cloud builds):

### 1. Install Java JDK

```bash
# Arch Linux
sudo pacman -S jdk17-openjdk

# Set JAVA_HOME (add to ~/.zshrc for persistence)
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
```

### 2. Install Android SDK

# Create SDK directory
mkdir -p ~/Android/Sdk/cmdline-tools

# Download and extract command-line tools
cd /tmp
wget https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip commandlinetools-linux-*.zip
mv cmdline-tools ~/Android/Sdk/cmdline-tools/latest

# Set environment variables (add to ~/.zshrc or ~/.bashrc)
export ANDROID_HOME=~/Android/Sdk
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"

# Reload shell
source ~/.zshrc

# Accept licenses and install components
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"

### 3. Build APK

## iOS Builds (EAS)

To build and submit the iOS app via EAS:

```bash
eas build --profile production --platform ios
eas submit --platform ios
```

## Android Environment

> **IMPORTANT**: You must only use `ANDROID_HOME`. Do NOT set `ANDROID_SDK_ROOT` - it is deprecated and causes conflicts.

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
# Android SDK (ONLY use ANDROID_HOME, not ANDROID_SDK_ROOT)
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
```

### Build (ABI-split APKs)
Mindwtr builds **split APKs per ABI** (arm64-v8a, armeabi-v7a, x86, x86_64) so the arm64 file stays under store size limits like F-Droid/Izzy.

If you already have `apps/mobile/android` on disk, run prebuild so the ABI split config is applied:

```bash
npx expo prebuild --clean --platform android
```

Then build locally (recommended):

```bash
ARCHS=arm64-v8a bash ./scripts/android_build.sh
```

After the build, grab the APKs from:

```
apps/mobile/build/
```

For IzzyOnDroid, upload the versioned arm64 build:

```
mindwtr-<version>-arm64-v8a.apk
```

The build script may also write the raw Gradle output (e.g. `app-arm64-v8a-release.apk`), but you only need the `mindwtr-<version>-arm64-v8a.apk` file for releases.

To change which ABIs are built by default, edit the `architectures` list for `./plugins/abi-splits` in `apps/mobile/app.json`.

### 4. Upload to GitHub Release

After building, upload the APK to GitHub releases using `gh` CLI:

```bash
# Upload to existing release
gh release upload vX.Y.Z build/mindwtr-<version>-arm64-v8a.apk --clobber

# Or create new release with APK
gh release create vX.Y.Z build/mindwtr-<version>-arm64-v8a.apk --title "vX.Y.Z" --notes "Release notes here"

# View releases
gh release list
```

## Running on Device

### Expo Go (Recommended)
1. Install Expo Go on your phone
2. Run `bun mobile:start`
3. Scan QR code with camera (iOS) or Expo Go (Android)

### Android Emulator

#### Option A: Android Studio (Recommended for Emulator)

1. **Install Android Studio:**
   ```bash
   # Arch Linux
   sudo pacman -S android-studio
   # Or use snap:
   sudo snap install android-studio --classic
   ```

2. **Install SDK via Android Studio:**
   - Open Android Studio → Tools → SDK Manager
   - Install: Android SDK Platform, Build-Tools, Emulator

3. **Create Virtual Device:**
   - Tools → Device Manager → Create Device
   - Pick a phone (e.g., Pixel 6) → Select system image (e.g., Android 13)
   - Finish

4. **Run:**
   ```bash
   # List available emulators
   emulator -list-avds

   # Start emulator
   emulator -avd Pixel_API_34 &

   # Run app
   bun mobile:android
   ```

#### Option B: Command-line Only (Already Covered Above)

Use the SDK you installed in the "Building APK Locally" section.

## Perfil de Inicio de Android

Usa este flujo de trabajo para obtener números de inicio repetibles y registros a nivel de fase.

### 1. Compila una aplicación de lanzamiento con marcadores de inicio habilitados

```bash
cd apps/mobile
EXPO_PUBLIC_STARTUP_PROFILING=1 npx expo run:android --variant release
```

Esto habilita marcadores de inicio de JS (`[MindwtrStartup] ...`) mientras mantiene las compilaciones normales silenciosas.
Si los archivos nativos de Android ya existen, ejecuta `npx expo prebuild --clean --platform android` primero para que los complementos de configuración reaplicen los parches de rastreo de inicio.

### 2. Ejecuta bucles de referencia de inicio repetibles

Desde la raíz del repositorio:

```bash
bash apps/mobile/scripts/android_startup_benchmark.sh
```

Variantes útiles:

```bash
# 15 inicios en frío
RUNS=15 MODE=cold bash apps/mobile/scripts/android_startup_benchmark.sh

# inicios en caliente (proceso ya almacenado en caché)
RUNS=15 MODE=warm bash apps/mobile/scripts/android_startup_benchmark.sh

# paquete/actividad personalizado
PACKAGE=tech.dongdongbh.mindwtr ACTIVITY=.MainActivity bash apps/mobile/scripts/android_startup_benchmark.sh
```

Los resultados se escriben en:

```text
apps/mobile/build/startup-benchmark/<timestamp>-<mode>/
```

Archivos clave:
- `summary.txt`: mediana/p95/mín/máx para `ThisTime`/`TotalTime` y duraciones de fase de inicio.
- `am_start_results.csv`: tiempos de lanzamiento por ejecución desde `am start -W` más `launch_state`/`sample_quality`.
- `phase_durations.tsv`: `durationMs` por fase extraído de marcadores de inicio.
- `js_since_start.tsv`: `sinceJsStartMs` por fase desde marcadores de inicio de JS.
- `run-*.log`: logcat filtrado sin procesar por ejecución.
- `run-*-am-start.txt`: salida bruta de `am start -W` por ejecución (úsalo para muestras faltantes/timeout).

Notas:
- En versiones recientes de Android, `ThisTime` puede omitirse; trata `TotalTime` + marcadores de fase de inicio como primarios.
- Las ejecuciones con `sample_quality` como `missing_total_time_wait_timeout` deben tratarse como muestras inestables, no como medianas de línea base.
- Si `LaunchState` es `UNKNOWN (0)` y falta `TotalTime`, confía en resúmenes `js.splash_hidden`/`js.app_ready` de `js_since_start.tsv`.
- Si `sample_quality` incluye `log_quota_dropped`, Android descartó registros de proceso (`LOG_FLOWCTRL`), por lo que los marcadores de JS faltantes probablemente sean un artefacto de registro. Confía en `TotalTime` y vuelve a ejecutar con menos etiquetas ruidosas si necesitas cadenas de marcadores completas.

### 3. Capturar seguimiento de Perfetto para causa raíz profunda

Mientras reproduces un inicio en frío lento:

```bash
adb shell perfetto -o /data/misc/perfetto-traces/mindwtr-startup.pftrace -t 12s \
  sched freq idle am wm gfx view binder_driver hal dalvik input res memory
adb pull /data/misc/perfetto-traces/mindwtr-startup.pftrace
```

Luego abre https://ui.perfetto.dev y correlaciona fases de registro de `MindwtrStartup` con bloqueo de hilo principal, I/O y secciones de GC.

## Almacenamiento de Datos

Las tareas se almacenan en AsyncStorage y se sincronizan a través del paquete compartido @mindwtr/core.

## Estructura del Proyecto

```
apps/mobile/
├── app/                    # Páginas de Expo Router
│   ├── (tabs)/            # Navegación por pestañas
│   ├── _layout.tsx        # Diseño raíz
│   └── settings.tsx       # Página de configuración
├── components/            # Componentes React
├── contexts/              # Contextos React (tema, idioma)
├── lib/                   # Utilidades
│   ├── storage-adapter.ts # Integración de AsyncStorage
│   └── storage-file.ts    # Operaciones de archivo para sincronización
├── global.css             # CSS de entrada de NativeWind
├── tailwind.config.js     # Configuración de Tailwind
├── metro.config.js        # Configuración del empaquetador Metro
├── babel.config.js        # Configuración de Babel con NativeWind
└── nativewind-env.d.ts    # Declaraciones de TypeScript
```

## NativeWind (Tailwind CSS)

La aplicación móvil usa NativeWind v4 para estilos de Tailwind CSS.

### Archivos de Configuración

| Archivo               | Propósito                                    |
| --------------------- | -------------------------------------------- |
| `tailwind.config.js`  | Tema de Tailwind y preset de NativeWind      |
| `global.css`          | Punto de entrada de directivas de Tailwind   |
| `babel.config.js`     | Preset de babel de NativeWind                |
| `metro.config.js`     | Procesamiento de CSS con `withNativeWind`    |
| `nativewind-env.d.ts` | Tipos de TypeScript para la propiedad `className` |

## Sincronización y Datos

### Almacenamiento Local
Los datos se almacenan en AsyncStorage y se sincronizan automáticamente con el almacén Zustand compartido.

### Sincronización de Archivos
Configura una carpeta de sincronización en Configuración para sincronizar a través de:
- Dropbox
- Syncthing
- Cualquier servicio de sincronización basado en carpetas

Para ediciones frecuentes en múltiples dispositivos, se recomienda WebDAV sobre herramientas de sincronización de carpetas.
Si usas Syncthing, prefiere `Enviar y Recibir` + `Vigilar cambios`, mantén intervalos de escaneo cortos y ejecuta **Sincronizar** antes de cambiar dispositivos.

### WebDAV / Nube
Mindwtr también admite backends de sincronización WebDAV y Nube en **Configuración → Sincronización**:
- `Autohospedado` (punto final `/data` existente + token)
- `Dropbox` OAuth (Carpeta de Aplicación)

#### Configuración de OAuth de Dropbox
1. Crea una aplicación de Dropbox con **Acceso limitado** + **Carpeta de aplicación**.
2. Habilita ámbitos: `files.content.read`, `files.content.write`, `files.metadata.read`.
3. Agrega URI de redirección: `mindwtr://redirect`.
4. Establece variable de entorno antes de iniciar Expo:
   - `DROPBOX_APP_KEY=<tu-clave-de-aplicación-de-dropbox>`
5. Reinicia la aplicación y conecta en **Configuración → Sincronización → Nube → Dropbox**.
6. Usa una compilación de desarrollo/lanzamiento para OAuth. Expo Go no es compatible con redirecciones OAuth de Dropbox.

El backend de Dropbox sincroniza:
- `/Apps/Mindwtr/data.json`
- `/Apps/Mindwtr/attachments/*` (adjuntos de archivos)

## Solución de Problemas

### Problemas de Caché de Metro

```bash
# Borrar caché e iniciar de nuevo
bun start --clear

# O borrar manualmente
rm -rf .expo node_modules/.cache
```

### NativeWind No Funciona

1. Asegúrate de que `global.css` se importe en `app/_layout.tsx`
2. Verifica que `babel.config.js` tenga el preset de NativeWind
3. Reinicia Metro con borrado de caché

### Errores de Compilación

```bash
# Reinstalar dependencias
cd /path/to/Mindwtr
rm -rf node_modules apps/mobile/node_modules
bun install
```

## Recursos

- [Documentación de Expo](https://docs.expo.dev/)
- [Documentación de NativeWind](https://www.nativewind.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [React Native](https://reactnative.dev/)
