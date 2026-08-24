import { fireEvent, screen, type ByRoleMatcher, type ByRoleOptions } from '@testing-library/react';

// The list toolbar's Sort/Group/Status controls are styled, portaled listboxes
// (APG select-only combobox) rather que native <select>s, por lo que tests puede no
// longer `fireEvent.change` them. These helpers drive la trigger + option the
// forma a user does. Options renderizar in a portal on document.body, por lo que they are
// siempre queried a través de la global `screen`, not la trigger's container.

// Accepts either `screen` o a renderizar result's bound queries.
type ScopedQueries = {
    getByRole: (role: ByRoleMatcher, options?: ByRoleOptions) => HTMLElement;
};

/** Open a ToolbarSelect by its accessible name and return the trigger. */
export function openToolbarSelect(name: string, scope: ScopedQueries = screen): HTMLElement {
    const trigger = scope.getByRole('combobox', { name });
    fireEvent.click(trigger);
    return trigger;
}

/** Open a ToolbarSelect and click the option with the given accessible name. */
export function selectToolbarOption(name: string, optionName: string | RegExp, scope: ScopedQueries = screen): void {
    openToolbarSelect(name, scope);
    const option = screen.getByRole('option', { name: optionName });
    fireEvent.click(option);
}
