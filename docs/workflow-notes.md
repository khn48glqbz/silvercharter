## CLI Workflow Notes

This document captures the current state of the CLI so that future sessions can understand the moving parts quickly.

### Entry Points

- `index.js` – boots the CLI, loads environment/config, launches `mainMenu`.
- `src/cli/menus/mainMenu.js` – presents Imports / Products / Settings menu.

### Imports Workflow

- `src/cli/menus/importsMenu.js` – start/continue import sessions, run maintenance tools.
- `src/cli/sessions/importSession.js`
  - Reads URLs, parses switch flags (`src/cli/helpers/switchParser.js`).
  - Calls `handleImportUrl` (see below).
  - Handles special input `custom` → `src/cli/menus/customCard.js`.
- `src/workflows/importCard.js` – shared import logic for scraped cards.
  - Fetches Shopify product, scrapes PriceCharting data, applies pricing, creates drafts, and logs to CSV.
  - Signed cards are handled via the `signed` flag; they always require manual price entry and store `pricecharting.signature`.

### Custom Card Workflow

- `src/cli/menus/customCard.js`
  - Prompts for game (uses `vendors.json`), expansion (includes custom-expansion suggestions, see below), language, condition, and signed flag.
  - Icon handling:
    - Generates a PriceCharting-style slug `game-language-set`.
    - Suggested icons are fetched via `getIconSuggestions` (filename candidates + Shopify file search).
    - Manual search/upload paths reuse Shopify helpers in `src/shopify/files.js`.
  - Pricing mirrors `handleImportUrl`, but the card title is suffixed with `(Signature)` when signed.
  - Writes the product to Shopify via `createDraftAndPublishToPos` and appends the CSV row.

### Custom Expansion Cache

- `src/utils/customExpansions.js`
  - Queries Shopify for products where `pricecharting.source_url == "null"` and caches their expansions keyed by game in `data/custom-expansions.json`.
  - `customCard.js` loads this cache at startup to offer saved expansion suggestions for each game.

### Products Menu

- `src/cli/menus/productsMenu.js` → `src/cli/products/viewProducts.js`.
- Fetch:
  - `src/shopify/productSearch.js` pulls all products with `metafields.pricecharting.source_url` using GraphQL (`sortKey: CREATED_AT, reverse: true`), so newest items arrive first.
- Grid UI:
  - `viewProducts` filters + sorts in memory and renders a grid via `gridPrompt`.
  - Columns (in order): Title, Condition/Type, Price/Value/Markup, Quantity, Expansion/Lang/Icon flag, Additional Options.
  - Top row shows navigation buttons (Next, Previous, Filters, Sort, Search, Exit).
  - Sort choices include Date Added (Newest/Oldest) plus Title/Price/Quantity.
- Editing:
  - Selecting a column triggers `editProduct`, which delegates to Shopify GraphQL/REST helpers (`src/shopify/productMutations.js`).

### Grid Prompt Helper

- `src/cli/helpers/gridPrompt.js`
  - Renders the grid on the terminal’s alternate screen buffer (so keypresses don’t spam the primary console). Each keypress clears/redraws that buffer for a clean refresh.
  - Supports per-column widths (pass `columnWidths` option) to mimic a table layout.
  - Navigation: left/right/up/down arrows move the highlight; Enter selects; Esc exits.

### Maintenance Tools

- `src/cli/maintenance/legacyUpdater.js` – re-scrapes existing products, refreshes metafields (including `signature` flag and expansion icon references).
- `src/cli/maintenance/normalizeValues.js` – normalizes `pricecharting.value` metafields (replaces "-" or blank with `"null"`).

### Key Metafields (namespace `pricecharting`)

- `source_url` – original PriceCharting URL (or `"null"` for manual custom cards).
- `condition`, `type`, `game`, `expansion`, `language`.
- `expansion_icon` – file reference to the Shopify icon file.
- `value` – stored PriceCharting value (string, `"null"` when unknown).
- `signature` – `"true"` when the card is signed.

### Shopify Helpers

- `src/shopify/draft.js` – creates/updates products and sets metafields.
- `src/shopify/files.js` – staged uploads, expansion icon search, caching.
- `src/shopify/metafields.js` – GraphQL helpers for reading/writing metafields; `findProductBySourceUrlAndCondition` now also checks `signature`.
- `src/shopify/productSearch.js` – GraphQL query with pagination and `createdAt` sorting.

### Notes for Future Work

- Products grid still clears/redraws the screen each keypress (alternate buffer, minimal flicker). To further reduce flicker, consider using an interactive TUI library (e.g., Ink, Blessed) or incremental cursor positioning.
- Custom card flow is currently a single 300+ line module with many nested prompts. If future work requires more changes, consider splitting into helper modules (game selection, icon selection, pricing block).

This document should give the next engineer enough context to continue work without replaying the whole session.
