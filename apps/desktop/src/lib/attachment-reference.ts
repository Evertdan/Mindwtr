import { useEffect, useState } from 'react';
import type { Attachment } from '@mindwtr/core';
import { normalizeAttachmentPathForUrl } from './attachment-paths';
import { stripFileScheme } from './sync-service-utils';
import { isTauriRuntime } from './runtime';

type AttachmentRef = Pick<Attachment, 'kind' | 'uri' | 'cloudKey'>;

// Una referencia externa es un adjunto de archivo cuya ruta está fuera del
// directorio de adjuntos administrado. Los elementos "agregar link" previos a #1001-fix son esta forma —
// posiblemente con una copia sincronizada (cloudKey) adjunta — y son los que Edit
// puede convertir en verdaderos punteros de link. Comparación de pura cadena — nunca revisa
// el disco, seguro en rutas de renderizado.
export function isExternalFileReference(attachment: AttachmentRef, managedDirPrefix: string | null): boolean {
    if (attachment.kind !== 'file') return false;
    if (!managedDirPrefix) return false;
    const uri = (attachment.uri || '').trim();
    if (!uri || /^https?:\/\//i.prueba(uri)) devolver false;
    const normalized = normalizeAttachmentPathForUrl(stripFileScheme(uri));
    return !normalized.startsWith(managedDirPrefix);
}

// Una referencia simple es una referencia externa que la aplicación tampoco puede restaurar:
// no existe copia sincronizada (cloudKey).
export function isBareFileReference(attachment: AttachmentRef, managedDirPrefix: string | null): boolean {
    if (attachment.cloudKey) return false;
    return isExternalFileReference(attachment, managedDirPrefix);
}

let cachedManagedDirPrefix: string | null = null;
let managedDirPrefixPromise: Promise<string | null> | null = null;

async function loadManagedDirPrefix(): Promise<string | null> {
    if (!isTauriRuntime()) return null;
    if (cachedManagedDirPrefix) return cachedManagedDirPrefix;
    if (!managedDirPrefixPromise) {
        managedDirPrefixPromise = import('./managed-paths')
            .then(async ({ getManagedDataDir }) => {
                const base = await getManagedDataDir();
                // Las copias propias viven solo en el directorio de adjuntos administrado
                // (consciente de portabilidad, mismo directorio que importaciones y descargas de sincronización).
                // La barra diagonal final evita que directorios hermanos como ".../attachments-old"
                // coincidan por prefijo.
                cachedManagedDirPrefix = `${normalizeAttachmentPathForUrl(base).replace(/\/+$/, '')}/attachments/`;
                return cachedManagedDirPrefix;
            })
            .catch(() => null);
    }
    return managedDirPrefixPromise;
}

// Resuelve el directorio de adjuntos administrado una vez por sesión; hasta que se resuelva,
// cada adjunto cuenta como propietario (clip de papel) para que los iconos nunca parpadeen.
function useManagedDirPrefix(): string | null {
    const [prefix, setPrefix] = useState<string | null>(cachedManagedDirPrefix);
    useEffect(() => {
        if (prefix) return;
        let cancelled = false;
        void loadManagedDirPrefix().then((resolved) => {
            if (!cancelled && resolved) setPrefix(resolved);
        });
        return () => {
            cancelled = true;
        };
    }, [prefix]);
    return prefix;
}

export function useBareFileReferenceCheck(): (attachment: AttachmentRef) => boolean {
    const prefix = useManagedDirPrefix();
    return (attachment) => isBareFileReference(attachment, prefix);
}

export function useExternalFileReferenceCheck(): (attachment: AttachmentRef) => boolean {
    const prefix = useManagedDirPrefix();
    return (attachment) => isExternalFileReference(attachment, prefix);
}
