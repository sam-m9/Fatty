# Fatty

A personal restaurant tracker you install on your phone from the browser (a PWA). You save spots from the iOS Share Sheet into a Google Sheet, and the app reads that sheet.

Plain HTML, CSS and JS. There's no build step and no backend.

```
index.html            app shell
styles.css            Matcha Cream theme, light + dark
js/app.js             state, rendering, events
js/sheet.js           reads the sheet (gviz JSON) and maps rows to places
js/hours.js           "is it open now?" from the Hours column
js/scripts.js         Apps Script sources handed out by the Copy buttons
apps-script/          the same scripts as files
sw.js                 offline app shell
manifest.webmanifest  install metadata
icons/                app icons
```

## Run it

Serve the folder over HTTPS. Any static host works (GitHub Pages, Netlify, Cloudflare Pages). The service worker and location only work over HTTPS or on `localhost`.

```
npx http-server -c-1 .
```

On iPhone, open the site in Safari, then tap Share and Add to Home Screen.

## 1. The sheet

Make a Google Sheet. Put these headers in row 1 (any order, matched without case):

| Column | Filled by | Format |
|---|---|---|
| Link | shortcut | The URL you shared (opened by **View reel**) |
| Score | shortcut | 0–5, one decimal. Blank means "want to try" |
| Note | shortcut | Free text |
| Date | shortcut | Date saved. Used for Newest and New (≤ 6 months) |
| Name, Area, Cuisine | backfill | Text |
| Price | backfill | `$` to `$$$$` (or 1–4) |
| Hours | backfill | e.g. `11am-10pm`, `Mon-Fri 11:30am-2pm, 5-10pm; Sat-Sun 10am-11pm`, `Tue-Sun 5pm-1am; Mon closed`, `Open 24 hours` |
| Map link | backfill | Google or Apple Maps URL (opened by **Open in Maps**) |
| Tags | backfill | Comma separated: Date night, Cheap eats, Group friendly, Outdoor seating, Late night, Brunch, Solo |
| Lat, Lng | backfill | Decimal coordinates for the map. If they're blank, Fatty tries to read them from the Map link |
| Open | optional | TRUE/FALSE. Only used when Hours can't be read |
| Photo | optional | Image URL for the card tile |

Then tap **Share → General access → Anyone with the link (Viewer)**. Paste the sheet link into Fatty under the cloud button. The first tab is read. To read another tab, use a link that includes its `#gid=`.

## 2. The share sheet endpoint

1. In the sheet, open **Extensions → Apps Script** and paste `apps-script/Endpoint.gs`. The app's **?** sheet also has a Copy button for it.
2. **Deploy → New deployment → Web app**. Execute as: *Me*. Who has access: *Anyone*. Copy the web app URL.

## 3. The iOS Shortcut

1. Create a new shortcut. Turn on **Show in Share Sheet** and set it to receive **URLs**.
2. **Ask for Input**: Number, prompt "Score?". Leave it blank for want-to-try.
3. **Ask for Input**: Text, prompt "Note?". Optional.
4. **Get Contents of URL**: paste the web app URL. Method **POST**, Request Body **JSON**:
   - `link` = Shortcut Input
   - `score` = Provided Input (step 2)
   - `note` = Provided Input (step 3)

That's two taps per save. New rows appear in Fatty the next time you open it.

## 4. Weekly backup

In Fatty, open the cloud button and paste your Drive folder link. Tap **Copy backup script**; the folder ID is already filled in. Paste it into the same Apps Script project and run `setup()` once. It saves a backup right away, then again every Monday around 3am (in the script's time zone). The folder keeps `Fatty backup (latest)` and `Fatty backup (previous)`.

## Stored on the device

`localStorage["fatty.v1"]` holds `{ cfg: { sheet, folder }, dark, sort }`. `fatty.v1.data` caches the last sheet read, so the app opens instantly and still works offline.
