# Contributing

Thanks for taking a look at this project.

## Local Setup

```bash
npm install
npm run typecheck
npm run build
```

## Development Notes

- Keep the core server code storage-provider agnostic.
- Keep Supabase-specific code inside `src/adapters/`.
- Keep React-specific code out of the root export. Use `src/client.ts` for client exports.
- Do not add real credentials, bucket names, account IDs, or project URLs.
- Update the README when behavior or setup changes.

## Before Opening A PR

Run:

```bash
npm run typecheck
npm run build
```

If you change public APIs, add a short note to `CHANGELOG.md`.
