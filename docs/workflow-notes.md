## CLI Workflow Notes

This document captures the current state of the CLI so that future sessions can understand the moving parts quickly.

### Entry Points

- `index.js` – boots the CLI, loads environment/config, then invokes `runCli`.
- `src/cli/app.js` – loads settings once and passes the shared config into the main menu loop.
- `src/cli/menus/main-menu.js` – presents Imports / Products / Settings menu and dispatches to the relevant flows.

- `src/cli/menus/imports-menu.js` – start/continue import sessions, run maintenance tools.
- `src/cli/sessions/import-session.js`
  - Reads URLs, parses switch flags (`src/cli/components/utils/switch-parser.js`).
  - Calls `handleImportUrl` (see below).
  - Handles special input `custom` → `src/cli/flows/custom-card.js`.
- `src/workflows/import-workflow.js` – shared import logic for scraped cards.
  - Fetches Shopify product, scrapes PriceCharting data, applies pricing, creates drafts, and logs to CSV.
  - Signed cards are handled via the `signed` flag; they always require manual price entry and store `pricecharting.signature`.

### Custom Card Workflow

- `src/workflows/custom-workflow.js`
  - Prompts for game (uses `vendors.json`), expansion (includes custom-expansion suggestions, see below), language, condition, and signed flag.
  - Icon handling:
    - Generates a PriceCharting-style slug `game-language-set`.
    - Suggested icons are fetched via `getIconSuggestions` (filename candidates + Shopify file search).
    - Manual search/upload paths reuse Shopify helpers in `src/shopify/files.js`.
  - Pricing mirrors `handleImportUrl`, but the card title is suffixed with `(Signature)` when signed.
  - Writes the product to Shopify via `saveProduct` (Shopify adapter) and appends the CSV row.
  - `src/cli/flows/custom-card.js` simply routes the CLI flow into this workflow.

### Custom Expansion Cache

- `src/app/data/custom-expansions.js`
  - Queries Shopify for products where `pricecharting.source_url == "null"` and caches their expansions keyed by game in `data/custom-expansions.json`.
  - `custom-workflow.js` loads this cache at startup to offer saved expansion suggestions for each game.

### Products Menu

- `src/cli/menus/products-menu.js` → `src/cli/flows/view-products.js`.
- Fetch:
  - `src/adapters/shopify/services/search-service.js` pulls all products with `metafields.pricecharting.source_url` using GraphQL (`sortKey: CREATED_AT, reverse: true`), so newest items arrive first.
- Grid UI:
  - `view-products` filters + sorts in memory and renders a grid via `gridPrompt` (`src/cli/components/prompts/grid-prompt.js`).
  - Columns (in order): Title, Condition/Type, Price/Value/Markup, Quantity, Expansion/Lang/Icon flag, Additional Options.
  - Top row shows navigation buttons (Next, Previous, Filters, Sort, Search, Exit).
  - Sort choices include Date Added (Newest/Oldest) plus Title/Price/Quantity.
- Editing:
  - Selecting a column triggers `editProduct`, which delegates to Shopify helpers (`src/adapters/shopify/services/product-service.js` plus inventory service when needed).

### Grid Prompt Helper

- `src/cli/components/prompts/grid-prompt.js`
  - Renders the grid on the terminal’s alternate screen buffer (so keypresses don’t spam the primary console). Each keypress clears/redraws that buffer for a clean refresh.
  - Supports per-column widths (pass `columnWidths` option) to mimic a table layout.
  - Navigation: left/right/up/down arrows move the highlight; Enter selects; Esc exits.

### Maintenance Tools

- `src/cli/maintenance/legacy-updater.js` – re-scrapes existing products, refreshes metafields (including `signature` flag and expansion icon references).
- `src/cli/maintenance/normalize-values.js` – normalizes `pricecharting.value` metafields (replaces "-" or blank with `"null"`).
- `src/cli/maintenance/legacy-tag-cleaner.js` – clears tags for legacy PriceCharting items.

### Key Metafields (namespace `pricecharting`)

- `source_url` – original PriceCharting URL (or `"null"` for manual custom cards).
- `condition`, `type`, `game`, `expansion`, `language`.
- `expansion_icon` – file reference to the Shopify icon file.
- `value` – stored PriceCharting value (string, `"null"` when unknown).
- `signature` – `"true"` when the card is signed.

### Shopify Helpers

- `src/adapters/shopify/client/client.js` – initializes the Shopify API client via `@shopify/shopify-api`.
- `src/adapters/shopify/services/draft-service.js` – creates/updates products, ensures inventory, publishes to channels, and sets metafields.
- `src/adapters/shopify/services/file-service.js` – staged uploads, expansion icon search, caching.
- `src/adapters/shopify/services/metafield-service.js` – GraphQL helpers for reading/writing metafields; `findProductBySourceUrlAndCondition` checks `signature`.
- `src/adapters/shopify/services/inventory-service.js` – toggles tracking, links inventory to the default location, adjusts quantities.
- `src/adapters/shopify/services/product-service.js` – GraphQL mutations for variant updates and product deletes.
- `src/adapters/shopify/services/search-service.js` – GraphQL query with pagination and `createdAt` sorting.
- `src/adapters/shopify/services/publish-service.js` – publishes products to Online Store and Point of Sale by default.

### Notes for Future Work

- Products grid still clears/redraws the screen each keypress (alternate buffer, minimal flicker). To further reduce flicker, consider using an interactive TUI library (e.g., Ink, Blessed) or incremental cursor positioning.
- Custom card flow is currently a single 300+ line module with many nested prompts. If future work requires more changes, consider splitting into helper modules (game selection, icon selection, pricing block).
- Inventory operations currently use the REST Admin endpoints (tracking, connect/set/adjust). Consider migrating to GraphQL inventory mutations once API support is verified.
- Extract the custom-card workflow into smaller helpers (game/expansion selection, icon selection/upload, pricing/signed handling) to improve readability and testability.
- Add regression tests for pure modules (switch-parser, pricing-engine, currency helpers, CSV writer) using a test runner (e.g., Jest/Vitest) to prevent prompt regressions.
- Harden PriceCharting scraping by adding selector fallbacks or alternate endpoints to avoid manual pricing when the site markup changes.

This document should give the next engineer enough context to continue work without replaying the whole session.
