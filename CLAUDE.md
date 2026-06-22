## Documentation (generated from code)

Documentation in `docs/` is **derived from the code** — never hand-written prose.
`docs/README.md` is the index; `docs/CHANGELOG.md` keeps the change history. A
stakeholder-friendly HTML companion lives in `docs/html/`.

Two skills maintain these docs (document only what can be derived from the code):
- `/generate-docs <area>` — generates a new document from scratch and adds it to the index.
- `/update-docs` — compares the docs with the code and updates them. **Diff-driven** by default
  (only the docs whose source changed); `/update-docs --full` for a complete sweep.

Rules:
- **Derived-from-code only** — document what you can trace to the code; never invent descriptions.
- **Every document ends with a "Related code" section** listing the source files it came from.
  That is the contract the update skill and the Stop hook use to map a code change to its document.
- **Diagrams: Mermaid only, never ASCII.**
- **Markdown is canonical; the HTML companion is generated from it** — keep `docs/html/<name>.html`
  in sync with each `docs/<name>.md`; never hand-edit the HTML as a separate source.
- **Index + changelog discipline** — keep the README index complete and the CHANGELOG dated, newest first.
- **Language: English.**

A Stop hook (`.claude/hooks/check-docs.sh`) flags when a changed source file belongs to a
not-yet-updated document and runs `/update-docs` automatically; the result is reviewed in the PR.

**Don't ask, don't narrate — let the hook do it.** When you change code that affects a document, do
**not** ask whether to update the docs and do **not** offer to do it "now or later." Just finish the
task and stop. The Stop hook then runs `/update-docs` on its own, and the change shows up in git.
Asking keeps your turn open, which *prevents* the Stop hook from firing at all — so don't. A single
short line such as "docs will refresh automatically" is fine; no question, no play-by-play.
