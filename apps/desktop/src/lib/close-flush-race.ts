// #913: a save_data bloqueado invocar used to leave flushPendingSave() awaited with
// no bound, wedging window cerrar shut forever. esto races la flush against a
// tiempo de espera por lo que la caller puede Dejar de bloquear y ask la user instead — it nunca
// cancels la flush itself, solo stops waiting on it.
export type CloseFlushRaceOptions = {
    flush: () => Promise<void>;
    timeoutMs: number;
    logStep?: (step: string) => void;
    reportError: (label: string, error: unknown) => void;
};

export type CloseFlushRaceResult = {
    timedOut: boolean;
};

export async function raceCloseFlush({
    flush,
    timeoutMs,
    logStep,
    reportError,
}: CloseFlushRaceOptions): Promise<CloseFlushRaceResult> {
    logStep?.('flush before close started');
    const flushPromise = flush().catch((error) => reportError('Save failed', error));

    let timeoutId: ReturnType<typeof setTimeout>;
    const timedOut = await Promise.race([
        flushPromise.then(() => false),
        new Promise<boolean>((resolve) => {
            timeoutId = setTimeout(() => resolve(true), timeoutMs);
        }),
    ]);
    clearTimeout(timeoutId!);

    logStep?.(timedOut ? `flush before close timed out after ${timeoutMs}ms` : 'flush before close settled');
    return { timedOut };
}
