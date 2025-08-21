import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn
} from 'typeorm'
import { Collection } from './Collection'
import { Card } from './Card'

@Entity('collection_cards')
export class CollectionCard {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  collectionId: string

  @Column({ type: 'uuid' })
  cardId: string

  @Column({ type: 'varchar', length: 255 })
  catalogSku: string

  @Column({ type: 'integer', default: 1 })
  quantity: number

  @Column({ type: 'varchar', length: 20, default: 'NM' })
  condition: 'M' | 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'

  @Column({ type: 'varchar', length: 10, default: 'EN' })
  language: string

  @Column({ type: 'boolean', default: false })
  isForTrade: boolean

  @Column({ type: 'text', nullable: true })
  notes?: string

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  acquiredPrice?: number

  @Column({ type: 'timestamp', nullable: true })
  acquiredDate?: Date

  @ManyToOne(() => Collection, collection => collection.cards, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'collectionId' })
  collection: Collection

  @ManyToOne(() => Card, { eager: false })
  @JoinColumn({ name: 'cardId' })
  card: Card

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}