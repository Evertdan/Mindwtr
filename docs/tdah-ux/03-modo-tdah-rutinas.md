# 03 · Modo TDAH — Rutinas (T-03, T-04)

> Las plantillas que generan el día. Fuente: PRD §4.1 FR-2, UJ-1/6/7/8. Spine: AD-1, AD-5, AD-13.

## 🎨 Maquetado Stitch (referencia visual para construir el frontend)

Proyecto [`6331475909488481570`](https://stitch.withgoogle.com/projects/6331475909488481570) — screen ID completo para `get_screen`:

| Spec | Screen Stitch | Screen ID |
| --- | --- | --- |
| T-03 Lista (PWA) | Rutinas (Desktop) | `575e470d8b9a4a4c908a49b4051bebee` |
| T-03 Lista · light (PWA) | Rutinas (Light) | `1c4807ccd1f240b690d1df089c57cf0a` |
| T-04 Editor (PWA) | Editar Rutina (Desktop) | `3fe831a26c22414893316efc9f30fccb` |

*Brecha registrada (doc 08): estados de T-03/T-04 (vacío de primera Rutina, validación de solapes) sin screen aún.*

## T-03 · Lista de Rutinas

- **Plataforma:** PWA (primaria — es superficie de planificación) · móvil
- **Propósito:** ver, crear, editar y eliminar las Rutinas del usuario (CRUD completo, FR-2).
- **Entradas:** desde el hub del Modo TDAH; desde T-02 ("parte de la Rutina X" — informativo).
- **Zonas de layout:**
  1. **Lista de Rutinas** — tarjeta por Rutina: nombre, patrón de calendario en lenguaje humano ("Lunes a viernes" · "Sábados" · "Último sábado del mes" · "Domingos"), preview de bloques (próximos 3: "5:30 Levantarse · 6:00 Caminadora · 6:20 Baño"), conteo total.
  2. **CTA "Nueva Rutina"** → T-04 en creación.
  3. **Orden de precedencia visible** — las Rutinas se listan agrupadas por especificidad (más específica arriba) porque la precedencia decide cuál genera el día (FR-2: "último sábado del mes" gana sobre "sábado").
- **Acciones:** tap → T-04; duplicar; eliminar (confirmación con consecuencia explícita: "los días ya generados no cambian — aplica desde la próxima generación", FR-2).
- **Estados:** vacío (onboarding del concepto: "Una Rutina es la plantilla de un tipo de día…"); carga; offline (lectura diferida + banner).
- **Casos límite:** dos Rutinas con patrones que se solapan el mismo día → la lista muestra un indicador de conflicto con la ganadora (transparencia de la precedencia); patrones personalizados definidos por el usuario (FR-2: "u otros que el usuario defina").
- **i18n:** descripciones de patrón generadas por claves parametrizadas, no strings fijos ("último {día} del mes").
- **Restricciones:** AD-1 (CRUD = requests al VPS), AD-5 (la precedencia la aplica el scheduler — la UI solo la explica, no la computa).
- **Notas de maquetación:** el preview de bloques es el gancho visual de la tarjeta — debe leerse como "la forma de mi día" en un vistazo.

## T-04 · Editor de Rutina

- **Plataforma:** PWA (primaria) · móvil
- **Propósito:** definir una Rutina: nombre, patrón de calendario aplicable y lista ordenada de Bloques (FR-2).
- **Entradas:** desde T-03 (crear/editar/duplicar).
- **Zonas de layout:**
  1. **Nombre** de la Rutina (ej: "Día laboral", "Sábado casa", "Último sábado", "Domingo").
  2. **Patrón de calendario** — selector por tipo:
     - días de semana específicos (multi-select lun..dom),
     - nth-ésimo día de mes (ej: "último sábado del mes") — picker de ordinal (1º..último) + día de semana,
     - (extensible: el modelo admite patrones definidos por el usuario).
  3. **Preview de aplicabilidad** — mini-calendario de 1 mes marcando los días donde ESTA Rutina ganaría (calculado por el VPS; la UI lo pide — AD-1). Los días donde otra más específica gana se marcan distintos.
  4. **Lista ordenada de Bloques** — cada Bloque: título, hora inicio, duración esperada. Reordenamiento por drag (PWA/puntero) y por controles (móvil). Añadir/eliminar Bloque.
  5. **Duración total** — sumatorio visible (feedback de la forma del día).
- **Acciones:** guardar (request, estados espera/error); cancelar.
- **Estados:** creación vs edición; en edición, banner permanente: "Los días ya generados no cambian — aplica desde la próxima generación" (FR-2); validación de solapes de Bloques (aviso no bloqueante — el usuario puede querer solapes deliberados).
- **Casos límite:** Bloque sin duración (válida — fin = inicio); Bloque cruzando medianoche (duración que pasa de 23:xx a 0:yy — mostrar aviso); rutina sin bloques (válida — día vacío); patrón nth-ésimo cuando el mes no tiene esa combinación (ej: "5º lunes" — el preview lo refleja: algunos meses no aplican).
- **i18n:** el selector de patrón y el preview de calendario usan locale del usuario.
- **Restricciones:** AD-1, AD-6 (las horas de Bloque son wall-clock de la tz del usuario — sin conversión en UI).
- **Notas de maquetación:** el editor de Bloques es la pantalla de mayor densidad de interacción del modo — priorizar edición rápida en PWA (tabla editable) y controles claros en móvil (steppers de hora/duración). La preview de aplicabilidad es la característica que evita la sorpresa "¿por qué hoy salió la Rutina equivocada?" — darle presencia.
