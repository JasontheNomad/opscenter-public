# Architecture

```
src/lib/server/
  db.ts            SQLite schema + lightweight migrations
  tasks.ts         task CRUD, views, stage map, unseen tracking
  hubspot.ts       HubSpot client (429 backoff), tickets/pipelines/companies/contacts,
                   activity (notes + emails via search), attachments (Files API proxy)
  sync.ts          pull sync: pipelines → stage map, tickets → tasks, incremental ref data,
                   change flags (new / stage / client reply)
  push.ts          drag → HubSpot stage PATCH
  hubspotPoller.ts background sync (90 s) + notifications
  teams/           Microsoft Graph, one concern per module: auth (PKCE), graph, render,
                   messages, prefs, focus, status (SSE + notifications), presence,
                   calendar, poller. Import from the index barrel.
  notes.ts         Markdown notes on disk (vault), soft-delete to .trash
  acs.ts           CTE token exchange for the Calling SDK
  shareFrame.ts    red frame around what's being screen-shared (native helper, shareFrame.jxa)
src/lib/calls/
  engine.svelte.ts  agent, CTE token, single-agent Web Lock, call + lobby state, held calls
  media.ts          video renderers (created and disposed in one place), local preview, mic meter
  window.svelte.ts  the call's own popup window (pre-join + call), mounted from the main page
  join.ts           join a meeting in-app, or hand off to Teams
  pip.ts            draggable self-view
src/routes/
  [[view]]/        board (projects | support | tasks); / = projects
  task/[id]/       redirect to whichever board a task lives on
  clients/         client hub: notes · tickets · contacts · history
  teams/           chats + channels (layout = sidebar, pages = threads)
  calendar/        week view + New / Edit / Cancel meeting
  api/…            JSON endpoints used by the UI
src/hooks.server.ts starts the two pollers; refuses any Host but localhost/127.0.0.1 (plus
                    APP_HOST when set) (DNS rebinding) and any write from a foreign Origin (CSRF;
                    with APP_HOST set, only exactly https://APP_HOST); on loopback 307s
                    127.0.0.1 -> localhost (the Calling SDK needs that spelling)
```

## Data flow

- **HubSpot → app**: server poller runs every 90 s. Tickets owned by you are upserted into `tasks`. HubSpot wins the column, stage and priority only if `hs_lastmodifieddate` changed since last seen; otherwise your local values stick (search lags behind your own edits). Companies/contacts pull incrementally (`lastmodifieddate > last run`).
- **app → HubSpot**: dropping a card in a column PATCHes `hs_pipeline_stage` to the first stage in that ticket's pipeline mapped to the column (`stage_map`, editable at `/settings`). Changing a ticket's priority PATCHes `hs_ticket_priority` before the local write, so a failed push leaves nothing to be overwritten by the next sync. Manual tasks never touch HubSpot.
- **Client Response** = an outgoing email engagement on the ticket (HubSpot logs it; delivery is whatever your portal does with it). **Team notes** = note engagements.
- **Teams**: chats + channels are read on demand and cached; a server poller (5 s base beat, adaptive) keeps the unread state, warms message caches for hot chats, sweeps channels every 60 s, refreshes presence and (optionally) keeps an app-only presence session alive. Notifications go out natively (`osascript`, addressed to the `OpsCenter Alerts` stub app so the banner carries the app icon) *or* via the PWA — never both: the PWA reports whether it holds notification permission, and the native path stands down while it does.
- **Notes**: files under `NOTES_DIR/<client>/*.md`, edited in place with CodeMirror. Companies are linked to folders by name match, with a manual override.

## Notable decisions

- Single SQLite file, WAL mode. No ORM.
- All third-party auth is per-machine in `.env`; nothing is proxied through a server you don't own.
- Graph `search` is used for emails because the read-only email scope blocks `GET`.
- Long-lived caches are in-process; restarting the service clears them.
- Calls run in the main page's JS; the call window is a same-origin popup the page draws into, so closing OpsCenter ends the call. Picture-in-Picture was rejected because Chromium caps it at half the screen.
- Remote HTML (Teams message bodies) is sanitized with DOMPurify in the browser, so `/teams` renders client-side only.
