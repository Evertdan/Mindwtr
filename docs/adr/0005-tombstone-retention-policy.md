# ADR 0005: Política de retención y purga de lápidas

Fecha: 2026-03-14
Estado: Aceptado

## Contexto

Mindwtr utiliza lápidas de eliminación suave para que las eliminaciones se puedan sincronizar de forma segura entre dispositivos y proveedores. Si las lápidas desaparecen demasiado pronto, un cliente sin conexión puede resucitar registros eliminados durante una fusión posterior. Si se mantienen para siempre, los datos locales y las cargas útiles de sincronización crecen sin límite.

El sistema, por lo tanto, necesita una política de retención que mantenga eliminadas el tiempo suficiente para la recuperación normal de múltiples dispositivos mientras sigue permitiendo la limpieza eventual.

## Decisión

Retenemos registros marcados como eliminados en datos persistidos durante una ventana limitada y solo los purgamos después de que ha transcurrido el período de retención.

Política actual:

- las eliminaciones se representan como lápidas, no como eliminaciones duras inmediatas
- las lápidas permanecen en instantáneas persistidas y cargas útiles de sincronización durante la ventana de retención
- la purga ocurre como un paso de limpieza explícito después de la ventana de retención, no como parte de las lecturas ordinarias
- la retención se mide de forma conservadora para que un elemento recientemente eliminado nunca se pierda durante el churn de sincronización normal

## Consecuencias

- La propagación de eliminación permanece determinista para clientes sin conexión e intermitentemente conectados.
- El crecimiento de almacenamiento está limitado en lugar de acumular permanentemente registros eliminados.
- Las rutas de guardado/exportación deben preservar lápidas hasta que se ejecute la limpieza; filtrarlas temprano es un error de pérdida de datos.
- Cualquier cambio futuro a la ventana de retención o al momento de purga debe tratarse como una decisión de comportamiento de sincronización, no solo una optimización de almacenamiento.
