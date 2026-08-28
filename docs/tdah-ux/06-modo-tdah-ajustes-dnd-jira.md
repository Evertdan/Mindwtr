# 06 · Modo TDAH — Ajustes, DND y Origen Jira (T-11, T-12, T-13)

> El control del modo: activación, ritual, zona horaria, silencios y conexión laboral.
> Fuente: PRD §4.1 FR-1, §4.4 FR-11, §4.5 FR-12, §8. Spine: AD-3, AD-6, AD-8, AD-9.

## 🎨 Maquetado Stitch (referencia visual para construir el frontend)

Proyecto [`6331475909488481570`](https://stitch.withgoogle.com/projects/6331475909488481570) — screen ID completo para `get_screen`:

| Spec | Screen Stitch | Screen ID |
| --- | --- | --- |
| T-11 Ajustes | Ajustes (móvil) | `29d65804562a435fb67d08ae7051298e` |
| T-12 DND | No molestar (móvil) | `d4375194ca404d3cbc2f4d325002bf84` |
| T-13 Origen Jira (PWA) | Origen Jira (Desktop) | `e64b931bd9c44a0c81716b3c2c090b7b` |

*Brecha registrada (doc 08): Ajustes versión PWA sin screen aún.*

## T-11 · Ajustes del Modo TDAH

- **Plataforma:** móvil · PWA
- **Propósito:** activar/desactivar el modo (FR-1); configururar hora del ritual (FR-8); zona horaria del perfil (AD-6); defaults del modo.
- **Entradas:** sección nueva dentro de los Ajustes existentes de Mindwtr (misma pantalla de settings del app — no una isla aparte; ubicación exacta según inventario E-xx de `00-inventario-existente-movil.md`).
- **Zonas de layout / controles:**
  1. **Modo TDAH on/off** — toggle maestro. Copy de consecuencia al apagar: "Las Actividades y su historial se conservan; solo se pausan la generación y los recordatorios" (FR-1).
  2. **Hora del ritual** — picker HH:mm, default 23:00 (FR-8).
  3. **Zona horaria** — selector IANA (detectada del dispositivo como default; editable — AD-6). Nota visible: "tus horas se calculan en esta zona".
  4. **Accesos:** Rutinas (T-03) · DND (T-12) · Origen Jira (T-13) · Limbo (T-08).
- **Estados:** modo off (controles atenuados excepto el toggle maestro y la consulta de historial — FR-1: "permanecen consultables tras reactivar").
- **Casos límite:** cambio de zona horaria con días ya generados → el scheduler recalcula la agenda vigente (AD-6); copy de aviso "los disparos de hoy pueden moverse".
- **i18n:** claves de settings (integrarse al archivo de settings existente, no namespace propio de strings sueltos).
- **Restricciones:** AD-6 (la tz es atributo del perfil en el VPS — este control la escribe allí, no en el dispositivo).
- **Notas de maquetación:** seguir la gramática de la pantalla de ajustes existente de Mindwtr (grupos, divisores, switches) — el modo se siente parte del app, no un plugin.

## T-12 · No-molestar en juntas (DND)

- **Plataforma:** móvil (observación de calendario es móvil-only) · PWA (solo ventanas manuales)
- **Propósito:** gestionar la supresión de recordatorios: ventanas detectadas del calendario + ventanas manuales (FR-12); ver cuándo está activo.
- **Entradas:** desde T-11; indicador rápido desde T-01.
- **Zonas de layout:**
  1. **Estado actual** — "DND activo · termina 11:00" (o "inactivo") — visible también como chip en T-01.
  2. **Detección por calendario** — toggle + estado del permiso de calendario (si el permiso no está concedido: CTA a permisos del sistema). Copy: "eventos ocupados en horario laboral suprimen recordatorios".
  3. **Horario laboral** — definición de la franja (ej: 9:00–18:00) que acota la detección.
  4. **Ventanas manuales** — lista de reglas: semanales ("lunes 10:00–11:00", "todos los días 9:30–9:45") y puntuales (fecha específica); CRUD de ventanas.
- **Estados:** permiso de calendario denegado (degradado elegante: solo ventanas manuales); offline (banner).
- **La PWA no lee calendarios — estado permanente, no degradación (decidido en 4.3).** En móvil, "solo ventanas manuales" es un estado transitorio del que el usuario puede salir concediendo el permiso; en la PWA no hay salida y no debe insinuarse ninguna. La vista de escritorio **no muestra** el toggle de detección, **no** pide permisos, **no** ofrece CTA a ajustes del sistema y **no** reintenta: su zona de calendario lleva un aviso de hecho consumado (`tdahDnd.calendar.unsupported` — "esta app no lee calendarios; la detección de juntas vive en tu teléfono"). Tampoco lista las ventanas `source='calendar'` que subió el teléfono: son de solo lectura para todo cliente y ofrecer su edición allí solo produciría un 409 `TDAH_DND_READ_ONLY`. Sí edita el **horario laboral**, que es estado compartido del VPS y acota lo que el teléfono sube.
- **Ventanas que cruzan medianoche — decisión de 4.3.** Una ventana **manual** exige `start < end` (mismo validador que el horario laboral): un silencio que cruza medianoche se expresa como **dos ventanas** y ningún cliente lo parte solo. Los eventos de **calendario** que sí cruzan los parte el **servidor** por día local, cerrando el primer tramo en `23:59` y abriendo el siguiente en `00:00`; el hueco de un minuto es irrelevante para suprimir juntas y mantiene el dominio `HH:mm` uniforme y comparable léxicamente.
- **Casos límite:** ventana manual solapada con detección de calendario (la supresión es OR — cualquier ventana activa suprime; el `until` que ve el usuario es el final del bloque contiguo, calculado por el servidor).
- **Semántica crítica de diseño (FR-12/AD-8):** suprimido = suprimido — "NO se recuperan después" debe quedar explícito en el copy (el usuario TDAH necesita confiar que no habrá una avalancha post-junta; lo suprimido se resuelve de noche).
- **i18n:** claves de ventanas, días, estados.
- **Restricciones:** AD-8 (el teléfono SOLO observa el calendario y sube ventanas; el VPS decide — esta pantalla no promete "silenciar ya" instantáneo local, refleja el estado acordado con el servidor).
- **Notas de maquetación:** el estado activo es un dato de calma — chip discreto pero localizable (el usuario en junta mira de reojo). El editor de reglas semanales reutiliza los selectores de patrón de T-04 (mismo lenguaje de días).

## T-13 · Origen Jira (conexión)

- **Plataforma:** PWA (primaria — configuración de credenciales con teclado) · móvil
- **Propósito:** conectar el Origen Jira: URL del sitio, usuario, token de API; ver estado de sincronización; ajustar el pull (FR-11).
- **Entradas:** desde T-11.
- **Zonas de layout:**
  1. **Estado de conexión** — conectado a `{sitio}` · última sincronización exitosa hace Xh · próximas: franja laboral.
  2. **Formulario de conexión** — URL de sitio Jira Cloud, usuario, token de API. El token se ingresa una vez y NO se re-muestra jamás (AD-9: cifrado en reposo en el VPS; nunca en logs ni respuestas) — campo de un solo uso con máscara.
  3. **Ajustes de sincronización** — frecuencia del pull (default cada 2h en horario laboral — `[ASSUMPTION]` del PRD pendiente de confirmar); horario laboral de la franja (**hoy es una definición propia, no compartida con T-12** — ver la nota de abajo).
  4. **Vista previa del JQL** — mostrar la consulta que se ejecutará (sprint activo asignado al usuario; pregunta abierta #2 del PRD: JQL exacto y multi-sprint — dejar visible como texto consultable).
  5. **Desconectar** — con confirmación: las Actividades Jira importadas se retiran de futuras generaciones; las pasadas quedan en Historial.
- **Horario laboral duplicado a propósito (decidido en 4.3).** T-13 (4.1) y T-12 (4.3) llevan cada uno su propio `workStart`/`workEnd`, con los mismos defaults 09:00–18:00. Unificarlos habría hecho que el DND exigiera un Origen Jira conectado para acotar la detección, dejándolo muerto para quien no usa Jira. La unificación queda como **trabajo diferido explícito**, no como acoplamiento silencioso: mientras tanto, cambiar uno no cambia el otro y ambas pantallas deben decirlo por separado.
- **Estados:** nunca conectado (onboarding del origen); conectado-sano; error de credenciales ("token inválido" — aviso accionable); error de red (degradado: "las personales siguen funcionando offline", FR-11); sincronizando.
- **Casos límite:** sin sprints activos (estado "sin sprint activo — nada que importar"); múltiples sprints paralelos (pregunta abierta #2 — mostrar aviso y decidir en implementación); usuario sin Jira (este origen simplemente no se configura — la entrada existe igual como punto de extensión futuro, PRD §4.4).
- **i18n:** claves de conexión, estados, errores.
- **Restricciones (críticas de seguridad — AD-9):** el token vive en el VPS cifrado; esta pantalla NUNCA lo muestra de vuelta, NUNCA lo loguea, y el copy debe decir dónde vive ("se guarda cifrado en tu servidor"). Las tareas importadas son solo-lectura (marcar ✓ = alerta atendida, no escritura a Jira — FR-11).
- **Notas de maquetación:** formulario corto y serio (es una credencial laboral); el estado de sincronización es el dato que el usuario vendrá a mirar cuando algo falle — priorizar claridad del estado degradado. Copy de privacidad visible: "Nada de Jira entra al sync GTD — vive en tu servidor, por usuario".
