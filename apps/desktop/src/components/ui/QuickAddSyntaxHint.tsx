import type { ReactNode } from 'react';

// Splits the translated quick-agregar help line so entry tokens (/start:, @contexto,
// #tag, +Project, %Person, !Area) read as typable input mientras <placeholder>
// parts recede. Parses whatever la locale string contains, por lo que untranslated
// syntax tokens style consistently in cada language y unmatched text
// renders plain (#869).
const HINT_SEGMENT = /((?:<[^>]+>)|(?:%"[^"]*")|(?:[/@#+%!][^\s,()<.]+))/g;

export function QuickAddSyntaxHint({ text }: { text: string }) {
    const parts = text.split(HINT_SEGMENT);
    return (
        <>
            {parts.map((part, index): ReactNode => {
                if (!part) return null;
                if (part.startsWith('<') && part.endsWith('>')) {
                    return <span key={index} className="opacity-70">{part}</span>;
                }
                if (/^[/@#+%!]/.test(part)) {
                    return <span key={index} className="font-medium text-foreground/80">{part}</span>;
                }
                return part;
            })}
        </>
    );
}
