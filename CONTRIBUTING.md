# Contributing to Overlap

Thanks for helping make group scheduling simpler and more private.

## Before opening a pull request

1. Open an issue for substantial product or architecture changes.
2. Keep calendar permissions limited to free/busy or read-only availability.
3. Do not add email, contacts, or event-content collection.
4. Add or update tests for behavior changes.
5. Run `npm test`, `npm run lint`, and `npm run build`.

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

The default configuration uses demo busy blocks, so contributors do not need provider credentials. Never commit `.env`, OAuth secrets, refresh tokens, exported calendar data, or live group credentials.

## Pull requests

Keep changes focused, explain the user-facing behavior, and call out any privacy or migration implications. Screenshots are useful for visual changes.
