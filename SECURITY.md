# Política de Seguridad

## Reportar una vulnerabilidad

Por favor reporta vulnerabilidades de forma privada a través de [avisos de seguridad de GitHub](https://github.com/dongdongbh/Mindwtr/security/advisories/new). No abras un issue público para nada que sea explotable.

Puedes esperar una respuesta inicial en unos pocos días. No hay recompensa por errores (bug bounty); las correcciones se acreditan en las notas de lanzamiento a menos que prefieras lo contrario.

## Versiones soportadas

Solo la última versión recibe correcciones de seguridad. Las etiquetas anteriores son inmutables y nunca se parchean en su lugar — una corrección siempre se lanza como una nueva versión.

## Postura de la cadena de suministro

- Los GitHub Actions se fijan a SHAs completos de commits.
- Las compilaciones de CI y lanzamiento instalan dependencias con `bun install --frozen-lockfile`; el archivo `bun.lock` comprometido es la fuente de verdad.
- Un flujo de trabajo de auditoría de dependencias programado revisa los avisos del árbol de dependencias.
- Los scripts de instalación de las dependencias solo se esperan para compilaciones nativas (por ejemplo `better-sqlite3` en las imágenes Docker cloud/MCP); las nuevas dependencias que necesitan scripts de instalación reciben revisión adicional.

## Notas de alcance

Mindwtr es local-first. El servidor en la nube autoalojado opcional se autentica con tokens de portador (hasheados en reposo, comparación de tiempo constante) y es la superficie expuesta a la red principal; los reportes sobre el mismo son especialmente bienvenidos.
