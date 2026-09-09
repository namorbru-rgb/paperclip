# Klar UI overlay for a newer runtime

The Klar change in PR #3 starts from an older release than the deployed server.
Deploying its complete image would revert server changes. Build only the UI
against the exact newer release, then extend the existing runtime image.

`docker/klar-ui/source.json` pins the release, feature base, feature commit and
the eight reviewed paths. The preparation script requires a clean source tree,
rejects a different path list, and stops on patch conflicts. It never changes
the runtime server source. No credentials are used in the build.

Build with `docker/klar-ui/Dockerfile`, an existing immutable `RUNTIME_IMAGE`,
and the exact packaging Git SHA as `PAPERCLIP_UI_BUILD_COMMIT`. The build runs
source-guard tests, a frozen pnpm installation, the UI production build,
TypeScript and the two Klar test suites. The final stage checks the server's
release commit and overlays only `/app/ui/dist`. It inherits the server,
entrypoint, tools and environment from the existing image. Old hashed UI assets
remain available to tabs opened before deployment.

Before switching the application, build and inspect the child image separately.
Record the old image ID, compose configuration and a fresh backup. Keep the
existing absolute data mount, networks, authentication and environment.
Recreate only the existing application service with the new immutable image.
Rollback uses the previous image with the same data and configuration; this
UI-only release has no database migration.

After deployment, compare `paperclip-ui-build.json` with the approved packaging,
feature and release commits. Verify its `indexSha256` against the served HTML.
The build fetches the claimed packaging commit and requires every packaging
file to match that commit byte for byte. The manifest also records each file's
SHA-256 digest; a supplied revision alone is not accepted as proof.
The server health commit must remain the existing runtime commit; a UI release
must not mislabel it. Then test the company-prefixed Klar page with a real board
session, live tasks, filters, search, pagination, refresh, expired sessions,
company boundaries and a phone viewport. A successful build alone is not live
acceptance.
