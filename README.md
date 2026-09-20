# ValueTrace

Click a value. Trace it back to the API.

Local-only Chrome DevTools extension (Manifest V3). Network responses never leave the browser.

Repo: https://github.com/zmovo/value-trace

## Develop

```bash
npm install
npm test
npm run build
npm run test-page
```

`dist/` is the unpacked extension. The test page is `http://localhost:3456`.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this repo's `dist/` folder
4. Start `npm run test-page`
5. Open `http://localhost:3456`
6. Open DevTools and select the **API Source** tab
7. Refresh the page so the collector can index `/mock/dashboard`
8. Click **Start Inspect** and click `66,860`
