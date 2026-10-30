---
name: lark-card
description: Review and customize Lark or Feishu card JSON using local previews. Use when changing cards or reviewing their layout.
compatibility: Requires Bun, Playwright Chromium, and prepared CardKit assets. The optional client renderer also requires a compatible Lark installation.
---

# Review Lark cards

Resolve the project root two directories above this skill. Read its README for setup and renderer limits. Run commands from that root.

## Define coverage

For a request to review all cards, list static JSON files and dynamic card-generation entry points in the business project. Enumerate the states and roles each entry point can produce. Generate JSON from real calls or test data. Do not claim full coverage from representative examples.

Record each case and its generation, PC preview, and iOS preview status. Record every uncovered case and its reason. Dynamic state enumeration belongs to the business project, not this tool.

## Review layout

Render each case with the simulator in both layouts.

```sh
bun src/cli.ts render-batch card-a.json card-b.json --renderer simulator --output-dir previews
```

Read `previews/manifest.json` for each result and warning, then inspect both PNGs for every successful case. A fresh output directory is required. Check text clipping, button width, input-to-action distance, wrapping, and visual hierarchy. Side-by-side placement is an option, not a rule. A shared submit button must not appear to apply to only one field.

For key cards and missing or suspicious components, compare the original JSON, the `compile` output, and a client-renderer preview. The client renderer requires a compatible local Lark installation.

```sh
bun src/cli.ts compile card.json > card-vr.json
bun src/cli.ts render card.json --renderer client --platform pc -o card-client-pc.png
bun src/cli.ts render card.json --renderer client --platform ios -o card-client-ios.png
```

Do not change business cards solely because one renderer omits an element. The local client renderer has omitted Markdown link text, and the simulator has omitted a collapsible panel. Neither renderer replaces a real-client or mobile-device check.

## Preserve behavior

When modifying a card, preserve form ownership, control names, button actions and values, links, and role visibility unless the user asks to change them. A preview checks appearance. It does not prove submission, callbacks, or permissions work.

Report PNG paths, renderer, layout, compiler or renderer warnings, and unverified cases. A PNG alone does not prove every component rendered. Use only trusted cards and variables. Do not send a card without the user's approval.
