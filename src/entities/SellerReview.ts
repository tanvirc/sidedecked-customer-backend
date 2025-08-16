import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn
} from 'typeorm'

export enum ReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  FLAGGED = 'flagged',
  REMOVED = 'removed'
}

export enum ReviewType {
  PURCHASE = 'purchase',
  COMMUNICATION = 'communication',
  SHIPPING = 'shipping',
  OVERALL = 'overall'
}

@Entity('seller_reviews')
@Index(['seller_id'])
@Index(['customer_id'])
@Index(['order_id'])
@Index(['status'])
@Index(['created_at'])
@Index(['rating'])
export class SellerReview {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'varchar', length: 100 })
  seller_id: string // References vendor from MedusaJS

  @Column({ type: 'varchar', length: 100 })
  customer_id: string // References customer from MedusaJS

  @Column({ type: 'varchar', length: 100, nullable: true })
  order_id?: string // References order from MedusaJS

  @Column({ type: 'varchar', length: 100, nullable: true })
  product_id?: string // References specific product reviewed

  @Column({ type: 'int', width: 1 })
  rating: number // 1-5 stars

  @Column({ type: 'text', nullable: true })
  title?: string

  @Column({ type: 'text', nullable: true })
  comment?: string

  @Column({ type: 'enum', enum: ReviewType, default: ReviewType.OVERALL })
  review_type: ReviewType

  @Column({ type: 'enum', enum: ReviewStatus, default: ReviewStatus.PENDING })
  status: ReviewStatus

  // Breakdown ratings (optional, 1-5 each)
  @Column({ type: 'int', width: 1, nullable: true })
  item_as_described_rating?: number

  @Column({ type: 'int', width: 1, nullable: true })
  shipping_speed_rating?: number

  @Column({ type: 'int', width: 1, nullable: true })
  communication_rating?: number

  @Column({ type: 'int', width: 1, nullable: true })
  packaging_rating?: number

  // Review metadata
  @Column({ type: 'boolean', default: false })
  is_verified_purchase: boolean

  @Column({ type: 'boolean', default: false })
  is_helpful: boolean

  @Column({ type: 'int', default: 0 })
  helpful_votes: number

  @Column({ type: 'int', default: 0 })
  total_votes: number

  @Column({ type: 'jsonb', nullable: true })
  images?: string[] // URLs to review images

  @Column({ type: 'text', nullable: true })
  seller_response?: string

  @Column({ type: 'timestamp', nullable: true })
  seller_response_at?: Date

  @Column({ type: 'text', nullable: true })
  moderation_notes?: string

  @Column({ type: 'varchar', length: 100, nullable: true })
  moderated_by?: string

  @Column({ type: 'timestamp', nullable: true })
  moderated_at?: Date

  @Column({ type: 'varchar', length: 50, nullable: true })
  transaction_hash?: string // For blockchain verification if implemented

  @CreateDateColumn()
  created_at: Date

  @UpdateDateColumn()
  updated_at: Date

  // Calculated fields
  get overall_rating(): number {
    if (this.item_as_described_rating && this.shipping_speed_rating && 
        this.communication_rating && this.packaging_rating) {
      return (this.item_as_described_rating + this.shipping_speed_rating + 
              this.communication_rating + this.packaging_rating) / 4
    }
    return this.rating
  }

  get helpful_percentage(): number {
    return this.total_votes > 0 ? (this.helpful_votes / this.total_votes) * 100 : 0
  }

  get is_recent(): boolean {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    return this.created_at > thirtyDaysAgo
  }

  get review_age_days(): number {
    return Math.floor((Date.now() - this.created_at.getTime()) / (1000 * 60 * 60 * 24))
  }
}