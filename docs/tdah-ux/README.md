# Modo TDAH — Base de maquetación UI/UX

> Documentos de especificación pantalla por pantalla para maquetar el **Modo TDAH** de Mindwtr.
> Cubren lo **existente** (inventario + revisión) y lo **nuevo** (pantallas a diseñar).

## Maquetado visual (Stitch)

El diseño visual de las pantallas vive en **Google Stitch**:

- **Proyecto:** https://stitch.withgoogle.com/projects/6331475909488481570
- **ID de proyecto (API/MCP):** `6331475909488481570`
- **Mapa spec ↔ screens:** [08-stitch-maquetado.md](./08-stitch-maquetado.md) — 32 screens
  verificadas, cobertura 14/14 T-xx + notificaciones + estados transversales, con IDs completos
  para acceso programático.
- **Convención de mapeo:** cada screen del proyecto Stitch corresponde a un ID `T-xx` / `N-xx`
  de estos documentos — el spec acá es la fuente de contenido, estados y reglas; el screen en
  Stitch es la referencia visual de layout y estilo.
- **Acceso programático:** MCP `stitch` configurado en opencode (`stitch.googleapis.com/mcp`,
  auth por header `X-Goog-Api-Key` — key actualizada 2026-08-24).
- **Regla de precedencia:** los documentos de este directorio definen QUÉ debe cumplir cada
  pantalla (estados, casos límite, restricciones AD); Stitch muestra CÓMO se ve. En conflicto:
  gana el comportamiento especificado acá + `DESIGN.md`/`EXPERIENCE.md` del contrato UX
  (`../_bmad-output/planning-artifacts/ux-designs/ux-Mindwtr-2026-08-24/`).
- Para diseñar el **backend** (módulo TDAH del VPS): la referencia de pantallas es este
  directorio + el proyecto Stitch como apoyo visual de los flujos; la arquitectura autoritativa
  es la spine (`../_bmad-output/planning-artifacts/architecture/architecture-Mindwtr-2026-08-24/ARCHITECTURE-SPINE.md`).

## Cómo usar estos documentos

Cada pantalla tiene una ficha con: propósito, plataformas, entradas, zonas de layout, contenido, acciones, estados, casos límite, i18n y **restricciones de arquitectura** (citas a los ADs de la spine — `../_bmad-output/planning-artifacts/architecture/architecture-Mindwtr-2026-08-24/ARCHITECTURE-SPINE.md`). La identidad visual (colores, tipografía, tokens) NO está fijada aquí — eso vive en DESIGN.md cuando se destile; estos docs son estructura, contenido y comportamiento.

## Convención de IDs

| Prefijo | Significado |
| --- | --- |
| `E-xx` | Pantalla existente de Mindwtr (móvil / web / desktop) |
| `T-xx` | Pantalla nueva del Modo TDAH |
| `N-xx` | Superficie de sistema (notificaciones, widgets) |

## Índice

| Doc | Contenido | Estado |
| --- | --- | --- |
| [00-inventario-existente-movil.md](./00-inventario-existente-movil.md) | Pantallas existentes del app móvil (E-01..E-20, N-E*, W-*, Q-*) + concordancia | ✅ |
| [01-inventario-existente-web.md](./01-inventario-existente-web.md) | PWA/desktop existentes (E-21..E-35) + concordancia | ✅ |
| [02-modo-tdah-dia-y-actividades.md](./02-modo-tdah-dia-y-actividades.md) | T-01 Hoy, T-02 Detalle de Actividad, N-01..N-04 notificaciones | ✅ |
| [03-modo-tdah-rutinas.md](./03-modo-tdah-rutinas.md) | T-03 Lista de Rutinas, T-04 Editor de Rutina | ✅ |
| [04-modo-tdah-ritual-nocturno.md](./04-modo-tdah-ritual-nocturno.md) | T-05 Cierre del día, T-06 Mañana, T-07 Confirmación | ✅ |
| [05-modo-tdah-limbo-historial-metricas.md](./05-modo-tdah-limbo-historial-metricas.md) | T-08 Limbo, T-09 Historial, T-10 Métricas | ✅ |
| [06-modo-tdah-ajustes-dnd-jira.md](./06-modo-tdah-ajustes-dnd-jira.md) | T-11 Ajustes del modo, T-12 DND, T-13 Origen Jira | ✅ |
| [07-modo-tdah-onboarding-conexion.md](./07-modo-tdah-onboarding-conexion.md) | T-14 Activación, N-05 Conexión persistente, permisos + matriz de cobertura de flujos | ✅ |
| [08-stitch-maquetado.md](./08-stitch-maquetado.md) | Mapa spec ↔ screens de Stitch (32 screens, IDs completos, brechas, guía para backend) | ✅ |

## Reglas transversales para maquetar (de la arquitectura)

1. **Ninguna pantalla promete planificación offline** (AD-1, AD-11): sin conexión, pantallas de plan/ritual muestran estado offline con reintento — no edición local "fantasma".
2. **Toda mutación es request al VPS** (AD-1): los botones de acción deben tener estados de espera/confirmación/error de red.
3. **Notificaciones = pipeline propio** (AD-3, AD-10): visualmente consistentes con el sistema, pero conceptualmente separadas de los recordatorios GTD.
4. **Zona horaria del usuario** (AD-6): todas las horas mostradas son wall-clock local del perfil.
5. **i18n obligatorio** (23 locales): nada de texto hardcodeado; los mocks rotulan en español pero cada string es una clave i18n.
6. **Estados de Actividad** (convención spine): `pending / started / completed / missed / limbo / discarded` — iconografía consistente en TODAS las pantallas.

## Superficies de v1 (verificadas contra el código — ver docs 00 y 01)

- **Móvil (Expo, `apps/mobile`):** experiencia completa del día — T-01, T-02, ritual, Limbo, notificaciones N-01..N-05. Entrada al modo: tile en el Menú (E-05) y home configurable (E-02).
- **PWA web (`apps/desktop` compilado para web — NO expo web):** superficie de planificación — las T-xx se construyen como vista+modales nuevos en `apps/desktop`, mismo código que sirve al navegador y al Tauri de escritorio (que **hereda las pantallas gratis**; en v1 solo no se pulen detalles nativos de Tauri).
- Sin push web en v1: en PWA el ritual se abre manualmente (FR-8 lo permite); los estados offline/error aplican igual (AD-1/AD-11).
