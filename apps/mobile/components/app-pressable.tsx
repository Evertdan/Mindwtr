import React, { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type GestureResponderEvent, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';
import { useThemeTokens } from '../hooks/use-theme-tokens';

type AppPressableProps = PressableProps & {
    /** Overlay color while pressed; defaults to a theme-aware dim layer. Useful
     *  on saturated backgrounds (e.g. swipe action buttons) that need a fixed
     *  darkening regardless of theme. */
    pressedColor?: string;
};

// último gana borderRadius lookup so the superposición presionada hugs esquinas redondeadas.
const findBorderRadius = (style: StyleProp<ViewStyle>): number | undefined => {
    if (!style || typeof style !== 'object') return undefined;
    if (Array.isArray(style)) {
        for (let index = style.length - 1; index >= 0; index -= 1) {
            const radius = findBorderRadius(style[index] as StyleProp<ViewStyle>);
            if (radius !== undefined) return radius;
        }
        return undefined;
    }
    const radius = (style as ViewStyle).borderRadius;
    return typeof radius === 'number' ? radius : undefined;
};

/**
 * The app's standard `Pressable`: every theme gets visible press feedback
 * (#818). Material 3 on Android keeps its ripple; everywhere else a pressed
 * overlay dims the control. The overlay is a separate layer instead of a
 * background swap so controls layered above other colors (task rows over
 * swipe actions) never flash what's underneath while pressed.
 */
export function AppPressable({ style, children, pressedColor, onPressIn, onPressOut, ...rest }: AppPressableProps) {
    const { isMaterial, state, isDark } = useThemeTokens();
    const [pressed, setPressed] = useState(false);
    const hasRipple = isMaterial && Boolean(state.rippleColor);
    // android_ripple is inert off Android, so the overlay covers those cases.
    const rippleHandlesFeedback = hasRipple && Platform.OS === 'android';
    const overlayColor = pressedColor
        ?? (isMaterial
            ? state.stateLayerColor('pressed')
            : isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.08)');
    const overlayRadius = typeof style === 'function' ? undefined : findBorderRadius(style as StyleProp<ViewStyle>);

    const handlePressIn = useCallback((event: GestureResponderEvent) => {
        setPressed(true);
        onPressIn?.(event);
    }, [onPressIn]);
    const handlePressOut = useCallback((event: GestureResponderEvent) => {
        setPressed(false);
        onPressOut?.(event);
    }, [onPressOut]);

    return (
        <Pressable
            android_ripple={hasRipple ? { color: state.rippleColor } : undefined}
            style={style}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            {...rest}
        >
            {/* The cast keeps this portable across react-native versions whose
                PressableStateCallbackType gained/lost optional members. */}
            {typeof children === 'function' ? children({ pressed } as PressableStateCallbackType) : children}
            {!rippleHandlesFeedback && pressed ? (
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFillObject,
                        { backgroundColor: overlayColor, borderRadius: overlayRadius },
                    ]}
                />
            ) : null}
        </Pressable>
    );
}
