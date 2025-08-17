import { BaseEntity } from './base'

/**
 * User deck entity
 */
export interface Deck extends BaseEntity {
  user_id: string          // Reference to commerce backend customer
  name: string
  description?: string
  game_id: string
  format: string           // Standard, Modern, Commander, etc.
  
  // Deck metadata
  is_public: boolean
  is_featured: boolean
  is_legal: boolean        // Format legality
  
  // Statistics
  total_cards: number
  unique_cards: number
  mana_curve?: Record<string, number>  // CMC distribution for MTG
  color_distribution?: Record<string, number>
  avg_mana_value?: number
  
  // Community features
  likes_count: number
  views_count: number
  copies_count: number     // How many times deck was copied
  comments_count: number
  
  // Pricing (cached from pricing service)
  estimated_value?: number
  budget_tier: 'budget' | 'mid' | 'high' | 'competitive'
  price_updated_at?: Date
  
  // Deck image/thumbnail
  cover_card_id?: string
  thumbnail_url?: string
}

/**
 * Cards in a deck with quantities and categories
 */
export interface DeckCard extends BaseEntity {
  deck_id: string
  card_id: string
  print_id?: string        // Specific printing preference
  
  // Quantities by category
  mainboard_quantity: number
  sideboard_quantity: number
  commander_quantity: number   // For Commander format
  companion_quantity: number   // For companion cards
  
  // User notes and preferences
  notes?: string
  is_proxy: boolean
  is_owned: boolean
  priority: 'low' | 'medium' | 'high'  // Acquisition priority
  
  // Cached card data for performance
  card_name: string
  mana_cost?: string
  mana_value?: number
  primary_type: string
  rarity: string
  
  // Pricing cache
  preferred_printing_price?: number
  cheapest_printing_price?: number
}

/**
 * Format definitions with validation rules
 */
export interface Format extends BaseEntity {
  game_id: string
  name: string
  display_name: string
  description: string
  
  // Format rules
  min_deck_size: number
  max_deck_size?: number
  max_copies_per_card: number
  allows_sideboard: boolean
  max_sideboard_size?: number
  
  // Special rules
  banned_cards: string[]   // Card oracle_ids
  restricted_cards: string[] // Limited to 1 copy
  commander_legal: boolean
  allows_digital_only: boolean
  
  // Rotation
  is_rotating: boolean
  rotation_date?: Date
  legal_sets: string[]     // Set codes
  
  // Status
  is_active: boolean
  is_official: boolean
  popularity_rank: number
}

/**
 * Deck validation result
 */
export interface DeckValidation {
  is_valid: boolean
  format: string
  errors: DeckValidationError[]
  warnings: ValidationWarning[]
  suggestions: DeckSuggestion[]
  
  // Statistics
  deck_size: number
  sideboard_size: number
  color_identity: string[]
  mana_curve: Record<string, number>
  
  // Legality by format
  format_legality: Record<string, boolean>
}

export interface DeckValidationError {
  type: 'deck_size' | 'banned_card' | 'too_many_copies' | 'illegal_card' | 'commander_rule'
  message: string
  card_id?: string
  card_name?: string
  severity: 'error' | 'warning'
}

export interface ValidationWarning {
  type: 'mana_curve' | 'color_balance' | 'land_count' | 'budget'
  message: string
  suggestion?: string
}

export interface DeckSuggestion {
  type: 'add_card' | 'remove_card' | 'replace_card' | 'adjust_quantities'
  message: string
  card_id?: string
  card_name?: string
  reasoning: string
  confidence: number  // 0-1 confidence score
}

/**
 * Deck archetype classification
 */
export interface DeckArchetype extends BaseEntity {
  game_id: string
  format: string
  name: string
  description: string
  
  // Archetype characteristics
  primary_colors: string[]
  key_cards: string[]      // Oracle IDs of defining cards
  strategy: string         // aggro, control, combo, midrange, etc.
  
  // Meta statistics
  play_rate: number        // Percentage of meta
  win_rate: number
  popularity_trend: 'rising' | 'stable' | 'falling'
  
  // Example decklist
  sample_deck_id?: string
  guide_url?: string
}

/**
 * Collection integration
 */
export interface UserCollection extends BaseEntity {
  user_id: string
  card_id: string
  print_id?: string
  
  // Ownership details
  quantity_owned: number
  condition: string
  is_foil: boolean
  is_graded: boolean
  grade?: string
  
  // Acquisition info
  acquired_date?: Date
  acquisition_price?: number
  current_value?: number
  
  // Organization
  binder_location?: string
  tags: string[]
  notes?: string
}

/**
 * Deck completion analysis
 */
export interface DeckCompletion {
  deck_id: string
  user_id: string
  
  // Completion statistics
  cards_owned: number
  cards_needed: number
  completion_percentage: number
  
  // Missing cards breakdown
  missing_cards: MissingCard[]
  total_missing_value: number
  budget_options_available: boolean
  
  // Acquisition suggestions
  recommended_purchases: PurchaseSuggestion[]
  alternative_printings: AlternativePrinting[]
}

export interface MissingCard {
  card_id: string
  card_name: string
  quantity_needed: number
  preferred_printing_id?: string
  min_price: number
  budget_printing_id?: string
  budget_price: number
  priority: 'high' | 'medium' | 'low'
}

export interface PurchaseSuggestion {
  vendor_id?: string
  cards: MissingCard[]
  total_price: number
  shipping_cost?: number
  estimated_total: number
  vendor_rating?: number
}

export interface AlternativePrinting {
  card_id: string
  current_printing_id: string
  current_price: number
  alternative_printing_id: string
  alternative_price: number
  savings: number
  quality_difference: string
}