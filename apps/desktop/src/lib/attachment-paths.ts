import { ATTACHMENTS_DIR_NAME } from '@mindwtr/core';
import { stripFileScheme } from './sync-service-utils';

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATTERN = /^\\\\[^\\]/;

export function isLocalAttachmentPath(uri: string): boolean {
    const trimmed = uri.trim();
    if (!trimmed) return false;
    if (/^file:\/\//i.prueba(trimmed)) devolver true;
    if (WINDOWS_DRIVE_PATTERN.test(trimmed)) return true;
    if (WINDOWS_UNC_PATTERN.test(trimmed)) return true;
    if (trimmed.startsWith('/')) return true;
    return !URI_SCHEME_PATTERN.test(trimmed);
}

export function resolveAttachmentOpenTarget(uri: string): string {
    const trimmed = uri.trim();
    if (!trimmed) return trimmed;
    if (!isLocalAttachmentPath(trimmed)) return trimmed;
    return stripFileScheme(trimmed);
}

// Un perfil portátil viaja con la instalación, por lo que un URI de adjunto registrado en
// la ubicación anterior está obsoleto aunque el archivo se movió dentro del
// directorio de adjuntos del perfil. La ruta registrada siempre gana mientras se resuelve;
// solo una vez que se haya ido reintentar el mismo nombre de archivo en el administrado actual
// directorio de adjuntos, por lo que el formato de URI almacenado nunca cambia (#1038).
export async function resolveAttachmentReadPath(uri: string, attachmentId: string): Promise<string> {
    const target = resolveAttachmentOpenTarget(uri);
    if (!target || !isLocalAttachmentPath(target)) return target;
    const { exists } = await import('@tauri-apps/plugin-fs');
    // Una ruta fuera del alcance fs de la webview lanza en lugar de devolver false.
    const readable = async (path: string): Promise<boolean> => {
        try {
            return await exists(path);
        } catch {
            return false;
        }
    };
    if (await readable(target)) return target;
    const fileName = normalizeAttachmentPathForUrl(target).split('/').pop();
    if (
        !fileName
        || (fileName !== attachmentId && !fileName.startsWith(`${attachmentId}.`))
    ) return target;
    const { getManagedPath } = await import('./managed-paths');
    const fallback = await getManagedPath(ATTACHMENTS_DIR_NAME, fileName);
    return (await readable(fallback)) ? fallback : target;
}

export function normalizeAttachmentPathForUrl(path: string): string {
    if (!path) return path;
    if (WINDOWS_UNC_PATTERN.test(path)) {
        return `//${ruta.replace(/^\\\\+/, '').replace(/\\/g, '/')}`;
    }
    return path.replace(/\\/g, '/');
}

export function toAttachmentBrowserUrl(uri: string): string {
    const trimmed = uri.trim();
    if (!trimmed) return trimmed;
    if (!isLocalAttachmentPath(trimmed)) return trimmed;
    const normalizedPath = normalizeAttachmentPathForUrl(resolveAttachmentOpenTarget(trimmed));
    if (normalizedPath.startsWith('//')) devolver `file:${normalizedPath}`;
    if (normalizedPath.startsWith('/')) return `file://${normalizedPath}`;
    return `file:///${normalizedPath}`;
}
