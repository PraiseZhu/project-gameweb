---
name: auto-one_page
description: Run the fixed one-page Gameweb workflow from a Figma page link. Start with the scope confirmation card, stop on source or scope ambiguity, and only continue to the ready handoff after explicit confirmation.
---

# auto-one_page

Use this Skill when the user invokes the fixed one-page workflow with the trigger word auto-onepage or explicitly asks to run the one-page standard workflow.

This Skill owns the fixed A–H chain:

A scope contract → B design extraction and complete handoff pack → C single-language complete page (static, interaction, responsive, motion, compression) → D first complete review → E multi-language complete page (static, interaction, responsive, motion, compression) → F second complete review → G final package consistency review → H frozen delivery.

Do not jump directly to B, C, or a review stage. A must pass first.

## A. Scope confirmation

A confirms only three user-facing inputs:

1. designSource: one Figma page link. The page itself is the task source; page-level design sets are identified later by B using the naming rules and page structure. Do not ask the user to select individual frames.
2. languages: the actual language set for this delivery. A language count without the language identities is insufficient to generate language pages.
3. platformScope: pc, mobile, or pc+mobile.

Do not ask A users to list modules, data fields, interaction targets, animation objects, or page structure. Those facts come from the design page, naming rules, and the complete handoff pack in B.

### Scope card

When triggered, show a compact scope confirmation card with:

- Figma page URL input;
- language multi-select or language tags;
- platform single-select: PC, mobile, or PC + mobile;
- an explicit 确认范围 action.

Values inferred from the user message may be prefilled, but remain unconfirmed until the user submits the card. After validation, show a summary and require an explicit confirmation before writing a versioned scope contract and entering B.

The scope contract records at least:

- designSource;
- languages;
- platformScope;
- newTask: true;
- a scope version and confirmation timestamp.

Every design page starts a new task. Do not model this as resume or continuation in A.

### A stop conditions

Stop in A or at the B source-qualification boundary and report the concrete issue when any of these occurs:

1. The Figma page link is invalid, unavailable, or lacks access.
2. The confirmed language set or platform scope conflicts with what the page actually provides.
3. The page changes after scope confirmation and before extraction.
4. The page is accessible but is not a naming-compliant ready source, including an unnamed or draft source.
5. The page contains multiple design sets that cannot be uniquely identified from naming and structure.
6. The user changes the design source, language set, or platform scope after confirmation.

For all six cases: do not guess, auto-shrink scope, mark the missing work n_a, pick the first candidate, revive the unnamed flow, or continue with the old scope contract. Create a new scope version or stop for the missing decision as appropriate.

### A pass condition

A passes only when the page source is accessible and source-qualified, the actual language set is explicit, the platform scope is explicit, the scope summary has been shown, and the user has explicitly confirmed it. Only then may B extract the ready inventory and the rest of the handoff pack.

A does not change the HTML v1 standard, choose the generation method, select tools, or define the B handoff schema. Those decisions remain in later module discussions.

## Record keeping

Record the scope decision, unresolved boundary questions, user confirmation, and any stop reason in the one-page discussion ledger. Keep the existing source standard, the scope contract, and later handoff artifacts versioned separately.

## Fixed-chain boundary

This Skill preserves the legacy Gameweb sequence. The scope card is the first gate inside A; it is not a new production stage outside the fixed chain. QA material, inventory, handoff records, screenshots, and diff artifacts remain outside the final product package.


## Reuse-first premise

auto-one_page must inspect existing Gameweb／ews Skills, templates, scripts, checks, and reusable page capabilities before designing new implementations for any module A–H.

- Reuse existing capability when it already satisfies the HTML v1 standard.
- Adapt and extend existing capability when it is close and the difference is explicit.
- Record source, version, reused parts, and differences in the module evidence.
- If no usable capability exists, continue with the independent one-page design; missing developer Skill is not a workflow blocker.
- Do not silently weaken HTML v1 to match an existing implementation.
- Do not silently overwrite a Skill or project owned by another project or maintainer; use an adapter, copied working unit, or the agreed handoff path and record the boundary.

This premise applies to every module, not only B0.
