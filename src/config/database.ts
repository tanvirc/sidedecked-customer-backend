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
// Note: Portfolio entities are part of the pricing intelligence module (future implementation)
// import { Portfolio } from '../entities/Portfolio'
// import { PortfolioHolding } from '../entities/PortfolioHolding'
// import { PortfolioTransaction } from '../entities/PortfolioTransaction'

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: config.DATABASE_URL,
  synchronize: false, // Always use migrations in production
  logging: config.NODE_ENV === 'development' && !process.env.DISABLE_TYPEORM_LOGGING,
  // Connection pool settings for Railway
  extra: {
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    max: 20,
    ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  },
  // Connection retry settings
  connectTimeoutMS: 30000,
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
    WishlistItem
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
  const retryDelay = (attempt: number) => Math.min(1000 * Math.pow(2, attempt), 10000) // Exponential backoff, max 10s

  while (retryCount < maxRetries) {
    try {
      if (!AppDataSource.isInitialized) {
        console.log(`🔄 Attempting database connection (attempt ${retryCount + 1}/${maxRetries})...`)
        await AppDataSource.initialize()
        console.log('🗄️  Database connection established')
        
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
      console.error(`❌ Database connection failed (attempt ${retryCount}/${maxRetries}):`, (error as Error).message)
      
      if (retryCount >= maxRetries) {
        console.error('❌ Max database connection retries exceeded')
        throw new Error(`Database connection failed after ${maxRetries} attempts: ${(error as Error).message}`)
      }
      
      const delay = retryDelay(retryCount - 1)
      console.log(`⏳ Retrying database connection in ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

export const closeDatabase = async (): Promise<void> => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy()
    console.log('🔌 Database connection closed')
  }
}