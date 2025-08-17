# SideDecked Customer Backend

This is the customer-focused backend monorepo for SideDecked, implementing the split-brain architecture. This repository handles all customer experience data and APIs, separate from the commerce operations in the main backend.

## Architecture Overview

The SideDecked project uses a **split-brain architecture** with strict separation:

- **backend** (MercurJS) → `mercur-db` (commerce: orders, payments, vendors)
- **customer-backend** (this repo) → `sidedecked-db` (catalog, decks, community, pricing)
- **storefront** → Consumes both backend APIs for complete customer experience
- **vendorpanel** → Connects to backend for vendor management

## Structure

### Main Application
- **src/** - Customer backend API server (Express/TypeORM)
  - **config/** - Database and infrastructure configuration
  - **entities/** - TypeORM entity definitions
  - **routes/** - API endpoints and controllers
  - **services/** - Business logic and integrations
  - **middleware/** - Express middleware
  - **migrations/** - Database schema migrations
  - **scripts/** - ETL and utility scripts

### Shared Packages
- **packages/types** - Shared TypeScript definitions
- **packages/tcg-catalog** - Universal TCG card database and ETL
- **packages/deck-builder** - Deck management and validation
- **packages/community** - User profiles, social features
- **packages/pricing** - Price intelligence and market data
- **packages/shared** - Common utilities and helpers

## Quick Start

```bash
# Install dependencies
npm install

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

## Inventory Sync Service

The **InventorySyncService** provides real-time inventory synchronization between customer-backend and the Medusa commerce backend, maintaining the split-brain architecture while enabling accurate inventory data.

### Features
- **Real-time Inventory Checks** - Query current product availability
- **Intelligent Caching** - Redis-based caching with configurable TTL
- **Circuit Breaker Pattern** - Resilient API calls with fallback mechanisms  
- **Batch Operations** - Efficient bulk inventory queries
- **Health Monitoring** - Comprehensive service monitoring and alerts

### Authentication Setup

The inventory sync **requires** a publishable API key from Medusa:

```bash
# 1. Create Publishable API Key in Medusa Admin
#    Visit: http://localhost:9000/app/ (or production URL)
#    Go to: Settings > API Key Management > Publishable API Keys
#    Create key with sales channel configured
#    Copy the pk_xxxxxxxxx key

# 2. Configure in .env
COMMERCE_PUBLISHABLE_KEY=pk_your_key_here
COMMERCE_BACKEND_URL=http://localhost:9000  # or production URL
```

### Usage Examples

```typescript
import { InventorySyncService } from './services/InventorySyncService'

const inventorySync = new InventorySyncService()

// Check single product availability
const result = await inventorySync.checkInventory('variant_123')
console.log(result.available, result.quantity)

// Batch inventory check  
const variants = ['var_1', 'var_2', 'var_3']
const results = await inventorySync.checkMultipleInventory(variants)

// Health check
const health = await inventorySync.healthCheck()
console.log('API accessible:', health.api_accessible)
```

### Production Deployment

**CRITICAL**: The inventory sync service must be configured during deployment:

1. **Deploy backend first** and create publishable API key
2. **Configure customer-backend** with the publishable key
3. **Verify connection** in logs: "✅ Successfully connected to Medusa backend"

Without proper authentication, the service will fallback to unavailable inventory.

## API Integration

The customer-backend integrates with the commerce backend through:

1. **Inventory Sync Service** - Real-time product availability via REST API
2. **Direct SKU references** - Links to commerce products by SKU
3. **Event subscriptions** - React to commerce events (future)

Example integration in storefront:
```typescript
// Fetch product from commerce backend
const product = await getProduct(id)

// Check real-time inventory from customer backend
const inventory = await checkInventory(product.variant_id)

// Fetch card details from customer backend
const cardDetails = await getCardBySKU(product.sku)

// Combine for complete product view
const enrichedProduct = { 
  ...product, 
  cardDetails,
  inventory: {
    available: inventory.available,
    quantity: inventory.quantity
  }
}
```

## Contributing

1. Follow the existing code patterns in each package
2. Write comprehensive tests for new features
3. Update types in `@sidedecked/types` for shared interfaces
4. Run `npm run typecheck` before committing
5. Follow conventional commit messages

## Environment Variables

See `.env.template` for all required environment variables. Key configurations:

### Core Configuration
- **DATABASE_URL** - PostgreSQL connection for sidedecked-db  
- **API_PORT** - Server port (default: 7000)
- **REDIS_URL** - Redis connection for caching and sessions

### Inventory Sync Service (REQUIRED)
- **COMMERCE_BACKEND_URL** - MercurJS backend URL (http://localhost:9000)
- **COMMERCE_PUBLISHABLE_KEY** - Medusa publishable API key (pk_xxxxx) - **REQUIRED**

### External APIs
- **SCRYFALL_API_URL** - Magic: The Gathering card data
- **POKEMON_TCG_API_KEY** - Pokemon TCG API access
- **YUGIOH_API_URL** - YuGiOh card database
- **ONEPIECE_API_URL** - One Piece card game data

### Storage & Search  
- **MINIO_ENDPOINT** - Image storage configuration
- **ALGOLIA_APP_ID** - Search engine configuration

**Note**: Without `COMMERCE_PUBLISHABLE_KEY`, the inventory sync service will operate in fallback mode with limited functionality.