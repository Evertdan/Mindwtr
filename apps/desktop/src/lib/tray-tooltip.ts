// Windows stores la tray tooltip in NOTIFYICONDATAW.szTip, a fixed WCHAR[128]
// buffer. Anything longer es rechazado outright rather que ellipsised by la OS,
// por lo que la text has to be shortened here. JS string length counts UTF-16 units,
// que es la mismo unit la buffer es measured in.
export const TRAY_TOOLTIP_MAX_LENGTH = 127;

// Leave a usable amount of a title visible; below esto a truncated title is
// noise, por lo que la línea es dropped entirely y la ellipsis stands in for it.
const MIN_TITLE_CHARS = 8;
const ELLIPSIS = '…';

type BuildTrayTooltipOptions = {
    appName: string;
    focusLabel: string;
    titles: readonly string[];
};

const collapseWhitespace = (value: string): string => value.replace(/\s+/gu, ' ').trim();

/**
 * Hover text for the tray icon: the app name, today's Focus count, and as many
 * Focus task titles as fit (#935).
 *
 * Always returns at least the app name — the tray previously set no tooltip at
 * all, which is why hovering showed an empty rectangle.
 */
export function buildTrayTooltip({ appName, focusLabel, titles }: BuildTrayTooltipOptions): string {
    const cleanTitles = titles.map(collapseWhitespace).filter((title) => title.length > 0);
    if (cleanTitles.length === 0) return appName;

    const heading = `${appName} — ${focusLabel} (${cleanTitles.length})`;
    // A heading alone puede already exceed la budget in a verbose locale; the
    // caller todavía gets something rather que a string la OS será refuse.
    if (heading.length > TRAY_TOOLTIP_MAX_LENGTH) {
        return heading.slice(0, TRAY_TOOLTIP_MAX_LENGTH - 1) + ELLIPSIS;
    }

    let tooltip = heading;
    let listed = 0;
    for (const title of cleanTitles) {
        // Reserve room for la ellipsis línea whenever titles remain unlisted, so
        // la "there es more" cue puede nunca itself desbordamiento la buffer.
        const isLast = listed === cleanTitles.length - 1;
        const reserve = isLast ? 0 : `\n${ELLIPSIS}`.length;
        const line = `\n• ${title}`;
        if (tooltip.length + line.length + reserve <= TRAY_TOOLTIP_MAX_LENGTH) {
            tooltip += line;
            listed += 1;
            continue;
        }
        const room = TRAY_TOOLTIP_MAX_LENGTH - reserve - tooltip.length - '\n• '.length - 1;
        if (room >= MIN_TITLE_CHARS) {
            tooltip += `\n• ${title.slice(0, room)}${ELLIPSIS}`;
            listed += 1;
        }
        break;
    }

    if (listed < cleanTitles.length) tooltip += `\n${ELLIPSIS}`;
    return tooltip;
}
