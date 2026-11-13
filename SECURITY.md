# Security and privacy

## What stays on your PC

| Data | Where it is stored | Who can see it |
|---|---|---|
| Your builds | `Documents\Path of Building\Builds` | You, and the AI app when it asks PoB for build data |
| POESESSID (trade session) | `Documents\Path of Building\AgentEdition.json` | Only pathofexile.com, sent with trade requests. It is never printed, logged or shown to the AI |
| PoB Agent Edition live API | `127.0.0.1:31337` | Programs on this PC only. It does not listen on your network |

PoB Agent Edition has no telemetry, no analytics and no accounts. Network traffic goes only to:
- `www.pathofexile.com` (trade searches, when you ask for them),
- `github.com` / `raw.githubusercontent.com` (update checks and tree data, only when you run the developer update scripts),
- whatever your AI app itself connects to. That depends on the app you use, not on this project.

## Treat your POESESSID like a password

Anyone who has it can use your pathofexile.com session. Never paste it into a chat, an issue or a screenshot. If you think it leaked, log out of pathofexile.com and change your password.

## Account safety

The project never reads game memory, never automates input and never sends whispers or buys items. Trade requests follow the limits pathofexile.com publishes.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's **Report a vulnerability** button (Security tab → Advisories) on this repository, or contact the maintainer privately. Never include your POESESSID or other secrets in a report.

## For contributors: never commit secrets

`.gitignore` blocks `AgentEdition.json`, `.env`, `*.cfg`, `Settings.xml`, `Builds/` and local settings files. Before you push, run:

```powershell
tools\check-secrets.ps1
```

It scans the files you are about to commit for session IDs, tokens, personal paths and e-mail addresses.
