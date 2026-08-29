# Cortex Workflows for Codex

This branch is a slim Codex marketplace package for Cortex. It intentionally excludes
the Cortex CLI runtime and contains only the marketplace catalog, plugin manifest, and
workflow-authoring skills.

## Included plugin

`cortex-workflows` provides the `spec-to-workflow` skill. It turns an implementation
spec into an executable Cortex `.workflow.js` file with deliberate fan-out, per-agent
cones and profiles, model assignment, and orchestrator-owned verification.

The Cortex CLI is a separate prerequisite. Install it from the repository's `master`
branch before running generated workflows.

## Install from a local checkout

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
.agents/plugins/marketplace.json
plugins/cortex-workflows/
  .codex-plugin/plugin.json
  skills/spec-to-workflow/
```
