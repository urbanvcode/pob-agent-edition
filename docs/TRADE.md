# Trade searches

PoB Agent Edition can search the official trade site (pathofexile.com/trade) for upgrades that fit your build. It shows instant-buyout listings, simulates each item in your build and ranks them by gain per chaos. You buy them yourself.

## Finding your POESESSID

Trade searches work best while you are logged in, so they need your pathofexile.com session cookie (`POESESSID`).

1. Log in at https://www.pathofexile.com in your browser.
2. Press **F12** to open the developer tools.
3. Chrome or Edge: **Application** tab > **Cookies** > `https://www.pathofexile.com`. Firefox: **Storage** tab > **Cookies**.
4. Copy the value of `POESESSID`. It is 32 characters long.
5. In PoB Agent Edition, open **Options > Trade session ID** and paste it.

It is saved only in `Documents\Path of Building\AgentEdition.json` on your PC. All AI apps pick it up from there, so you never paste it into a chat. A `POE_SESSION_ID` environment variable in an MCP config overrides it.

Treat the POESESSID like a password. If it ever leaks, log out of pathofexile.com and change your password.

## Limits

| Rule | Value |
|---|---|
| Listings | Instant buyout only. This is fixed and cannot be switched off |
| Pace | At most 1 request every 2 seconds |
| Per question | At most 16 trade requests |
| Rate limits | Every limit pathofexile.com publishes is respected before it is reached. If the site asks for a pause, the AI tells you and does not retry |
| Buying | Never automatic. There is no whispering and no game-client access |

## Settings (MCP config env vars)

| Variable | Default | Meaning |
|---|---|---|
| `POE_TRADE_MAX_REQUESTS_PER_CALL` | `16` | Trade requests allowed per question |
| `POB_LIVE` | `auto` | `auto`, `only` or `off`: whether to use the open PoB Agent Edition window |
| `POB_AGENT_PORT` | `31337` | Port of the live API (`127.0.0.1` only) |
