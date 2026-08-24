# 01 · Inventario existente — Web/PWA y Desktop (E-21..E-35)

> **Referencia visual:** el código existente (`apps/desktop/src/`) — estas vistas YA están
> construidas; no hay screens en Stitch para la serie E-xx. El maquetado Stitch
> (`6331475909488481570`, ver [08-stitch-maquetado.md](./08-stitch-maquetado.md)) cubre
> exclusivamente lo nuevo (T-xx/N-xx).

> Verificado contra código real: `apps/desktop/src/` (React + Vite + Zustand compartido).
> **Hallazgo de concordancia central:** la PWA que sirve el Docker (`docker/app/Dockerfile`:
> `bun desktop:web:build` → `apps/desktop/dist` → nginx) **es el codebase desktop compilado
> para web**. Una sola base de código = PWA del navegador + app Tauri de escritorio.
> Consecuencia para el Modo TDAH: las pantallas de planificación (superficie PWA de la spine)
> se implementan en `apps/desktop` — y el Tauri de escritorio **las hereda gratis**
> (actualiza la lectura de "desktop fuera de v1": no hay esfuerzo extra, simplemente no se
> pulen peculiaridades de Tauri en v1).

## Navegación real

SPA sin router-librería: `Layout.tsx` con vistas por `id` (sidebar/nav). Vistas verificadas:
`agenda, inbox, projects, contexts, waiting, someday, board, calendar, review, done, reference,
archived, trash, obsidian` + `settings` + búsqueda.

| ID | Vista | Archivo (`components/views/`) | Concordancia TDAH |
| --- | --- | --- | --- |
| E-21 | Agenda | `AgendaView.tsx` | Sin cambios |
| E-22 | Inbox + procesamiento | `inbox/`, `InboxProcessor` | Sin cambios |
| E-23 | Projects | `ProjectsView.tsx` + `projects/` | Sin cambios |
| E-24 | Contexts | `ContextsView.tsx` | Sin cambios |
| E-25 | Waiting | (lista) | Sin cambios |
| E-26 | Someday | (lista) | Sin cambios |
| E-27 | Board | `BoardView.tsx` + `board-view-dnd` | Sin cambios |
| E-28 | Calendar | `CalendarView.tsx` + `calendar/` | Sin cambios — sin puente GTD (AD-4) |
| E-29 | Review | `ReviewView.tsx` + `review/` | Distinción: NO es el ritual TDAH |
| E-30 | Done / Archived / Trash / Reference | (listas) | Sin cambios |
| E-31 | Obsidian (importación) | `ObsidianView.tsx` | Sin cambios |
| E-32 | ListView (tareas) | `ListView.tsx` | Sin cambios |
| E-33 | Search | `SearchView.tsx` + `GlobalSearch.tsx` | Sin cambios |
| E-34 | **Settings** | `settings/` | **T-11 web se integra aquí** (misma gramática de settings) |
| E-35 | Pomodoro panel | `PomodoroPanel.tsx` | Sin cambios — el "timer" TDAH es otro concepto (registro de horas reales, no cronómetro) |

## Modales globales existentes

| Modales | Concordancia TDAH |
| --- | --- |
| `QuickAddModal`, `QuickAddPreview`, `QuickDateChips` | La Actividad manual TDAH en web usa el CTA de T-01/T-06, no el QuickAdd GTD (dominios separados) |
| `MindSweepModal`, `PromptModal`, `StartupPromptModal` | Sin cambios |
| `KeybindingHelpModal` (presets Gmail/Vim/Emacs) | v1 TDAH web es pointer-first; atajos diferidos |
| `DesktopOnboardingFlow` | Precedente para **T-14 onboarding TDAH** (mismo patrón de flujo de bienvenida) |
| `InboxProcessingWizard` + paneles | Sin cambios |
| `ConfirmModal`, `ToastHost`, `PersistenceFailureBanner` | Reutilizar como primitivas de las pantallas T-xx (confirmaciones, toasts de éxito/error de red AD-1) |

## Implicaciones estructurales para las T-xx (fijadas por esta revisión)

1. **Las pantallas T-03..T-13 "PWA" se construyen en `apps/desktop`** como vista nueva del Layout
   (sección "Modo TDAH" en el nav, visible cuando el modo está activo) + sus modales.
2. **T-05..T-07 (ritual) también existen en web** — la spine puso el ritual en móvil-primario,
   pero como la PWA es surface de planificación, el flujo completo vive en ambas; en web SIN N-03
   (no hay push en PWA v1): entrada manual desde la sección TDAH (FR-8 ya lo permite).
3. **Estado de conexión al VPS**: en web, el fetch es request/respuesta normal (sin conexión
   persistente) — los estados offline/error de las T-xx aplican igual (AD-1/AD-11).
4. **Responsive**: `apps/desktop` ya sirve computadora y tablet por navegador; las T-xx siguen
   la densidad de tabla/puntero de las vistas existentes.
5. El store Zustand **compartido GTD no se toca** para TDAH (AD-4): el estado TDAH llega por
   fetch a la API del módulo — hooks/contexts propios en `apps/desktop`, sin tocar `store/` core.
