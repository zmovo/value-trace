# ValueTrace

Click a number. See its API.

Local-only Chrome extension (Manifest V3). Network responses never leave the browser.

Repo: https://github.com/zmovo/value-trace

## Use

1. Load unpacked `dist/` in `chrome://extensions`
2. Open the page
3. Click the ValueTrace icon → **Start Inspect**
4. Click a blue-boxed number

Stop inspect from the blue banner **×**, or **Esc** to close the popup. Only one tab can inspect at a time. A full page leave or refresh turns it off; in-page clicks do not. DevTools → API Source is optional (full JSON).

## Develop

```bash
npm install
npm test
npm run build
npm run test-page
```

`dist/` is the unpacked extension. The test page is `http://localhost:3456`.
