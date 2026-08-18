# Overlap

Find the time everyone shares.

Overlap is a privacy-first group availability portal for Google Calendar and Microsoft Outlook. Create a password-protected group, invite people with one link, connect calendars, and find shared openings from 30 minutes to 5 hours across the next 30, 60, 90, or 180 days.

![Overlap social preview](public/og.png)

**Live app:** [overlapfinder.com](https://overlapfinder.com)

## What it does

- Creates private groups without global app accounts
- Uses a group name, password, and one-time email code for members
- Gives the creator a separate recovery key and settings access
- Lets the creator attach emails to unverified participants and send calendar-connection reminders
- Connects Google Calendar and Microsoft Outlook with read-only calendar scopes
- Supports direct, self-service OAuth for Google Calendar and Microsoft Outlook
- Optionally supports an admin-provisioned [MarimerLLC/calendar-mcp](https://github.com/MarimerLLC/calendar-mcp) HTTP server
- Shows only the shared free times; event titles and descriptions are never stored
- Keeps showing results from connected calendars while naming participants whose availability is not yet included
- Calculates 30-minute through 5-hour openings across six months

## Product flow

1. A creator chooses a globally unique group name, password, display name, and verifies their email.
2. Overlap returns a one-time creator recovery key.
3. Members open the shared link, enter the group password, and verify their email with a six-digit code.
4. Each person privately authorizes Google, Microsoft, or an administrator-provisioned Calendar MCP account. One participant can connect both Google and Microsoft calendars.
5. The availability board intersects busy blocks and shows the times everyone shares.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Group creation and joining require Resend plus a verified sender. Real calendar connections require at least one OAuth provider. The UI reports missing configuration instead of substituting fake identity or calendar data.

Generated demo calendars are available only for intentional UI testing:

```dotenv
ENABLE_DEMO_CALENDARS=true
```

Do not enable demo calendars on a shared deployment.

Useful commands:

```bash
npm test
npm run lint
npm run build
npm run db:generate
```

## Email identity and profile recovery

Email verification prevents someone who only has a shared link and password from viewing group availability. Within a group, the normalized verified email is unique. Returning with the same email reopens the existing participant and preserves their calendar connections instead of creating a duplicate person.

Overlap uses Resend for transactional verification codes. Each self-hosted deployment supplies its own sending key and verified sender; credentials are never committed to the repository:

```dotenv
RESEND_API_KEY=
EMAIL_FROM="Overlap <verify@YOUR_HOST>"
```

Codes expire after ten minutes, are stored only as hashes, are single-use, allow at most five atomic attempts, and are rate-limited per purpose and email address, requester IP, and deployment. Existing deployments can let legacy participants verify the profile they already use, including on the original deployment URL, before reopening it on a custom domain.

Creators can add an email to a participant who has not verified one yet. This reserves that existing participant profile for the address, so joining and verifying it reopens the same calendar connections instead of creating a duplicate. A creator cannot replace a verified participant’s address. Calendar reminder emails contain the group link but never the group password, are limited per participant, group, and deployment, and stop once that participant has connected a calendar.

## How calendar connections work in an open-source deployment

The repository contains the application code, not reusable Google or Microsoft credentials. Every person or organization hosting Overlap creates one Google OAuth client and one Microsoft Entra application for its deployment, then stores those credentials as deployment secrets. Group creators and participants do not create their own OAuth applications.

The same deployment can serve people with personal accounts and people in different organizations. Configure Google as an external web application and Microsoft as a multitenant application that accepts organizational and personal Microsoft accounts. Each participant still signs in to their own provider and grants access only to their own calendar; the deployment does not receive blanket access to an organization.

When a participant clicks a provider button:

1. Overlap redirects them to Google or Microsoft.
2. The provider shows the calendar-only permission request.
3. The provider sends an authorization code back to that Overlap deployment.
4. Overlap encrypts the returned refresh token before storing it.
5. The connection dialog marks that provider as connected for that participant.
6. Availability checks request busy intervals and intersect them in memory. They do not save event content.

Google is limited to free/busy access. Microsoft is limited to read-only calendar access. Overlap never requests email, contacts, event notes, guests, or attachments.

An open-source MCP server does not remove the provider-consent requirement: Google and Microsoft still require every calendar owner to authorize access. The optional Calendar MCP integration is intended for accounts provisioned by a deployment administrator; direct OAuth is the recommended participant-driven flow.

This is the standard self-hosted OAuth model: source code is shared, while every deployment owns its domain, consent configuration, and secrets. Those values must never be committed to GitHub.

## Calendar connection modes

### Direct Google or Microsoft OAuth (recommended)

Direct OAuth is the default for a self-service portal where every group member connects their own account.

Google requests only the [`calendar.freebusy`](https://developers.google.com/workspace/calendar/api/auth) scope:

```text
https://www.googleapis.com/auth/calendar.freebusy
```

Microsoft requests only:

```text
offline_access Calendars.Read
```

Create web OAuth applications with these exact callbacks:

```text
https://YOUR_HOST/api/oauth/google/callback
https://YOUR_HOST/api/oauth/microsoft/callback
```

Then set deployment secrets:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
TOKEN_ENCRYPTION_KEY=
```

`TOKEN_ENCRYPTION_KEY` should contain at least 32 random bytes. Refresh tokens are encrypted with AES-GCM before storage. See Google’s [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) and Microsoft’s [delegated OAuth guide](https://learn.microsoft.com/en-us/graph/auth-v2-user) for provider setup.

### Calendar MCP (optional, admin-managed)

Overlap includes a Streamable HTTP MCP client for [MarimerLLC/calendar-mcp](https://github.com/MarimerLLC/calendar-mcp), an MIT-licensed server supporting Google Workspace, Microsoft 365, and Outlook.com.

Build and start the MCP server:

```bash
git clone https://github.com/MarimerLLC/calendar-mcp.git
cd calendar-mcp
docker build -t calendar-mcp-http .
docker run -p 8080:8080 -v calendar-mcp-data:/app/data calendar-mcp-http
```

Use its admin UI at `http://localhost:8080/admin/ui` to add and authenticate calendar accounts. Calendar MCP account IDs are provisioned by its administrator; it is not a participant-driven browser OAuth flow. Then configure Overlap:

```dotenv
CALENDAR_MCP_URL=http://localhost:8080
CALENDAR_MCP_API_KEY=
```

In Overlap, choose **Connect calendar → Use a self-hosted Calendar MCP** and enter the account ID configured in Calendar MCP. The adapter initializes an MCP session and invokes only:

```text
find_available_times(accountIds, duration, startDate, endDate, workingHoursOnly)
```

Calendar MCP exposes other capabilities, but Overlap calls only `find_available_times`. Important: the upstream Calendar MCP project’s default Google configuration includes Gmail and contacts scopes in addition to calendars. Its current Microsoft 365 configuration can be explicitly narrowed to `Calendars.ReadOnly`, but operators must review and set those scopes rather than relying on defaults. Use direct OAuth above, or operate a reviewed configuration whose provider scopes are restricted to calendar availability.

All participants in one group should use the same connection mode. The server rejects a mix of direct OAuth and MCP connections rather than returning incomplete availability.

## Architecture

```text
Browser
  ├─ group name + password ──> Group API ──> D1 / SQLite
  ├─ Google / Microsoft OAuth ─────────────> encrypted refresh token
  └─ availability request
       ├─ direct provider free/busy APIs
       └─ Calendar MCP: find_available_times
                    │
                    └─> shared slots only
```

The web app is React 19 on Vinext and Cloudflare Workers. D1 stores groups, password hashes, members, short-lived session hashes, OAuth state, and encrypted refresh tokens. PBKDF2-SHA-256 with 100,000 iterations protects group passwords within the Workers runtime limit.

## Privacy and security choices

- App access uses a verified email within each group; there is no global Overlap user account.
- Email verification codes are short-lived, rate-limited, and stored only as hashes.
- Group passwords are never stored or returned in plaintext.
- Creator recovery keys are returned once and stored only as SHA-256 hashes.
- Session and OAuth state values are stored as hashes.
- Browser session cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`.
- Provider tokens are encrypted at rest.
- Google uses its free/busy endpoint; Microsoft discards events marked `free` and keeps only start/end blocks in memory.
- Calendar-provider authorization never requests mailbox email, event title/body, guest, attachment, or contacts data. The separate verified email address used for group identity is stored as described below.

## Stored data and deletion

D1 stores group metadata, participant email addresses, hashed passwords and recovery keys, hashed short-lived verification/session/OAuth state, and encrypted provider refresh tokens. Resend receives the recipient address and the minimum message content needed for verification or a creator-requested calendar reminder, including the relevant participant, creator, and group names. Busy intervals are fetched when availability is requested and are not persisted.

The group creator can remove any non-creator participant, which deletes that participant’s Overlap profile, local sessions, pending OAuth state, and stored calendar connections. A member can leave a group and remove the same local data while keeping sessions for their other groups. Removing an Overlap connection does not revoke the grant at Google or Microsoft; the calendar owner can revoke that grant in their provider account. Group deletion and creator transfer are not yet implemented, so a self-hosting operator must handle full-group deletion directly in D1 if required.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Deployment

The included `.openai/hosting.json` declares the D1 binding used by the app. Any Cloudflare Workers-compatible deployment needs a D1 database bound as `DB` plus the environment variables for the desired calendar mode.

Fresh databases are bootstrapped idempotently by the application at startup. The files under `drizzle/` are the reviewed schema history. If upgrading a database created before email identity was added, apply `0002_clumsy_madame_masque.sql` and then `0003_vengeful_the_fallen.sql` through the D1 control plane before deploying the new code. Do not replay a migration whose tables or columns are already present. Production upgrades should snapshot or back up D1 first.

For a Wrangler-managed deployment, replace `YOUR_D1_DATABASE` with the database name or ID:

```bash
npx wrangler d1 execute YOUR_D1_DATABASE --remote --file=drizzle/0002_clumsy_madame_masque.sql
npx wrangler d1 execute YOUR_D1_DATABASE --remote --file=drizzle/0003_vengeful_the_fallen.sql
```

Before inviting a group, verify all of the following:

- The site is reachable by every intended participant, not restricted to the deployment owner.
- At least one direct OAuth provider reports as configured in the connection dialog.
- The registered OAuth callback exactly matches the deployed HTTPS origin.
- `TOKEN_ENCRYPTION_KEY` is set as a secret and is stable across deployments.
- `RESEND_API_KEY` and a verified `EMAIL_FROM` sender are configured.
- `ENABLE_DEMO_CALENDARS` is absent or `false`.
- A full create → join → provider consent → availability flow has been tested with two separate browser sessions.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting a larger change.

## License

[MIT](LICENSE)
