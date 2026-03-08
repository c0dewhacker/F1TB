# F1 Teammate Battles

A sleek, F1-styled single-page app that shows head-to-head championship points battles between teammates at every constructor.

Built with React + Vite. Powered by the [OpenF1 API](https://openf1.org).

## Features

- **Teammate head-to-head** — Points comparison for each constructor's driver pairing
- **Year selector** — Browse standings from 2023 through the current season
- **Constructor car images** — Faded background car renders per team from the official F1 media CDN
- **Driver headshots** — Pulled live from the OpenF1 drivers endpoint
- **Smart caching** — localStorage cache with TTL (1 hour for current season, 30 days for past seasons) to minimize API calls
- **Rate limiting** — Built-in request throttling to stay under the OpenF1 3 req/s limit
- **Live session handling** — Modal notification when the API is locked during a live F1 session (401)
- **Responsive** — Works on mobile and desktop
- **Static deployment** — Configured for GitHub Pages via GitHub Actions

## Getting Started

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Deploying to GitHub Pages

The repo includes a GitHub Actions workflow at `.github/workflows/deploy.yml` that builds and deploys automatically.

1. Push to `main`
2. Go to **Settings → Pages → Source** and select **GitHub Actions**
3. The site will deploy on every push to `main`

You can also trigger a deploy manually from the Actions tab via `workflow_dispatch`.

## API

All data comes from the [OpenF1 API](https://openf1.org/docs):

| Endpoint | Usage |
|---|---|
| `/v1/sessions` | Find the latest race session per year |
| `/v1/drivers` | Driver names, headshots, team assignments, team colours |
| `/v1/championship_drivers` | Championship points and positions |

Constructor car images are loaded from the Formula 1 media CDN:
```
https://media.formula1.com/image/upload/.../common/f1/{year}/{team_slug}/{year}{team_slug}carright.webp
```

## Tech Stack

- [React 19](https://react.dev)
- [Vite 7](https://vite.dev)
- [OpenF1 API](https://openf1.org)

## License

MIT
