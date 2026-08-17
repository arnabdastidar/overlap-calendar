# Overlap

Find the time everyone shares.

Overlap is a privacy-first group availability portal for Google Calendar and Microsoft Outlook. Create a password-protected group, invite people with one link, connect calendars, and find shared openings from 30 minutes to 5 hours across the next 30, 60, 90, or 180 days.

![Overlap social preview](public/og.png)

## What it does

- Creates private groups without app accounts or email login
- Uses a group name and password for members
- Gives the creator a separate recovery key and settings access
- Connects Google Calendar and Microsoft Outlook with read-only calendar scopes
- Supports direct, self-service OAuth for Google Calendar and Microsoft Outlook
- Optionally supports an admin-provisioned [MarimerLLC/calendar-mcp](https://github.com/MarimerLLC/calendar-mcp) HTTP server
- Shows only the shared free times; event titles and descriptions are never stored
- Calculates 30-minute through 5-hour openings across six months

## Product flow

1. A creator chooses a globally unique group name, password, and display name.
2. Overlap returns a one-time creator recovery key.
3. Members open the shared link and enter the group password plus a display name.
4. Each person connects Google, Microsoft, or a self-hosted Calendar MCP account.
5. The availability board intersects busy blocks and shows the times everyone shares.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Group creation works immediately, but real calendar connections require at least one OAuth provider to be configured. The UI reports unconfigured providers instead of substituting fake calendar data.

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

## How open-source deployments work

The repository contains the application code, not reusable Google or Microsoft secrets. Every person or organization hosting Overlap creates its own OAuth applications and stores those credentials in its deployment environment. Those values must never be committed to GitHub.

When a participant clicks a provider button:

1. Overlap redirects them to Google or Microsoft.
2. The provider shows the calendar-only permission request.
3. The provider sends an authorization code back to that Overlap deployment.
4. Overlap encrypts the returned refresh token before storing it.
5. Availability checks request busy intervals and intersect them in memory. They do not save event content.

This is the same operating model used by most self-hosted OAuth applications: source code is shared, while every deployment owns its domains, OAuth consent configuration, and secrets.

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

Calendar MCP exposes other capabilities, but Overlap calls only `find_available_times`. Important: the upstream Calendar MCP project’s standard Google and Microsoft account flows currently include mail and contacts permissions in addition to calendars. Do not use that default configuration when your deployment promises calendar-only authorization. Use direct OAuth above, or operate a reviewed fork/configuration whose provider scopes are restricted to calendar availability.

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

- App access is separate from calendar-provider identity; there is no Overlap user account.
- Group passwords are never stored or returned in plaintext.
- Creator recovery keys are returned once and stored only as SHA-256 hashes.
- Session and OAuth state values are stored as hashes.
- Browser session cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`.
- Provider tokens are encrypted at rest.
- Google uses its free/busy endpoint; Microsoft discards events marked `free` and keeps only start/end blocks in memory.
- No email, event title, event body, guest, attachment, or contacts data is requested by the app.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Deployment

The included `.openai/hosting.json` declares the D1 binding used by the app. Any Cloudflare Workers-compatible deployment needs a D1 database bound as `DB` plus the environment variables for the desired calendar mode.

Before inviting a group, verify all of the following:

- The site is reachable by every intended participant, not restricted to the deployment owner.
- At least one direct OAuth provider reports as configured in the connection dialog.
- The registered OAuth callback exactly matches the deployed HTTPS origin.
- `TOKEN_ENCRYPTION_KEY` is set as a secret and is stable across deployments.
- `ENABLE_DEMO_CALENDARS` is absent or `false`.
- A full create → join → provider consent → availability flow has been tested with two separate browser sessions.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting a larger change.

## License

[MIT](LICENSE)
