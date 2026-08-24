import type { ThemeStatusPreset } from '@mindwtr/core';

// Un ajuste preestablecido por tema con una identidad de color personalizada (lista de núcleo), más
// 'default' for the themes that just use plain light/dark colors.
export type ThemePresetName = 'default' | ThemeStatusPreset;
export type ThemePresetColor = `#${string}`;

export type ThemePresetColors = {
    bg: ThemePresetColor;
    cardBg: ThemePresetColor;
    taskItemBg: ThemePresetColor;
    text: ThemePresetColor;
    secondaryText: ThemePresetColor;
    border: ThemePresetColor;
    tint: ThemePresetColor;
    onTint: ThemePresetColor;
    inputBg: ThemePresetColor;
    danger: ThemePresetColor;
    success: ThemePresetColor;
    warning: ThemePresetColor;
    filterBg: ThemePresetColor;
    icon: ThemePresetColor;
    tabIconDefault: ThemePresetColor;
    tabIconSelected: ThemePresetColor;
};

export const THEME_PRESETS: Record<Exclude<ThemePresetName, 'default'>, ThemePresetColors> = {
    eink: {
        bg: '#FFFFFF',
        cardBg: '#FFFFFF',
        taskItemBg: '#FFFFFF',
        text: '#000000',
        secondaryText: '#000000',
        border: '#000000',
        tint: '#000000',
        onTint: '#FFFFFF',
        inputBg: '#FFFFFF',
        danger: '#000000',
        success: '#000000',
        warning: '#000000',
        filterBg: '#FFFFFF',
        icon: '#000000',
        tabIconDefault: '#000000',
        tabIconSelected: '#000000',
    },
    nord: {
        bg: '#2E3440',
        cardBg: '#3B4252',
        taskItemBg: '#3B4252',
        text: '#ECEFF4',
        secondaryText: '#D8DEE9',
        border: '#4C566A',
        tint: '#88C0D0',
        onTint: '#2E3440',
        inputBg: '#434C5E',
        danger: '#BF616A',
        success: '#A3BE8C',
        warning: '#EBCB8B',
        filterBg: '#434C5E',
        icon: '#D8DEE9',
        tabIconDefault: '#D8DEE9',
        tabIconSelected: '#88C0D0',
    },
    // Las superficies suben la base propia del sabor -> surface0 -> surface1 -> surface2
    // ladder; mauve is Macchiato's default accent.
    'catppuccin-macchiato': {
        bg: '#24273A',
        cardBg: '#363A4F',
        taskItemBg: '#363A4F',
        text: '#CAD3F5',
        secondaryText: '#A5ADCB',
        border: '#5B6078',
        tint: '#C6A0F6',
        onTint: '#24273A',
        inputBg: '#494D64',
        danger: '#ED8796',
        success: '#A6DA95',
        warning: '#EED49F',
        filterBg: '#494D64',
        icon: '#A5ADCB',
        tabIconDefault: '#A5ADCB',
        tabIconSelected: '#C6A0F6',
    },
    // background / bgLight / bgLighter / selection from the reference Dracula
    // theme. secondaryText is `comment` blended halfway to `foreground`:
    // comment itself is 3:1 on the background, which is fine for the code
    // comments it was drawn for but not for due dates and project names.
    dracula: {
        bg: '#282A36',
        cardBg: '#343746',
        taskItemBg: '#343746',
        text: '#F8F8F2',
        secondaryText: '#ADB5CB',
        border: '#44475A',
        tint: '#BD93F9',
        onTint: '#282A36',
        inputBg: '#424450',
        danger: '#FF5555',
        success: '#50FA7B',
        warning: '#FFB86C',
        filterBg: '#424450',
        icon: '#ADB5CB',
        tabIconDefault: '#ADB5CB',
        tabIconSelected: '#BD93F9',
    },
    sepia: {
        bg: '#F4ECD8',
        cardBg: '#FAF3E3',
        taskItemBg: '#FAF3E3',
        text: '#3B2F2F',
        secondaryText: '#7A5C3E',
        border: '#E2D3B5',
        tint: '#956735',
        onTint: '#FFF6E7',
        inputBg: '#F0E3C8',
        danger: '#B44B3B',
        success: '#5F7D4A',
        warning: '#B5813C',
        filterBg: '#EFE2C7',
        icon: '#7A5C3E',
        tabIconDefault: '#7A5C3E',
        tabIconSelected: '#956735',
    },
    oled: {
        bg: '#000000',
        cardBg: '#000000',
        taskItemBg: '#000000',
        text: '#E5E7EB',
        secondaryText: '#9CA3AF',
        border: '#1F2937',
        tint: '#4F9DFF',
        onTint: '#000000',
        inputBg: '#0B0B0B',
        danger: '#F87171',
        success: '#34D399',
        warning: '#FBBF24',
        filterBg: '#0B0B0B',
        icon: '#9CA3AF',
        tabIconDefault: '#6B7280',
        tabIconSelected: '#4F9DFF',
    },
};
