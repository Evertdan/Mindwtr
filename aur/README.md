# Paquetes Mindwtr AUR

Mindwtr reconoce estas identidades de paquetes AUR:

| Paquete                                                                   | Canal   | Fuente                         | Propietario(s) esperado(s)                               |
| ----------------------------------------------------------------------- | ------- | ------------------------------ | ------------------------------------------------------- |
| [`mindwtr-bin`](https://aur.archlinux.org/packages/mindwtr-bin)           | Estable | Lanzamiento de GitHub `.deb`   | Mantenedor `dongdongbh`                                 |
| [`mindwtr`](https://aur.archlinux.org/packages/mindwtr)                   | Estable | Archivo fuente de lanzamiento GitHub | Mantenedor `yochananmarqos`; comantenedor `dongdongbh` |
| [`mindwtr-bin-beta`](https://aur.archlinux.org/packages/mindwtr-bin-beta) | RC/beta | Prelanzamiento GitHub `.deb`   | Mantenedor `dongdongbh`                                 |

Trata una URL ascendente diferente o un cambio de propiedad inesperado como un evento de seguridad. La política legible por máquina está en [`trusted-packages.json`](trusted-packages.json).

## Instalar

Revisa cada archivo AUR antes de compilar. Por ejemplo:

```bash
git clone https://aur.archlinux.org/mindwtr-bin.git
cd mindwtr-bin
git log --oneline -10
less PKGBUILD .SRCINFO
makepkg --verifysource
makepkg -sri
```

Las URL fuente deben resolverse en `https://github.com/dongdongbh/Mindwtr`, los artefactos ejecutables y fuente deben tener sumas de comprobación SHA-256 completas, y `.SRCINFO` debe coincidir con `PKGBUILD`. Los paquetes Mindwtr AUR no deben contener scripts de instalación, comandos de shell remoto, ganchos de persistencia o sumas de comprobación `SKIP` para contenido ejecutable/fuente.

## Ancla de confianza de lanzamiento

Mindwtr publica `SHA256SUMS` con artefactos de lanzamiento y firma nuevos manifiestos como `SHA256SUMS.asc`. La huella digital de la clave de firma principal es:

```text
0358 999B BE70 4F58 8B90  9497 9E55 3245 CB17 047D
```

Verifica la huella digital de forma independiente antes de confiar en la clave. Una verificación típica es:

```bash
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --check SHA256SUMS
```

## Política de publicación

Los tres paquetes se publican directamente desde trabajos de lanzamiento:

1. Genera `PKGBUILD` y `.SRCINFO` del paquete desde la etiqueta de lanzamiento.
2. Rechaza archivos inesperados, propietarios, fuentes, comandos o sumas de comprobación omitidas (`scripts/ci/validate-aur-package.mjs`).
3. Compila en un contenedor Arch limpio.
4. Reverifica el mantenedor del paquete, comantendedores y URL ascendente contra la política de confianza inmediatamente antes de hacer push (`scripts/ci/audit-aur-state.mjs`); la deriva de propiedad aborta el push.
5. Impulsa una única confirmación sin fuerza sobre una credencial SSH dedicada.

Una respuesta reconocida de mantenimiento de AUR (pushes deshabilitados) marca el canal como retrasado en lugar de fallar el trabajo; un rechazo inesperado falla.

`mindwtr` (el paquete fuente, comantenido con `yochananmarqos`) además ejecuta una compilación completa de contenedor limpio del paquete antes de hacer push, y su trabajo de lanzamiento aún guarda los archivos exactos publicados, confirmación base, instantánea de propiedad/historial de todos los paquetes, diferencia de revisión y suma de comprobación de diferencia como un artefacto de flujo de trabajo de 90 días — ahora como un registro de publicación en lugar de una propuesta pendiente.

El flujo de trabajo manual `Publicar propuesta AUR revisada` (`publish-aur.yml`), protegido por el Entorno de GitHub `aur-publish`, publica tal artefacto guardado y permanece disponible como alternativa en modo de incidente para los tres paquetes, para publicación fuera de banda cuando los empujes directos no están disponibles o se justifica revisión adicional.

## Seguridad del mantenedor

- Mantén `dongdongbh` como mantenedor o comantenedor de todos los paquetes reconocidos.
- Usa una clave AUR Ed25519 dedicada y protegida con frase de contraseña que no se comparta con GitHub, servidores o máquinas de compilación general.
- Almacena la clave de publicación solo como el secreto `AUR_SSH_PRIVATE_KEY` en el Entorno protegido `aur-publish`.
- Requiere una revisión humana del artefacto de propuesta antes de aprobar la implementación del Entorno.
- Nunca abandones un paquete por conveniencia de mantenimiento temporal y nunca hagas push forzado del historial de AUR.

El AUR es no oficial. La automatización detecta la deriva de política, pero no reemplaza la revisión de la diferencia real del paquete y el comportamiento de compilación.
