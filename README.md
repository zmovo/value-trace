# ValueTrace

Click a number. See its API.

Local-only Chrome extension (Manifest V3). Network responses never leave the browser.

Repo: https://github.com/zmovo/value-trace

## Use

1. Load unpacked `dist/` in `chrome://extensions`
2. Open the page
3. Click the ValueTrace icon → **Start Inspect**
4. Click a blue-boxed number

**Stop** on the ValueTrace chip stops inspect. **Esc** closes the API card. Only one tab can inspect at a time. Refreshing this tab keeps inspect on. Opening another site in it stops inspect when the new page starts. Switching tabs or clicking around on the same page does not.

DevTools → API Source is optional (full JSON).

## Develop

```bash
npm install
npm test
npm run build
```

`dist/` is the unpacked extension.

## Chrome Web Store

Paste-ready listing, permission justifications, and reviewer notes: `store/LISTING.md`.

```bash
npm run pack
```

Upload `store/value-trace.zip`. After this repo’s GitHub Pages is enabled on `docs/`:

- Demo: https://zmovo.github.io/value-trace/
- Privacy: https://zmovo.github.io/value-trace/privacy.html

Regenerate store screenshots (Chrome required): `npm run screenshots`
