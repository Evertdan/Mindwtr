# 04 · Modo TDAH — Ritual nocturno (T-05, T-06, T-07)

> El mecanismo anti-deuda del producto: cerrar hoy y armar mañana en ≤10 minutos (SM-3).
> Fuente: PRD §4.3 FR-8..FR-10, UJ-5. Spine: AD-1, AD-5, AD-6, AD-7, AD-11.

## 🎨 Maquetado Stitch (referencia visual para construir el frontend)

Proyecto [`6331475909488481570`](https://stitch.withgoogle.com/projects/6331475909488481570) — screen ID completo para `get_screen`:

| Spec | Screen Stitch | Screen ID |
| --- | --- | --- |
| T-05 Cierre | Cierre del día | `5dfeb60cc5884ac98340eff70ee7a1c1` |
| T-05 Cierre · variante | Cierre | `57e804c7a3b24436bcdf2a925ee74f3b` |
| T-05 Cierre · light | Cierre (Light) | `0cf531095fcd432f96ec9a3e7300a57f` |
| T-06 Mañana | Mañana (variante A) | `2c9177e99a9140279cfa36e326efa117` |
| T-06 Mañana · variante | Mañana (variante B) | `00bd07de9d084df3a8201e570a21b93e` |
| T-07 Confirmación | Confirmación | `e7fa92b638f14332954fc905d1f7361b` |
| N-03 (entrada del ritual) | Notificación Ritual — ver doc 02 | `41eb55e344644fb4a12b9569555d8af0` |

*Brecha registrada (doc 08): versión PWA del ritual (dos columnas ≥1024 px) sin screen aún.*

Contexto de arquitectura que moldea TODO el flujo (AD-5): a la hora del ritual, el scheduler del VPS **ya generó** el día siguiente y **ya cerró** el día saliente (sin registro → Limbo). El ritual es un flujo de **edición y decisión**, nunca de creación ni de rescate.

## T-05 · Cierre del día (paso 1 del ritual)

- **Plataforma:** móvil (primaria — el ritual es de teléfono en mano, en la cama) · PWA (mismo flujo)
- **Propósito:** revisar el resultado del día: Actividades con ✓/✗/sin registrar y horas reales; decidir por cada ✗ (FR-8/FR-9).
- **Entradas:** notificación N-03 (deep-link); entrada manual desde la app en cualquier momento (FR-8).
- **Zonas de layout:**
  1. **Resumen del día** — conteo tipo scoreboard: completadas en tiempo y forma / no completadas / quedaron en Limbo. Tono informativo, NUNCA de juicio (SM-C2: no perseguir 100%).
  2. **Lista del día con estado real** — cada Actividad: glifo de estado final, título, horas reales si actuó (`startedAt`→`completedAt`).
  3. **Decisiones pendientes** — por cada `missed`/`limbo` de HOY, acciones: *mover a mañana · mover a fecha · descartar · dejar sin fecha* (FR: UJ-5, T-06 recibirá lo movido). Decidir no es obligatorio: lo no decidido queda en Limbo (FR-9).
  4. **CTA "Continuar a Mañana"** → T-06.
- **Contenido y datos:** estado del día desde el VPS (ya cerrado por el scheduler a la hora del ritual — AD-5).
- **Estados:** día sin actividades (skip directo a T-06 con aviso); offline (bloqueante: banner + reintento — AD-11, sin ritual sin red); carga.
- **Casos límite:** actividad completada después de su día (cuenta como `missed` a efectos de %, FR-13 — mostrarla con su marca); usuario que abre el ritual mucho después de medianoche (el "día saliente" es el día calendario que cerró el scheduler).
- **i18n:** claves para scoreboard, decisiones y horas.
- **Restricciones:** AD-5 (el cierre ya ocurrió — esta pantalla muestra y permite decidir), AD-7 (horas reales de solo lectura).
- **Notas de maquetación:** el objetivo de mediana ≤10 min (SM-3) define TODO: decisiones en un tap por defecto (chip preseleccionado "mover a mañana" para el flujo rápido), scrolleo mínimo, CTA "Continuar" siempre visible. Este es el clímax de UJ-5 — diseñar la sensación de cierre limpio, no de auditoría.

## T-06 · Mañana (paso 2 del ritual)

- **Plataforma:** móvil (primaria) · PWA
- **Propósito:** revisar el día siguiente YA generado (AD-5), editarlo para ese día: reordenar, ajustar horas, eliminar Bloques instanciados sin tocar la Rutina fuente, agregar Actividades manuales (FR-10).
- **Entradas:** CTA desde T-05; entrada directa (saltar el cierre si no hay decisiones).
- **Zonas de layout:**
  1. **Cabecera** — "Mañana {fecha}" + Rutina que lo generó.
  2. **Timeline editable del día generado** — mismas filas que T-01 pero en modo edición: reordenar (drag/controles), editar hora/duración inline, eliminar instancia (icono), badge "de Rutina X" (informativo — la plantilla no se toca aquí).
  3. **Lo movido desde el Cierre** — las Actividades decididas "mover a mañana" en T-05 aparecen integradas en la línea de tiempo (o en sección "sin hora" si no tienen hora), con badge de origen del movimiento.
  4. **Agregar manual** — CTA que abre T-02 en creación (FR-4).
  5. **CTA "Confirmar mañana"** → T-07.
- **Estados:** edición de día sin Rutina (día vacío generado, FR-3 consequence — solo manuales); validación de solapes (aviso, no bloqueo); offline (bloqueante + reintento).
- **Casos límite:** editar instancia NO modifica la Rutina (FR-10 — el badge de origen lo deja claro); mañana con día ya confirmado antes (re-entrada al ritual: el plan confirmado es la lista de confianza — mostrar candado suave + permitir re-editar con aviso).
- **i18n:** claves de edición, badges de origen.
- **Restricciones:** AD-1 (edición = requests), AD-5 (el día ya existe — no hay "generar" en UI), AD-6 (wall-clock de la tz del usuario).
- **Notas de maquetación:** distinguir visualmente "editable por hoy" (instancia) vs "esto viene de una plantilla" (origen) — dos capas de identidad sin confundir. El arrastre/reordenamiento debe funcionar igual con puntero (PWA) y dedo (móvil).

## T-07 · Confirmación del ritual (cierre del flujo)

- **Plataforma:** móvil (primaria) · PWA
- **Propósito:** confirmar y persistir todo el resultado del ritual: decisiones del Cierre + edición de Mañana (FR-10: "Confirmar marca la planeación del día como cerrada — lista de confianza de mañana").
- **Zonas de layout:**
  1. **Resumen de decisiones** — compacto: N movidas a mañana · N a fecha · N descartadas · N al Limbo · cambios de Mañana.
  2. **CTA "Confirmar"** — request único/agrupado al VPS con estados espera/error (AD-1).
  3. **Confirmación de éxito** — cierre sensorial del día (feedback positivo breve — "Mañana está lista") + salida al resto de la vida (UJ-5 resolución: "cierro el día sin deuda mental").
- **Estados:** error de red en confirmar (reintento — las decisiones NO se pierden mientras el flujo esté abierto); éxito.
- **Casos límite:** usuario abandona el ritual sin confirmar → nada se pierde: lo decidido por pantalla NO se aplicó, las sin decisión siguen en Limbo (FR-8/FR-9 — el Limbo es la red de seguridad del abandono).
- **i18n:** claves del resumen y CTAs.
- **Notas de maquetación:** el momento de confirmación es el clímax emocional del producto (fin de UJ-5) — merece un beat de satisfacción: breve, digno, sin gamificación (Non-Goal del PRD).
