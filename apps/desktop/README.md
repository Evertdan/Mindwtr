# Mindwtr Desktop

Aplicación de escritorio Tauri v2 para el sistema de productividad Mindwtr.

## Características

### Flujo de Trabajo GTD

- **Procesamiento de Bandeja** - Flujo de clarificación guiado con la regla de 2 minutos
- **Filtrado de Contextos** - Contextos delimitados por barras con coincidencia de padres (@trabajo/reuniones)
- **Revisión Semanal** - Asistente paso a paso de revisión GTD
- **Vista de Tablero** - Kanban con arrastrar y soltar
- **Vista de Calendario** - Planificación de tareas basada en tiempo
- **Asistente de IA (Opcional)** - Clarificar, desglosar y revisar con IA de tu propia clave

### Productividad

- **Búsqueda Global** - Operadores de búsqueda (estado:, contexto:, vencimiento:<=7d)
- **Búsquedas Guardadas** - Guardar y reutilizar filtros de búsqueda
- **Acciones en Lote** - Selección múltiple, movimiento/etiquetado/eliminación por lotes
- **Dependencias de Tareas** - Bloquear tareas hasta que se completen los requisitos previos
- **Notas de Markdown** - Descripciones de texto enriquecido con vista previa
- **Adjuntos** - Archivos y enlaces en tareas
- **Listas Reutilizables** - Duplicar tareas o restablecer listas de verificación
- **Atajos de Teclado** - Presets de Vim y Emacs
- **Hotkey Global** - Capturar desde cualquier lugar
- **Icono de Bandeja** - Acceso rápido y captura

### Notificaciones

- **Recordatorios de Vencimiento** - Notificaciones de escritorio con posponer
- **Resumen Diario** - Informe matutino + indicadores de revisión nocturna

### Vistas

| Vista         | Descripción                                                  |
| ------------- | ------------------------------------------------------------ |
| Bandeja       | Capturar y procesar elementos entrantes                      |
| Próximas Acc. | Tareas accionables filtradas por contexto                    |
| Proyectos     | Resultados de varios pasos con áreas                         |
| Contextos     | Filtrado de contextos delimitados por barras con coincidencia|
| Esperando     | Elementos delegados                                          |
| Algún Día     | Ideas diferidas                                              |
| Calendario    | Vista basada en tiempo                                       |
| Tablero       | Kanban con arrastrar y soltar                                |
| Revisión      | Asistente de revisión semanal                                |
| Configuración | Tema, sincronización y preferencias                          |

## Pila de Tecnología

- **Frontend**: React + TypeScript + Vite
- **Estilos**: Tailwind CSS
- **Estado**: Zustand (compartido con móvil)
- **Plataforma**: Tauri v2 (backend en Rust, WebKitGTK)
- **Arrastrar y Soltar**: @dnd-kit

### ¿Por qué Tauri?

- 🚀 **Binario pequeño** (~5MB vs ~150MB para Electron)
- 💾 **Baja memoria** (~50MB vs ~300MB para Electron)
- 🦀 **Backend en Rust** para operaciones rápidas de archivos
- 🖥️ **Diálogos nativos** a través del webview del sistema

### Nota de Seguridad

- Tauri (`src-tauri/tauri.conf.json`) y compilaciones de PWA estáticas (`public/_headers`) incluyen un CSP restrictivo. Evita cargar contenido remoto no confiable en el webview.

## Requisitos Previos

- [Rust](https://rustup.rs/) (para compilar Tauri)
- [Bun](https://bun.sh/) (gestor de paquetes)

### Arch Linux

```bash
sudo pacman -S rust webkit2gtk-4.1 base-devel
```

## Inicio Rápido

```bash
# Desde la raíz del monorepo
bun install

# Ejecutar la aplicación de escritorio (modo de desarrollo)
cd apps/desktop
bun dev

# O desde la raíz
bun desktop:dev
```

## Compilación

```bash
# Compilar para distribución
bun run build

# Salida en src-tauri/target/release/
```

Las compilaciones de lanzamiento de Windows también publican `mindwtr_<version>_windows_x64_portable.zip`.
Extrae a una carpeta escribible y mantén `portable.txt` junto a `mindwtr.exe`.

## Almacenamiento de Datos

Las tareas se guardan en:

- **Datos de Linux**: `~/.local/share/mindwtr/data.json`
- **Configuración de Linux**: `~/.config/mindwtr/config.toml`

Configuración de Escritorio → Sincronización → Datos Locales muestra las rutas exactas para tu sistema operativo. Si usaste compilaciones muy tempranas, los datos pueden existir en directorios Tauri heredados como `~/.config/tech.dongdongbh.mindwtr/` y `~/.local/share/tech.dongdongbh.mindwtr/` y se migrarán automáticamente.

Las compilaciones portátiles de Windows almacenan el estado local junto al ejecutable:

- **Datos portátiles**: `profile/data/mindwtr.db`, `profile/data/data.json`, registros, instantáneas y capturas de audio
- **Configuración portátil**: `profile/config/config.toml` y `profile/config/secrets.toml`

El modo portátil almacena secretos en el archivo local `profile/config/secrets.toml` en lugar del llavero/anillo del sistema operativo. Windows WebView2 aún es necesario.

## Sincronización

Configura la sincronización en Configuración:

- **Sincronización de Archivos** - iCloud Drive, carpetas de Dropbox, Google Drive, Syncthing, recursos compartidos de red, etc.
- **WebDAV** - Nextcloud, ownCloud, servidores autohospedados
- **Dropbox** - Sincronización directa de carpeta de aplicación de Dropbox en compilaciones compatibles
- **Nube** - Backend de nube autohospedado (ver https://docs.mindwtr.app/data-sync/ y https://docs.mindwtr.app/data-sync/cloud-deployment)
- **Calendarios Externos (ICS)** - Superposición de calendario de solo lectura

Recomendación de sincronización:

- Prefiere **WebDAV** para ediciones frecuentes en múltiples dispositivos.
- Si usas **Syncthing**, usa `Enviar y Recibir` + `Vigilar cambios`, mantén intervalos de escaneo cortos, y toca **Sincronizar ahora** antes de cambiar dispositivos.

## Pruebas

```bash
bun run test
```

Incluye pruebas unitarias, pruebas de componentes y pruebas de accesibilidad.
