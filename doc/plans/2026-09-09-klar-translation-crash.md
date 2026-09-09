# Klar translation crash

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
