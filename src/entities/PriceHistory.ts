import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

export interface PriceSnapshot {
  source: string
  price: number
  url?: string
  seller?: string
  condition: string
  language: string
  currency: string
  shipping?: number
  stock_quantity?: number
  last_seen: Date
}

@Entity('price_history')
@Index(['catalog_sku'])
@Index(['catalog_sku', 'recorded_at'])
@Index(['catalog_sku', 'condition', 'language'])
export class PriceHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'varchar', length: 100 })
  catalog_sku: string

  @Column({ type: 'varchar', length: 10 })
  condition: string

  @Column({ type: 'varchar', length: 10, default: 'EN' })
  language: string

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  lowest_price: number

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  average_price: number

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  highest_price: number

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  market_price: number // Our calculated fair market price

  @Column({ type: 'int', default: 0 })
  listings_count: number

  @Column({ type: 'int', default: 0 })
  in_stock_count: number

  @Column({ type: 'jsonb' })
  price_sources: PriceSnapshot[] // Array of price data from different sources

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string

  @Column({ type: 'varchar', length: 20, default: 'daily' })
  aggregation_period: string // daily, weekly, monthly

  @Column({ type: 'timestamp' })
  recorded_at: Date

  @CreateDateColumn()
  created_at: Date

  @UpdateDateColumn()
  updated_at: Date

  // Calculated fields
  get price_trend(): 'up' | 'down' | 'stable' {
    // This would be calculated based on previous records
    return 'stable'
  }

  get price_volatility(): number {
    // Calculate volatility based on price range
    if (this.lowest_price === 0) return 0
    return ((this.highest_price - this.lowest_price) / this.lowest_price) * 100
  }

  get market_confidence(): number {
    // Calculate confidence based on listings count and source diversity
    const sourceCount = this.price_sources.length
    const listingsWeight = Math.min(this.listings_count / 20, 1) // Max weight at 20+ listings
    const sourceWeight = Math.min(sourceCount / 5, 1) // Max weight at 5+ sources
    return Math.round((listingsWeight * 0.6 + sourceWeight * 0.4) * 100)
  }
}