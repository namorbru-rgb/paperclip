# syntax=docker/dockerfile:1
ARG RUNTIME_IMAGE
FROM node:24.15.0-bookworm-slim AS ui-build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* && corepack enable
COPY docker/klar-ui/ /package/
RUN node --test /package/prepare.test.mjs
RUN node /package/prepare.mjs prepare /build/source
WORKDIR /build/source
ENV CI=true NODE_OPTIONS=--max-old-space-size=4096
RUN corepack pnpm@9.15.4 install --filter '@paperclipai/ui...' --filter '@paperclipai/plugin-sdk...' --frozen-lockfile --ignore-scripts
RUN corepack pnpm@9.15.4 -r --filter '@paperclipai/ui...' build
RUN node scripts/check-token-gates.mjs && cd ui && node node_modules/typescript/bin/tsc -b --pretty false \
    && node ../node_modules/vitest/vitest.mjs run src/pages/PaperclipKlar.test.tsx src/components/KlarComposer.test.tsx src/components/KlarBotChat.test.tsx src/components/KlarNewTask.test.tsx src/components/useKlarVoice.test.tsx src/lib/klar-chat.test.ts src/components/Layout.test.tsx src/components/NewIssueDialog.test.tsx src/components/WorkOverview.test.tsx src/lib/company-routes.test.ts --pool=threads --maxWorkers=1
ARG PAPERCLIP_UI_BUILD_COMMIT
RUN node /package/prepare.mjs stamp /build/source "$PAPERCLIP_UI_BUILD_COMMIT"

# The existing runtime provides the server, tools, entrypoint and configuration.
# Only the UI is overlaid. Keep old hashed assets for already-open browser tabs.
FROM ${RUNTIME_IMAGE} AS production
RUN test "$PAPERCLIP_BUILD_COMMIT" = "65ec059bde30d98c92165b24a30a540800dd1f6f" \
    && test -s /app/ui/dist/index.html
COPY --chown=node:node --from=ui-build /build/source/ui/dist/ /app/ui/dist/
ARG PAPERCLIP_UI_BUILD_COMMIT
LABEL org.opencontainers.image.ui-revision=$PAPERCLIP_UI_BUILD_COMMIT
