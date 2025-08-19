import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm'
import { WishlistItem } from './WishlistItem'

@Entity('wishlists')
@Index(['user_id'])
@Index(['user_id', 'name'], { unique: true })
export class Wishlist {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  user_id: string

  @Column({ type: 'varchar', length: 255 })
  name: string

  @Column({ type: 'text', nullable: true })
  description?: string

  // Privacy settings
  @Column({ type: 'boolean', default: false })
  is_public: boolean

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  share_token?: string

  // Metadata
  @Column({ type: 'integer', default: 0 })
  item_count: number

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  total_value: number

  // Relationships
  @OneToMany(() => WishlistItem, item => item.wishlist, { cascade: true })
  items: WishlistItem[]

  @CreateDateColumn()
  created_at: Date

  @UpdateDateColumn()
  updated_at: Date
}