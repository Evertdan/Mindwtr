# 02 · Modo TDAH — Día y Actividades (T-01, T-02, N-01..N-04)

> La experiencia central del día: ver el día, actuar sobre una Actividad, y las notificaciones
> que sostienen la secuencia. Fuente: PRD §4.1/§4.2, UJ-1..UJ-4, UJ-6..UJ-8. Spine: AD-1..AD-11.

## 🎨 Maquetado Stitch (referencia visual para construir el frontend)

Proyecto [`6331475909488481570`](https://stitch.withgoogle.com/projects/6331475909488481570) — screen ID completo para `get_screen`:

| Spec | Screen Stitch | Screen ID |
| --- | --- | --- |
| T-01 Hoy | Hoy (dark) | `ba9e62d54d014cefba0cb2ca8b7ba19e` |
| T-01 Hoy · light | Hoy (Light) | `e3d17c2f71ba44008c5966fc7f982dee` |
| T-01 · vacío | Hoy — Sin Rutina | `1f2b4749f12d4067b38a976d668b8c82` |
| T-01 · carga | Hoy — Cargando | `1b469f2df2d74b809456bd73ff785492` |
| T-01 · offline | Hoy — Sin Conexión | `d089367937604aa7815386de2c49c3ca` |
| T-02 Detalle | Detalle (dark) | `c77731050ccc4105ae035260146e365d` |
| T-02 Detalle · light | Detalle (Light) | `e2e1a5f53d2f4cc080b5fd610e45850b` |
| N-01/N-02 | Notificaciones | `04ff6d9fc2b04696896632b7d9d2d58b` |
| N-03 | Notificación Ritual | `41eb55e344644fb4a12b9569555d8af0` |
| N-04 + N-05 | Notificaciones Jira y Conexión | `7ab626700c5c41b8890c2b52c774df02` |
| Error de mutación (transversal) | Error de Mutación | `6c656d3dd0424c50982fa981b1f97f8f` |

## Estados de Actividad (especificación compartida)

Iconografía única en todas las pantallas — el sistema de estados ES el lenguaje visual del modo:

| Estado | Significado | Glifo sugerido (definir en DESIGN.md) |
| --- | --- | --- |
| `pending` | Generada/manual, aún no inicia | círculo vacío |
| `started` | Iniciada (hay `startedAt`) | círculo medio lleno / progreso |
| `completed` | Completada el mismo día planeado (✓ "en tiempo y forma") | check lleno |
| `missed` | Marcada ✗ conscientemente, o completada después de su día | cruz |
| `limbo` | Sin decisión al cierre del día | círculo punteado |
| `discarded` | Descartada explícitamente en el ritual | tachado suave |

Regla de color: ✓ verde del tema, ✗/`missed` rojo neutro SIN juicio (tono informativo, no alarma), `limbo` color de "pendiente-de-decisión" distintivo (el Limbo es un concepto nuevo — necesita identidad propia).

---

## T-01 · Hoy (timeline del día)

- **Plataforma:** móvil (primaria) · PWA (misma pantalla, layout ancho)
- **Propósito:** ver la línea de tiempo del día con sus Actividades y su estado; es la pantalla hogar del Modo TDAH.
- **Entradas:** tab/pestaña propia del Modo TDAH (coexiste con GTD, FR-1); deep-link desde notificación (N-01/N-02); al abrir la app con modo activo.
- **Zonas de layout:**
  1. **Cabecera de fecha** — día de semana + fecha + nombre de la Rutina que generó el día (ej: "Lunes 24 · Rutina Día laboral").
  2. **Timeline vertical de Actividades** — ordenadas por `plannedStart`; cada fila: hora, glifo de estado, título, duración esperada, badge de origen (Rutina / manual / Jira).
  3. **Indicador "ahora"** — línea/marcador en la Actividad vigente.
  4. **Franja laboral Jira** — bloque agrupado (ej: "9:30–14:00 · 3 tareas del sprint") SIN horas inventadas por tarea (FR-11).
  5. **Acceso rápido:** agregar Actividad manual (FR-4) + indicador de DND activo (FR-12) + entrada al Limbo (badge con conteo).
- **Contenido y datos:** actividades del `DayPlan` de hoy desde el VPS (AD-1: siempre fetch, sin caché de plan local).
- **Acciones:** tap en Actividad → T-02; agregar manual → T-02 en modo creación; tap en franja Jira → lista expandida de tareas (solo lectura).
- **Estados:**
  - *Vacío* (día sin Rutina aplicable, FR-3): "Hoy no tiene Rutina — agregá actividades manuales" + CTA.
  - *Carga:* skeleton de filas.
  - *Offline:* banner "Sin conexión al servidor — reintentando" (AD-11); NO se muestra plan viejo como si fuera vivo.
  - *Modo desactivado:* la tab no existe (FR-1).
- **Casos límite:** actividades traslapadas (mostrar ambas, sin resolver solape visual complejo); actividad sin hora (sección "sin hora" al final); día ya cerrado (23:00 pasado) muestra estado de solo lectura + link al ritual.
- **i18n:** todos los strings por clave; fecha/hora en locale del usuario (AD-6 wall-clock local).
- **Restricciones:** AD-1 (sin generación local), AD-5 (día ya materializado por el scheduler), AD-11 (offline = banner, no plan fantasma).
- **Notas de maquetación:** densidad alta tolerada (usuario consulta de vistazo); el glifo de estado debe leerse a distancia de brazo (reloj/brazo contexto); jerarquía: hora → glifo → título.

---

## T-02 · Detalle / edición de Actividad

- **Plataforma:** móvil (primaria) · PWA
- **Propósito:** ver y editar una Actividad puntual; crear una manual (FR-4); registrar acciones (inicio, completar, no completar) desde la app.
- **Entradas:** tap en fila de T-01; CTA "agregar" en T-01; desde el ritual (T-06) en modo edición.
- **Zonas de layout:**
  1. **Encabezado** — título editable (o input en creación), badge de origen (Rutina nombre / manual / Jira solo-lectura).
  2. **Horas** — `plannedStart` (hora opcional) + duración esperada (opcional). Selector nativo de hora.
  3. **Acciones de registro** — botones: *Iniciar* (escribe `startedAt`), *Completada* (✓), *No completada* (✗ consciente, FR-7).
  4. **Horas reales** — `startedAt`/`completedAt` mostrados como solo-lectura cuando existen (AD-7: el primer tap cuenta, no se re-editan).
  5. **Contexto** — si es instancia de Bloque: "parte de la Rutina X" (link informativo; editar la Rutina es otro camino, FR-2/FR-10).
- **Acciones:** guardar (request al VPS con estados de espera/error); eliminar instancia (solo este día, no la Rutina — FR-10).
- **Estados:** creación vs edición; Jira (campos bloqueados + aviso "solo lectura — el registro laboral vive en Jira", FR-11); error de red en acción (reintento).
- **Casos límite:** segundo tap en *Iniciar* → deshabilitado con tooltip "ya iniciada" (AD-7); actividad de día pasado → solo lectura de registro + estado.
- **Restricciones:** AD-7 (startedAt una sola vez; posponer NO aparece aquí — es snooze de notificación, no propiedad de la Actividad).
- **Notas de maquetación:** los botones de acción son los mismos conceptos que las acciones de notificación (N-01) — mismo lenguaje visual; "No completada" requiere la misma dignidad visual que "Completada" (registrar el fracaso consciente es un acto de salud, no un error — tono del PRD §1).

---

## N-01 · Notificación de inicio de Actividad

- **Plataforma:** notificación local Android (reenviada al reloj por Bluetooth — el reloj muestra título+cuerpo, sin acciones)
- **Disparo:** scheduler del VPS a `plannedStart` (±30 s, FR-5) → push por WebSocket/SSE → el teléfono la materializa (AD-3).
- **Contenido:** título = nombre de la Actividad; cuerpo = duración esperada ("30 min"); texto localizado.
- **Acciones (solo teléfono):**
  - **Iniciar** → HTTP al VPS, registra `startedAt` (AD-7).
  - **Posponer +10 min** → snooze de NOTIFICACIÓN: re-muestra a los 10 min; NO altera `plannedStart` ni nada del plan (FR-5).
  - **Completada** → HTTP al VPS, registra `completedAt`, cierra notificación, sin abrir la app (FR-7).
- **Comportamiento:** sin acción del usuario NO se repite en el momento (FR-5 NFR — la replanificación es nocturna); si ventana DND activa al programar → suprimida, no encolada, no recuperada (AD-8/FR-12).
- **Casos límite:** sin red al tocar → la acción falla con notificación de reintento o apertura de app (AD-7); teléfono apagado al disparo → perdida (offline = silencio, AD-11) — el día sigue vivo en el servidor y se cierra en el ritual.
- **Notas de maquetación:** en el RELOJ solo viajan título+cuerpo — el diseño del título/cuerpo debe funcionar sin acciones (el texto tiene que sostenerse solo: "Caminadora — 30 min").

## N-02 · Notificación de fin de Actividad

- **Disparo:** a `plannedStart + duración` de la Actividad anterior, anuncia cierre y siguiente: "Fin de Baño — próxima: Vestirse" (FR-5).
- **Acciones:** *Completada* (de la que termina) + *Posponer* — mismas semánticas que N-01.
- **Casos límite:** sin Actividad siguiente → "Fin de X" a secas; siguiente sin hora → solo nombre.

## N-03 · Notificación del ritual nocturno

- **Disparo:** a la hora configurada del ritual (default 23:00, tz del usuario — AD-6) desde el scheduler (FR-8).
- **Contenido:** "Cierre del día — revisá lo de hoy y armá mañana (≤10 min)".
- **Acciones:** *Abrir ritual* → deep-link a T-05 (móvil). En PWA no hay push v1 — entrada manual.
- **Nota de maquetación:** tono invitacional, no de alarma — el ritual es un mecanismo anti-deuda, no un castigo (SM-2/SM-3).

## N-04 · Notificación de franja Jira (agrupada)

- **Disparo:** al inicio de la franja laboral configurada (FR-11): "Sprint: 3 tareas pendientes asignadas" — UNA notificación por franja, nunca por tarea (sin horas inventadas).
- **Acciones:** *Ver* → abre T-01 con la franja expandida; marcar atendida = registro local de alerta, NO escribe a Jira (solo lectura, FR-11).
- **Estados:** fallo de sincronización Jira → la franja muestra aviso de degradación, lo personal sigue funcionando (FR-11 consequence).
