import { BaseEntity } from './base'

/**
 * Price data sources
 */
export enum PriceSource {
  TCGPLAYER = 'tcgplayer',
  CARDMARKET = 'cardmarket',
  EBAY = 'ebay',
  INTERNAL = 'internal',
  MANUAL = 'manual'
}

/**
 * Historical price tracking
 */
export interface PriceHistory extends BaseEntity {
  print_id: string
  source: PriceSource
  
  // Price data
  condition: string
  finish: string
  price: number
  currency: string
  
  // Market context
  quantity_available?: number
  vendor_count?: number
  sale_date?: Date          // For actual sales vs listings
  
  // Data quality
  confidence_score: number  // 0-1 score for price accuracy
  is_outlier: boolean      // Flagged as potential outlier
  
  // Metadata
  source_url?: string
  source_listing_id?: string
  collected_at: Date
}

/**
 * Current market prices with aggregation
 */
export interface MarketPrice extends BaseEntity {
  print_id: string
  condition: string
  finish: string
  
  // Aggregated pricing
  lowest_price: number
  market_price: number     // Weighted average
  highest_price: number
  median_price: number
  
  // Market depth
  total_listings: number
  vendor_count: number
  quantity_available: number
  
  // Price trends
  price_trend_7d: number   // Percentage change
  price_trend_30d: number
  price_trend_90d: number
  volatility_score: number // Price stability measure
  
  // Last update
  last_updated: Date
  stale_threshold: Date    // When this data becomes stale
  
  // Source breakdown
  source_prices: SourcePrice[]
}

export interface SourcePrice {
  source: PriceSource
  price: number
  quantity: number
  last_seen: Date
  confidence: number
}

/**
 * Price alerts for users
 */
export interface PriceAlert extends BaseEntity {
  user_id: string
  print_id: string
  condition: string
  finish: string
  
  // Alert criteria
  alert_type: 'price_drop' | 'price_target' | 'availability' | 'price_spike'
  target_price: number
  current_price: number
  percentage_threshold?: number  // For percentage-based alerts
  
  // Alert settings
  is_active: boolean
  notification_methods: string[] // email, push, sms
  frequency: 'immediate' | 'daily' | 'weekly'
  
  // Trigger history
  last_triggered?: Date
  trigger_count: number
  
  // Expiration
  expires_at?: Date
}

/**
 * ML-based price predictions
 */
export interface PricePrediction extends BaseEntity {
  print_id: string
  condition: string
  finish: string
  
  // Prediction timeframes
  prediction_7d: number
  prediction_30d: number
  prediction_90d: number
  
  // Confidence intervals
  confidence_low_7d: number
  confidence_high_7d: number
  confidence_low_30d: number
  confidence_high_30d: number
  confidence_low_90d: number
  confidence_high_90d: number
  
  // Model metadata
  model_version: string
  confidence_score: number
  prediction_factors: PredictionFactor[]
  
  // Generated date
  predicted_at: Date
  expires_at: Date
}

export interface PredictionFactor {
  factor_name: string
  impact_score: number     // -1 to 1, negative = price decrease
  importance: number       // 0-1, how important this factor is
  description: string
}

/**
 * Market analytics and insights
 */
export interface MarketReport extends BaseEntity {
  report_type: 'daily' | 'weekly' | 'monthly' | 'set_analysis' | 'format_analysis'
  
  // Report scope
  game_id?: string
  set_id?: string
  format?: string
  
  // Time period
  period_start: Date
  period_end: Date
  
  // Key metrics
  total_volume: number     // Total transaction volume
  average_price_change: number
  most_gained_cards: TopCard[]
  most_lost_cards: TopCard[]
  highest_volume_cards: TopCard[]
  
  // Market insights
  market_sentiment: 'bullish' | 'bearish' | 'neutral'
  volatility_index: number
  key_insights: string[]
  
  // Trend analysis
  emerging_archetypes: string[]
  declining_archetypes: string[]
  format_health_score: number
  
  // Report content
  summary: string
  detailed_analysis: string
  charts_data: Record<string, any>
}

export interface TopCard {
  card_id: string
  card_name: string
  current_price: number
  price_change: number
  price_change_percentage: number
  volume: number
  reason?: string
}

/**
 * Investment portfolio tracking
 */
export interface Portfolio extends BaseEntity {
  user_id: string
  name: string
  description?: string
  
  // Portfolio metrics
  total_invested: number
  current_value: number
  unrealized_gain_loss: number
  realized_gain_loss: number
  
  // Performance
  roi_percentage: number
  daily_change: number
  weekly_change: number
  monthly_change: number
  
  // Risk metrics
  volatility: number
  diversification_score: number
  risk_rating: 'low' | 'medium' | 'high'
  
  // Holdings
  holdings: PortfolioHolding[]
  transactions: PortfolioTransaction[]
  
  // Settings
  is_public: boolean
  auto_track_purchases: boolean
}

export interface PortfolioHolding {
  print_id: string
  quantity: number
  condition: string
  finish: string
  
  // Purchase info
  average_cost_basis: number
  total_invested: number
  purchase_dates: Date[]
  
  // Current valuation
  current_price: number
  current_value: number
  unrealized_gain_loss: number
  
  // Performance
  roi_percentage: number
  holding_period_days: number
  
  // Notes
  notes?: string
  tags: string[]
}

export interface PortfolioTransaction {
  portfolio_id: string
  print_id: string
  
  // Transaction details
  transaction_type: 'buy' | 'sell' | 'trade_in' | 'trade_out'
  quantity: number
  price_per_unit: number
  total_amount: number
  
  // Transaction metadata
  transaction_date: Date
  source: string           // Where the transaction occurred
  notes?: string
  
  // Trade specific
  trade_id?: string
  trade_partner?: string
}

/**
 * Price scraping and data collection
 */
export interface ScrapeJob extends BaseEntity {
  source: PriceSource
  job_type: 'full_scrape' | 'delta_scrape' | 'specific_cards'
  status: 'pending' | 'running' | 'completed' | 'failed'
  
  // Job configuration
  target_cards?: string[]   // Specific card IDs to scrape
  batch_size: number
  
  // Progress tracking
  total_cards: number
  processed_cards: number
  successful_updates: number
  failed_updates: number
  
  // Performance
  started_at?: Date
  completed_at?: Date
  duration_ms?: number
  cards_per_second?: number
  
  // Results
  price_updates_created: number
  errors: ScrapeError[]
  summary: Record<string, any>
}

export interface ScrapeError {
  card_id?: string
  error_type: string
  error_message: string
  retry_count: number
  occurred_at: Date
}

/**
 * Price comparison and shopping
 */
export interface PriceComparison {
  print_id: string
  condition: string
  finish: string
  
  // Vendor prices
  vendor_prices: VendorPrice[]
  
  // Best options
  lowest_price: VendorPrice
  best_value: VendorPrice     // Considers shipping, reputation, etc.
  fastest_shipping: VendorPrice
  
  // Market context
  market_price: number
  savings_vs_market: number
  price_range: [number, number]
  
  // Updated timestamp
  last_updated: Date
}

export interface VendorPrice {
  vendor_id: string
  vendor_name: string
  vendor_rating: number
  
  // Pricing
  price: number
  quantity_available: number
  shipping_cost: number
  total_cost: number
  
  // Vendor details
  location: string
  estimated_delivery: string
  return_policy: string
  
  // Quality indicators
  condition_accuracy: number
  shipping_speed: number
  customer_service: number
  
  // Links
  product_url: string
  last_verified: Date
}