# Mindwtr Docker (PWA + Nube)

Esta carpeta contiene Dockerfiles y un archivo de composición para ejecutar:
- **mindwtr-app**: la compilación web/PWA de escritorio, servida por Nginx
- **mindwtr-cloud**: el servidor de sincronización ligero

## Inicio rápido (composición HTTP)

No necesitas clonar el repositorio. Descarga el archivo de Composición en un directorio vacío:

```bash
curl -LO https://raw.githubusercontent.com/dongdongbh/Mindwtr/main/docker/compose.yaml
```

Crea un archivo `.env` junto a él (Composición lo lee automáticamente):

```dotenv
MINDWTR_CLOUD_AUTH_TOKENS=replace_with_a_token_at_least_20_characters_long
MINDWTR_CLOUD_CORS_ORIGIN=http://localhost:5173
```

`MINDWTR_CLOUD_CORS_ORIGIN` debe ser la dirección exacta en la que abres la PWA en tu navegador, incluyendo esquema y puerto. `http://localhost:5173` solo funciona cuando el navegador se ejecuta en el propio host de Docker. Desde cualquier otra máquina, usa la dirección del host, por ejemplo `http://192.168.1.20:5173`. Solo se puede establecer un origen.

Luego descarga e inicia las imágenes publicadas:

```bash
docker compose pull
docker compose up -d
```

Luego abre:
- PWA: `http://localhost:5173`
- Salud de nube: `http://localhost:8787/health`
- URL autohospedada para pruebas locales: `http://localhost:8787`
- URL base de API REST: `http://localhost:8787/v1`

Desde un teléfono u otra computadora, reemplaza `localhost` con la IP de LAN del host de Docker. En Mindwtr, usa el puerto en la nube (`http://HOST_IP:8787`) como URL autohospedada, no el puerto PWA (`:5173`).

Para compilar desde la fuente, clona el repositorio y ejecuta `docker compose -f docker/compose.yaml up --build -d` desde su raíz.

Este archivo de composición HTTP es mejor para pruebas locales. Los clientes de escritorio y móvil de Mindwtr aceptan HTTP para localhost, IPs privadas y nombres de host locales. Las URL públicas deben usar HTTPS.

## Sincronización de Dropbox y PWA de Docker

La imagen `mindwtr-app` de Docker sirve la compilación del navegador/PWA. La sincronización nativa de Dropbox OAuth no está disponible en este tiempo de ejecución porque la conexión de Dropbox se implementa mediante las aplicaciones nativas de escritorio y móvil. El suministro de `VITE_DROPBOX_APP_KEY` o `DROPBOX_APP_KEY` a través de `.env`, `env_file` o el entorno de ejecución de composición no habilitará Dropbox en Docker.

Para sincronización alojada en Docker, usa el servidor en la nube autohospedado incluido o WebDAV. Si el punto final autohospedado está detrás de Authelia u otro proxy SSO interactivo, configura el proxy para permitir que la ruta de sincronización/API de Mindwtr use el token de portador de Mindwtr directamente; la aplicación móvil no puede completar un inicio de sesión en navegador de Authelia enfrente de `/v1/data`.

## Inicio rápido HTTPS (Nube + Caddy)

Usa el archivo de composición HTTPS al sincronizar clientes reales de escritorio o móvil con un servidor en la nube autohospedado:

```bash
cp docker/.env.https.example docker/.env.https.local
```

Edita `docker/.env.https.local`:

```dotenv
MINDWTR_CLOUD_DOMAIN=mindwtr.example.com
MINDWTR_CLOUD_AUTH_TOKENS=your_long_random_token
MINDWTR_CLOUD_CORS_ORIGIN=https://mindwtr.example.com
MINDWTR_CADDYFILE=Caddyfile.https
```

Inicia la pila HTTPS:

```bash
docker compose --env-file docker/.env.https.local -f docker/compose.https.yaml up -d
```

Luego verifica:

```bash
curl https://mindwtr.example.com/health
```

En Configuración de Mindwtr -> Sincronización -> Autohospedado, usa:

```text
https://mindwtr.example.com
```

Mindwtr añadirá automáticamente `/v1/data`.

### HTTPS solo para LAN

Para un nombre de host que solo se resuelve en tu red local, cambia:

```dotenv
MINDWTR_CLOUD_DOMAIN=mindwtr.home.arpa
MINDWTR_CLOUD_CORS_ORIGIN=https://mindwtr.home.arpa
MINDWTR_CADDYFILE=Caddyfile.local-https
```

Esto usa la autoridad de certificación interna de Caddy. Cada dispositivo cliente debe confiar en el certificado raíz local de Caddy antes de que Mindwtr acepte la conexión HTTPS. Los certificados públicos de Let's Encrypt son la opción más confiable para clientes móviles.

Después de que se inicie la pila solo para LAN, puedes exportar el certificado raíz local de Caddy con:

```bash
docker compose --env-file docker/.env.https.local -f docker/compose.https.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt ./mindwtr-caddy-root.crt
```

Instala ese certificado como raíz de confianza en cada dispositivo que se sincronizará con este nombre de host.

## Configurar token de sincronización

El servidor en la nube espera un token. En `docker/compose.yaml`, establece:

```
MINDWTR_CLOUD_AUTH_TOKENS=your_token_here
```

`MINDWTR_CLOUD_TOKEN` aún se acepta por compatibilidad hacia atrás, pero está deprecado.

Para secretos de Docker, puedes apuntar a un archivo montado en su lugar:

```
MINDWTR_CLOUD_AUTH_TOKENS_FILE=/run/secrets/mindwtr_cloud_tokens
```

Usa el **mismo token** en Configuración de Mindwtr → Sincronización → Autohospedado.
Establece la URL autohospedada en el punto final **base**, por ejemplo:

```
http://localhost:8787
```

Mindwtr añadirá automáticamente `/v1/data` y almacenará `data.json` (y adjuntos) bajo ese punto final.

Ejemplo para generar un token:

```
cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | fold -w 50 | head -n 1
```

O puedes usar https://it-tools.tech/token-generator

## API (automatización de tareas)

El contenedor en la nube ahora expone la API REST en el mismo host/puerto que la sincronización, usando el **mismo token de Portador**.

URL base:

```
http://localhost:8787/v1
```

Crear una tarea:

```
curl -X POST \
  -H "Authorization: Bearer your_token_here" \
  -H "Content-Type: application/json" \
  -d '{"input":"Review invoice from Paperless /due:tomorrow #finance"}' \
  http://localhost:8787/v1/tasks
```

Listar tareas:

```
curl -H "Authorization: Bearer your_token_here" \
  "http://localhost:8787/v1/tasks?status=next"
```

## Volúmenes

Persiste datos en la nube montando una ruta de host:

```
./data:/app/cloud_data
```

Si cambias a una ruta de host personalizada, asegúrate de que sea escribible por el usuario del contenedor (uid 1000):

```
sudo chown -R 1000:1000 /path/data_dir
```

## Compilar sin composición (opcional)

```bash
# PWA
docker build -f docker/app/Dockerfile -t mindwtr-app .

# Nube
docker build -f docker/cloud/Dockerfile -t mindwtr-cloud .
```

## Notas

- La PWA usa representación del lado del cliente; Nginx se configura con `try_files` para evitar 404 en la actualización.
- Bun se fija en `1.3` y la compilación usa banderas C++20 para `better-sqlite3`.
