# SideDecked Customer Backend

This is the customer-focused backend monorepo for SideDecked, implementing the split-brain architecture. This repository handles all customer experience data and APIs, separate from the commerce operations in the main backend.

## Architecture Overview

The SideDecked project uses a **split-brain architecture** with strict separation:

- **backend** (MercurJS) → `mercur-db` (commerce: orders, payments, vendors)
- **customer-backend** (this repo) → `sidedecked-db` (catalog, decks, community, pricing)
- **storefront** → Consumes both backend APIs for complete customer experience
- **vendorpanel** → Connects to backend for vendor management

## Packages

### Core Data Packages
- **@sidedecked/types** - Shared TypeScript definitions
- **@sidedecked/tcg-catalog** - Universal TCG card database and ETL
- **@sidedecked/deck-builder** - Deck management and validation
- **@sidedecked/community** - User profiles, social features
- **@sidedecked/pricing** - Price intelligence and market data
- **@sidedecked/shared** - Common utilities and helpers

### Applications
- **apps/api** - Customer backend API server

## Quick Start

```bash
# Install dependencies
npm install

# Bootstrap packages
npm run bootstrap

# Setup environment
cp .env.template .env
# Update with your configuration

# Run database migrations
npm run migration:run

# Start development server
npm run dev

# API will be available at http://localhost:7000
```

## Development

```bash
# Build all packages
npm run build

# Run tests
npm run test

# Type checking
npm run typecheck

# Linting
npm run lint

# Clean build artifacts
npm run clean
```

## Database Schema

The customer-backend uses the `sidedecked-db` database with the following main entities:

### TCG Catalog
- `games` - Supported TCG games (MTG, Pokemon, YuGiOh, One Piece)
- `cards` - Universal card database with game-agnostic fields
- `prints` - Game-specific card printings and variants
- `sets` - Card set information
- `catalog_skus` - Universal SKU system for marketplace integration

### Deck Builder
- `decks` - User-created decks
- `deck_cards` - Cards in decks with quantities
- `formats` - Game format definitions and rules

### Community
- `user_profiles` - Extended user information
- `user_follows` - Social following relationships
- `forum_posts` - Community discussions

### Pricing Intelligence
- `price_history` - Historical price data
- `market_prices` - Current market pricing
- `price_alerts` - User price notifications

## API Integration

The customer-backend integrates with the commerce backend through:

1. **Direct database references** - Links to commerce entities by ID
2. **REST API calls** - Real-time data exchange
3. **Event subscriptions** - React to commerce events

Example integration in storefront:
```typescript
// Fetch product from commerce backend
const product = await getProduct(id)

// Fetch card details from customer backend
const cardDetails = await getCardBySKU(product.sku)

// Combine for complete product view
const enrichedProduct = { ...product, cardDetails }
```

## Contributing

1. Follow the existing code patterns in each package
2. Write comprehensive tests for new features
3. Update types in `@sidedecked/types` for shared interfaces
4. Run `npm run typecheck` before committing
5. Follow conventional commit messages

## Environment Variables

See `.env.template` for all required environment variables. Key configurations:

- **DATABASE_URL** - PostgreSQL connection for sidedecked-db
- **COMMERCE_BACKEND_URL** - Connection to MercurJS backend
- **ETL APIs** - Scryfall, Pokemon TCG, YuGiOh API keys
- **MinIO** - Image storage configuration
- **Meilisearch** - Search engine configuration