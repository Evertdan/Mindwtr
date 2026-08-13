import { baseTextCollator } from '@mindwtr/core';
export type TokenAutocompletePrefix = '@' | '#';

const TOKEN_PREFIX_PATTERN = /^[@#]+/;

export const stripTokenPrefix = (token: string): string =>
    token.trim().replace(TOKEN_PREFIX_PATTERN, '').trim();

export const normalizeAutocompleteToken = (
    token: string,
    prefix: TokenAutocompletePrefix,
): string => {
    const trimmed = token.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('@') || trimmed.startsWith('#')) {
        return trimmed.startsWith(prefix) ? trimmed : '';
    }
    const label = stripTokenPrefix(trimmed);
    return label ? `${prefix}${label}` : '';
};

export const normalizeAutocompleteTokens = (
    tokens: readonly string[],
    prefix: TokenAutocompletePrefix,
): string[] => Array.from(
    new Set(
        tokens
            .map((token) => normalizeAutocompleteToken(token, prefix))
            .filter(Boolean)
    )
);

export const compareAutocompleteLabels = (left: string, right: string, query: string): number => {
    const normalizedQuery = query.trim().toLowerCase();
    const leftLabel = left.toLowerCase();
    const rightLabel = right.toLowerCase();
    const leftStartsWithQuery = normalizedQuery.length === 0 || leftLabel.startsWith(normalizedQuery);
    const rightStartsWithQuery = normalizedQuery.length === 0 || rightLabel.startsWith(normalizedQuery);

    if (leftStartsWithQuery !== rightStartsWithQuery) {
        return leftStartsWithQuery ? -1 : 1;
    }
    return baseTextCollator.compare(left, right);
};

export const matchesAutocompleteQuery = (label: string, query: string): boolean => {
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery.length === 0 || label.toLowerCase().includes(normalizedQuery);
};

export const rankAutocompleteTokens = (
    tokens: readonly string[],
    prefix: TokenAutocompletePrefix,
    query: string,
    limit = 8,
): string[] => normalizeAutocompleteTokens(tokens, prefix)
    .filter((token) => matchesAutocompleteQuery(stripTokenPrefix(token), query))
    .sort((left, right) => compareAutocompleteLabels(
        stripTokenPrefix(left),
        stripTokenPrefix(right),
        query,
    ))
    .slice(0, limit);
