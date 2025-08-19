import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique
} from 'typeorm'

@Entity('market_prices')
@Index(['catalog_sku'])
@Index(['catalog_sku', 'condition', 'language'])
@Index(['catalog_sku', 'source'])
@Index(['last_scraped'])
@Unique(['catalog_sku', 'condition', 'language', 'source', 'seller_id'])
export class MarketPrice {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'varchar', length: 100 })
  catalog_sku: string

  @Column({ type: 'varchar', length: 50 })
  source: string // 'tcgplayer', 'cardmarket', 'ebay', 'amazon', etc.

  @Column({ type: 'varchar', length: 100, nullable: true })
  seller_id?: string

  @Column({ type: 'varchar', length: 200, nullable: true })
  seller_name?: string

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  shipping_cost?: number

  @Column({ type: 'varchar', length: 10 })
  condition: string // NM, LP, MP, HP, DMG

  @Column({ type: 'varchar', length: 10, default: 'EN' })
  language: string

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string

  @Column({ type: 'integer', nullable: true })
  stock_quantity?: number

  @Column({ type: 'text', nullable: true })
  listing_url?: string

  @Column({ type: 'text', nullable: true })
  image_url?: string

  @Column({ type: 'boolean', default: true })
  is_available: boolean

  @Column({ type: 'boolean', default: false })
  is_foil: boolean

  @Column({ type: 'varchar', length: 50, nullable: true })
  set_code?: string

  @Column({ type: 'varchar', length: 20, nullable: true })
  card_number?: string

  @Column({ type: 'jsonb', nullable: true })
  additional_data?: Record<string, any> // Store source-specific metadata

  @Column({ type: 'integer', default: 0 })
  seller_rating?: number

  @Column({ type: 'integer', default: 0 })
  seller_feedback_count?: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  total_price?: number // price + shipping

  @Column({ type: 'timestamp' })
  last_scraped: Date

  @Column({ type: 'timestamp', nullable: true })
  last_available?: Date

  @CreateDateColumn()
  created_at: Date

  @UpdateDateColumn()
  updated_at: Date

  // Calculated fields
  get price_per_unit(): number {
    return this.total_price || (this.price + (this.shipping_cost || 0))
  }

  get seller_trustworthiness(): 'high' | 'medium' | 'low' | 'unknown' {
    if (!this.seller_rating || !this.seller_feedback_count) return 'unknown'
    
    if (this.seller_rating >= 95 && this.seller_feedback_count >= 100) return 'high'
    if (this.seller_rating >= 90 && this.seller_feedback_count >= 25) return 'medium'
    return 'low'
  }

  get is_stale(): boolean {
    const staleThreshold = 24 * 60 * 60 * 1000 // 24 hours
    return Date.now() - this.last_scraped.getTime() > staleThreshold
  }

  get condition_rank(): number {
    const ranks: Record<string, number> = { 'NM': 5, 'LP': 4, 'MP': 3, 'HP': 2, 'DMG': 1 }
    return ranks[this.condition] || 0
  }
}