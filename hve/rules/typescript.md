# HVE TypeScript Rules

- Use strict ESM TypeScript without `any`; validate every external value from `unknown`.
- Keep the deterministic core free of runtime package dependencies and side effects.
- Use safe integers or `bigint` intentionally; never allow silent precision loss in persisted data.
- Bound input size and depth, reject unknown fields, and return typed stable errors.
- Use async Node filesystem APIs, same-directory temporary files, flush-before-rename, and explicit path confinement.