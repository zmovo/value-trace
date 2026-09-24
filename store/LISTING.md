# Chrome Web Store listing

Paste these fields into https://chrome.google.com/webstore/devconsole

Enable GitHub Pages on this repo (`docs/` folder) so the demo and privacy URLs resolve:

- Demo: https://zmovo.github.io/value-trace/
- Privacy: https://zmovo.github.io/value-trace/privacy.html

Until Pages is on, reviewers can still open the raw files after you publish the repo.

## Listing

**Name (45):** ValueTrace – Find the API for a Number

**Summary (132):** Click a number to see which API it comes from.

**Category:** Developer Tools

**Language:** English

**Detailed description:**

Click a number to see which API it comes from.

1. Open the page.
2. Click the ValueTrace icon and press Start Inspect.
3. Click the number.

The card shows the request, the field, and the value. You can copy them, download the call, or copy cURL.

Press Esc to close the card. Press Stop on the chip to stop. Refreshing this page keeps inspect on. Opening another site stops it. Data stays in the browser.

**Single purpose:** Click a number on a page and see which API it comes from.

## Privacy practices

- Collects user data: Yes — current-tab XHR/fetch response bodies, in memory only, to match clicked numbers. No account data. Not sold. Not used for ads or creditworthiness.
- Remote code: No
- Privacy policy URL: https://zmovo.github.io/value-trace/privacy.html

## Permission justifications

- **activeTab:** Start Inspect on the tab the user has open when they click the toolbar action.
- **scripting:** Inject the inspect content script on that tab if it is not already present.
- **clipboardWrite:** Copy the URL, field, value, or cURL command when the user clicks a copy control.
- **downloads:** Save a text file with the matched call’s URL, request, and response when the user clicks Download.
- **webNavigation:** Watch main-frame commits only, so inspect stops when this tab refreshes or opens another site.
- **host_permissions / &lt;all_urls&gt;:** The number can be on any site the developer is debugging. Content scripts read visible numbers and locally captured JSON. They do not change site data.

## Reviewer notes

Demo: https://zmovo.github.io/value-trace/

1. Load the unpacked zip (manifest.json at the zip root) or the published extension.
2. Open the demo. If the page was already open, refresh once so content scripts run.
3. Click the ValueTrace icon → Start Inspect.
4. Click **66,860**. The overlay should show `/dashboard.json` and `$.data.entryCount`.
5. Use the copy icons, Download, or Copy cURL on the card.
6. Click Stop on the ValueTrace chip to stop. Refreshing the demo tab keeps inspect on. Opening another site in that tab stops it.

Expected: inspect is one tab at a time. Starting inspect on a second tab stops the first. In-page clicks and switching Chrome tabs do not stop inspect.

## Upload package

```bash
npm run pack
```

Upload `store/value-trace.zip`. Do not upload the repo root.

## Store graphics

Upload these from the repo (already sized for the console):

| Asset | File |
| --- | --- |
| Store icon 128×128 | `static/icons/icon128.png` |
| Cover / Screenshot 1 (1280×800) | `store/screenshots/cover-1280x800.png` |
| Screenshot 2 (1280×800) | `store/screenshots/inspect-1280x800.png` |
| Screenshot 3 (1280×800) | `store/screenshots/popup-1280x800.png` |
| Small promo tile 440×280 | `store/screenshots/tile-440x280.png` |

HTML sources for regenerating the shots live next to the PNGs. With Chrome installed:

```bash
# serve store/screenshots, then:
# chrome --headless=new --window-size=1280,800 --screenshot=inspect-1280x800.png http://127.0.0.1:8765/inspect.html
```
