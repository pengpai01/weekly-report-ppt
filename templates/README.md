# Official week-summary sample

Deployments may place the software weekly sample deck here:

```
templates/week-summary-software-20260911.pptx
```

This file is a packaging/reference artifact for the 丹娜生物 software week-summary layout (cover, TOC, part dividers, one project per page, issues/N/A, next-week table, closing). Runtime PPTX export is generated in the browser by `src/lib/exportPptx.ts` and does **not** read this binary.

Do not bake machine-local paths into application code.
