---
name: diagrams
description: Use when a doc in this repo needs a picture. Covers authoring or reviewing a Mermaid diagram in docs/features/<slug>/ (RESEARCH.md, SPEC.md), docs/DECISIONS/, ARCHITECTURE.md or anything under docs/, and diagramming a subsystem such as the four build targets, the login flow, the assistant session lifecycle, the frontend layers, or the request path through shared/api into apps/api. Drives the whole loop: decide whether a diagram earns its place at all (often a table is better), pick the type, draw it from the code rather than from memory, then check the source against the code and preview the rendering before committing. Valid Mermaid is routinely unreadable Mermaid. Reach for this when the user says "add a diagram", "visualize this", "draw the architecture", "diagram the flow", or when writing-spikes, writing-specs, implement, or software-architecture calls for a visual. Covers Mermaid in repo markdown, not image files and not Figma.
---

# Diagrams

A diagram in this repo is a Mermaid block inside a markdown file. GitHub renders it. There is no build step, no image file, and nothing that can drift away from the doc it lives in.

This skill is the **method** for producing a diagram someone can actually read. It exists because of one failure a syntax check cannot catch:

> **Valid Mermaid is routinely unreadable Mermaid.** A diagram that parses on the first try can still lay out as one unreadable row, clip its own labels, or bury the point under crossing edges. The only way to know is to look at it rendered.

**Scope:** deciding whether to draw, picking the type, drawing it from verified code, and checking that it reads. It does not own the surrounding document. The artifact's own skill does that (`writing-spikes`, `writing-specs`).

**State of the repo today (2026-09-19):** `docs/` and `ARCHITECTURE.md` contain **zero** Mermaid blocks. There is no prior art here and no exemplar to copy. The first diagram written under this skill becomes the exemplar, so get it right. Re-check rather than trusting this line:

```bash
grep -rh '```mermaid' docs/ ARCHITECTURE.md | wc -l
```

`ARCHITECTURE.md`, `CLAUDE.md` and `AGENTS.md` carry ASCII box drawings of the layer direction and the target list. Those ASCII versions are authoritative. A Mermaid version must agree with them or one of the two is wrong.

## The process

### 1. Decide whether a diagram earns its place

A diagram is worth it when the thing has **shape**: a topology, an ordering, a lifecycle, a dependency graph, a decision surface. Otherwise use prose or a table.

Do not draw when:

- **It is a matrix.** N rows by M attributes is a markdown table. Tables sort, diff, and stay readable at 30 rows. A diagram of the same data does none of that. The target table in `AGENTS.md` is the right shape already.
- **It is a list.** Four steps with no branching is four bullets.
- **It restates the paragraph above it.** A diagram must carry information the prose does not, or it is decoration that will rot.
- **You cannot verify it.** An architecture diagram drawn from memory is a guess in a nice font. See step 3.

The strongest pairing is usually a table **and** one diagram over the same content. The table answers "what about X?", the diagram answers "what is going on here?".

#### Two jobs: navigational and illustrative

An **illustrative** diagram explains the section it sits in, to a reader who is already reading that section. A flowchart of the current pipeline under "Findings", an `erDiagram` under a spec's data model. Draw one when the section has shape, skip it when it does not.

A **navigational** diagram carries the document's conclusion to a reader who has not read it, and sits near the top. The main one is the **decision diagram** on a research doc (`docs/features/<slug>/RESEARCH.md`). It answers three things: what was chosen, what the choice depends on, and what happens if a dependency fails. A research doc whose recommendation can only be recovered by reading the whole file has not finished its job.

Skip the decision diagram when the recommendation has no contingency, no fallback, and no ordering constraint. At that point it would restate one sentence, and the sentence is the better artifact. Say so in one line instead of drawing decoration.

The two jobs do not substitute for each other. A decision diagram is not an architecture diagram with the pick coloured in.

### 2. Pick the type

| Type              | Use when                                                       | Watch out for                                                                  |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `flowchart`       | topology, data flow, layers, tier gates, dependency graphs     | fan-in and fan-out spaghetti, `direction` inside subgraphs (see recipes)       |
| `sequenceDiagram` | ordering across participants (page, query hook, api client, backend, provider) | more than about 6 participants stops fitting on a screen                       |
| `stateDiagram-v2` | lifecycles (an OTP challenge, an assistant session, a recording) | do not use it for control flow, that is a flowchart                            |
| `erDiagram`       | table relationships and cardinality                            | column lists get long fast, show keys and relationships, not every field       |
| `quadrantChart`   | ranking candidates on two axes (value vs effort, risk vs reach) | labels clip past x of about 0.8, points collide with quadrant titles near y 0.44 to 0.53 |
| `timeline`        | phases or rollout stages                                       | not a Gantt, no dependencies and no durations                                  |

For copy-pasteable skeletons of each, read `references/mermaid-recipes.md`.

### 3. Draw from the code, not from memory

This is what separates a diagram that survives review from one that gets a "this is not how it works" comment.

Before drawing any diagram of an existing subsystem:

1. **Open the real modules.** Grep for the entry points and read them. `references/repo-vocabulary.md` lists where each subsystem lives: the four targets, the frontend layers, the API client, auth and sessions, the assistant session, the theme system, and the backend services.
2. **Cite what you drew.** Put `file.ts:line` or `file.py:line` in the node label or in the prose under the diagram, at least for the load-bearing boxes. A reader who doubts a box should be one click from checking it.
3. **Use the repo's vocabulary.** `references/repo-vocabulary.md` fixes the canonical names and shapes: target names as the build uses them, layer names as `ARCHITECTURE.md` uses them, service names as `apps/api` uses them. Diagrams of different subsystems then compose into one picture instead of three artists' impressions.
4. **Mark what does not exist yet.** In a research doc or a spec, proposed nodes must look different from shipped ones. Use a dashed stroke through `classDef` and say so in the caption. A reader must never have to guess which half is real.

### 4. Draw it

Keep it honest and keep it small.

- **One diagram, one claim.** If you cannot say in one sentence what the reader should take away, split it or drop it.
- **Prefer a subgraph-level edge to N node-level edges.** Four nodes pointing at the same target draws four crossing lines. One edge from the enclosing subgraph says the same thing and reads.
- **Label the edges that carry meaning.** The condition, the trigger, the guarantee (`X-Client-Platform: native`, `403 account_disabled`, `parsed by userSchema`). An unlabelled arrow in an architecture diagram is a missed opportunity.
- **Theme-safe styling.** Readers see these in GitHub light **and** dark mode. Theme text is dark in light mode and light in dark mode, so a pale `classDef` fill with no `color` renders light on light and disappears. Always set `color:#000` next to the fill. Never let the default theme carry meaning.
- **Quote labels that contain punctuation.** `A["thing (detail)"]`. Unquoted parentheses and slashes break the parser.
- **Keep diagrams in English, and node ids ASCII.** The product ships in English and Persian, and `docs/` is written in English. A Mermaid label can hold Persian text and it renders, but Mermaid does not lay a graph out right to left, and mixing Persian labels with English code names reads badly. Node ids like `MOBILE` must stay ASCII in every case.

#### Give the flows IDs once the prose argues about them

A node already has a name, and that name is how a reviewer cites it. An **edge has no name**, so a comment about one becomes "the arrow from router.py to sessions.py, the lower one".

Number the edges instead, in reading order, and put the ID **in the visible label**: `-->|"DF01 · X-Client-Platform: native"|`. A Mermaid node id like `PG` is invisible in the rendered picture, so nobody looking at the image can cite it. Use two digits, not three.

Number when the diagram has **more than about five edges**, or as soon as the prose under it points at a specific one. Below that it is ceremony. IDs are stable inside one document and mean nothing across documents. Unlike a spec's `REQ-001`, they are a local citation handle, not an identifier.

#### Past about 15 nodes, ship a summary and a detail diagram

A diagram with more than about **15 nodes**, or more than about **four subgraphs**, has stopped being one claim. Splitting beats shrinking the font: a **summary** that carries the shape, and a **detail** version for whoever needs it.

Never collapse: the subject of the diagram, any node marked proposed, anything sitting on an authorization or trust boundary, or either end of a load-bearing `==>` edge. Those are the boxes the reader came for.

Do collapse: siblings at one layer that share a relationship, supporting infrastructure, and leaf nodes nothing depends on.

A collapsed node must **list what it contains** in its own label, for example `SHELL["app shell<br/>providers · store · queryClient · router"]`, and the pair needs a mapping table, or the summary is a lie by omission:

| Summary node | Collapses | Detail flows |
| ------------ | --------- | ------------ |

Prefix summary flow IDs with `S` (`SDF01`) so the two diagrams' IDs never collide. Skeleton in `references/mermaid-recipes.md`.

### 5. Verify: check the source, then look at it rendered

**Never commit a Mermaid block you have not looked at rendered.**

There is **no render script in this repo**. Nothing under `scripts/` renders Mermaid, and no CI job checks a diagram. So verification is two passes, and the first one is the one that catches wrong diagrams.

**Pass 1: read the source against the code.** This is a correctness check, not a layout check, and no tool does it for you.

- Every box maps to a file, function, table, component or endpoint you actually opened in step 3.
- Every edge label states something the code does. A header name matches `src/auth/router.py`. A route path matches the target's `router.tsx`. An error code matches `docs/API.md`.
- Every proposed node is dashed and every shipped node is not.
- Nothing that exists in the code path is silently missing, unless the caption says the diagram is partial.

**Pass 2: look at it rendered.** Pick whichever of these fits the machine you are on.

**a) Paste the block into https://mermaid.live.** Nothing to install, it renders as you type. Best for one block while you are still editing it.

**b) Render to PNG with mermaid-cli.** Needs Node, which this repo already uses. It can reuse the Chromium that Playwright installed for the e2e tests, so nothing extra is downloaded except mermaid-cli itself:

```bash
export PUPPETEER_EXECUTABLE_PATH="$HOME/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
npx -y @mermaid-js/mermaid-cli@11 -i docs/features/<slug>/RESEARCH.md -o "$TMPDIR/diag/out.png" -w 1400
```

It writes one file per Mermaid block, named `out-1.png`, `out-2.png` and so on, next to the output path. Then **Read each PNG**. The Chromium version number changes when Playwright updates, so run `ls ~/Library/Caches/ms-playwright/` and use the newest `chromium-*` directory if that path misses. Without the env var, mermaid-cli tries to download its own browser (a few hundred MB). mermaid-cli is a throwaway tool: never add it to a `package.json` here.

**c) Push the branch and open the file on GitHub.** GitHub is the real renderer, so this is the only check that shows exactly what the reader will see.

Then check:

- Is it laid out as intended, or did it collapse into one row or one column?
- Is any label clipped, overlapping another label, or sitting on a title?
- Can you follow every edge to its target without tracing with a finger?
- Does the takeaway from step 4 jump out, or is it buried?

Fix and re-check until it reads. Recurring failures and their fixes are in `references/mermaid-recipes.md`. Check there first, most layout problems are one of seven causes.

> **Not built (a suggestion, not a fact).** A `scripts/render-diagrams` wrapper around mermaid-cli, plus an advisory CI job that renders changed markdown, would turn pass 2 into one command. Nothing like it exists today, and `.github/workflows/ci.yml` has no such job. It is only worth building once `docs/` holds enough diagrams to pay for it. Do not write a skill, a doc or a runbook that talks about it as if it ships.

### 6. Place it in the document

- Put it directly **under the prose it illustrates**, never in a gallery at the end.
- Give it a one-line caption saying what to notice, and spell out any encoding (dashed means proposed, colour means category). Never make the reader reverse-engineer the legend.
- Watch the width. The reader is in a narrow column on GitHub. A `flowchart LR` deeper than about 5 ranks forces sideways scrolling. Prefer `TB` when the graph is deep.

## Per-artifact defaults

What the other skills should ask for. Every row is a default, not a quota. A doc with nothing shaped to show ships zero diagrams.

| Artifact                                           | Section                          | Default diagram                                                                     |
| -------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| **Research** (`docs/features/<slug>/RESEARCH.md`)  | Recommendation                   | `flowchart TB` of the pick, what it depends on, and where each failed gate lands    |
|                                                    | What the codebase already does   | `flowchart` of the current system, proposed nodes dashed                            |
|                                                    | Options                          | `quadrantChart` when ranking more than about five candidates on two axes            |
| **Spec** (`docs/features/<slug>/SPEC.md`)          | 4. User and system flow          | `flowchart` of the change surface, or `sequenceDiagram` across 3+ participants      |
|                                                    | 5. Behaviour                     | `stateDiagram-v2` when an entity gains a lifecycle                                  |
|                                                    | 7. Data model                    | `erDiagram` when the spec adds or reshapes tables                                   |
| **ADR** (`docs/DECISIONS/NNNN-*.md`)               | usually none                     | the entries are short prose. Draw only when the alternatives have real shape         |
| **Architecture** (`ARCHITECTURE.md`)               | layers, targets, boundaries      | layered `flowchart` plus one `sequenceDiagram` for the primary path                 |
| **API** (`docs/API.md`)                            | usually none                     | endpoint tables beat diagrams. A `sequenceDiagram` only for a multi-step flow like login |

## The quality bar

A diagram is doing its job when it shows shape that prose could not, a reader can name its single takeaway without help, a research doc's decision diagram lets a reader name the recommendation **and** the risk it carries without reading the document under it, every box maps to something that exists in the codebase (or is visibly marked as proposed), the load-bearing boxes are traceable to `file:line`, it uses the repo's vocabulary so it composes with other diagrams, it reads in both GitHub themes, and **it was checked against the code and looked at rendered before it was committed**.

The failure this skill exists to prevent is a diagram that parses, ships, and turns out to be unreadable or wrong. Both are worse than no diagram, because both are believed.

## References

- `references/mermaid-recipes.md`: skeletons per artifact type, plus the catalogue of recurring layout failures and their fixes. Read at step 2 and step 5.
- `references/repo-vocabulary.md`: canonical node names, shapes, and the `file:line` starting points for each subsystem. Read at step 3.
- `ARCHITECTURE.md`: the current architecture. Read it before drawing anything structural so your diagram does not contradict it.
- `CLAUDE.md` and `AGENTS.md`: the ASCII layer direction and target list are authoritative. A Mermaid version must agree with them.
