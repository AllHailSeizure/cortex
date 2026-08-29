# Cortex Workflows marketplace

This branch is a slim marketplace package for Cortex. It intentionally excludes
the Cortex CLI runtime and contains only marketplace catalogs, plugin manifests, and
workflow-authoring skills.

It works as a **Codex** marketplace and a **Cursor** team marketplace.

## Included plugin

`cortex-workflows` provides the `spec-to-workflow` skill. It turns an implementation
spec into an executable Cortex `.workflow.js` file with deliberate fan-out, per-agent
cones and profiles, model assignment, and orchestrator-owned verification.

The Cortex CLI is a separate prerequisite. Install it from the repository's `master`
branch before running generated workflows.

## Cursor

Import this GitHub repo as a team marketplace and select the `plugin` branch
(Cursor looks for `.cursor-plugin/marketplace.json` at the repo root):

`https://github.com/AllHailSeizure/cortex`

Dashboard → Settings → Plugins → Team Marketplaces → Import.

Then install `cortex-workflows`. Reload Cursor (or start a new agent) so the skill loads.

Local symlink (no marketplace):

```bash
# Windows (PowerShell, as Administrator or with Developer Mode)
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.cursor\plugins\local\cortex-workflows" -Target (Resolve-Path plugins/cortex-workflows)

# macOS / Linux
ln -s "$(pwd)/plugins/cortex-workflows" ~/.cursor/plugins/local/cortex-workflows
```

## Codex

Clone only this branch, register the checkout as a local marketplace, and install the
plugin:

```bash
git clone --branch plugin --single-branch https://github.com/AllHailSeizure/cortex.git cortex-plugin
codex plugin marketplace add ./cortex-plugin
codex plugin add cortex-workflows@cortex
```

Start a new Codex task after installation so the skill is loaded.

## Layout

```text
.agents/plugins/marketplace.json          # Codex catalog
.cursor-plugin/marketplace.json           # Cursor catalog
plugins/cortex-workflows/
  plugin.json                             # Agent Plugin manifest
  .codex-plugin/plugin.json
  .cursor-plugin/plugin.json
  skills/spec-to-workflow/
```
