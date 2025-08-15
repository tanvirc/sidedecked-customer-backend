import { BaseEntity } from './base'

/**
 * Extended user profile for community features
 */
export interface UserProfile extends BaseEntity {
  customer_id: string      // Reference to commerce backend customer
  username: string
  display_name: string
  bio?: string
  
  // Profile customization
  avatar_url?: string
  banner_url?: string
  location?: string
  timezone?: string
  
  // Gaming preferences
  favorite_games: string[] // Game codes
  favorite_formats: string[]
  play_style: string[]     // casual, competitive, collector, etc.
  
  // Community stats
  reputation_score: number
  level: number
  experience_points: number
  
  // Activity metrics
  posts_count: number
  decks_shared_count: number
  trades_completed: number
  reviews_given: number
  
  // Privacy settings
  is_profile_public: boolean
  show_collection: boolean
  show_wishlist: boolean
  allow_trade_requests: boolean
  allow_messages: boolean
  
  // Verification status
  is_verified: boolean
  verification_badges: string[]
  
  // Achievements
  badges: UserBadge[]
  achievements: UserAchievement[]
}

/**
 * User following relationships
 */
export interface UserFollow extends BaseEntity {
  follower_id: string      // User who is following
  following_id: string     // User being followed
  
  // Follow metadata
  follow_type: 'follow' | 'friend' | 'blocked'
  notification_enabled: boolean
  followed_at: Date
}

/**
 * User activity feed
 */
export interface Activity extends BaseEntity {
  user_id: string
  activity_type: ActivityType
  
  // Activity content
  title: string
  description?: string
  entity_type: string      // deck, card, trade, etc.
  entity_id: string
  
  // Metadata
  is_public: boolean
  tags: string[]
  
  // Engagement
  likes_count: number
  comments_count: number
  shares_count: number
}

export enum ActivityType {
  DECK_CREATED = 'deck_created',
  DECK_UPDATED = 'deck_updated',
  DECK_SHARED = 'deck_shared',
  CARD_ACQUIRED = 'card_acquired',
  TRADE_COMPLETED = 'trade_completed',
  ACHIEVEMENT_EARNED = 'achievement_earned',
  REVIEW_Posted = 'review_posted',
  TOURNAMENT_JOINED = 'tournament_joined',
  COLLECTION_MILESTONE = 'collection_milestone'
}

/**
 * Direct messaging system
 */
export interface Conversation extends BaseEntity {
  participants: string[]   // Array of user IDs
  conversation_type: 'direct' | 'group' | 'trade_negotiation'
  
  // Conversation metadata
  title?: string
  last_message_id?: string
  last_activity_at: Date
  
  // Trade context (if applicable)
  trade_id?: string
  is_trade_active: boolean
  
  // Moderation
  is_archived: boolean
  is_muted: boolean
}

export interface Message extends BaseEntity {
  conversation_id: string
  sender_id: string
  
  // Message content
  content: string
  message_type: 'text' | 'image' | 'card_reference' | 'deck_reference' | 'trade_offer'
  
  // Rich content
  card_references: string[] // Card IDs mentioned
  deck_references: string[] // Deck IDs shared
  image_urls: string[]
  
  // Message status
  is_read: boolean
  read_by: Record<string, Date> // User ID -> read timestamp
  is_edited: boolean
  edit_history: MessageEdit[]
  
  // Moderation
  is_flagged: boolean
  is_deleted: boolean
}

export interface MessageEdit {
  edited_at: Date
  previous_content: string
  edit_reason?: string
}

/**
 * Forum system
 */
export interface ForumCategory extends BaseEntity {
  name: string
  description: string
  slug: string
  
  // Hierarchy
  parent_category_id?: string
  subcategories: ForumCategory[]
  order_priority: number
  
  // Game/format specific
  game_id?: string
  format?: string
  
  // Statistics
  topics_count: number
  posts_count: number
  last_activity_at?: Date
  
  // Permissions
  required_level: number
  moderator_ids: string[]
  
  // Display
  icon?: string
  color?: string
  is_featured: boolean
}

export interface ForumTopic extends BaseEntity {
  category_id: string
  author_id: string
  
  // Topic content
  title: string
  content: string
  topic_type: 'discussion' | 'question' | 'guide' | 'announcement'
  
  // Topic metadata
  tags: string[]
  is_pinned: boolean
  is_locked: boolean
  is_solved: boolean       // For question topics
  
  // Statistics
  views_count: number
  replies_count: number
  likes_count: number
  last_reply_at?: Date
  last_reply_by?: string
  
  // Moderation
  is_featured: boolean
  featured_until?: Date
  moderator_notes?: string
}

export interface ForumPost extends BaseEntity {
  topic_id: string
  author_id: string
  
  // Post content
  content: string
  post_number: number      // Sequential number in topic
  
  // Rich content
  card_references: string[]
  deck_references: string[]
  image_urls: string[]
  
  // Engagement
  likes_count: number
  liked_by: string[]
  
  // Post metadata
  is_solution: boolean     // Marked as solution for question topics
  is_edited: boolean
  edit_history: PostEdit[]
  
  // Moderation
  is_flagged: boolean
  is_deleted: boolean
  moderator_action?: string
}

export interface PostEdit {
  edited_at: Date
  edited_by: string
  previous_content: string
  edit_reason?: string
}

/**
 * Reputation and badge system
 */
export interface UserBadge extends BaseEntity {
  user_id: string
  badge_type: string
  
  // Badge details
  name: string
  description: string
  icon_url: string
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  
  // Earning criteria
  earned_for: string       // Description of what earned the badge
  earned_at: Date
  
  // Display
  is_featured: boolean
  display_order: number
}

export interface UserAchievement extends BaseEntity {
  user_id: string
  achievement_id: string
  
  // Achievement progress
  current_value: number
  target_value: number
  is_completed: boolean
  completed_at?: Date
  
  // Achievement details
  category: string         // collection, trading, community, competitive
  tier: number            // For tiered achievements
  
  // Rewards
  experience_reward: number
  badge_reward?: string
  title_reward?: string
}

/**
 * Events and tournaments
 */
export interface Event extends BaseEntity {
  organizer_id: string
  
  // Event details
  title: string
  description: string
  event_type: 'tournament' | 'casual_meetup' | 'draft' | 'sealed' | 'online'
  
  // Game and format
  game_id: string
  format: string
  
  // Timing
  start_date: Date
  end_date: Date
  registration_deadline: Date
  
  // Location
  is_online: boolean
  venue_name?: string
  address?: string
  city?: string
  country?: string
  timezone: string
  
  // Entry
  entry_fee?: number
  max_participants?: number
  min_participants: number
  current_participants: number
  
  // Prizes
  prize_pool?: number
  prize_structure: PrizeStructure[]
  
  // Status
  status: 'planning' | 'open_registration' | 'full' | 'in_progress' | 'completed' | 'cancelled'
  registration_required: boolean
  
  // Rules and info
  rules_url?: string
  stream_url?: string
  bracket_url?: string
}

export interface PrizeStructure {
  placement: string        // "1st", "2nd", "Top 8", etc.
  prize_type: 'cash' | 'product' | 'credit' | 'points'
  prize_value: number
  prize_description: string
}

export interface EventRegistration extends BaseEntity {
  event_id: string
  user_id: string
  
  // Registration details
  deck_id?: string
  deck_list?: string       // Submitted decklist
  
  // Status
  registration_status: 'registered' | 'waitlist' | 'confirmed' | 'checked_in' | 'dropped'
  check_in_time?: Date
  
  // Results
  final_placement?: number
  match_wins: number
  match_losses: number
  match_draws: number
  
  // Prizes won
  prizes_won: PrizeWon[]
}

export interface PrizeWon {
  prize_type: string
  prize_value: number
  prize_description: string
  awarded_at: Date
}

/**
 * Trade negotiation system
 */
export interface TradeOffer extends BaseEntity {
  from_user_id: string
  to_user_id: string
  
  // Offer details
  offered_cards: TradeCard[]
  requested_cards: TradeCard[]
  cash_offered: number
  cash_requested: number
  
  // Trade metadata
  message?: string
  expires_at?: Date
  
  // Status tracking
  status: 'pending' | 'accepted' | 'declined' | 'countered' | 'expired' | 'completed' | 'cancelled'
  response_message?: string
  
  // Completion details
  completed_at?: Date
  shipping_method?: string
  tracking_numbers: string[]
  
  // Reviews
  review_from_sender?: TradeReview
  review_from_receiver?: TradeReview
}

export interface TradeCard {
  card_id: string
  print_id?: string
  quantity: number
  condition: string
  estimated_value: number
  notes?: string
}

export interface TradeReview {
  rating: number           // 1-5 stars
  comment?: string
  delivery_speed: number   // 1-5 stars
  card_condition_accuracy: number // 1-5 stars
  communication: number    // 1-5 stars
  would_trade_again: boolean
}