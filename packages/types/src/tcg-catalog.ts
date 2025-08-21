import { BaseEntity, UniversalSKU, SortParams } from './base'

/**
 * Supported TCG Games
 */
export enum GameCode {
  MTG = 'MTG',
  POKEMON = 'POKEMON', 
  YUGIOH = 'YUGIOH',
  ONEPIECE = 'OPTCG'
}

/**
 * TCG Game definition
 */
export interface Game extends BaseEntity {
  code: GameCode
  name: string
  display_name: string
  
  // Game mechanics flags
  has_colors: boolean
  has_energy_types: boolean
  has_power_toughness: boolean
  has_levels: boolean
  
  // ETL configuration
  etl_enabled: boolean
  etl_source: string
  last_etl_run?: Date
  
  // Display configuration
  card_back_image: string
  primary_color: string
  logo_url: string
}

/**
 * Universal card entity - game-agnostic fields
 */
export interface Card extends BaseEntity {
  oracle_id: string         // Unique across all printings
  name: string
  normalized_name: string   // For search optimization
  game_id: string
  
  // Universal fields (most games)
  oracle_text?: string
  flavor_text?: string
  keywords: string[]
  
  // Type information
  primary_type?: string     // Creature, Instant, Pokemon, etc.
  subtypes: string[]
  supertypes: string[]
  
  // Game-specific fields (nullable for games that don't use them)
  // MTG specific
  mana_cost?: string
  mana_value?: number
  colors: string[]          // W, U, B, R, G for MTG
  color_identity: string[]
  power_value?: number
  defense_value?: number    // Toughness for MTG, HP for Pokemon
  
  // Pokemon specific  
  hp?: number
  retreat_cost?: number
  energy_types: string[]    // Fire, Water, etc.
  
  // YuGiOh specific
  attribute?: string        // LIGHT, DARK, etc.
  level?: number
  rank?: number
  attack_value?: number
  defense_value_yugioh?: number
  
  // One Piece specific
  cost?: number
  power?: number
  counter?: number
  life?: number
  
  // Search optimization
  search_vector?: string    // PostgreSQL tsvector
  popularity_score: number
  total_views: number
  total_searches: number
}

/**
 * Card printing/edition - game-specific implementations
 */
export interface Print extends BaseEntity {
  card_id: string
  set_id: string
  
  // Print identification
  number: string            // Card number in set
  rarity: string
  artist: string
  language: string
  
  // Images and assets
  image_small: string
  image_normal: string  
  image_large: string
  image_art_crop?: string
  image_border_crop?: string
  blurhash: string         // For progressive loading
  
  // Print-specific attributes
  finish: string           // normal, foil, etched, etc.
  variation?: string       // alternate art, promo, etc.
  frame: string           // 1993, 1997, 2003, 2015, future, etc.
  border_color: string    // black, white, borderless, etc.
  
  // Format legality - MTG
  is_legal_standard: boolean
  is_legal_pioneer: boolean  
  is_legal_modern: boolean
  is_legal_legacy: boolean
  is_legal_vintage: boolean
  is_legal_commander: boolean
  is_legal_pauper: boolean
  is_legal_brawl: boolean
  
  // Format legality - Pokemon TCG
  is_legal_pokemon_standard: boolean
  is_legal_pokemon_expanded: boolean
  is_legal_pokemon_unlimited: boolean
  
  // Format legality - Yu-Gi-Oh!
  is_legal_yugioh_advanced: boolean
  is_legal_yugioh_traditional: boolean
  
  // Format legality - One Piece Card Game
  is_legal_onepiece_standard: boolean
  
  // Market data
  tcgplayer_id?: string
  cardmarket_id?: string
  scryfall_id?: string
  
  // Pricing cache (updated from pricing service)
  current_price_low?: number
  current_price_mid?: number
  current_price_high?: number
  price_updated_at?: Date
}

/**
 * Card set information
 */
export interface CardSet extends BaseEntity {
  game_id: string
  code: string             // Set abbreviation
  name: string
  
  // Set metadata
  set_type: string         // core, expansion, masters, etc.
  block?: string          // Block name for MTG
  release_date: Date
  card_count: number
  
  // Images
  icon_svg_uri?: string
  logo_uri?: string
  
  // MTG specific
  mtg_arena_code?: string
  mtg_tcgplayer_id?: number
  
  // Pokemon specific
  pokemon_series?: string
  pokemon_legalities?: Record<string, string>
  
  // Market data
  is_digital: boolean
  is_foil_only: boolean
}

/**
 * Universal SKU mapping for marketplace integration
 */
export interface CatalogSKU extends BaseEntity {
  sku: string              // Universal SKU format
  print_id: string
  
  // SKU breakdown
  game_code: string
  set_code: string
  card_number: string
  language: string
  condition: string
  finish: string
  grade?: string
  
  // Marketplace integration
  is_available_b2c: boolean
  is_available_c2c: boolean
  vendor_count: number
  
  // Cached aggregated pricing (from pricing service)
  min_price?: number
  max_price?: number
  avg_price?: number
  median_price?: number
  market_price?: number
  price_trend: 'up' | 'down' | 'stable'
  price_updated_at?: Date
}

/**
 * ETL job tracking
 */
export interface ETLJob extends BaseEntity {
  game_code: string
  job_type: 'full_sync' | 'incremental' | 'images_only'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  
  // Job configuration
  triggered_by: 'schedule' | 'manual' | 'webhook'
  trigger_user_id?: string
  batch_size: number
  
  // Progress tracking
  total_records?: number
  processed_records: number
  failed_records: number
  skipped_records: number
  
  // Timing
  started_at?: Date
  completed_at?: Date
  duration_ms?: number
  
  // Results and logs
  result_summary?: Record<string, any>
  error_message?: string
  log_file_path?: string
  
  // Performance metrics
  records_per_second?: number
  peak_memory_usage?: number
}

/**
 * Search functionality
 */
export interface SearchQuery {
  text?: string
  filters: SearchFilters
  sort?: SortParams
  page: number
  limit: number
}

export interface SearchFilters {
  games?: string[]
  types?: string[]
  colors?: string[]
  rarities?: string[]
  keywords?: string[]
  sets?: string[]
  
  // Numeric ranges
  manaValueRange?: [number, number]
  powerRange?: [number, number]
  toughnessRange?: [number, number]
  priceRange?: [number, number]
  
  // Flags
  inStock?: boolean
  isLegal?: string[]       // format names
}

export interface SearchResults {
  hits: SearchHit[]
  totalHits: number
  facets: Record<string, Record<string, number>>
  processingTime: number
  page: number
  hasMore: boolean
}

export interface SearchHit {
  id: string
  name: string
  gameCode: string
  gameName: string
  primaryType?: string
  subtypes: string[]
  oracleText?: string
  keywords: string[]
  
  // Game-specific display fields
  manaCost?: string
  manaValue?: number
  colors: string[]
  powerValue?: number
  defenseValue?: number
  
  // Set information
  setNames: string[]
  rarities: string[]
  artists: string[]
  
  // Market data
  minPrice?: number
  maxPrice?: number
  avgPrice?: number
  hasB2C: boolean
  hasC2C: boolean
  
  // Popularity
  totalViews: number
  popularity: number
}