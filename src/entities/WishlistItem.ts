import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm'
import { Wishlist } from './Wishlist'
import { CatalogSKU } from './CatalogSKU'

@Entity('wishlist_items')
@Index(['wishlist_id'])
@Index(['catalog_sku'])
@Index(['wishlist_id', 'catalog_sku'], { unique: true })
export class WishlistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  wishlist_id: string

  @Column({ length: 200 })
  catalog_sku: string

  // User preferences
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  max_price?: number

  @Column({ length: 10, nullable: true })
  preferred_condition?: string

  @Column({ length: 10, nullable: true })
  preferred_language?: string

  @Column({ type: 'text', nullable: true })
  notes?: string

  // Tracking
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  target_price?: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price_when_added?: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  current_lowest_price?: number

  // Notifications
  @Column({ default: true })
  price_alert_enabled: boolean

  @Column({ default: true })
  stock_alert_enabled: boolean

  @Column({ nullable: true })
  last_price_alert_sent?: Date

  @Column({ nullable: true })
  last_stock_alert_sent?: Date

  // Status
  @Column({ default: false })
  is_available: boolean

  @Column({ nullable: true })
  availability_last_checked?: Date

  // Relationships
  @ManyToOne(() => Wishlist, wishlist => wishlist.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'wishlistId' })
  wishlist: Wishlist

  // Note: We use catalog_sku as a string reference to avoid circular dependencies
  // The CatalogSKU relationship is resolved at the service level

  @CreateDateColumn()
  added_at: Date

  @UpdateDateColumn()
  updated_at: Date
}