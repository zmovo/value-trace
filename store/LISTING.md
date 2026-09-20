# Chrome Web Store listing

Paste these fields into https://chrome.google.com/webstore/devconsole

Enable GitHub Pages on this repo (`docs/` folder) so the demo and privacy URLs resolve:

- Demo: https://zmovo.github.io/value-trace/
- Privacy: https://zmovo.github.io/value-trace/privacy.html

Until Pages is on, reviewers can still open the raw files after you publish the repo.

## Listing

**Name:** ValueTrace

**Summary (132):** See which API a number comes from. Click a number to start.

**Category:** Developer Tools

**Language:** English

**Detailed description:**

ValueTrace shows which API response field produced a number on the page.

You see a dashboard number and should not have to hunt the Network panel. Start Inspect, click a blue-boxed number, and see the request URL and JSON Path. Copy the last path segments when you need the API name.

How to use
1. Open the page that shows the number.
2. Click the ValueTrace icon and press Start Inspect.
3. Click a blue number.
4. Press Esc to close the card, or × on the banner to stop inspect.

Only one tab can inspect at a time. Refreshing this tab, or opening another site in it, stops inspect when the new page starts. Switching Chrome tabs does not.

Network bodies stay in the browser. They are not uploaded. DevTools → API Source is optional if you want the full JSON.

**Single purpose:** Let a developer click a visible number on a web page and see which local API response field produced it.

## Privacy practices

- Collects user data: Yes — current-tab XHR/fetch response bodies, in memory only, to match clicked numbers. No account data. Not sold. Not used for ads or creditworthiness.
- Remote code: No
- Privacy policy URL: https://zmovo.github.io/value-trace/privacy.html

## Permission justifications

- **activeTab:** Start Inspect on the tab the user has open when they click the toolbar action.
- **scripting:** Inject the inspect content script on that tab if it is not already present.
- **clipboardWrite:** Copy the API path suffix when the user clicks Copy.
- **webNavigation:** Watch main-frame commits only, so inspect stops when this tab refreshes or opens another site.
- **host_permissions / &lt;all_urls&gt;:** The number can be on any site the developer is debugging. Content scripts read visible numbers and locally captured JSON. They do not change site data.

## Reviewer notes

Demo: https://zmovo.github.io/value-trace/

1. Load the unpacked zip (manifest.json at the zip root) or the published extension.
2. Open the demo. If the page was already open, refresh once so content scripts run.
3. Click the ValueTrace icon → Start Inspect.
4. Click **66,860**. The overlay should show `/dashboard.json` and `$.data.entryCount`.
5. Click Copy to copy the API name suffix.
6. Click × on the blue banner to stop. Refreshing the demo tab also stops inspect when the new page starts.

Expected: inspect is one tab at a time. Starting inspect on a second tab stops the first. In-page clicks and switching Chrome tabs do not stop inspect.

## Upload package

```bash
npm run pack
```

Upload `store/value-trace.zip`. Do not upload the repo root.

## Store graphics

- Extension icons: `static/icons/icon16.png` … `icon128.png` (also used as the 128×128 store icon)
- Screenshots (1280×800): `store/screenshots/`
