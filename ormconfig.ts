import { DataSource } from 'typeorm'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Import all entities from compiled JS
import { Game } from './dist/src/entities/Game.js'
import { Card } from './dist/src/entities/Card.js'
import { Print } from './dist/src/entities/Print.js'
import { CardSet } from './dist/src/entities/CardSet.js'
import { CatalogSKU } from './dist/src/entities/CatalogSKU.js'
import { CardImage } from './dist/src/entities/CardImage.js'
import { ETLJob } from './dist/src/entities/ETLJob.js'
import { Deck } from './dist/src/entities/Deck.js'
import { DeckCard } from './dist/src/entities/DeckCard.js'
import { Format } from './dist/src/entities/Format.js'
import { UserProfile } from './dist/src/entities/UserProfile.js'
import { UserFollow } from './dist/src/entities/UserFollow.js'
import { Activity } from './dist/src/entities/Activity.js'
import { Conversation } from './dist/src/entities/Conversation.js'
import { Message } from './dist/src/entities/Message.js'
import { ForumCategory } from './dist/src/entities/ForumCategory.js'
import { ForumTopic } from './dist/src/entities/ForumTopic.js'
import { ForumPost } from './dist/src/entities/ForumPost.js'
import { UserCollection } from './dist/src/entities/UserCollection.js'
import { PriceHistory } from './dist/src/entities/PriceHistory.js'
import { MarketPrice } from './dist/src/entities/MarketPrice.js'
import { PriceAlert } from './dist/src/entities/PriceAlert.js'
import { PricePrediction } from './dist/src/entities/PricePrediction.js'
import { Wishlist } from './dist/src/entities/Wishlist.js'
import { WishlistItem } from './dist/src/entities/WishlistItem.js'
import { SellerRating } from './dist/src/entities/SellerRating.js'

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgres://localhost:5432/sidedecked_db',
  synchronize: false,
  logging: false,
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
  ],
  migrations: ['dist/src/migrations/*.js'],
  subscribers: ['dist/src/subscribers/*.js']
})