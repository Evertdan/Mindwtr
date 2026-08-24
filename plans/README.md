# Índice de Planes

Escrito por la auditoría de mejora del 2026-08-13 (Fase 2 del bucle de revisión-mejora), marcado contra `0e4021faa`. La selección fue no interactiva: cada hallazgo procesable de alta confianza se convirtió en un plan; los elementos especulativos/diferidos se registran a continuación en lugar de planearse.

## Orden de ejecución y estado

| # | Plan | Hallazgos | Esfuerzo | Estado |
|---|------|----------|----------|--------|
| 001 | tauri-main-thread-commands | R-01, R-02 | S-M | HECHO |
| 002 | calendar-feed-revocation | R-03 | S | HECHO |
| 003 | local-api-hardening | R-04, R-05 | S-M | HECHO |
| 004 | mcp-hardening | R-06, R-08 | S | HECHO |
| 005 | import-sourcekey-identity | R-07 | S | HECHO |
| 006 | derived-state-hot-path | A-02, A-04 | S | HECHO |
| 007 | capture-import-chain | A-05 | S | HECHO |
| 008 | source-hygiene-pair | A-03, A-07 | S | HECHO |
| 009 | i18n-toast-leaks | Q-02 | S | HECHO |
| 010 | locale-coverage-label | Q-01 | S | HECHO |
| 011 | undo-import | Q-03 | S-M | HECHO |
| 012 | csv-export | DIR-01 | M | HECHO |
| 013 | automation-query-unification | DIR-02 | M | HECHO |
| 014 | dx-batch | DX-01/02/04/05 | S | HECHO |
| 015 | core-lint-ci | DX-03 | S | HECHO |
| 016 | desktop-flat-eslint | DX-06 | S-M | HECHO |
| 017 | adr-encryption-at-rest | DOCS-01 | S | HECHO |
| 018 | mobile-store-action-settlement | ARCH-01 | M | HECHO |

Dependencias: 015 antes de 016 (ambas tocan el cableado de lint; 015 es ascendente en CI). El commit 2 de 001 depende de su commit 1. El commit 2 de 006 depende del commit 1 solo para limpieza de fusión. Todo lo demás independiente.

## Diferido (registrado, deliberadamente no planeado)

- **DEPS-01** dependencia principal de escritorio `file:` → `workspace:*` (copia obsoleta de 138MB): diferir hasta poco después de 1.2.0 estable — la agitación del lockfile a mitad del tren RC es el peligro, no el cambio.
- **DEPS-02** migración de Expo SDK 54→57: tren de versión propio post-estable, etapas 54→55→56→57 con rondas de dispositivo por salto y revalidación de parches; la pregunta de Nueva Arquitectura de `@fugood/react-native-audio-pcm-stream` decide si la transcripción en tiempo real necesita un nuevo transporte primero.
- **DEBT-03** duplicación de pegamento de backend de adjuntos 2×5: solo veredicto de investigación — ciclo de vida + protocolo de cable ya compartido; diff WebDAV+Dropbox cuerpos antes de creer que la consolidación paga. No re-auditar sin ese diff.
- **DIR-03** publicar la CLI (bin en mindwtr-mcp) vs. relabelar docs como script de colaborador: decisión de producto del mantenedor; ambas mitades baratas una vez decididas.
- **DIR-04** decisión de almacenamiento web/PWA: pico (medir accesorio serializado de 5k tareas frente a cuota de localStorage) decide invertir (adaptador IndexedDB detrás de setStorageAdapter) vs degradar (docs). Llamada de producto después de la medición.
- **DIR-05** Obsidian en móvil: brecha de paridad real, deliberadamente no ahora (riesgo de escritor bidireccional SAF). Registrado para detener re-derivación.

## Considerado y rechazado

- Golpes de zustand v5 / lucide 1.x: solo acompañamiento, sin valor independiente.
- Eliminación de shim de reexportación (attachment-utils, par dropbox-sync): agitación > valor.
- División de módulo Rust storage.rs/sync.rs "dios": las mitades de producción son ~3k líneas; las pruebas inflan los conteos.
- Trabajo de native-schema fuera de macOS: necesita xcrun swiftc, verificado.
- Adiciones de comando testing-strategy.md: costo de paridad de 6 locales para información a un clic de distancia.
- Compartición de ayudante de autenticación MCP/cloud: independencia deliberada del espacio de trabajo, registrada en encabezados de archivo.
- Confianza global de CA de usuario de Android: restaura deliberadamente la paridad de la tienda de confianza del SO para URL autohospedadas arbitrarias; alcanzarla requiere una pila HTTP nativa separada, y el propietario del dispositivo o administrador debe instalar explícitamente la CA. La migración de bajo apalancamiento L/ALTO riesgo se rechaza a menos que el modelo de amenaza del producto cambie.
- Mega-interfaz de renderizador de campo de tarea móvil: acoplamiento real, pero las compuertas de rendimiento actual están verdes y la refactorización cruza teclado, recurrencia, accesorio, audio y comportamiento de divulgación progresiva. Mantener como Vale la pena explorar hasta que una regresión medida o un corte más estrecho lo justifique.

## Planes heredados (archivos 2026-08-09, reconciliados 2026-08-13)

`2026-08-09-improve-product.md` y `2026-08-09-improve-architecture-performance.md` predate esta ejecución (base faea7edc3):
- Superficie de falla de persistencia con reintento — **HECHO** (645f376d7, PersistenceFailureBanner ambas plataformas).
- Ciclo de vida de falla parcial de vigilante — **HECHO** (vigilante controller/generación commits + este bucle S6/S11/C2).
- Localizar retroalimentación de configuración de escritorio — **MAYORMENTE HECHO** (4b8c53a4c, 43fc66552, 06eb36bc9, 24ac122f2); el remanente de prueba de trinquete es superado por plan 009.
- Guardia ocupada de incorporación móvil — **PROBABLEMENTE HECHO** (8aad219ff); verificar antes de re-planificar.
- Costo de apertura cálida de SQLite, accesorios de fusión dorada TS/Rust, IDs exactos de operación de transferencia, a11y de fila de datos móvil — **AÚN ABIERTO**, llevado como candidatos futuros (no seleccionado en esta ejecución; los dos primeros son M-L con requisitos de cuidado alto, los dos últimos son lotes de pulido UX).

---

# Auditoría de mejora del 2026-08-22 (Fase 2 del bucle de revisión-mejora), marcada contra `b0a96ccc9`

Selección no interactiva: cada hallazgo procesable de ALTA confianza se convirtió en un plan; la numeración continúa desde la ejecución del 08-13. Todos los planes 08-13 siguen siendo HECHO. Ejecutores: un commit por hallazgo, prueba roja primero, honrar condiciones de PARADA, actualizar esta tabla.

## Orden de ejecución y estado

| Plan | Título | Prioridad | Esfuerzo | Depende de | Estado |
|------|--------|-----------|----------|------------|--------|
| 019 | cloud-server-integrity | P1 | S | — | HECHO |
| 020 | core-store-write-integrity | P1 | M | — | HECHO |
| 021 | delete-vs-live-revision | P1 | M | — | BLOQUEADO (ADR 0007 registra la regla fuera de ventana como deliberada; accesorios fijados; superar ADR = decisión del mantenedor) |
| 022 | sync-orchestrator-rejections | P1 | S | — | HECHO |
| 023 | fts-search-quoting | P1 | S | — | HECHO |
| 024 | attachment-integrity | P1 | L | — | HECHO (SEC-07 parcial en móvil: la procedencia de pre-paso de migración es una decisión de diseño abierta) |
| 025 | android-component-security | P1 | M | — | HECHO (SEC-03 mitad de permiso rechazada: receptor exportado es API pública documentada; límite de velocidad enviado) |
| 026 | network-policy | P2 | M | — | HECHO (+ corrección en ventana: descargas de adjuntos en la nube se descifran antes de validar) |
| 027 | mcp-hardening-2 | P1 | M | — | HECHO (liberación npm deuda para que las correcciones lleguen a los usuarios) |
| 028 | desktop-native-hardening-2 | P1 | M | — | HECHO |
| 029 | core-input-hardening | P2 | M | — | HECHO (BUG-12: la ganancia real necesita una API de hash incremental en uuid.ts — seguimiento) |
| 030 | batch-update-perf | P1 | S | — | HECHO (movimiento de lote de 50k tareas ~11s → ~0.6s) |
| 031 | mobile-test-integrity | P2 | M | 024 (suave) | HECHO |
| 032 | dx-batch-2 | P2 | M | DX-01 desembarques primero y solo | HECHO |
| 033 | docs-batch-2 | P2 | M | — | HECHO |
| 034 | csv-recurrence | P2 | M | — | HECHO |

Notas de dependencia: 031 después de 024 (idioma vi.mock compartido para desarandelar); DX-01 de 032 (lockfile) desembarca como un commit aislado antes de que otro trabajo toque node_modules; los elementos 024 1→5→8→9 están ordenados internamente.

## Diferido (registrado, deliberadamente no planeado en esta ejecución)

- **DEPS-03** ~50 transitorios RN fijados como dependencias directas raíz (desde 7703fdee2, ninguno importado por código raíz): la extirpación es mecánica pero requiere revisión de lockfile + ronda real de compilación de Android — ventana de mantenimiento propia, junto con DEPS-02 (Expo 54→57).
- **SEC-15b** limitación de velocidad IP en modo cualquier token + evicción verdadera de LRU en el limitador de nube: real pero modo de activación; un cubo IP cambia comportamiento para despliegues proxy — necesita decisión de modelo de despliegue.
- **SEC-12b** movimiento de información del usuario de URL WebDAV al llavero al guardar config: real, esfuerzo M, seguimiento a redacción de 026.
- **SEC-10b** alcance de dominio de network-security-config de Android: RECHAZADO como planeado — entra en conflicto con #663 liquidado (el texto claro de base-config lleva carga para WebDAV privado arbitrario); la guardia `assertConnectionAllowed` a nivel de JS (026) es el punto de aplicación.
- **DIR-02** modo de aplicación de viaje redondo de hoja de cálculo: DECIDIDO "no" en esta ejecución — postura de documentación (omitir en coincidencia de id) se mantiene; 033/DOCS-05 alinea los comentarios del código. Revisitar solo con un diseño consciente de rev.
- **DIR-03** ZIP de copia de seguridad con bytes de adjuntos: necesita un pico de medición de memoria/threading móvil; DOCS-01 (033) captura el valor de seguridad ahora.
- **BUG-26 advertencia** — si la investigación muestra que SyncRun re-comprueba la frescura, el elemento 024 7 se degrada a solo aborto temprano.
- **DEBT-01** (registro de descriptor AppTheme) y **DEBT-02** (consolidación de transacción de configuración de sincronización): enrutado a la fase de profundización de arquitectura, no a este conjunto de planes.
- **DX-02** grupo de espacio de trabajo: `git worktree prune` hecho operativamente; eliminación de los 21 directorios de checkout (53 GB) dejada al mantenedor (destructivo).

## Hallazgos considerados y rechazados (esta ejecución)

- Desinfectante de contenido de tarea como instrucciones MCP: inherente a una herramienta de lectura de tareas; problema del lado del cliente.
- Evicción FIFO de aceleración de autenticación MCP: impacto limitado (401→429 solo); digno de comentario como máximo.
- Escritura de diseño no atómica de window_state.rs: la pérdida es geometría del monitor; no programado.
- Caché muerto de `insertColumns` en queries.ts: eliminación de una línea, doblar en cualquier commit 027 que toque el archivo.
- División mayorista de task-utils.ts; grandes divisiones de superficie React; ayudante SETTINGS_X_VALUES; paridad de enlace Home.md de wiki; almacenamiento en caché CI: todo re-confirmado que no vale la pena hacer (ver razón 08-13).
- Memoización de allTokens (ListView.tsx:292): los consumidores se re-procesan independientemente; no compra nada.
