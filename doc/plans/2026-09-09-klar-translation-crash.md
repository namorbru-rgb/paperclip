# Klar translation crash

Chats open at the newest message after the initial history has loaded. New
messages follow the bottom only while the reader is there. Scrolling up keeps
the current message in place and loads older history at the top. A small arrow
returns to the newest message. Older comment pages stay visible while their
larger page loads. Image and viewport size changes also keep the bottom visible
when the reader follows the conversation.

Klar supplies a separate web app manifest with a stable /klar identity and start
URL, standalone display, German name and existing application icons. The
manifest is emitted as an HTTPS asset, not an inline data URL. iOS install
metadata is active while Klar is open and restores native metadata on exit.
The menu explains Safari's Add to Home Screen action. This does not add offline
caching of private data or change the native app's browser display mode.

Klar now keeps all pending approvals and decisions in a separate view opened
from Menu > Freigaben. Assigned and unassigned requests remain available there.
Chats no longer render pinned approval cards. Returning from the approval list
restores the selected chat and its draft. Review and explicit approval controls
remain in place.

Routine task activity no longer creates toast popups while Klar is open. The
same events still refresh live data. Error notifications and notifications on
other Paperclip routes keep their existing behavior.

A browser-translated bot status can lose the text node React owns. When the
approval query then adds the shield icon before that text, React's insertBefore
fails and the route error boundary replaces the page.

Keep the status label inside a stable span so inserting or removing the icon
uses a React-owned element as its reference. Mark the already localized Klar
shell, standalone page, menu portal and dialog portals with lang=de-CH and
translate=no/notranslate. Native Paperclip routes retain their translation
behavior. No DOM prototypes or error handlers are patched, and unexpected
render errors remain visible.

The regression test replaces the live status text with a translator-style font
element before the query cache adds and removes a pending approval. It fails on
the previous source with NotFoundError and passes with the stable label. The
actual page and task portal are also checked for their language/translation
contract. Browser translators may ignore HTML hints; the structural fix covers
the reproduced approval transition independently of those hints.

Package reconstruction still verifies the exact UI source tree and leaves the
runtime backend unchanged. Standard PR/security checks and the server image
verifier remain required for deployment.
