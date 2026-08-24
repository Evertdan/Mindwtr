# Política de seguridad

## Reportar una vulnerabilidad

Por favor, reporta vulnerabilidades de forma privada a través de [avisos de seguridad de GitHub](https://github.com/dongdongbh/Mindwtr/security/advisories/new). No abras un problema público para nada que sea explotable.

Puedes esperar una respuesta inicial dentro de algunos días. No hay recompensa por errores; las correcciones se acreditan en las notas de la versión a menos que prefieras lo contrario.

## Versiones admitidas

Solo la última versión recibe correcciones de seguridad. Las etiquetas antiguas son inmutables y nunca se parchean en su lugar — una corrección siempre se envía como una nueva versión.

## Postura de la cadena de suministro

- Las acciones de GitHub se fijan a SHAs de commit completos.
- Las compilaciones de CI y lanzamiento instalan dependencias con `bun install --frozen-lockfile`; el `bun.lock` comprometido es la fuente de verdad.
- Un flujo de trabajo de auditoría de dependencias programado revisa avisos para el árbol de dependencias.
- Se esperan scripts de instalación de dependencias solo para compilaciones nativas (por ejemplo, `better-sqlite3` en las imágenes de Docker en la nube/MCP); las nuevas dependencias que necesitan scripts de instalación reciben revisión adicional.

## Notas de alcance

Mindwtr es local-first. El servidor en la nube auto hospedado opcional se autentica con tokens portadores (hasheados en reposo, comparación de tiempo constante) y es la superficie principal expuesta a la red; los reportes sobre ello son especialmente bienvenidos.
