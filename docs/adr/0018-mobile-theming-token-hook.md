# ADR 0018: Tematización móvil a través de gancho de token unificado con invariante de aislamiento de tema

Fecha: 2026-06-20
Estado: Aceptado

## Contexto

La tematización móvil centraliza solo **color**: cada consumidor lee desde el gancho único
`useThemeColors()` y cada tema (luz/oscuridad predeterminados, eink, nord, sepia, oled y
una opción "Material 3") proporciona valores de color. La escala de tipo, el radio de esquina, la elevación y
la retroalimentación de presión son `StyleSheet` en línea en ~82 componentes personalizados.

El tema "Material 3" enviado es **Material solo de nombre** — una paleta única asignada a
la forma de color genérica, sin escala de tipo M3, sistema de forma, elevación tonal o capas de
estado. Profundizarlo en un sistema de diseño Material 3 genuino corre el riesgo de un problema diferente:
*filtrar rasgos de Material a otros temas*, varios de los cuales (eink, nord, sepia,
oled) son deliberadamente no-Material y deben seguir siendo exactamente como son.

Se consideraron y rechazaron dos formas de entrega:

- **Un nuevo conjunto de componentes primitivos M3** (`M3Button`, `M3Card`, FAB…) e intercambio de
  sitios de llamada — una reescritura más grande que riesgo comportamiento a la deriva y excede el alcance acordado.
- **Ramas `themeStyle === 'material3'` en línea** en cada componente — dispersa lógica M3
  sin fundación reutilizable (el anti-patrón de duplicación por vista).

## Decisión

La tematización móvil utiliza un único **gancho de token** en lugar del estilo por componente ad-hoc.

1. `useThemeTokens()` devuelve `{ colors, type, shape, elevation, state, isMaterial }`.
   El tema Material 3 proporciona valores de Material para cada categoría; **cada otro tema
   proporciona valores predeterminados de "look actual"**. Convertir un componente para consumir tokens es una
   no-operación visual/conductual para temas no-Material y Materializa el mismo componente
   en M3.
2. `useThemeColors()` se retiene y se reimplementa para delegar a `useThemeTokens()`,
   por lo que los sitios de llamada existentes siguen funcionando y la Materialización procede incrementalmente,
   superficie por superficie — sin día de bandera y las superficies no convertidas nunca se rompen, solo
   "aún no Materializadas".
3. **Los tokens de comportamiento se cierran, no solo se colorean.** La elevación y rizo/capas de estado
   son efectos visuales/interactivos nuevos que no existen hoy; se cierran detrás de
   `isMaterial` (verdadero solo en el tema Material 3). En temas no-Material los
   ayudantes son no-ops: sin color de rizo, capa de estado transparente, estilo de elevación vacío.
4. **El aislamiento del tema es un invariante aplicado por prueba**, cubriendo ambas dimensiones:
   - una **regresión de color idéntico a bytes** afirmando que los colores resueltos de cada tema no-Material
     son iguales a la salida actual y
   - un conjunto de **no-degradación conductual** afirmando `isMaterial === false`, sin rizo,
     capa de estado transparente y estilo de elevación vacío para cada tema no-Material.

   La sustitución de color solo no puede probar que los efectos conductuales no se filtren, por lo que ambas
   afirmaciones son necesarias; un cambio de token futuro no puede Materializar silenciosamente otro
   tema sin fallar en CI.
5. **Sin nuevos valores de enum `theme`.** Los modos `material3-light` / `material3-dark` existentes
   se mantienen, por lo que no hay tipos de `packages/core`, cambios de sincronización o configuración. M3
   se mantiene dos-modo explícito; "apariencia del sistema → auto claro/oscuro" se difiere como
   una característica separada e independiente del tema. Sin `react-native-paper` y sin Material You /
   color dinámico.

## Consecuencias

- El tema Material 3 puede convertirse en un sistema de diseño M3 genuino (roles de color, escala de tipo,
  forma, elevación tonal, capas de estado) *a través de* componentes existentes, sin
  reescritura de interfaz de usuario o dependencia nueva.
- "¿Esto degrada mis otros temas?" deja de ser una esperanza y se convierte en una
  propiedad aplicada por CI a través del color y el comportamiento.
- La Materialización parcial es aceptable: un conjunto limitado de superficies de alto tráfico se
  convierte primero; el resto sigue funcionando y se puede recoger más tarde.
- Un cambio visible para el usuario para usuarios de tema existente Material: las superficies de acción primaria se mueven
  de `primary` a `primaryContainer` (M3 correcto). Esto merece una línea de notas de lanzamiento.
- Los temas futuros y las categorías de token futuras se conectan al mismo gancho; el invariante de aislamiento
  protege contra regresiones a medida que crece el sistema.
- Esta decisión se circunscribe a `apps/mobile` y no afecta la tematización de escritorio, el modelo de
  datos central o la sincronización.

## Referencias

- Detalle de diseño de trabajo: `docs/superpowers/specs/2026-06-20-mobile-material3-theme-design.md`
  (archivo de trabajo local sin rastrear; este ADR es el registro duradero de la decisión).
