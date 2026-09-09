# German task creation in Paperclip Klar

Opening **Neuer Auftrag** from Klar now requests the German version of the
existing task dialog. Titles, placeholders, selectors, status and mode labels,
uploads, warnings and submission controls are translated. Other entry points
keep their existing language. User content, entity names, company selection,
API status values and execution policies are unchanged.

The running server uses a newer source release than this fork's default branch.
`docker/klar-ui/german-dialog.patch` records the reviewed UI changes against the
existing release plus Klar. It preserves that release's paused-agent warning,
workspace-path privacy fix, mode label and footer behavior. Replacing the whole
runtime with this fork's default branch would lose those changes.

The packaging recipe applies the patch only after verifying its SHA-256, exact
predecessor tree and seven allowed UI source paths. It then verifies the result
tree. The manifest binds the locale patch and final source tree to the packaging
commit. No server, database, API, dependency, credential or workflow is changed.

Validation includes the existing task-dialog suite and two German interaction
cases: submission preserves the canonical payload, and a failed submission
retains its text with a German retry message. The UI typecheck and build are
required, followed by authenticated mobile visual inspection after deployment.
