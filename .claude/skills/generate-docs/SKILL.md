---
name: generate-docs
description: "Generate documentation for a part of the system, derived from the code, in DOCS_DIR/. Usage: /generate-docs <area name>"
user_invocable: true
model: sonnet
---

# Generate Documentation

Generate a new documentation file in `docs/` for the given area of the system,
**derived from the code** — not written from memory or from a spec.

If no area name is given, ask the user which part of the system to document.

> **Fill in before first use** (one-time, search-and-replace):
> - `docs` — where your docs live (e.g. `docs` or `docs/domain`)
> - `src, functions` — the folders/globs your code lives in
>
> Language is **English**. The structure below is proven; only the specifics are yours.

## Step 0 — Don't regenerate by accident

If `docs/<area>.md` already exists, stop and point the user to `/update-docs`. Only overwrite
if they explicitly ask for it.

## Step 1 — Discover the sources

Use an `Explore` subagent for the broad search — you want the conclusion (which files belong to this
area), not every file's contents in your main context. Search in `src, functions` for:

- **Models / domain types** — classes, interfaces, records, enums, value types
- **Schemas / data definitions** — JSON Schema, SQL DDL, ORM models, OpenAPI, …
- **Services / handlers / business rules** — where validation and behaviour live
- **Configuration / entry points** — APIs, jobs, processes, message handlers

Report which files you found and **ask the user to confirm the scope** before continuing.

> Tip: name the doc after the folder/module the code lives in, so the Stop hook can match a changed
> file to its doc by that shared name and the auto-update "just works".

## Step 2 — Read the code and extract the facts

From the source files, pull out only what the code actually says:

- **Per entity/type:** every field with type, required/optional, a short description, relationships,
  and validation rules
- **Per enum:** every value and what it means
- **Storage / shape:** how the pieces relate (nested vs. referenced by id)
- **Behaviour:** the key rules and flow
- **Deprecation / drift:** deprecated fields, or fields in the schema but not the code (or vice-versa)

Document the **data model + behaviour**; keep the UI / serialization layer to a brief mention in
"Related code".

## Step 3 — Write the document

Read one existing file in `docs/` first as a style reference (if any exist). Then write
`docs/<area>.md` in **English**, using this skeleton:

```markdown
# Data Dictionary — <Area name>

## Context
<2–3 sentences: what this area is, what it's used for, who relies on it>

---

## 1. <Main entity>
<short description>

**Source:** `<relative/path>`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| …     | …    | …        | …           |

**Validation:**
- …

---

## 2. <Next entity>
…

---

## Enums & status codes

### <EnumName>
| Value | Code | Meaning |
|-------|------|---------|
| …     | …    | …       |

---

## How it fits together
<a Mermaid `erDiagram` (relations) or `flowchart TD` (steps) — never ASCII art>

---

## Related code

### Models
- `<path>`

### Services / rules
- `<path>`
```

### The most important section: "Related code"

End **every** document with the exact source files it was derived from. This is **not optional and
not decoration — it is the contract.** `/update-docs` reads it back to find which document a code
change affects. Fill in every relevant path.

## Step 4 — Update the index

Add the new doc to `docs/README.md` (the index). Create it with a short intro and a list of
docs if it doesn't exist yet.

## Step 5 — Generate the HTML companion

Stakeholders read the HTML version, not the Markdown — so every `docs/<area>.md` gets a twin
at `docs/html/<area>.html`. The shared design lives in `docs/html/assets/`
(`styles.css`, `app.js` — copy them in once from the kit's `html-assets/`); those handle styling,
the table-of-contents, scrollspy, copy buttons and Mermaid — **you only write the content.**

Create `docs/html/<area>.html` from this exact shell, translating the Markdown body into it:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><Area> — Data Dictionary</title>
  <link rel="stylesheet" href="assets/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="index.html">📚 Documentation</a>
    <span class="crumb"><Area></span>
    <a class="md-link" href="../<area>.md">View Markdown</a>
  </header>
  <div class="layout">
    <main class="content">
      <p class="kicker">Data Dictionary</p>
      <h1><Area></h1>
      <p class="lede"><context paragraph></p>
      <!-- one <section> per "## N. …" heading; see the mapping below -->
    </main>
    <aside class="toc"><p class="toc-title">On this page</p><nav></nav></aside>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js" integrity="sha384-WmdflGW9aGfoBdHc4rRyWzYuAjEmDwMdGdiPNacbwfGKxBW/SO6guzuQ76qjnSlr" crossorigin="anonymous"></script>
  <script src="assets/app.js"></script>
</body>
</html>
```

Markdown → HTML mapping:

| Markdown | HTML |
|----------|------|
| `## N. Entity` | `<section><h2>N. Entity</h2> … </section>` (no `id` — `app.js` adds them) |
| a table | `<div class="table-wrap"><table>…</table></div>` |
| `Yes` in a **Required** column | `<span class="badge req">Yes</span>` |
| `No` in a **Required** column | `<span class="badge opt">No</span>` |
| ` ```mermaid … ``` ` | `<pre class="mermaid">…</pre>` (keep the exact mermaid source) |
| `` `inline code` `` | `<code>inline code</code>` |
| `[text](./other.md)` | `<a href="other.html">text</a>` |
| `> note` | `<blockquote><p>note</p></blockquote>` |

Do **not** write a table-of-contents or sidebar — `app.js` builds the TOC from your `<h2>`/`<h3>`.
Keep the two script tags exactly as above so the Mermaid integrity hash stays valid.

Then add a card for the new doc to `docs/html/index.html` inside `<div class="cards" id="cards">`:

```html
<a class="card" href="<area>.html"><h3><Area></h3><p><one-line summary></p></a>
```

## Guidelines

- **Derive only from the code** — never invent a plausible-sounding description.
- **Diagrams: Mermaid only, never ASCII** (`flowchart TD` for steps, `erDiagram` for relations).
- Use **relative paths** in "Related code"; no line numbers or fast-aging detail.
- Match the style of the existing docs (read one first).
- Write in **English**.
