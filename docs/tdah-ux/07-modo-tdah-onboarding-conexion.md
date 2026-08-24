# 07 · Modo TDAH — Activación, conexión y permisos (T-14, N-05)

> Brechas detectadas en la revisión de completitud de flujos: el encendido del modo, la conexión
> persistente del teléfono (con su notificación obligatoria de Android) y los permisos del sistema.
> Sin estas pantallas, el flujo UJ-1 no puede empezar. Spine: AD-1, AD-3, AD-6, AD-8, AD-11.

## 🎨 Maquetado Stitch (referencia visual para construir el frontend)

Proyecto [`6331475909488481570`](https://stitch.withgoogle.com/projects/6331475909488481570) — screen ID completo para `get_screen`:

| Spec | Screen Stitch | Screen ID |
| --- | --- | --- |
| T-14 paso 1 | Activación 1 — Promesa | `f99ea4235b4840a5a13a8cde69cf7345` |
| T-14 paso 2 | Activación 2 — Ritual | `a5628cbbc7f14a5c88594b7a1d456026` |
| T-14 paso 3 | Activación 3 — Rutina | `a6c5665284a84bc5a32349fcc96f7707` |
| T-14 paso 4 | Activación 4 — Permisos | `34601f24286641c8b470e26341747eff` |
| T-14 paso 5 | Activación 5 — Listo | `84f414dc7e564d9c9f3f7f443f96a664` |
| N-05 + N-04 | Notificaciones Jira y Conexión | `7ab626700c5c41b8890c2b52c774df02` |
| Permiso denegado (transversal) | Aviso de Permisos | `77c959d0f86e4a18bb1213cbed1da848` |

## T-14 · Activación del Modo (onboarding)

- **Plataforma:** móvil (primaria) · PWA (activación simple sin permisos)
- **Propósito:** primera activación del modo (FR-1): entender el concepto, fijar lo mínimo y
  dejar el sistema andando. NO es un tour largo — es una secuencia corta que termina con el día
  de mañana generado.
- **Entradas:** toggle maestro en T-11 cuando el modo nunca se ha activado; tile del Menú (E-05)
  la primera vez.
- **Pasos (patrón `DesktopOnboardingFlow` existente, adaptado):**
  1. **Qué es esto** — una pantalla: "El Modo TDAH convierte teléfono + reloj en apoyo ejecutivo:
     rutinas generan tu día, el reloj vibra en cada transición, un ritual nocturno cierra hoy y
     arma mañana." (Vocabulario del PRD §1 — promesa central: "tu cabeza no sostiene el día sola").
  2. **Hora del ritual** — picker HH:mm (default 23:00, FR-8) + zona horaria detectada
     (confirmable, AD-6).
  3. **Primera Rutina** — crear la Rutina del "Día laboral" (atajo a T-04 con plantilla sugerida
     de bloques) O saltar (el sistema genera días vacíos hasta que exista una Rutina, FR-3).
  4. **Permisos del teléfono** (móvil): notificaciones → batería sin restricciones (para la
     conexión persistente) → calendario (opcional, para DND) — ver bloque de permisos abajo.
  5. **Fin** — "Mañana ya está generada" + entrada a T-01. (Verificable: el scheduler del VPS ya
     materializa mañana — AD-5.)
- **Estados:** re-activación tras apagar el modo (FR-1): NO vuelve a correr — salta directo al
  fin con datos conservados ("tus Actividades e historial siguen ahí").
- **i18n:** claves propias de onboarding (5 pantallas, texto mínimo).
- **Notas de maquetación:** tono calmado, cero jerga GTD (el usuario TDAH no necesita "contextos"
  ni "clarificar" — necesita "tu día, tu reloj, tu ritual").

## N-05 · Notificación persistente de conexión (foreground service)

- **Plataforma:** notificación Android persistente (obligatoria del OS para foreground services)
- **Propósito:** mantener viva la conexión WebSocket/SSE al VPS (AD-3). Android exige una
  notificación visible mientras el servicio corre.
- **Precedente concordante:** `persistent-capture-notification.ts` (N-E4) ya existe en el app con
  el mismo patrón — el mocker replica esa gramática visual (discreta, silenciosa, no swipeable).
- **Contenido:** "Mindwtr conectado — tus recordatorios del día están activos" + estado
  (conectado / reconectando…).
- **Acciones (móvil):** tap → T-01. Sin acciones destructivas.
- **Estados:** conectado (normal) · reconectando (backoff — diferido de implementación de la
  spine) · VPS inalcanzable (mantiene visible el último estado + "se reintentará"; sin spam).
- **Regla crítica de diseño:** esta notificación NUNCA compite con N-01..N-04 — prioridad
  mínima, canal propio, silenciosa. La vibra es territorio exclusivo de las Actividades.
- **Caso límite:** modo apagado (FR-1) → la conexión y esta notificación desaparecen (la
  generación y recordatorios se pausan — copy de T-11).

## Bloque de permisos del teléfono (móvil) — estados en pantallas

| Permiso | Para | Dónde se pide | Estado denegado |
| --- | --- | --- | --- |
| Notificaciones | materializar N-01..N-05 | paso 4 de T-14 | banner en T-01: "sin notificaciones no hay avisos" + CTA a settings del OS; el resto del modo sigue |
| Batería sin restricciones (exención de optimización) | supervivencia de la conexión persistente | paso 4 de T-14 (flujo nativo `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) | la conexión puede morir en Doze: chip de estado en T-01/T-12 "conexión limitada por batería" + re-pedir una vez; NUNCA bloquear el resto del modo |
| Calendario (lectura) | observación DND (AD-8) | paso 4 de T-14 (opcional, saltable) | T-12 degradado a ventanas manuales (estado ya especificado en 06) — copy sin culpa: "podés activarlo después" |

**Regla transversal de permisos:** cada permiso es degradable — el modo NUNCA se niega a
funcionar por un permiso faltante; se muestra el estado y el camino de recuperación. (El usuario
TDAH abandona flows que se rompen — todos los estados tienen salida.)

## Matriz de flujos completos (verificación de cobertura UJ/FR)

| Flujo | Camino | Cubierto por |
| --- | --- | --- |
| UJ-1 mañana entre semana | N-01 → tap → T-01/T-02 → N-02 secuencia | T-01, T-02, N-01, N-02 |
| UJ-2 arranque laboral + Jira | N-04 franja → T-01 expandida → (config: T-13) | N-04, T-13, T-01 |
| UJ-3 trabajo profundo + DND | calendario → supresión silenciosa → sin avalancha | T-12, AD-8 |
| UJ-4 tarde/noche | N-01/N-02 → registro | T-01, T-02 |
| UJ-5 ritual nocturno | N-03 → T-05 → T-06 → T-07 (+ abandono → Limbo) | N-03, T-05..T-07, T-08 |
| UJ-6/7/8 rutinas por patrón | T-03/T-04 CRUD + preview de aplicabilidad | T-03, T-04 |
| FR-1 on/off + reactivación | T-11 + T-14 (solo primera vez) | T-11, T-14 |
| FR-13 métricas | T-10 + drill-down T-09 | T-09, T-10 |
| Primer arranque total | T-14 onboarding → primera generación → T-01 | T-14, N-05, permisos |
| Conexión caída | N-05 estado → T-01 banner → reintento | N-05, T-01 (AD-11) |
