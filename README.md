# Bottomless Starred Coffees

> **Unofficial Chrome extension** for [Bottomless](https://www.bottomless.com) (not affiliated with or endorsed by Bottomless).

Visually categorizes all of your starred (hearted / "I loved this") coffees into a dedicated **Starred** section at the top of [`bottomless.com/orders`](https://www.bottomless.com/orders), with your remaining orders organized below.

## Why This Exists

On `bottomless.com/orders`, your order history shows every bag you've received, but it doesn't indicate which coffees you previously marked with the heart (**"I loved this"**) button. Finding a favorite coffee to reorder normally requires clicking into each individual order status page one by one.

This extension surfaces all of your favorited coffees right at the top of your Orders page—along with repeat order counts and your tasting/brewing notes.

## Features

- **Dedicated `Starred` section at the top**: Automatically groups your loved coffees into a visually distinct section above **History**, styled to match Bottomless's native layout.
- **Unique vs. All orders toggle**:
  - **Unique** *(default)*: Groups repeated deliveries of the same starred coffee into a single card (linking to your most recent delivery) with an `Ordered N×` badge.
  - **All orders**: Expands the section to show every individual delivery of your starred coffees with each delivery date.
- **Hide / Show toggle**: Collapse the Starred section whenever you want to focus on chronological history. Your toggle preferences persist in `localStorage`.
- **Tasting note & brew method previews**: Shows a compact one-line preview of your saved brewing method and notes directly on starred cards (hover to read the full note).
- **Subtle status cues**: Badges any **In Progress** order of a coffee you've previously loved, adds a quiet ban icon on coffees marked *"Don't send me this again"* in History, and automatically hides empty year headings.
- **Live SPA refresh**: When you click into a coffee, toggle its heart, and return to `/orders`, the extension automatically re-fetches fresh feedback and updates the page.

## How It Works

### 1. Single-Request Data Fetching
Bottomless's own web app loads order history from `GET https://app.bottomless.com/api/orders` (and active orders from `/api/orders/in-transition`). Conveniently, Bottomless's backend already attaches each order's `product_feedback` object (`like`, `dislike`, `brewing_method`, `content`) directly on the `/api/orders` response.

When you open `https://www.bottomless.com/orders`, the content script makes one authenticated `GET` request to `https://app.bottomless.com/api/orders` using your existing browser session (`credentials: "include"`, plus the `bottomless_access_token` header if present in `localStorage` or cookies)—the exact same mechanism Bottomless's frontend uses. There is no scraping of individual coffee pages and no N+1 request storm.

### 2. Order Classification & Deduplication (`src/orders-logic.js`)
Each order from the API is classified by `product_feedback`:
- `product_feedback.like === true` → added to the **Starred** list (sorted newest-first by delivery/fulfillment date).
- `product_feedback.dislike === true` → flagged for a subtle ban icon in History.
- Repeated orders sharing the same `subproduct_id.product._id` are grouped together for **Unique** mode (preserving the newest delivery date, total `orderCount`, and tasting notes).

Each rendered card on `/orders` links to `/order/<orderId>/status`, which lets the extension match API records to existing DOM cards cleanly by order ID.

### 3. React-Safe DOM Rendering (`src/content.js`)
Bottomless is a React single-page application (SPA). Moving or removing React-managed DOM nodes from their parent containers breaks React's reconciliation (`NotFoundError: removeChild`) when navigating between routes.

To avoid interfering with React:
- The extension injects a standalone `<section class="panel-section btl-starred-section">` immediately before Bottomless's **History** section.
- Original starred cards inside **History** (and any year groups whose orders are all starred) are hidden purely with CSS classes (`display: none !important`), keeping React's DOM tree completely intact.
- Clicking a card in the **Starred** section delegates normal left-clicks to the hidden original React `<a href="/order/<id>/status">` link, so React Router handles SPA navigation natively (while `Ctrl`/`Cmd`+click and middle-click open in a new tab as usual).

### 4. SPA Navigation & Freshness
Because Chrome content scripts don't re-run on client-side route transitions, `manifest.json` matches `https://www.bottomless.com/*` and `src/content.js` watches route changes via a throttled `MutationObserver` on `#root`, plus `popstate` and window `focus` listeners. Leaving `/orders` cleans up injected UI and clears cached data so returning after starring or unstarring a coffee immediately reflects your changes.

## Privacy & Security

- **100% read-only**: Only makes `GET` requests to Bottomless's own API endpoints (`/api/orders` and `/api/orders/in-transition`). Never modifies your orders, subscription, or ratings.
- **No external servers or tracking**: All processing happens locally in your browser. Zero analytics, telemetry, or third-party requests.
- **Minimal permissions**: Uses Manifest V3 with a single content script scoped only to `https://www.bottomless.com/*` and no extra Chrome API permissions.

## Installation (Chrome, Brave, Edge, Arc, Vivaldi)

1. Download this repository (click **Code → Download ZIP** and extract it, or run `git clone https://github.com/saiku73/bottomless-coffee-chrome-extension.git`).
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the extracted repository folder (the folder containing `manifest.json`).
5. Visit or refresh [`https://www.bottomless.com/orders`](https://www.bottomless.com/orders).

## Project Structure

```text
├── manifest.json             # Chrome Manifest V3 configuration
├── src/
│   ├── orders-logic.js       # Pure parsing, classification, and deduplication logic
│   ├── content.js            # SPA-aware content script and DOM renderer
│   └── styles.css            # Styling matching Bottomless's Bootstrap 4 + Figtree UI
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── tests/
    └── orders-logic.test.js  # Unit tests (Node.js built-in test runner)
```

## Development & Testing

No build step or external dependencies are required—just edit files and reload the extension in `chrome://extensions`.

Run the unit tests with Node.js (v18+):

```bash
node --test tests/orders-logic.test.js
```

## License

[MIT](LICENSE)
