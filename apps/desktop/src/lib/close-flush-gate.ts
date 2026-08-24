import { raceCloseFlush, type CloseFlushRaceOptions, type CloseFlushRaceResult } from './close-flush-race';

// #913 seguimiento: un evento de cierre nativo impulsa dos escuchadores JS independientes
// (la carrera de vaciado en App.tsx y la decisión de salir/bandeja en
// close-request-handler.ts), y nada los secuencia — una ruta de salida podría
// alcanzar quit_app antes de que incluso se haya iniciado el vaciado. Cada ruta de salida canaliza
// a través de quitApp(), así que cerrar ese único punto de estrangulamiento cubre todos ellos
// sin necesidad de coordinar los dos escuchadores directamente.
//
// Vuelo único: la primera ruta de cierre que pregunta inicia el vaciado acotado;
// todas las otras rutas se unen al mismo resultado en lugar de iniciar uno segundo.
let gate: Promise<CloseFlushRaceResult> | null = null;

export function beginCloseFlush(options: CloseFlushRaceOptions): Promise<CloseFlushRaceResult> {
    if (!gate) gate = raceCloseFlush(options);
    return gate;
}

// Llamar cuando se abandona una secuencia de cierre (usuario cancelado) para que la siguiente solicitud de cierre
// se vacíe de nuevo en lugar de reutilizar un resultado resuelto obsoleto.
// Deliberadamente no se borra cuando el vaciado simplemente se resuelve — dentro de un cierre
// secuencia, las rutas posteriores deben unirse al resultado resuelto instantáneamente en lugar de
// iniciar un segundo vaciado.
export function resetCloseFlushGate(): void {
    gate = null;
}
