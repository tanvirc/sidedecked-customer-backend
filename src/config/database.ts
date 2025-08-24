import { DataSource } from 'typeorm'
import { config } from './env'

// Import all entities
import { Game } from '../entities/Game'
import { Card } from '../entities/Card'
import { Print } from '../entities/Print'
import { CardSet } from '../entities/CardSet'
import { CatalogSKU } from '../entities/CatalogSKU'
import { CardImage } from '../entities/CardImage'
import { ETLJob } from '../entities/ETLJob'
import { Deck } from '../entities/Deck'
import { DeckCard } from '../entities/DeckCard'
import { Format } from '../entities/Format'
import { UserProfile } from '../entities/UserProfile'
import { UserFollow } from '../entities/UserFollow'
import { Activity } from '../entities/Activity'
import { Conversation } from '../entities/Conversation'
import { Message } from '../entities/Message'
import { ForumCategory } from '../entities/ForumCategory'
import { ForumTopic } from '../entities/ForumTopic'
import { ForumPost } from '../entities/ForumPost'
import { UserCollection } from '../entities/UserCollection'
import { PriceHistory } from '../entities/PriceHistory'
import { MarketPrice } from '../entities/MarketPrice'
import { PriceAlert } from '../entities/PriceAlert'
import { PricePrediction } from '../entities/PricePrediction'
import { Wishlist } from '../entities/Wishlist'
import { WishlistItem } from '../entities/WishlistItem'
import { SellerRating } from '../entities/SellerRating'
// Note: Portfolio entities are part of the pricing intelligence module (future implementation)
// import { Portfolio } from '../entities/Portfolio'
// import { PortfolioHolding } from '../entities/PortfolioHolding'
// import { PortfolioTransaction } from '../entities/PortfolioTransaction'

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: config.DATABASE_URL,
  synchronize: false, // Always use migrations in production
  logging: config.NODE_ENV === 'development' && !process.env.DISABLE_TYPEORM_LOGGING,
  // Enhanced connection pool settings for Railway production
  extra: {
    connectionTimeoutMillis: 60000, // Increased to 60s
    idleTimeoutMillis: 30000,
    query_timeout: 60000,
    statement_timeout: 60000,
    max: 10, // Reduced pool size for Railway limits
    min: 2,  // Maintain minimum connections
    acquireTimeoutMillis: 60000,
    ssl: config.NODE_ENV === 'production' ? { 
      rejectUnauthorized: false,
      sslmode: 'require'
    } : false
  },
  // Connection retry settings with higher timeouts
  connectTimeoutMS: 60000,
  entities: [
    // TCG Catalog
    Game,
    Card,
    Print,
    CardSet,
    CatalogSKU,
    CardImage,
    ETLJob,
    
    // Deck Builder
    Deck,
    DeckCard,
    Format,
    UserCollection,
    
    // Community
    UserProfile,
    UserFollow,
    Activity,
    Conversation,
    Message,
    ForumCategory,
    ForumTopic,
    ForumPost,
    
    // Pricing
    PriceHistory,
    MarketPrice,
    PriceAlert,
    PricePrediction,
    
    // Wishlist
    Wishlist,
    WishlistItem,
    
    // Seller Management
    SellerRating
    // Portfolio entities will be added in pricing intelligence module
    // Portfolio,
    // PortfolioHolding,
    // PortfolioTransaction
  ],
  migrations: ['dist/src/migrations/*.js'],
  subscribers: ['dist/src/subscribers/*.js']
})

export const initializeDatabase = async (maxRetries: number = 5): Promise<void> => {
  let retryCount = 0
  const retryDelay = (attempt: number) => Math.min(2000 * Math.pow(2, attempt), 30000) // Longer exponential backoff, max 30s

  while (retryCount < maxRetries) {
    try {
      if (!AppDataSource.isInitialized) {
        console.log(`🔄 Attempting database connection (attempt ${retryCount + 1}/${maxRetries})...`)
        
        // Test connection first with a simple query
        await AppDataSource.initialize()
        
        // Verify connection is actually working
        const result = await AppDataSource.query('SELECT 1 as test')
        if (!result || result.length === 0) {
          throw new Error('Database connection test failed')
        }
        
        console.log('🗄️  Database connection established and verified')
        
        // Run pending migrations
        const pendingMigrations = await AppDataSource.showMigrations()
        if (pendingMigrations) {
          console.log('⏳ Running pending migrations...')
          await AppDataSource.runMigrations()
          console.log('✅ Migrations completed')
        }
        return // Success, exit function
      }
    } catch (error) {
      retryCount++
      const errorMessage = (error as Error).message
      const isConnectionRefused = errorMessage.includes('ECONNREFUSED') || errorMessage.includes('connect timeout')
      
      console.error(`❌ Database connection failed (attempt ${retryCount}/${maxRetries}):`, errorMessage)
      
      if (isConnectionRefused) {
        console.error('🔌 Connection refused - check network connectivity and database service status')
      }
      
      if (retryCount >= maxRetries) {
        console.error('❌ Max database connection retries exceeded')
        
        // Provide specific guidance based on error type
        if (isConnectionRefused) {
          console.error('💡 Troubleshooting tips:')
          console.error('   - Verify DATABASE_URL is correct')
          console.error('   - Check if database service is running on Railway')
          console.error('   - Ensure network connectivity to Railway PostgreSQL')
        }
        
        throw new Error(`Database connection failed after ${maxRetries} attempts: ${errorMessage}`)
      }
      
      // Clean up failed connection attempt
      if (AppDataSource.isInitialized) {
        try {
          await AppDataSource.destroy()
        } catch (destroyError) {
          console.warn('Warning: Failed to clean up database connection:', (destroyError as Error).message)
        }
      }
      
      const delay = retryDelay(retryCount - 1)
      console.log(`⏳ Retrying database connection in ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

/**
 * Check database connection health
 */
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    if (!AppDataSource.isInitialized) {
      return false
    }
    
    await AppDataSource.query('SELECT 1')
    return true
  } catch (error) {
    console.error('Database health check failed:', (error as Error).message)
    return false
  }
}

/**
 * Middleware to handle database connection errors gracefully
 */
export const databaseErrorHandler = async (operation: () => Promise<any>): Promise<any> => {
  try {
    return await operation()
  } catch (error) {
    const errorMessage = (error as Error).message
    
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('connect timeout')) {
      console.error('Database connection lost, attempting to reconnect...')
      
      // Try to reinitialize connection
      try {
        await initializeDatabase(3) // Quick retry with fewer attempts
        console.log('Database connection restored, retrying operation...')
        return await operation()
      } catch (reconnectError) {
        console.error('Failed to restore database connection:', (reconnectError as Error).message)
        throw new Error('Database connection lost and could not be restored')
      }
    }
    
    throw error // Re-throw non-connection errors
  }
}

export const closeDatabase = async (): Promise<void> => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy()
    console.log('🔌 Database connection closed')
  }
}