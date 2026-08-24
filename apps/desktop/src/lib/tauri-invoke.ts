import { isTauriRuntime } from './runtime';

/**
 * El transporte que realmente llega a Rust. Intercambiable para que las personas que llaman obtengan una costura
 * sin que cada adaptador desarrolle su propio andamiaje de inyección de dependencias.
 */
export type NativeInvokeTransport = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const tauriTransport: NativeInvokeTransport = async <T>(
    command: string,
    args?: Record<string, unknown>,
): Promise<T> => {
    const { invoke } = await import('@tauri-apps/api/core');
    // Un comando sin argumentos permanece sin argumentos en el cable.
    return args === undefined ? invoke<T>(command) : invoke<T>(command, args);
};

let transport: NativeInvokeTransport = tauriTransport;

/** Reemplaza el transporte (pruebas, falsificaciones). Pase `null` para restaurar el real. */
export function setNativeInvokeTransport(next: NativeInvokeTransport | null): void {
    transport = next ?? tauriTransport;
}

/**
 * Resuelve el módulo de transporte por adelantado, para que un `invokeNative` posterior solo pague
 * la llamada. Las rutas de inicio cuya invocación tiene un tiempo limitado — `notify_ui_ready` se dispara después
 * de dos fotogramas de animación y es lo que revela la ventana (#936) — precargar antes
 * de la espera en lugar de resolver el módulo en la llamada cronometrada en sí.
 */
export async function preloadNativeTransport(): Promise<void> {
    if (!isTauriRuntime()) return;
    await import('@tauri-apps/api/core');
}

/**
 * Invoca un comando de Rust. Rechaza cuando no hay tiempo de ejecución de Tauri — use esto
 * cuando la persona que llama ya haya establecido que se está ejecutando en el shell de escritorio,
 * o cuando fallar es el resultado correcto en otro lugar.
 */
export async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!isTauriRuntime()) {
        throw new Error('Tauri runtime is unavailable.');
    }
    return transport<T>(command, args);
}

/**
 * Invoca un comando de Rust, resolviéndose a `fallback` cuando no hay Tauri
 * runtime (compilaciones web/dev), por lo que el llamador no necesita su propia guardia.
 */
export async function invokeNativeOr<T>(
    fallback: T,
    command: string,
    args?: Record<string, unknown>,
): Promise<T> {
    if (!isTauriRuntime()) return fallback;
    return transport<T>(command, args);
}
