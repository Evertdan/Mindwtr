# ADR 0003: Sincronización consciente de revisiones con resolución determinista de lápidas

Fecha: 2026-03-06
Estado: Superado por ADR 0007

## Contexto

Mindwtr es nativo-primero y se sincroniza entre múltiples dispositivos y proveedores. Los conflictos de sincronización deben converger de forma determinista sin coordinación central, mientras que aún se preservan las eliminaciones de forma segura.

El último-a-escribir-gana basado en marca de tiempo pura no es suficiente por sí solo porque:

- los relojes del dispositivo pueden desviarse
- las eliminaciones no deben desaparecer durante fusiones
- las marcas de tiempo iguales aún necesitan resolución determinista

Este ADR captura la regla de ambigüedad de eliminación-vs-activa original que se envió antes de Mindwtr 0.8.2. ADR 0007 reemplaza la regla de ganador de eliminación-vs-activa mientras mantiene el resto del enfoque de fusión consciente de revisiones en su lugar.

## Decisión

Utilizamos metadatos de fusión consciente de revisión (`rev`, `revBy`) junto con marcas de tiempo y lápidas.

La estrategia de fusión es:

1. Normalizar entidades antes de fusión.
2. Preferir metadatos de revisión más alta cuando estén disponibles.
3. Usar marcas de tiempo como siguiente señal de ordenamiento.
4. Regla histórica en ese momento: cuando los tiempos de operación de eliminación-vs-activa son iguales, preferir la lápida.
5. Retroceder a desempates deterministas para que cada cliente converja en el mismo ganador.

Esto favorece intencionalmente la propagación segura de eliminación sobre mantener un registro activo cuando los tiempos de operación son indistinguibles.

## Consecuencias

- La sincronización permanece determinista entre clientes y proveedores.
- Las carreras de eliminación-vs-activa de tiempo igual se resuelven consistentemente en lugar de depender del orden de iteración.
- Las lápidas permanecen como parte central del modelo de datos y deben preservarse hasta que las reglas de retención permitan la purga.
- Cualquier cambio futuro en las reglas de ambigüedad de eliminación-vs-activa debe tratarse como una migración de comportamiento de sincronización, no un ajuste cosmético.
