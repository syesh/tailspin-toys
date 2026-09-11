---
description: 'Shared documentation, comments, and TypeScript coding standards'
applyTo: '**/*.{ts,astro,js,mjs,css}'
---

# Coding Standards

## Comments and documentation

- Comment intent, constraints, and non-obvious decisions — not mechanics that are already clear from the code.
- Do not add comments that merely paraphrase the next line or describe routine control flow.
- Treat stale comments as bugs: update or remove them whenever the related code changes.
- Use TSDoc/JSDoc for every exported function in `db/` and `src/lib/`. Explain the function's purpose, each parameter (including injectable `db` arguments), and the return value. Keep the documentation next to the declaration.
- Reusable `.astro` components must define a `Props` interface in frontmatter and document the component contract when a prop's purpose or constraints are not obvious from its name and type. Keep the interface aligned with the rendered API.

## TypeScript

- Use explicit parameter and return types for exported functions, especially in `db/` and `src/lib/`.
- Prefer `interface` for object-shaped public contracts such as Astro component props, and use type aliases for unions and composed types.
- Use semicolons in TypeScript, keep quote style consistent within a file, and use `import type` for type-only imports.
- Avoid `any`, unexplained type assertions, and non-null assertions. Narrow values with guards or types instead.
- Keep formatting consistent with the surrounding file. ESLint enforces explicit module-boundary types for the data layer; run it through the `quality-checks` skill.

## Review checklist

Before submitting a change, verify that exported APIs and reusable component props are documented, comments explain decisions rather than syntax, and documentation still matches the implementation.
