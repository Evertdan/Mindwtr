# Mindwtr Unreleased

Changes collected after `v1.2.1` and before the next version tag.

## Highlights

- Mobile reminder rescheduling no longer rewrites its stored alarms or queries the system alarm list after every edit, and very large libraries stop re-serializing the whole library for a backup they already know is too big to keep.

## Full Change List

- Large libraries: editing, completing, or adding a task now redraws lists noticeably faster. Sorting a list and rebuilding the counts behind it were re-reading the same dates thousands of times per keystroke-sized change; both now read each date once. (#766)
- Desktop: right-clicking one task and then another no longer leaves the first row wearing the highlight ring — dismissing a context menu with the pointer no longer snaps keyboard focus back to the old row. Closing the menu with Escape still returns focus to where you were. (#999)
- Desktop: the sync backend state file in your profile folder is now called `sync-backend-state.json`. It tracks whichever sync backend you picked, not just Dropbox, so the old Dropbox-specific name was misleading; existing profiles are renamed automatically on the next launch. (#1007)
- Desktop: a date field now shows a warning outline while the typed text isn't a date it can read. Nonsense never saved — it quietly reverted when you left the field — but nothing said so while you typed. (#1050)
- Desktop: file attachments that point outside the app's managed folder now show an Edit button in the task editor, so a link added before the pointer fix can actually be re-saved into a true pointer — previously the promised Edit affordance only appeared on attachments already typed as links. Converting one also drops the leftover synced-copy bookkeeping. (#1001)
- Desktop: machines without a usable keyring no longer show a "Failed to check Dropbox connection status" banner when Dropbox was never set up — the status check now answers "not connected" instead of erroring when no Dropbox credentials were ever stored. A real Dropbox setup with an unreachable keyring still reports the error. (#1043)
- Desktop: tasks in the calendar's "Plan next actions" panel can now be dragged straight onto a day, matching the Schedule button and the drag support task lists already had. (#493)
- Desktop: File-backend sync no longer fails with "Failed to acquire an exclusive sync lock … Function not implemented" on filesystems that don't support OS file locks. Sync proceeds without the lock there — the pre-1.2 behavior — and logs a warning instead. (#1036)
- Windows: the app log now records the exact browser-argument set WebView2 was launched with, including anything merged in from your own `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` value, so network-behavior reports can be checked against what actually applied. (#913)
- Recurring tasks: a monthly or yearly task whose start and due fall on different days no longer has its start pulled onto the due date's day-of-month. Completing "starts the 14th, due the 15th" now creates "starts September 14, due September 15" instead of a copy starting August 15 — a leftover from recurrences saved before start and due tracked their anchor days separately. Desktop, mobile, and the local automation API.
