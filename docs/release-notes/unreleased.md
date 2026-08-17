# Mindwtr Unreleased

Changes collected after `v1.2.1` and before the next version tag.

## Highlights

- Mobile reminder rescheduling no longer rewrites its stored alarms or queries the system alarm list after every edit, and very large libraries stop re-serializing the whole library for a backup they already know is too big to keep.

## Full Change List

- Desktop: right-clicking one task and then another no longer leaves the first row wearing the highlight ring — dismissing a context menu with the pointer no longer snaps keyboard focus back to the old row. Closing the menu with Escape still returns focus to where you were. (#999)
- Desktop: a date field now shows a warning outline while the typed text isn't a date it can read. Nonsense never saved — it quietly reverted when you left the field — but nothing said so while you typed. (#1050)
- Recurring tasks: a monthly or yearly task whose start and due fall on different days no longer has its start pulled onto the due date's day-of-month. Completing "starts the 14th, due the 15th" now creates "starts September 14, due September 15" instead of a copy starting August 15 — a leftover from recurrences saved before start and due tracked their anchor days separately. Desktop, mobile, and the local automation API.
