# 08 · Maquetado Stitch — Mapa spec ↔ screens (referencia para backend)

> El diseño visual vive en **Google Stitch**, proyecto
> [`6331475909488481570`](https://stitch.withgoogle.com/projects/6331475909488481570).
> Verificado vía MCP (`stitch.googleapis.com/mcp`) el 2026-08-24 — **32 screens**.
> Este doc es el puente: dado un spec `T-xx`/`N-xx`, qué screen de Stitch lo materializa
> (screen ID completo para acceso programático por MCP: `projects/6331475909488481570/screens/{id}`).

## Regla de precedencia

El spec (`docs/tdah-ux/`) define QUÉ cumplir (estados, casos límite, restricciones AD de la
spine). Stitch muestra CÓMO se ve. En conflicto: gana el spec + el contrato UX
(`_bmad-output/planning-artifacts/ux-designs/ux-Mindwtr-2026-08-24/DESIGN.md` v2 + `EXPERIENCE.md` v2).
Para el **backend**: la referencia de datos/flujo es el spec; las screens son apoyo visual de
validación de flujos (lo que el usuario ve define lo que la API del módulo TDAH debe servir).

## Mapa spec ↔ screens

| Spec | Screens Stitch (ID completo) | Notas |
| --- | --- | --- |
| **T-01 Hoy** | `ba9e62d54d01` Hoy · `e3d17c2f71ba` Hoy (Light) | timeline con estados |
| T-01 · estado vacío | `1f2b4749f12d` Hoy — Sin Rutina | FR-3 consequence |
| T-01 · estado carga | `1b469f2df2d7` Hoy — Cargando | skeleton con canal de hora |
| T-01 · estado offline | `d08936793760` Hoy — Sin Conexión | AD-11 banner |
| **T-02 Detalle Actividad** | `c77731050ccc` Detalle · `e2e1a5f53d2f` Detalle (Light) | acciones de registro |
| **T-03 Lista Rutinas** (PWA) | `575e470d8b9a` Rutinas (Desktop) · `1c4807ccd1f2` (Light) | precedencia visible |
| **T-04 Editor Rutina** (PWA) | `3fe831a26c22` Editar Rutina (Desktop) | bloques + patrón |
| **T-05 Cierre del día** | `5dfeb60cc588` Cierre del día · `57e804c7a3b2` Cierre · `0cf531095fcd` Cierre (Light) | scoreboard + chips |
| **T-06 Mañana** | `2c9177e99a91` · `00bd07de9d08` Mañana (2 variantes) | edición del día generado |
| **T-07 Confirmación** | `e7fa92b638f1` Confirmación | beat de éxito 400 ms |
| **T-08 Limbo** | `754f5e5a5471` Limbo | bandeja de decisiones |
| **T-09 Historial** (PWA) | `d92f15032a07` Historial (Desktop) | consulta por rango |
| **T-10 Métricas** (PWA) | `2a361755c48d` Métricas (Desktop) | KPI + tendencia + desglose |
| **T-11 Ajustes** | `29d65804562a` Ajustes | sección del settings shell |
| **T-12 DND** | `d4375194ca40` No molestar | calendario + ventanas manuales |
| **T-13 Origen Jira** (PWA) | `e64b931bd9c4` Origen Jira (Desktop) | token una sola vez |
| **T-14 Activación** | `f99ea4235b48` A1 Promesa · `a5628cbbc7f1` A2 Ritual · `a6c5665284a8` A3 Rutina · `34601f242866` A4 Permisos · `84f414dc7e56` A5 Listo | onboarding 5 pasos |
| **N-01..N-05 Notificaciones** | `04ff6d9fc2b0` Notificaciones · `41eb55e34464` Notificación Ritual · `7ab626700c5c` Notificaciones Jira y Conexión | título autosuficiente (ley 1) |
| Estados transversales | `6c656d3dd042` Error de Mutación · `77c959d0f86e` Aviso de Permisos | patrones de EXPERIENCE.md |

**Cobertura: 14/14 T-xx + N-01..N-05 + estados transversales (carga, vacío, offline, error
de mutación, permisos) + variantes Light.** ✅

## Brechas detectadas (menores, registrar para v2 de maquetado)

1. **Ritual en PWA** (T-05..T-07 desktop): el spec permite el ritual en web (entrada manual,
   dos columnas ≥1024 px según DESIGN.md v2) — en Stitch solo existe la versión móvil.
2. **Limbo/Ajustes versión PWA**: specs los listan también en web; solo hay móvil.
3. **Estados de T-03/T-04** (vacío de primera Rutina, validación de solapes) sin screen.

Ninguna bloquea el diseño de backend — los flujos de datos quedan completamente definidos por
el spec; estas brechas son trabajo de maquetado futuro.

## Para diseñar el backend (módulo TDAH del VPS)

1. **Autoridad:** spine `ARCHITECTURE-SPINE.md` (AD-1..AD-13) — servidor-cerebro, mutación
   única, dominio propio, tz por usuario, SQLite por usuario.
2. **Flujos por pantalla:** cada spec T-xx/N-xx lista entradas/acciones/estados → son el
   contrato de endpoints y eventos que la API + scheduler deben servir.
3. **Validación visual:** usar este mapa para abrir la screen correspondiente al flujo que se
   implementa (MCP: `get_screen` con el ID completo de la tabla).
4. **Acceso MCP:** header `X-Goog-Api-Key` en `stitch.googleapis.com/mcp` (config en
   `~/.config/opencode/opencode.json`, key actualizada 2026-08-24; JSON-RPC directo funciona
   sin sesión si el cliente MCP de la sesión quedó desactualizado).
