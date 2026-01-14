Playwright E2E test for Fugleobservasjoner

Run locally:

```bash
cd tests/e2e_playwright
npm install
npx playwright install --with-deps
npm test -- --headed --project=chromium --grep @smoke
```

The test expects the app to be running at http://localhost:3000 (or set `BASE_URL` env var).
