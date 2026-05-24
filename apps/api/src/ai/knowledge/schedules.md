# Schedules

A **schedule** controls *when* playlists or content items play on devices. Schedules contain one or more **time slots** with optional recurrence.

## Where to find schedules
Workspace sidebar → **Schedules**. URL: `/workspaces/:workspaceId/schedule`.

## Creating a schedule
1. Click **+ New Schedule**.
2. Provide a **name**, optional **description**, and a **timezone** (IANA format, e.g. `Europe/London`).
3. Optionally set a **default playlist** — played when no slot matches.
4. Click **Create** — this opens the Schedule Editor.

## Adding time slots
In the Schedule Editor, click **+ Add Slot**:
- **Start time** and **end time** (HH:MM).
- **Recurrence**: `once`, `daily`, `weekly`, `bi-weekly`, or `monthly`.
- **Days of week** (weekly/bi-weekly): pick Mon–Sun.
- **Day of month** (monthly): 1–31.
- **Date** (once): specific calendar date.
- Optional **start date** and **end date** to limit the recurring window.
- Assign a **playlist**, **content item**, **sync group**, or **sync playlist** to play during the slot.
- **Priority** (higher wins when slots overlap) and **color/label** for the calendar view.

The editor warns about overlapping slots and refuses to save if a conflict isn't resolved by priority.

The current dashboard commonly exposes **weekly** and **one-time** slot creation. For a daily pattern, choose weekly and select every day.

## Schedule types
- `general` — normal weekly programming.
- `override` — temporarily replaces the general schedule (holidays, promotions).

## Publishing
A schedule is only active once published to a device:
1. Open **Devices** → choose a device.
2. Set **Published Schedule** to your schedule.
3. The player picks it up on its next sync.

## Common patterns
- "Play X every weekday morning 9–10am" → weekly recurrence, Mon-Fri, 09:00–10:00.
- "Lunch menu 11:30–14:00 every day" → daily recurrence, 11:30–14:00.
- "Christmas override" → an `override` schedule with recurrence `once` and a specific date range.
