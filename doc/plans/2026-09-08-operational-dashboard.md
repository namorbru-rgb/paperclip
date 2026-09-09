# Paperclip Klar: connected operator overview

## Scope

Add the company-scoped `/klar` board route and a sidebar entry. The established dashboard remains available. The new page uses the existing session-aware API client and company selection; no snapshots, API keys, copied company data, new backend endpoints or permissions are introduced.

## Behavior

- Company totals come from the authorized dashboard endpoint, independently of the paginated task list. Pending approvals are labelled as approvals, not task reviews.
- Tasks are fetched using the compact API, server-side status/search filtering, routine inclusion and offset pagination. Identical task IDs across shifting pages are deduplicated; offset pagination is a changing view, not a transactional export.
- Exact routine origin, title, status and assignee matches may be bundled within loaded pages. Every individual task remains linked, and bundling can be disabled.
- Team status uses the agent endpoint; ready/idle is not a failure. Human assignees use the existing company directory with an explicit fallback.
- Automatic foreground refresh every 30 seconds; independent manual refresh and data timestamps. Failed reads are explicit and never reported as successful empty results. Summary/team failures suppress stale success data.
- Company changes remount the scoped page and use distinct query keys. Existing board route guards and API authorization remain authoritative.
- Task details, comments, results, approvals, skill management and creation use existing Paperclip pages/dialogs and their original audit/approval paths.

## Validation and release

Run UI typecheck, WorkOverview component tests, token gates and UI production build. Before release, verify native `/COMPANY/klar` with a signed-in user, a forbidden company, an expired session, changing data and a mobile viewport. Full repository and deployment verification remain separate gates. This route needs the normal Paperclip UI/server release; an HTML snapshot or GitHub branch does not make it live.
