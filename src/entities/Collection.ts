import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany
} from 'typeorm'
import { CollectionCard } from './CollectionCard'

@Entity('collections')
export class Collection {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'varchar', length: 255 })
  name: string

  @Column({ type: 'text', nullable: true })
  description?: string

  @Column({ type: 'varchar', length: 255 })
  userId: string

  @Column({ type: 'boolean', default: false })
  isPublic: boolean

  @Column({ type: 'varchar', length: 50, default: 'personal' })
  type: 'personal' | 'wishlist' | 'trading' | 'showcase'

  @OneToMany(() => CollectionCard, collectionCard => collectionCard.collection, { cascade: true })
  cards: CollectionCard[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date
}