# Allow Empty Subtitles in Easy Steps Section

> Exported from Antigravity Storage Manager on 4/8/2026, 10:14:25 AM
> Conversation ID: `d12d7aac-81ba-400b-a42b-da1070c20c0d`

---

## Conversation Messages

*Raw extracted content:*

---

## Artifacts

### implementation_plan.md

# Allow Empty Subtitles in Easy Steps Section

The Easy Steps section (`frd-easy-steps.liquid`) currently forces the subtitle "Certified Safety Zero Liability Risk" on all three steps via two mechanisms:

1. **Liquid `| default:` filter** (lines 5, 7, 9) — when the setting value is blank, Liquid falls back to the hardcoded string.
2. **Schema `"default":` key** (lines 278, 294, 310) — pre-populates the field in the theme editor, so the merchant always sees this text even on a fresh section.

Both must be changed so the subtitle can be left empty.

## Proposed Changes

### Easy Steps Section

#### [MODIFY] [frd-easy-steps.liquid](file:///Users/shawnplep/WebProjects/levelUpTheme/sections/frd-easy-steps.liquid)

**1. Remove Liquid `| default:` fallbacks (lines 5, 7, 9)**

```diff
-  assign step_1_subtitle = section.settings.step_1_subtitle | default: "Certified Safety Zero Liability Risk"
+  assign step_1_subtitle = section.settings.step_1_subtitle
-  assign step_2_subtitle = section.settings.step_2_subtitle | default: "Certified Safety Zero Liability Risk"
+  assign step_2_subtitle = section.settings.step_2_subtitle
-  assign step_3_subtitle = section.settings.step_3_subtitle | default: "Certified Safety Zero Liability Risk"
+  assign step_3_subtitle = section.settings.step_3_subtitle
```

**2. Remove schema `"default":` values (lines 278, 294, 310)**

Remove the `"default": "Certified Safety Zero Liability Risk"` line from each of the three subtitle settings in the `{% schema %}` block. This lets the field start blank in the theme editor.

**3. Remove preset subtitle values (lines 426, 428, 430)**

Remove the `step_*_subtitle` entries from the `"presets"` block so new instances of the section don't get pre-filled subtitles.

> [!NOTE]
> The `{%- if step_*_subtitle != blank -%}` guards on lines 52, 65, 78 already handle blank values correctly — no subtitle `<p>` tag will render if the value is empty.

## Verification Plan

### Manual Verification
Since this is a Shopify theme, verification requires checking the theme editor:

1. Deploy the updated theme to the Shopify dev store
2. Open the **Theme Editor → Homepage → Easy Steps** section
3. Confirm the subtitle fields are **empty by default** (not pre-filled)
4. Confirm that leaving them blank results in **no subtitle text** rendering on the storefront
5. Confirm that typing custom subtitle text renders correctly


### implementation_plan.md.metadata.json

```
{
  "artifactType": "ARTIFACT_TYPE_IMPLEMENTATION_PLAN",
  "summary": "Plan to allow empty subtitles in the Easy Steps section by removing Liquid default fallbacks, schema default values, and preset values in frd-easy-steps.liquid.",
  "updatedAt": "2026-03-26T14:21:29.352601Z"
}
```
