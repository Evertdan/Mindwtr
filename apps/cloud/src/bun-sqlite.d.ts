declare module 'bun:sqlite' {
    export class Statement {
        get(...params: unknown[]): unknown;
        run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    }
    export class Database {
        constructor(path: string, options?: { readonly?: boolean });
        exec(sql: string): void;
        prepare(sql: string): Statement;
        close(): void;
    }
}
