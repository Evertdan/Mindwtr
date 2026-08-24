# 00 · Inventario existente — App móvil (E-01..E-20, N-E*, W-*, Q-*)

> **Referencia visual:** el código existente del app (`apps/mobile/`) — estas pantallas YA están
> construidas; no hay screens en Stitch para la serie E-xx. El maquetado Stitch
> (`6331475909488481570`, ver [08-stitch-maquetado.md](./08-stitch-maquetado.md)) cubre
> exclusivamente lo nuevo (T-xx/N-xx).

> Verificado contra el código real (commit `62b1ceef9`): `apps/mobile/app/` (Expo Router ~6 +
> react-navigation drawer+tabs), `apps/mobile/components/`, `apps/mobile/lib/`.
> Cada entrada trae **concordancia TDAH**: cómo la pantalla existente recibe lo nuevo sin cambiar
> su naturaleza (regla del usuario: lo existente se queda igual; solo lo nuevo es distinto).

## Navegación raíz

Expo Router con `_layout.tsx` raíz → grupo `(drawer)` (Stack) → grupo `(tabs)` (BottomTabs).
Handler central de apertura de notificaciones: `hooks/root-layout/use-root-layout-notification-open-handler.ts`
— **todos los deep-links de notificaciones TDAH (N-01..N-05) deben registrarse aquí**, mismo mecanismo.

## Tabs inferiores (orden real)

| ID | Pantalla | Ruta | Propósito | Concordancia TDAH |
| --- | --- | --- | --- | --- |
| E-01 | **Inbox** | `(tabs)/inbox` + `components/inbox-processing/` | capturar y procesar con flujo guiado (regla 2 min) | Sin cambios. La Actividad manual NO pasa por aquí (dominio propio, AD-4) |
| E-02 | **Agenda/Focus** | `(tabs)/focus` | vista hogar: agenda del día + siguientes acciones (`MOBILE_HOME_TAB_ROUTE` configurable) | **T-01 Hoy** se suma como vista hogar alterna cuando el modo está activo (FR-1) — ver nota abajo |
| E-03 | **Captura** | `(tabs)/capture` (botón + central) + `capture-modal` raíz + `components/quick-capture-sheet/` + share sheet del OS | captura rápida GTD | Sin cambios. Agregar Actividad manual TDAH usa su propio CTA en T-01/T-06 — no convierte la captura GTD en algo híbrido |
| E-04 | **Projects** | `(tabs)/projects` → `(drawer)/projects-screen` | proyectos con secciones/áreas | Sin cambios |
| E-05 | **Menú** | `(tabs)/menu` (More sheet: `MoreSheetTile`) | acceso a vistas rápidas: board, calendar, review, contexts, waiting, someday, reference, done, archived, trash, saved searches, settings | **Entrada del Modo TDAH en móvil**: tile "Modo TDAH" cuando activo → T-01. El More sheet es el "hub" móvil |

**Nota E-02/T-01 (decisión a fijar en maquetación):** el hogar configurable ya existe
(`MOBILE_HOME_TAB_ROUTE`). Dos opciones concordantes: (a) T-01 como destino adicional del
home-route cuando el modo está activo; (b) T-01 vive detrás del tile del Menú. Recomendado: (a) —
el usuario TDAH abre la app y cae en su día. El switch GTD↔TDAH nunca elimina tabs existentes.

## Stack del drawer (pantallas completas)

| ID | Pantalla | Ruta | Concordancia TDAH |
| --- | --- | --- | --- |
| E-06 | Board (kanban) | `(drawer)/board` + `views/board-view` | Sin cambios |
| E-07 | Calendar | `(drawer)/calendar` + `(tabs)/calendar-tab` + `views/calendar/` | Sin cambios — sin puente GTD (AD-4); las Actividades NO se proyectan aquí |
| E-08 | Review | `(drawer)/review` + `(tabs)/review-tab` + raíz `daily-review.tsx` / `weekly-review.tsx` | ⚠️ **Distinción crítica**: la revisión GTD (diaria/semanal) NO es el ritual TDAH. Flujos paralelos, pantallas separadas — el mocker no los fusiona |
| E-09 | Contexts | `(drawer)/contexts` | Sin cambios |
| E-10 | Waiting For | `(drawer)/waiting` | Sin cambios |
| E-11 | Someday/Maybe | `(drawer)/someday` | Sin cambios |
| E-12 | Reference | `(drawer)/reference` | Sin cambios |
| E-13 | Done | `(drawer)/done` | Sin cambios |
| E-14 | Archived | `(drawer)/archived` | Sin cambios |
| E-15 | Trash | `(drawer)/trash` | Sin cambios |
| E-16 | Saved Search | `(drawer)/saved-search/[id]` | Sin cambios |
| E-20 | **Settings** | `(drawer)/settings` — ver subsistema abajo | **T-11 se integra aquí** |

## Flujos raíz (modales/screens globales)

| ID | Pantalla | Ruta | Concordancia TDAH |
| --- | --- | --- | --- |
| E-17 | Global Search | `global-search.tsx` | Sin cambios (busca Tasks GTD; el dominio TDAH tiene su propio historial/limbo con sus pantallas) |
| E-18 | Mind Sweep | `mind-sweep-modal.tsx` | Sin cambios |
| E-19 | Check Focus | `check-focus.tsx` | Sin cambios |
| — | iOS native intent | `+native-intent.ts` | Sin cambios |

## E-20 · Settings (subsistema)

Shell con búsqueda (`settings.shell.tsx`, `settings.constants.ts`, `settings.hooks.ts`) y secciones:

| Sub | Pantalla | Archivo | Concordancia TDAH |
| --- | --- | --- | --- |
| E-20a | General | `general-settings-screen.tsx` | T-11 (ajustes del modo) se registra como sección nueva del shell — hereda búsqueda y gramática visual (`setting-row.tsx`) |
| E-20b | Notificaciones | `notifications-settings-screen.tsx` | ⚠️ Solo recordatorios GTD (ADR-0013). El ajuste TDAH (ritual, DND) NO se mezcla aquí — vive en T-11 (AD-10) |
| E-20c | Sync | `sync-settings-*` (file/webdav/dropbox/cloudkit/selfhosted + encryption) | Sin cambios — el módulo TDAH NO usa este sync (AD-4). Nota: el panel "Autohospedado" ya enseña al usuario a apuntar a su VPS — misma URL que usará la conexión TDAH |
| E-20d | AI | `ai-settings-*` | Sin cambios |
| E-20e | Calendario | `calendar-settings-screen.tsx` | La observación DND (T-12) reutiliza el permiso/gestos de esta pantalla existente (expo-calendar ya integrado) |
| E-20f | Manage / About / Feedback | `manage-`, `about-`, `feedback-*` | Sin cambios |

## Superficies de sistema existentes

| ID | Superficie | Realidad verificada | Concordancia TDAH |
| --- | --- | --- | --- |
| N-E1 | Recordatorios inicio/vencimiento GTD | `lib/notification-service-local.ts` + `react-native-alarm-notification` (alarmas exactas, `plugins/patch-alarm-notification-gradle.js`) | **Pipeline SEPARADO del TDAH** (AD-10): TDAH no programa alarmas locales; solo materializa push del VPS. Reutiliza el canal de presentación y el handler de apertura |
| N-E2 | Daily digest (briefing mañana + revisión tarde) | servicio de notificaciones local | Sin cambios — NO es el ritual TDAH (el ritual es N-03, server-side) |
| N-E3 | Recordatorio revisión semanal | ídem | Sin cambios |
| N-E4 | Notificación persistente de captura | `lib/persistent-capture-notification.ts` | Precedente clave: **ya existe una foreground/persistent notification en el app** — N-05 (conexión TDAH) sigue el mismo patrón, no inventa uno nuevo |
| W-1 | Widget Android Focus/next (2x2 adaptativo) | plugins/prebuild | v1 sin widget TDAH (deferido); posible v2: próxima Actividad |
| W-2 | Widget iOS focus/next + quick capture | ios-native | Ídem |
| Q-1 | iOS Quick Actions (Add/Focus/Calendar) | ios-app-intents | Sin cambios; posible v2: "Abrir ritual" |

## Reglas FOSS (verificadas en `apps/mobile/AGENTS.md`)

- Build F-Droid/Izzy no puede traer paquetes Google/Play — gate `isFossBuild`, verificado por `scripts/verify_foss_no_google_services.py`. **La arquitectura TDAH (WebSocket/SSE sin FCM, AD-3) es compatible por diseño** — es exactamente el tipo de push que un build FOSS acepta.
- `ios/`-`android/` son salida de prebuild (gitignored): el foreground service del canal TDAH debe vivir en `plugins/` (config plugin), nunca editado a mano en los árboles generados.
