/**
 * Shared GTD Contexto Constants
 * 
 * Contexts are categorized into:
 * - Location contexts (@): Where you need to be
 * - Energy contexts (#): What mental state you need
 */

// Location-based contexts (traditional GTD)
export const LOCATION_CONTEXTS = [
    '@home',
    '@work',
    '@errands',
    '@agendas',
    '@computer',
    '@phone',
    '@anywhere',
] as const;

// Energy/mental mode contexts (based on Reddit r/gtd community feedback)
export const ENERGY_CONTEXTS = [
    '#focused',     // Deep work requiring concentration
    '#lowenergy',   // Simple tasks for tired moments
    '#creative',    // Brainstorming, ideation 
    '#routine',     // Repetitive/mechanical tasks
] as const;

// Combined preset contexts for selection UI
export const PRESET_CONTEXTS = [
    ...LOCATION_CONTEXTS,
    ...ENERGY_CONTEXTS,
] as const;

// Type definitions
export type LocationContext = typeof LOCATION_CONTEXTS[number];
export type EnergyContext = typeof ENERGY_CONTEXTS[number];
export type PresetContext = typeof PRESET_CONTEXTS[number];

// Tags presets
export const PRESET_TAGS = [
    '#creative',
    '#focused',
    '#lowenergy',
    '#routine',
] as const;

export type PresetTag = typeof PRESET_TAGS[number];
