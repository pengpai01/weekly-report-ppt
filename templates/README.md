# Official week-summary sample

Canonical packaging/reference deck:

```
templates/week-summary-template.pptx
```

**Deprecated (do not add new references):** `templates/week-summary-software-20260911.pptx` — local deploys may still keep a copy for对照; prefer `week-summary-template.pptx`.

Runtime PPTX export is generated in the browser by `src/lib/exportPptx.ts` and does **not** require this binary at runtime, but client layout should align with the canonical template above.

Do not bake machine-local paths into application code.
