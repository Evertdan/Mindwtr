# 05 · Modo TDAH — Limbo, Historial y Métricas (T-08, T-09, T-10)

> La memoria del sistema: lo pendiente-de-decisión, el registro de incompletas y el termómetro personal.
> Fuente: PRD §4.3 FR-9, §4.6 FR-13, UJ-5 edge. Spine: AD-5, AD-11, AD-13.

## 🎨 Maquetado Stitch (referencia visual para construir el frontend)

Proyecto [`6331475909488481570`](https://stitch.withgoogle.com/projects/6331475909488481570) — screen ID completo para `get_screen`:

| Spec | Screen Stitch | Screen ID |
| --- | --- | --- |
| T-08 Limbo | Limbo (móvil) | `754f5e5a547147838bb7a12c256e8b21` |
| T-09 Historial (PWA) | Historial (Desktop) | `d92f15032a074c01ade0d30bc67e78fd` |
| T-10 Métricas (PWA) | Métricas (Desktop) | `2a361755c48d4ebb9a8087febbb2542d` |

*Brecha registrada (doc 08): Limbo versión PWA sin screen aún.*

## T-08 · Limbo

- **Plataforma:** móvil · PWA
- **Propósito:** lista persistente de Actividades no completadas sin decisión (FR-9). "Visibles, sin desaparecer, con su historial intacto" — el sistema nunca tira el problema debajo de la alfombra.
- **Entradas:** badge en T-01 (con conteo); desde T-05 (lo que quedó sin decidir al confirmar el ritual); en móvil, tile del Menú (E-05); en PWA, sección Modo TDAH del nav.
- **Zonas de layout:**
  1. **Lista de pendientes-de-decisión** — cada ítem: glifo `limbo` (identidad propia distintiva), título, fecha original, hora planeada, tiempo en Limbo.
  2. **Acciones por ítem** (las mismas del Cierre): *mover a mañana · mover a fecha · descartar · completar tardíamente* (FR-9: "solo sale por decisión del usuario").
  3. **Acciones por lote** — aplicar decisión a varias seleccionadas (el Limbo puede acumularse; el lote evita la fatiga).
- **Estados:** vacío ("Nada pendiente de decisión — limpio" — estado de logro, mostrarlo con calma); carga; offline (banner).
- **Casos límite:** antigüedad arbitraria — "nunca desaparece por antigüedad" (FR-9): no hay auto-limpieza, pero el orden puede priorizar lo viejo; el conteo del badge en T-01 se actualiza al decidir.
- **i18n:** claves de lista, acciones, vacío.
- **Restricciones:** AD-1 (decisiones = requests), AD-5/AD-11 (el estado Limbo lo fija el scheduler al cierre; esta pantalla consulta y decide).
- **Notas de maquetación:** tono neutro- compasivo — el Limbo NO es una lista de culpas, es una bandeja de decisiones diferidas (la divergencia con "apps que te hacen sentir mal" es posicionamiento del producto §1). Ítems viejos: marcar suavemente la antigüedad sin drama.

## T-09 · Historial de incompletas

- **Plataforma:** PWA (primaria — consulta por rango, pantalla ancha) · móvil
- **Propósito:** registro permanente de Actividades no completadas (decididas o en Limbo) con fecha, hora planeada y resultado (FR-9); consulta por rango de fechas; alimenta la métrica FR-13.
- **Entradas:** sección Modo TDAH del nav en PWA / tile del Menú (E-05) en móvil; desde Métricas (T-10) para drill-down.
- **Zonas de layout:**
  1. **Selector de rango** — día / semana / mes / custom (calendario o steppers).
  2. **Lista cronológica** — por día: Actividades ✗ con hora planeada, resultado (`missed` decidida vs `limbo`), origen (Rutina/manual/Jira).
  3. **Filtros** — por origen, por Rutina.
- **Estados:** rango vacío ("Sin incompletas en este rango" — positivo); carga; offline.
- **Casos límite:** misma Actividad movida varias veces antes de fallar definitivamente (mostrar su última posición + rastro de movimientos colapsable); completada después de su día (cuenta como incompletada a efectos de % — FR-13, mostrar la marca "completada tarde").
- **i18n:** claves de rangos, filtros, resultados.
- **Restricciones:** AD-13 (cálculo al vuelo sobre el Historial en el VPS — la UI no agrega nada localmente).
- **Notas de maquetación:** es una pantalla de consulta/ análisis — densidad de tabla en PWA, lista colapsable en móvil. No confundir con Limbo: Historial = archivo de hechos; Limbo = bandeja de acción.

## T-10 · Métricas de cumplimiento

- **Plataforma:** PWA (primaria) · móvil
- **Propósito:** dashboard simple del % de Actividades completadas "en tiempo y forma" (completadas el mismo día planeado — FR-13), por día/semana/mes; desglose por origen (Rutina vs manual); tendencia semanal. "Termómetro personal, no gamificación" (PRD §4.6).
- **Zonas de layout:**
  1. **KPI principal** — % del período seleccionado, con la definición visible al primer vistazo ("completadas el mismo día planeado").
  2. **Tendencia** — gráfica simple de la serie (semana a semana o día a día según período).
  3. **Desglose por origen** — barras comparativas Rutina vs manual; atención de Jira (atendidas/no atendidas).
  4. **Nota de exclusión** — los días sin Actividades planificadas no cuentan (FR-13).
- **Estados:** sin datos suficientes ("Aún no hay historia — usá el modo unos días"); carga; offline.
- **Casos límite:** 100% sostenido → el PRD lo lee como sobre-planificación (SM-C2): NO celebrar con énfasis excesivo el 100% ni poner metas visibles agresivas; el 70% es el umbral sano de SM-1 — la visual no debe convertir el termómetro en juego.
- **i18n:** claves de KPIs, períodos, desgloses.
- **Restricciones:** AD-13 (al vuelo en el VPS); SM-C1/C-2 (counter-metrics del PRD: el diseño NO optimiza para más notificaciones ni para 100%).
- **Notas de maquetación:** minimalismo informativo — una cifra grande, una tendencia, un desglose. Sin rachas, sin trofeos, sin confeti (Non-Goal explícito). El color del KPI es informativo (frío→templado), nunca semáforo de juicio duro.
