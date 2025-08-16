import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique
} from 'typeorm'

export enum SellerTier {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
  DIAMOND = 'diamond'
}

export enum VerificationStatus {
  UNVERIFIED = 'unverified',
  PENDING = 'pending',
  VERIFIED = 'verified',
  SUSPENDED = 'suspended'
}

@Entity('seller_ratings')
@Index(['seller_id'])
@Index(['overall_rating'])
@Index(['verification_status'])
@Index(['seller_tier'])
@Unique(['seller_id'])
export class SellerRating {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'varchar', length: 100, unique: true })
  seller_id: string // References vendor from MedusaJS

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  overall_rating: number // 0.00 - 5.00

  @Column({ type: 'int', default: 0 })
  total_reviews: number

  @Column({ type: 'int', default: 0 })
  total_orders: number

  @Column({ type: 'int', default: 0 })
  total_sales_volume: number // In cents

  // Breakdown ratings (0.00 - 5.00)
  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  item_as_described_rating: number

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  shipping_speed_rating: number

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  communication_rating: number

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  packaging_rating: number

  // Performance metrics
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  response_rate_percentage: number // 0.00 - 100.00

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  on_time_shipping_percentage: number

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  dispute_rate_percentage: number

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  cancellation_rate_percentage: number

  // Recent performance (last 30 days)
  @Column({ type: 'int', default: 0 })
  recent_orders_count: number

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  recent_average_rating: number

  @Column({ type: 'int', default: 0 })
  recent_disputes: number

  // Trust metrics
  @Column({ type: 'int', default: 0 })
  trust_score: number // 0-1000 calculated score

  @Column({ type: 'enum', enum: SellerTier, default: SellerTier.BRONZE })
  seller_tier: SellerTier

  @Column({ type: 'enum', enum: VerificationStatus, default: VerificationStatus.UNVERIFIED })
  verification_status: VerificationStatus

  @Column({ type: 'timestamp', nullable: true })
  verified_at?: Date

  @Column({ type: 'varchar', length: 100, nullable: true })
  verified_by?: string

  // Business verification
  @Column({ type: 'boolean', default: false })
  is_business_verified: boolean

  @Column({ type: 'boolean', default: false })
  is_identity_verified: boolean

  @Column({ type: 'boolean', default: false })
  is_address_verified: boolean

  @Column({ type: 'boolean', default: false })
  is_payment_verified: boolean

  // Special statuses
  @Column({ type: 'boolean', default: false })
  is_power_seller: boolean

  @Column({ type: 'boolean', default: false })
  is_featured_seller: boolean

  @Column({ type: 'boolean', default: false })
  is_preferred_seller: boolean

  @Column({ type: 'boolean', default: false })
  is_top_rated: boolean

  // Time-based metrics
  @Column({ type: 'timestamp', nullable: true })
  first_sale_at?: Date

  @Column({ type: 'int', default: 0 })
  months_active: number

  @Column({ type: 'int', default: 0 })
  consecutive_months_active: number

  // Badges and achievements
  @Column({ type: 'jsonb', nullable: true })
  badges?: string[] // Array of badge IDs or names

  @Column({ type: 'jsonb', nullable: true })
  achievements?: Array<{
    name: string
    earned_at: Date
    description: string
  }>

  // Performance history
  @Column({ type: 'jsonb', nullable: true })
  monthly_performance?: Array<{
    month: string
    orders: number
    rating: number
    revenue: number
    disputes: number
  }>

  // Risk assessment
  @Column({ type: 'varchar', length: 20, default: 'low' })
  risk_level: 'low' | 'medium' | 'high' | 'critical'

  @Column({ type: 'text', nullable: true })
  risk_notes?: string

  @Column({ type: 'timestamp', nullable: true })
  last_review_at?: Date

  @Column({ type: 'timestamp', nullable: true })
  last_order_at?: Date

  @CreateDateColumn()
  created_at: Date

  @UpdateDateColumn()
  updated_at: Date

  // Calculated properties
  get trustworthiness_level(): 'excellent' | 'good' | 'fair' | 'poor' {
    if (this.trust_score >= 800) return 'excellent'
    if (this.trust_score >= 600) return 'good'
    if (this.trust_score >= 400) return 'fair'
    return 'poor'
  }

  get is_reliable(): boolean {
    return this.overall_rating >= 4.0 && 
           this.total_reviews >= 10 && 
           this.dispute_rate_percentage < 5.0
  }

  get performance_score(): number {
    // Weighted score based on multiple factors
    const ratingWeight = 0.3
    const volumeWeight = 0.2
    const responseWeight = 0.2
    const shippingWeight = 0.15
    const disputeWeight = 0.15

    const ratingScore = (this.overall_rating / 5) * 100
    const volumeScore = Math.min((this.total_orders / 100) * 100, 100)
    const responseScore = this.response_rate_percentage
    const shippingScore = this.on_time_shipping_percentage
    const disputeScore = Math.max(0, 100 - (this.dispute_rate_percentage * 10))

    return Math.round(
      ratingScore * ratingWeight +
      volumeScore * volumeWeight +
      responseScore * responseWeight +
      shippingScore * shippingWeight +
      disputeScore * disputeWeight
    )
  }

  get seller_level(): string {
    if (this.is_top_rated) return 'Top Rated Seller'
    if (this.is_power_seller) return 'Power Seller'
    if (this.is_preferred_seller) return 'Preferred Seller'
    if (this.is_featured_seller) return 'Featured Seller'
    
    switch (this.seller_tier) {
      case SellerTier.DIAMOND: return 'Diamond Seller'
      case SellerTier.PLATINUM: return 'Platinum Seller'
      case SellerTier.GOLD: return 'Gold Seller'
      case SellerTier.SILVER: return 'Silver Seller'
      default: return 'Bronze Seller'
    }
  }

  get verification_badges(): string[] {
    const badges: string[] = []
    
    if (this.verification_status === VerificationStatus.VERIFIED) {
      badges.push('verified')
    }
    if (this.is_business_verified) badges.push('business')
    if (this.is_identity_verified) badges.push('identity')
    if (this.is_address_verified) badges.push('address')
    if (this.is_payment_verified) badges.push('payment')
    
    return badges
  }
}