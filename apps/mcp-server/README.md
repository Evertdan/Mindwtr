# Servidor MCP de Mindwtr

Servidor MCP para Mindwtr. Conecta clientes MCP (Claude Desktop, etc.) a tu base de datos local Mindwtr SQLite o a un punto final de Mindwtr Cloud autohospedado.

De forma predeterminada, este es un servidor **stdio**: los clientes MCP lo inician como un subproceso y se comunican por JSON-RPC en stdin/stdout. También tiene un **transporte HTTP** opcional (ver [Acceso remoto (HTTP)](#acceso-remoto-http)) para aquellos que autoalojan y desean exponerlo en una URL.

---

## Binarios de Aplicación vs. Asistente MCP

Los binarios de la aplicación de escritorio y móvil incluyen la aplicación Mindwtr, pero **actualmente no** incluyen un alternar de inicio/parada de escritorio ni un comando `mindwtr-mcp` independiente en tu `PATH`.

**No** necesitas ejecutar toda la aplicación desde la fuente para usar MCP. Puedes usar el binario normal de la aplicación de escritorio para tus tareas, luego ejecutar este asistente MCP separado desde el repositorio con Bun, o compilar el asistente una vez y ejecutarlo con Node. Apunta el asistente a la `mindwtr.db` local de la aplicación de escritorio.

En el escritorio, la aplicación muestra la ruta exacta de datos locales en **Configuración -> Sincronización -> Datos Locales**. Los binarios móviles no exponen una superficie de servidor MCP local.

---

## Requisitos

- Node.js 18+ (para el cliente MCP que inicia el servidor)
- Las instalaciones de paquetes npm usan better-sqlite3, un complemento SQLite nativo. Si no hay binario precompilado disponible para tu plataforma, npm necesita una cadena de herramientas de compilación C/C++ funcional y Python para node-gyp.
- Bun (recomendado para desarrollo en este repositorio)
- Una base de datos local de Mindwtr (`mindwtr.db`) para modo local, o una URL de Mindwtr Cloud autohospedada y token de portador para modo Nube

Ubicaciones de base de datos predeterminadas:
- Linux: `~/.local/share/mindwtr/mindwtr.db`
- macOS: `~/Library/Application Support/mindwtr/mindwtr.db`
- Windows: `%APPDATA%\mindwtr\mindwtr.db`

Ruta macOS adicional para compilaciones en sandbox:
- `~/Library/Containers/tech.dongdongbh.mindwtr/Data/Library/Application Support/mindwtr/mindwtr.db`

Si falta `mindwtr.db` pero existe `data.json` en la misma carpeta de datos de escritorio, el servidor MCP comenzará a generar una nueva base de datos SQLite desde esa instantánea de datos local al iniciarse.
Configuración de Escritorio → Sincronización → Datos Locales muestra la ubicación exacta de almacenamiento utilizada por la aplicación.

Puedes anular el modo local con:
- `--db /path/to/mindwtr.db`
- `MINDWTR_DB_PATH=/path/to/mindwtr.db`
- `MINDWTR_DB=/path/to/mindwtr.db`

Para el modo Nube autohospedado, usa:
- `--cloud-url https://mindwtr.example.com` o `MINDWTR_MCP_CLOUD_URL`
- `--cloud-token <token>` o `MINDWTR_MCP_CLOUD_TOKEN`
- opcional `--cloud-allow-insecure-http=true` para implementaciones HTTP privadas de confianza

---

## Start / Stop

### Ejecutar desde npm

Después de instalar el paquete publicado, ejecútalo directamente:

```bash
mindwtr-mcp --db "/path/to/mindwtr.db"
```

O deja que un cliente MCP lo lance a través de npx:

```json
{
  "mcpServers": {
    "mindwtr": {
      "command": "npx",
      "args": [
        "-y",
        "mindwtr-mcp",
        "--db",
        "~/.local/share/mindwtr/mindwtr.db"
      ]
    }
  }
}
```

El paquete npm es de solo lectura de forma predeterminada. Agrega `--write` solo cuando explícitamente desees que se habiliten las herramientas agregar/actualizar/completar/eliminar.

### Modo Cloud autohospedado

Usa modo Cloud cuando ejecutes tu propio servidor Mindwtr Cloud y desees herramientas MCP sin apuntar el ayudante a una base de datos SQLite local:

```bash
npx -y mindwtr-mcp \
  --cloud-url "https://mindwtr.example.com" \
  --cloud-token "$MINDWTR_TOKEN"
```

O pasa los mismos valores a través de variables de entorno:

```bash
MINDWTR_MCP_CLOUD_URL="https://mindwtr.example.com" \
MINDWTR_MCP_CLOUD_TOKEN="$MINDWTR_TOKEN" \
npx -y mindwtr-mcp
```

El modo Cloud usa la API de Cloud autohospedada. Las lecturas provienen de la instantánea actual de `/v1/data`; con `--write`, las escrituras de tarea/proyecto/sección/área pasan por los puntos finales REST por recurso del servidor en la nube (`POST /v1/tasks`, `PATCH /v1/tasks/:id`, y así sucesivamente), para que obtengan la misma validación y sellado de revisión que cualquier otro cliente. Sin `--write`, las herramientas de escritura devuelven `read_only`. Las ediciones de personas y la restauración de tareas eliminadas aún no están disponibles en modo Cloud.

Esto no convierte Mindwtr Cloud en un servidor MCP hospedado. Sigue siendo el mismo ayudante stdio, respaldado por una URL de Cloud que operas.

Para despliegues de prueba HTTP privados, las URL HTTP locales/privadas se permiten según las reglas del cliente de Cloud compartido. Usa `--cloud-allow-insecure-http=true` solo para un punto final autohospedado que confías intencionalmente.

### Acceso remoto (HTTP)

De forma predeterminada, `mindwtr-mcp` solo habla stdio. Pasa `--http` para también (en lugar de stdio) servir un punto final MCP HTTP sin estado transmisible, para que puedas apuntar un cliente MCP remoto a una URL — el caso motivador es [Gemini Spark](https://gemini.google.com) “aplicaciones personalizadas”, que toman una URL de servidor MCP. El modo HTTP funciona con cualquier backend (SQLite local o Cloud autohospedado).

```bash
mindwtr-mcp --http --http-token “$(openssl rand -hex 32)” --db “/path/to/mindwtr.db”
```

Banderas (todas tienen equivalentes de variable de entorno `MINDWTR_MCP_HTTP*`):

- `--http` / `MINDWTR_MCP_HTTP` — habilita modo HTTP. También implicado al establecer `--http-host`, `--http-port` o `--http-token`.
- `--http-token <token>` / `MINDWTR_MCP_HTTP_TOKEN` — **requerido** siempre que el modo HTTP esté activado, al menos 16 caracteres. Genera uno con `openssl rand -hex 32`. El servidor se niega a iniciarse sin él — no hay forma de exponer el modo HTTP sin autenticar, ni siquiera en loopback.
- `--http-host <host>` / `MINDWTR_MCP_HTTP_HOST` — dirección de enlace, predeterminada `127.0.0.1`.
- `--http-port <port>` / `MINDWTR_MCP_HTTP_PORT` — puerto de enlace, predeterminado `8722`.

El punto final MCP es `POST /mcp` y requiere `Authorization: Bearer <token>` en cada solicitud; `GET /healthz` devuelve `200 ok` sin autenticación para verificaciones de salud de proxy inverso. Las solicitudes sin un token válido obtienen `401`; los cuerpos superiores a 1 MiB obtienen `413`. Cuando el modo HTTP está activado, el servidor tampoco conecta un transporte stdio — permanece vivo mientras el servidor HTTP está escuchando, no stdin.

No hay terminación TLS integrada ni limitación de velocidad. Si estás exponiendo esto más allá de localhost, coloca un proxy inverso (p. ej., Caddy, nginx) al frente para TLS y coloca la URL `https://` resultante (más tu token) en el cliente MCP remoto.

### Ejecutar directamente desde el repo

```bash
# desde la raíz del repo (solo lectura de forma predeterminada)
bun run mindwtr:mcp -- --db “/path/to/mindwtr.db”
```

Habilita escrituras (requerido para herramientas agregar/actualizar/completar/eliminar):

```bash
bun run mindwtr:mcp -- --db “/path/to/mindwtr.db” --write
```

Parar:
- Presiona `Ctrl+C` en la terminal.

### Comportamiento de keep-alive (por qué a veces se sale)

El servidor MCP está **basado en stdio**. Se mantiene vivo mientras stdin esté abierto.
Si tu shell/cliente cierra stdin, el proceso se sale.

Para forzar una salida inmediata cuando se cierre stdin (sin keep-alive), pasa `--nowait`:

```bash
bun run mindwtr:mcp -- --db “/path/to/mindwtr.db” --nowait
```

Nota: Cuando un cliente MCP lanza el servidor, mantiene stdin abierto, por lo que el servidor debe permanecer conectado.

### Ejecutar sin el script ayudante

```bash
bun run --filter mindwtr-mcp dev -- --db “/path/to/mindwtr.db”
```

Parar:
- Presiona `Ctrl+C` en la terminal.

### Compilar y ejecutar la entrada binaria (Node)

```bash
# desde la raíz del repo
bun run --filter mindwtr-mcp build
node apps/mcp-server/dist/cli.js --db “/path/to/mindwtr.db”
```

Parar:
- Presiona `Ctrl+C` en la terminal.

---

## Por qué `mindwtr-mcp` es “command not found”

`mindwtr-mcp` es el binario del paquete. Existe después de instalar el paquete npm globalmente, después de que un cliente MCP lo lance a través de `npx`, o después de que compiles el paquete fuente y lo ejecutes con Node.

Usa una de estas opciones de árbol de fuentes en su lugar:

```bash
# ✅ funciona inmediatamente
bun run mindwtr:mcp -- --db “/path/to/mindwtr.db”

# ✅ compilar luego ejecutar
bun run --filter mindwtr-mcp build
node apps/mcp-server/dist/cli.js --db “/path/to/mindwtr.db”
```

### Opcional: crear un comando global `mindwtr-mcp`

Si deseas un comando real `mindwtr-mcp` en tu PATH, crea un pequeño envoltorio:

```bash
cat > ~/bin/mindwtr-mcp <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /absolute/path/to/Mindwtr
exec bun run mindwtr:mcp -- “$@”
EOF
chmod +x ~/bin/mindwtr-mcp
```

Luego usa:

```bash
mindwtr-mcp --db “/path/to/mindwtr.db”
```

### ¿Botón de aplicación de escritorio?

Todavía no. El inicio/parada sigue siendo manual.

---

## Configuración del Cliente MCP

Los clientes MCP ejecutan el servidor como un subproceso. Les señalas **el comando** y pasas args/env.

**Importante:** NO uses `bun run mindwtr:mcp` para clientes MCP. El envoltorio `bun run` emite mensajes del shell a stdout (p. ej., `$ bun run --filter...`) lo que rompe el protocolo JSON-RPC. Siempre ejecuta bun directamente en el archivo fuente.

### Ejemplo (configuración genérica de MCP)

```json
{
  "mcpServers": {
    "mindwtr": {
      "command": "bun",
      "args": [
        "/absolute/path/to/Mindwtr/apps/mcp-server/src/cli.ts",
        "--db",
        "~/.local/share/mindwtr/mindwtr.db"
      ]
    }
  }
}
```

Agrega `--write` a los args si deseas habilitar herramientas **agregar/actualizar/completar/eliminar**.

Si tu cliente no soporta Bun, compila primero y usa Node:

```bash
# Compilar una vez
cd /path/to/Mindwtr && bun run --filter mindwtr-mcp build
```

```json
{
  "mcpServers": {
    "mindwtr": {
      "command": "node",
      "args": [
        "/absolute/path/to/Mindwtr/apps/mcp-server/dist/cli.js",
        "--db",
        "~/.local/share/mindwtr/mindwtr.db"
      ]
    }
  }
}
```

Agrega `--write` a los args si deseas habilitar herramientas **agregar/actualizar/completar/eliminar**.

### Claude Desktop

Claude Desktop soporta MCP (stdio). Agrega una entrada de servidor en su configuración MCP.

Ubicaciones típicas del archivo de configuración:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Después de editar, cierra completamente y relanza Claude Desktop.

### Claude Code (CLI)

Agrega un servidor a través de la CLI:

```bash
claude mcp add mindwtr -- \
  bun /path/to/Mindwtr/apps/mcp-server/src/cli.ts --db "/path/to/mindwtr.db" --write
```

O edita `~/.claude.json` directamente:

```json
{
  "projects": {
    "/path/to/your/project": {
      "mcpServers": {
        "mindwtr": {
          "type": "stdio",
          "command": "bun",
          "args": [
            "/absolute/path/to/Mindwtr/apps/mcp-server/src/cli.ts",
            "--db",
            "~/.local/share/mindwtr/mindwtr.db",
            "--write"
          ]
        }
      }
    }
  }
}
```

Luego reinicia la sesión de Claude Code y ejecuta `/mcp` para verificar que está conectado.

### OpenAI Codex (config.toml)

Codex almacena la configuración de MCP en `~/.codex/config.toml`. Agrega:

```toml
[mcp_servers.mindwtr]
command = "bun"
args = ["/absolute/path/to/Mindwtr/apps/mcp-server/src/cli.ts", "--db", "/path/to/mindwtr.db", "--write"]

# Opcional: pasar variables de entorno al servidor
[mcp_servers.mindwtr.env]
MINDWTR_DB_PATH = "/path/to/mindwtr.db"
```

Reinicia Codex después de guardar.

### Gemini CLI

Gemini CLI usa un `settings.json` JSON con `mcpServers`, ya sea:
- Alcance de usuario: `~/.gemini/settings.json`
- Alcance del proyecto: `.gemini/settings.json` en tu repo

Puedes agregar Mindwtr MCP de dos formas:

**1) CLI (recomendado):**

```bash
gemini mcp add mindwtr \
  bun /absolute/path/to/Mindwtr/apps/mcp-server/src/cli.ts \
  --db "/path/to/mindwtr.db" --write
```

**2) Edita settings.json manualmente:**

```json
{
  "mcpServers": {
    "mindwtr": {
      "command": "bun",
      "args": ["/absolute/path/to/Mindwtr/apps/mcp-server/src/cli.ts", "--db", "/path/to/mindwtr.db", "--write"]
    }
  }
}
```

Reinicia la sesión de Gemini CLI después de guardar.

### Otros clientes MCP

Cualquier cliente compatible con MCP puede funcionar mientras pueda lanzar un servidor **stdio** con el comando + args anteriores.

---

## Migración: renombramiento de herramientas (`mindwtr.*` → `mindwtr_*`)

> **Cambio importante** (introducido en esta versión): todos los nombres de herramientas han cambiado de notación de puntos (`mindwtr.list_tasks`) a notación de guiones bajos (`mindwtr_list_tasks`) para cumplir con las reglas de validación del cliente MCP (p. ej., Claude Desktop).

**Mapeo antiguo → nuevo:**

| Nombre antiguo            | Nombre nuevo               |
| ------------------------- | -------------------------- |
| `mindwtr.list_tasks`      | `mindwtr_list_tasks`       |
| `mindwtr.list_projects`   | `mindwtr_list_projects`    |
| `mindwtr.get_project`     | `mindwtr_get_project`      |
| `mindwtr.get_task`        | `mindwtr_get_task`         |
| `mindwtr.list_areas`      | `mindwtr_list_areas`       |
| `mindwtr.add_task`        | `mindwtr_add_task`         |
| `mindwtr.update_task`     | `mindwtr_update_task`      |
| `mindwtr.complete_task`   | `mindwtr_complete_task`    |
| `mindwtr.delete_task`     | `mindwtr_delete_task`      |
| `mindwtr.restore_task`    | `mindwtr_restore_task`     |
| `mindwtr.add_project`     | `mindwtr_add_project`      |
| `mindwtr.update_project`  | `mindwtr_update_project`   |
| `mindwtr.delete_project`  | `mindwtr_delete_project`   |
| `mindwtr.add_area`        | `mindwtr_add_area`         |
| `mindwtr.update_area`     | `mindwtr_update_area`      |
| `mindwtr.delete_area`     | `mindwtr_delete_area`      |

**Acción de actualización:** busca y reemplaza `mindwtr.` con `mindwtr_` en cualquier configuración de cliente MCP, avisos del sistema, scripts o automatizaciones que hagan referencia a estos nombres de herramientas. No se requieren otros cambios.

---

## Tools

- `mindwtr_list_tasks`
  - Input: `{ status?, projectId?, includeDeleted?, limit?, offset?, search?, dueDateFrom?, dueDateTo?, sortBy?, sortOrder? }`
- `mindwtr_list_projects`
  - Input: `{}`
- `mindwtr_get_project`
  - Input: `{ id, includeDeleted? }`
- `mindwtr_list_sections`
  - Input: `{ projectId?, includeDeleted? }`
- `mindwtr_get_section`
  - Input: `{ id, includeDeleted? }`
- `mindwtr_list_areas`
  - Input: `{}`
- `mindwtr_list_people`
  - Input: `{ includeDeleted? }`
- `mindwtr_get_person`
  - Input: `{ id, includeDeleted? }`
- `mindwtr_get_task`
  - Input: `{ id, includeDeleted? }`
- `mindwtr_add_task` **(requires `--write`)**
  - Input: `{ title? | quickAdd?, status?, projectId?, sectionId?, areaId?, dueDate?, startTime?, reviewAt?, recurrence?, contexts?, tags?, description?, priority?, energyLevel?, assignedTo?, timeEstimate?, taskMode?, relativeStartOffset?, showFutureRecurrence?, pushCount?, checklist?, textDirection?, location?, isFocusedToday?, timeSpentMinutes?, suppressMindwtrReminders?, repeatReminderMinutes? }`
- `mindwtr_update_task` **(requiere `--write`)**
  - Entrada: `{ id, title?, status?, projectId?, sectionId?, areaId?, dueDate?, startTime?, reviewAt?, recurrence?, contexts?, tags?, description?, priority?, energyLevel?, assignedTo?, timeEstimate?, taskMode?, relativeStartOffset?, showFutureRecurrence?, pushCount?, checklist?, textDirection?, location?, isFocusedToday?, timeSpentMinutes?, suppressMindwtrReminders?, repeatReminderMinutes?, order?, boardOrder?, focusOrder? }`
  - `recurrence` acepta un objeto de recurrencia o una cadena RFC 5545 RRULE. Pasa `null` para borrarla.
- `mindwtr_complete_task` **(requiere `--write`)**
  - Input: `{ id }`
- `mindwtr_delete_task` **(requires `--write`)**
  - Input: `{ id }`
- `mindwtr_restore_task` **(requires `--write`)**
  - Input: `{ id }`
- `mindwtr_add_project` **(requires `--write`)**
  - Input: `{ title, color?, status?, areaId?, isSequential?, isFocused?, dueDate?, reviewAt?, supportNotes? }`
- `mindwtr_update_project` **(requires `--write`)**
  - Input: `{ id, title?, color?, status?, areaId?, isSequential?, isFocused?, dueDate?, reviewAt?, supportNotes? }`
- `mindwtr_delete_project` **(requires `--write`)**
  - Input: `{ id }`
- `mindwtr_add_section` **(requires `--write`)**
  - Input: `{ projectId, title, description?, order?, isCollapsed? }`
- `mindwtr_update_section` **(requires `--write`)**
  - Input: `{ id, title?, description?, order?, isCollapsed? }`
- `mindwtr_delete_section` **(requires `--write`)**
  - Input: `{ id }`
- `mindwtr_add_area` **(requires `--write`)**
  - Input: `{ name, color?, icon? }`
- `mindwtr_update_area` **(requires `--write`)**
  - Input: `{ id, name?, color?, icon? }`
- `mindwtr_delete_area` **(requires `--write`)**
  - Input: `{ id }`
- `mindwtr_add_person` **(requires `--write`)**
  - Input: `{ name, note?, referenceLink? }`
- `mindwtr_update_person` **(requires `--write`)**
  - Input: `{ id, name?, note?, referenceLink? }`
- `mindwtr_rename_person` **(requires `--write`)**
  - Input: `{ id, name, updateTasks? }`
- `mindwtr_delete_person` **(requires `--write`)**
  - Input: `{ id }`

Todas las herramientas devuelven cargas útiles de texto JSON con la tarea resultante, proyecto, sección, área, persona o carga útil de colección.

---

## Pruebas

### Prueba de humo rápida (CLI)

1) Inicia el servidor (solo lectura):
```bash
bun run mindwtr:mcp -- --db "~/.local/share/mindwtr/mindwtr.db"
```

2) Conecta a través de tu cliente MCP y ejecuta:
- `mindwtr_list_tasks` (límite 5)

Si deseas probar escrituras, reinicia con `--write`:
```bash
bun run mindwtr:mcp -- --db "~/.local/share/mindwtr/mindwtr.db" --write
```

Luego prueba:
- `mindwtr_add_task` (quickAdd: "Test task @home /due:tomorrow")
- `mindwtr_complete_task` (usa el id de tarea devuelto)
- `mindwtr_update_task` (p. ej., establecer estado o dueDate)
- `mindwtr_delete_task` (usa el id de tarea devuelto)
- `mindwtr_get_task` (usa el id de tarea devuelto)
- `mindwtr_restore_task` (después de eliminar, restaura la tarea)
- `mindwtr_list_projects`
- `mindwtr_get_project` (usa el id de proyecto devuelto)
- `mindwtr_list_areas`
- `mindwtr_list_people`
- `mindwtr_add_project`
- `mindwtr_update_project`
- `mindwtr_delete_project`
- `mindwtr_add_area`
- `mindwtr_update_area`
- `mindwtr_delete_area`
- `mindwtr_add_person`
- `mindwtr_update_person`
- `mindwtr_rename_person`
- `mindwtr_get_person` (usa el id de persona devuelto)
- `mindwtr_delete_person`
- `mindwtr_list_tasks` con `dueDateFrom`, `dueDateTo`, `sortBy`, `sortOrder`

Si la lista devuelve tareas y agregar/completar funciona, el servidor está sano.

### E2E JSON-RPC de Stdio (validación de transporte)

Usa cualquier cliente MCP o un pequeño script para enviar:
- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call` (p. ej., `mindwtr_list_projects` o `mindwtr_list_tasks`)

Si estos tienen éxito, el transporte stdio funciona de extremo a extremo.

### Verificación de cordura de Claude Code

1) Agrega el servidor:
```bash
claude mcp add mindwtr -- \
  bun /path/to/Mindwtr/apps/mcp-server/src/cli.ts --db "/path/to/mindwtr.db" --write
```
2) Reinicia Claude Code, ejecuta `/mcp` y verifica que **mindwtr** esté conectado.
3) Pide al modelo que llame:
   - `mindwtr_list_tasks` (límite 5)
   - `mindwtr_add_task` (quickAdd: "Test MCP @home /due:tomorrow")
   - `mindwtr_complete_task` (usa el id devuelto)

---

## Seguridad y Concurrencia

- El servidor usa **modo SQLite WAL**. Las herramientas de solo lectura pueden ejecutarse mientras la aplicación de escritorio está abierta.
- Las herramientas de escritura fallan rápidamente en bloqueos de escritor de SQLite, luego reintentan toda la operación de escritura de Mindwtr. Cada reintento recarga datos actuales antes de aplicar el cambio solicitado, por lo que una escritura MCP retrasada no continúa funcionando desde una instantánea anterior al bloqueo obsoleta.
- Las escrituras están **deshabilitadas de forma predeterminada**. Usa `--write` para habilitar ediciones.
- Las operaciones de escritura van a través del almacén compartido **@mindwtr/core** para hacer cumplir las reglas comerciales (tanto Bun como Node).
- SQL se reserva para rutas pesadas de lectura (lista/búsqueda) donde importa el rendimiento.
- No apuntes un despliegue separado de contenedor/servidor al mismo almacenamiento local o datos de sincronización mientras la aplicación de escritorio también está escribiendo. Esto crea escritores independientes fuera de la ruta de coordinación de SQLite local y no es compatible.

---

## Notas

- Este servidor MCP apunta a la base de datos SQLite utilizada por la aplicación de escritorio, con mutaciones enrutadas a través de `@mindwtr/core`.
- Ten cuidado con los cambios de esquema entre versiones de aplicaciones (actualiza consultas si es necesario).
