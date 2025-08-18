import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

export const config = {
  // Environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || process.env.API_PORT || '7000'),
  HOST: process.env.HOST || process.env.API_HOST || '0.0.0.0',
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://localhost:5432/sidedecked_db',
  DB_NAME: process.env.DB_NAME || 'sidedecked_db',
  
  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // Security
  JWT_SECRET: process.env.JWT_SECRET || 'your-jwt-secret',
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'your-cookie-secret',
  
  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  
  // TCG APIs
  SCRYFALL_API_URL: process.env.SCRYFALL_API_URL || 'https://api.scryfall.com',
  SCRYFALL_RATE_LIMIT: parseInt(process.env.SCRYFALL_RATE_LIMIT || '100'),
  POKEMON_TCG_API_URL: process.env.POKEMON_TCG_API_URL || 'https://api.pokemontcg.io/v2',
  POKEMON_TCG_API_KEY: process.env.POKEMON_TCG_API_KEY,
  YUGIOH_API_URL: process.env.YUGIOH_API_URL || 'https://db.ygoprodeck.com/api/v7',
  ONEPIECE_API_URL: process.env.ONEPIECE_API_URL || 'https://onepiece-cardgame.dev/api',
  
  // MinIO / S3
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,
  MINIO_BUCKET: process.env.MINIO_BUCKET || 'sidedecked-card-images',
  MINIO_REGION: process.env.MINIO_REGION || 'us-east-1',
  
  // CDN & Content Delivery
  CDN_BASE_URL: process.env.CDN_BASE_URL,
  CDN_ENABLED: process.env.CDN_ENABLED === 'true' || false,
  CDN_CACHE_TTL: parseInt(process.env.CDN_CACHE_TTL || '31536000'), // 1 year
  CDN_BROWSER_CACHE_TTL: parseInt(process.env.CDN_BROWSER_CACHE_TTL || '86400'), // 24 hours
  CDN_EDGE_CACHE_TTL: parseInt(process.env.CDN_EDGE_CACHE_TTL || '2592000'), // 30 days
  CDN_FAILOVER_ENABLED: process.env.CDN_FAILOVER_ENABLED !== 'false',
  
  // ETL Configuration
  ETL_BATCH_SIZE: parseInt(process.env.ETL_BATCH_SIZE || '100'),
  ETL_MAX_RETRIES: parseInt(process.env.ETL_MAX_RETRIES || '5'),
  ETL_RATE_LIMIT_DELAY: parseInt(process.env.ETL_RATE_LIMIT_DELAY || '1000'),
  ETL_CONCURRENT_JOBS: parseInt(process.env.ETL_CONCURRENT_JOBS || '2'),
  
  // Search (Algolia)
  ALGOLIA_APP_ID: process.env.ALGOLIA_APP_ID,
  ALGOLIA_API_KEY: process.env.ALGOLIA_API_KEY,
  ALGOLIA_SEARCH_KEY: process.env.ALGOLIA_SEARCH_KEY,
  ALGOLIA_INDEX_CARDS: process.env.ALGOLIA_INDEX_CARDS || 'cards_catalog',
  ALGOLIA_INDEX_MARKETPLACE: process.env.ALGOLIA_INDEX_MARKETPLACE || 'marketplace_products',
  
  // Commerce Backend Integration
  COMMERCE_BACKEND_URL: process.env.COMMERCE_BACKEND_URL || 'http://localhost:9000',
  COMMERCE_PUBLISHABLE_KEY: process.env.COMMERCE_PUBLISHABLE_KEY,
  COMMERCE_SERVICE_EMAIL: process.env.COMMERCE_SERVICE_EMAIL,
  COMMERCE_SERVICE_PASSWORD: process.env.COMMERCE_SERVICE_PASSWORD,
  
  // Monitoring
  SENTRY_DSN: process.env.SENTRY_DSN,
  DATADOG_API_KEY: process.env.DATADOG_API_KEY,
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL
}

// Validate required environment variables
export const validateConfig = (): void => {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET'
  ]
  
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`)
    }
  }
  
  // Warn about optional but recommended variables
  const recommended = [
    'REDIS_URL',
    'MINIO_ENDPOINT',
    'ALGOLIA_APP_ID',
    'ALGOLIA_API_KEY'
  ]
  
  for (const key of recommended) {
    if (!process.env[key]) {
      console.warn(`⚠️  Missing recommended environment variable: ${key}`)
    }
  }
}

export default config