---
name: clawrec-rendering-generative-interface
description: Publishes already-selected ClawRec recommendation display data into a local generative interface session. Use when upstream retrieval has provided sections, topics, card titles, sources, external links, summaries, and optional local asset paths that must be rendered as a structural HTML fragment with copied assets, displayed-card manifest, and existing runtime click logging.
---

# Rendering Generative Interface

## Purpose

Publish already-selected recommendation display data into the ClawRec local aggregate interface.

This Skill renders the supplied data, copies supplied local assets, and rewrites asset paths for the interface server. It does not select, rank, retrieve, summarize, or infer recommendations.

## Scope

Use this Skill when the input already contains:

- one or more display sections;
- each section's category label and topic heading;
- one or more cards per section;
- each card's title, source name, external link, and summary;
- optional local image asset paths for cards;
- explicit session information only when an upstream orchestrator requires session reuse.

If required display data is absent or empty, stop at the rendering boundary and report the missing fields. Do not invent titles, sources, links, summaries, images, sections, cards, or placeholder content.

## Session Workflow

Run commands from the project root.

1. Start a new interface session unless explicit session information was provided:

   ```bash
   skills/clawrec-rendering-generative-interface/scripts/start-server.sh --project-dir .
   ```

2. Parse the JSON startup record. Use:

   - `url` as the page URL;
   - `screen_dir` as the directory for the HTML fragment;
   - `state_dir` as the directory where click events are recorded;
   - `session_id` from the startup context. In the current runtime, this is the directory name immediately above `content` in `screen_dir`.

3. If an upstream orchestrator explicitly provides `screen_dir`, `state_dir`, and `url`, publish to that session. Do not choose a target by scanning historical session directories.
4. Create `screen_dir/assets` if needed.
5. Validate all required input fields before writing the fragment.
6. Copy supplied local assets into `screen_dir/assets`.
7. Write `state_dir/displayed-cards.json` for the cards rendered in this session.
8. Write one new `.html` fragment into `screen_dir`.
9. Return the page URL, fragment path, displayed-card manifest path, copied asset count, and event path.

## Input Validation

Required section fields:

- `label`: category or grouping label;
- `topic`: section heading;
- `cards`: non-empty card list.

Required card fields:

- `title`;
- `source`;
- `href`: absolute outbound link;
- `summary`.

Optional card fields:

- `card_id`;
- `asset_path`: local image file to show for that card.

Validation rules:

- Reject duplicate `card_id` values within the fragment.
- When `card_id` is absent, generate a deterministic rendering id using section and card position, such as `card-s01-c03`.
- Use the generated id only for rendering and click attribution; do not treat it as upstream evidence.
- If `asset_path` is present, verify it exists and is a regular file before writing the fragment.
- For card thumbnails, emit `<img>` only for supplied local image assets. Do not create placeholder images.
- If a supplied asset is not renderable by the current card image contract, stop and report the unsupported asset type. Do not convert it.

## Asset Handling

For each supplied `asset_path`:

1. Copy the file bytes unchanged into:

   ```text
   <screen_dir>/assets/
   ```

2. Name the copied file with the rendering id and original extension, for example:

   ```text
   card-s01-c03.png
   ```

3. Reference the copied asset in HTML only through:

   ```text
   /files/assets/<copied-file-name>
   ```

Do not expose absolute local paths in the fragment. Do not re-encode, crop, screenshot, compress, resize, or replace assets unless the user explicitly asks for asset transformation.

## Displayed-Card Manifest

Before writing the fragment, write a displayed-card manifest to:

```text
<state_dir>/displayed-cards.json
```

Use the same section/card shape as rendering input, but with final rendering `card_id` values filled in for every card:

```json
{
  "schema_version": "displayed_cards_v1",
  "session_id": "<session_id>",
  "sections": [
    {
      "label": "Right now",
      "topic": "Build right now",
      "cards": [
        {
          "card_id": "card-s01-c01",
          "title": "Card title",
          "source": "Source name",
          "href": "https://example.org/detail",
          "summary": "Display summary"
        }
      ]
    }
  ]
}
```

The manifest is the feedback collector's displayed-card source. It must match the actual `data-card-id` values used in the fragment. Do not include copied asset paths, absolute local paths, evidence notes, task ids, or ranking rationale in this manifest.

## Fragment Contract

Write an embeddable HTML fragment only. Do not include:

- `<!doctype>`;
- `<html>`, `<head>`, or `<body>`;
- inline `<style>`;
- inline or external `<script>`;
- custom click tracking code.

Use only structural markup and these supported class names:

- `split`
- `section`
- `cards`
- `card`
- `card-image`
- `card-body`
- `label`

Use this section structure:

```html
<section class="section">
  <p class="label">Category</p>
  <h2>Topic</h2>
  <div class="cards">
    <!-- cards -->
  </div>
</section>
```

When grouping multiple sections in a two-column layout, wrap only sections with `split`:

```html
<div class="split">
  <section class="section">...</section>
  <section class="section">...</section>
</div>
```

## Card Contract

Outbound cards that should participate in click logging must be anchors with `class="card"`, `href`, `target`, `rel`, `data-card-id`, and `data-source`.

Use this shape when an image asset is supplied:

```html
<a
  class="card"
  href="https://example.org/item"
  target="_blank"
  rel="noopener noreferrer"
  data-card-id="card-s01-c01"
  data-source="Example Source"
>
  <div class="card-image">
    <img src="/files/assets/card-s01-c01.png" alt="Card title">
  </div>
  <div class="card-body">
    <p class="label">Example Source</p>
    <h3>Card title</h3>
    <p>Card summary.</p>
  </div>
</a>
```

When no image asset is supplied, omit the `card-image` block and keep the same anchor and `card-body` structure.

Text and attribute rules:

- Escape all text and attribute values for HTML.
- Preserve upstream titles, sources, links, summaries, labels, and topics without rewriting their meaning.
- Set card body `.label` exactly to the upstream source name.
- Set `data-source` exactly to the upstream source name.
- Set image `alt` to the upstream card title.
- Keep outbound links unchanged except for HTML attribute escaping.

The existing `helper.js` records clicks on `a.card[href]` and derives topic, source, title text, `cardId`, and outbound link. Do not modify `helper.js`, `server.cjs`, or `frame-template.html` to make a fragment work.

## Output Contract

Write the fragment to a new file in:

```text
.clawrec/clawrec-generative-interface/<session_id>/content/
```

Use a filename that is unique for the publication, for example:

```text
recommendations-YYYYMMDD-HHMMSS.html
```

Place copied assets in:

```text
.clawrec/clawrec-generative-interface/<session_id>/content/assets/
```

The interface server reads the newest `.html` file in `content/`. Click events for compatible cards are written by the runtime to:

```text
.clawrec/clawrec-generative-interface/<session_id>/state/events
```

Displayed card metadata for explicit feedback collection is written to:

```text
.clawrec/clawrec-generative-interface/<session_id>/state/displayed-cards.json
```

This output is a display publication artifact. It is not a retrieval source, user state, recommendation rationale, search audit log, or long-term memory.

## Boundaries

Do not:

- collect user behavior;
- generate or update user state;
- create search plans;
- access external platforms;
- choose, rank, or replace recommendation results;
- fabricate missing display fields or filler cards;
- add new page shell markup, styles, scripts, or click logging behavior;
- modify shared server, template, or browser helper scripts;
- expose local absolute paths in HTML;
- save render output as user memory, retrieval evidence, or search audit data;
- infer a session target from old session directories.

## Verification

After publishing, verify:

```bash
test -s "$html_file"
test -d "$screen_dir/assets"
```

Then inspect the fragment and confirm:

- it contains only fragment markup, not a full HTML document;
- it uses only supported class names;
- every section has a label, heading, and non-empty cards container;
- every card has required click-logging attributes;
- `displayed-cards.json` exists and contains the same final `card_id` values as the fragment;
- every supplied asset was copied unchanged into `assets/`;
- every asset reference starts with `/files/assets/`;
- no local absolute path or `file://` URL appears in the fragment;
- no shared runtime file was changed.
