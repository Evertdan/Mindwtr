# Mindwtr Unreleased

Changes collected after `v1.2.1` and before the next version tag.

## Highlights

- Mobile reminder rescheduling no longer rewrites its stored alarms or queries the system alarm list after every edit, and very large libraries stop re-serializing the whole library for a backup they already know is too big to keep.

## Full Change List

- Desktop: right-clicking one task and then another no longer leaves the first row wearing the highlight ring — dismissing a context menu with the pointer no longer snaps keyboard focus back to the old row. Closing the menu with Escape still returns focus to where you were. (#999)
