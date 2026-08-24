# ADR 0012: Cascada de eliminación suave de área

Fecha: 2026-05-04
Estado: Aceptado

## Contexto

Las áreas pueden poseer proyectos, secciones y tareas. Una eliminación dura o un filtro solo de interfaz de usuario no es suficiente para sincronización local-primero: otro dispositivo aún puede tener hijos que hagan referencia al área eliminada, o puede restaurar un área de una instantánea anterior.

Sin una cascada a nivel de sincronización, los hijos restaurados pueden mantener valores `areaId` o `areaTitle` obsoletos colgantes. Eso crea restauraciones confusas y puede activar repetidamente revisiones de reparación.

## Decisión

Mindwtr trata la eliminación de área como una cascada de eliminación suave:

1. Eliminar un área sella lápidas en el área y sus proyectos, secciones y tareas secundarias.
2. Restaurar un área restaura hijos solo cuando su lápida pertenece al mismo timestamp de cascada.
3. Los hijos eliminados independientemente mantienen sus propias lápidas y no se restauran por la restauración del área.
4. La reparación de referencia de sincronización también se ejecuta en lápidas, por lo que los valores `areaId` y `areaTitle` obsoletos se limpian antes de cualquier restauración posterior.

## Consecuencias

- Las eliminaciones de área convergen entre dispositivos sin eliminar datos de usuario de forma dura inmediatamente.
- Las restauraciones son más seguras porque los hijos no reaparecen con referencias de área colgantes.
- La reparación de sincronización puede sellar hijos marcados como eliminados con `revBy: "sync-repair"`; estos son metadatos locales-primero intencionales, no contenido visible del usuario.
- Los cambios de jerarquía futura deben preservar timestamps de cascada o introducir un discriminador de restauración equivalente.
