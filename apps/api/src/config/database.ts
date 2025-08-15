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
// Note: Portfolio entities are part of the pricing intelligence module (future implementation)
// import { Portfolio } from '../entities/Portfolio'
// import { PortfolioHolding } from '../entities/PortfolioHolding'
// import { PortfolioTransaction } from '../entities/PortfolioTransaction'

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: config.DATABASE_URL,
  synchronize: false, // Always use migrations in production
  logging: config.NODE_ENV === 'development',
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
    PricePrediction
    // Portfolio entities will be added in pricing intelligence module
    // Portfolio,
    // PortfolioHolding,
    // PortfolioTransaction
  ],
  migrations: ['dist/migrations/*.js'],
  subscribers: ['dist/subscribers/*.js']
})

export const initializeDatabase = async (): Promise<void> => {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize()
      console.log('🗄️  Database connection established')
      
      // Run pending migrations
      const pendingMigrations = await AppDataSource.showMigrations()
      if (pendingMigrations) {
        console.log('⏳ Running pending migrations...')
        await AppDataSource.runMigrations()
        console.log('✅ Migrations completed')
      }
    }
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    throw error
  }
}

export const closeDatabase = async (): Promise<void> => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy()
    console.log('🔌 Database connection closed')
  }
}