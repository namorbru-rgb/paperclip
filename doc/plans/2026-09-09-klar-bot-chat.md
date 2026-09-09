# Paperclip Klar: bot chats and media input

The operator asked for a chat interface inspired by Grok. The entry screen is a ranked bot list: unresolved approvals, running bots, stopped/error bots, then idle bots. A bot opens its conversation; tasks and comments form a time-ordered stream. Replies target the selected task, task details open on demand, and back returns to the bot list. Draft text, files and interrupted upload state are held per bot while this company remains mounted.

## Input and actions

There is one text field. A message becomes a task for the selected bot; replying adds a comment without silently reopening a completed task or interrupting execution. Images can be pasted or dropped; up to ten nonempty files of at most 10 MiB each can be selected. With attachments, an unassigned backlog draft is created first. The task is assigned and made ready only after all files exist. Confirmed partial upload progress is reused, and an uncertain final write is not retried automatically.

Diktieren uses the browser's SpeechRecognition implementation in de-CH; it is not Whisper and needs browser support. Interim text is replaced without duplication and remains editable before sending. A separate voice-note control uses MediaRecorder, chooses a supported audio MIME type and stops after five minutes. Recording requires microphone permission and a secure context. Stream tracks stop on completion, error and unmount. Audio, images and files can be reviewed before sending and viewed in the conversation. No credentials or new speech-provider service are introduced.

The left navigation contains Bot-Chats, Posteingang, Armaturenbrett and Neue Aufgabe. Neue Aufgabe opens the existing German task form without a preselected bot, so operators can use detailed task entry separately from chat. Chat drafts remain in place while the form is open. Inbox and dashboard use the existing company-scoped routes. The mobile menu exposes the same destinations plus Bot hinzufügen and account settings. Bot hinzufügen is kept out of the left navigation.

Enter sends a chat message; Shift+Enter inserts a line break. The mobile keyboard is given the send hint. Composition confirmation and held-key repeat events do not submit. Existing submission locks, assignment guards and upload recovery rules still apply.

## Approvals and access

Unresolved approval cards are placed after the chronologically ordered message stream and stick above the input. New messages therefore appear above pending approvals. A complete attention snapshot includes dismissed items so dismissal does not hide a decision. Stable IDs map decisions to bots; requests with no known bot remain visible above the roster.

A normal approval reveals the complete payload before explicit approve/reject controls. Plans, tool requests, secrets, questions, checkbox selections and audience policies reuse the existing native interaction resolver. Other specialist decisions link to their original full-detail surface. Those advanced surfaces retain the upstream UI and its language. No resolver policy, budget, checkout rule, authentication boundary or server access check is weakened.

The authenticated company boundary remains shared. A company change warns about unsent work and resets company-specific state. Failed loading is visible; no simulated success is shown as actual execution.

## Visual implementation

Klar owns a white chat shell with a compact blue header, dark text and a single composer inspired by the public Grok interface. CSS values live in ui/src/index.css. Existing buttons, textarea, menu and dialogs are reused. Only the exact company /klar route replaces the native shell. The existing onboarding illustration's fixed colors are moved unchanged into CSS variables to satisfy the existing token gates.

The Storybook story Product/Paperclip Klar / BotChats (also retained under GuidedWorkspace for the already-open preview) is an isolated simulator with conspicuous example-data labeling. Its mutation handler never forwards a preview write to production.

## Verification and delivery

Tests cover sorting, company isolation, chronological comments, pinned approval ordering after a new message, explicit reviewed decisions, double submission, reply targeting, stopped agents, expired sessions, partial uploads, uncertain final writes, file-only input and dictation events. Native layout, creation, work overview and route tests remain in the build. Typecheck, token gates, production UI build, Storybook build and package reconstruction must pass.

This is a UI overlay onto pinned runtime release 65ec059bde30d98c92165b24a30a540800dd1f6f. The package independently verifies the original feature layer, German modal layer and this bot-chat layer by exact Git tree, SHA-256 and reviewed path set. The backend, database and authentication implementation are unchanged.

A local browser at iPhone-sized dimensions is not physical iPhone acceptance. Actual microphone permission, speech recognition, authenticated live data and the HTTPS release must be verified after authorized deployment before calling the release complete.
