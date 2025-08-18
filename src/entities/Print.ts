import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index
} from 'typeorm'
import { Card } from './Card'
import { CardSet } from './CardSet'
import { CatalogSKU } from './CatalogSKU'
import { CardImage } from './CardImage'

@Entity('prints')
@Index('idx_prints_hash', ['printHash'], { unique: true })
@Index('idx_prints_card_set_number', ['cardId', 'setId', 'collectorNumber'], { unique: true })
@Index('idx_prints_set', ['setId'])
@Index('idx_prints_rarity', ['rarity'])
@Index('idx_prints_artist', ['artist'])
export class Print {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  cardId: string

  @ManyToOne(() => Card, card => card.prints)
  @JoinColumn({ name: 'cardId' })
  card: Card

  @Column({ type: 'uuid' })
  setId: string

  @ManyToOne(() => CardSet, set => set.prints)
  @JoinColumn({ name: 'setId' })
  set: CardSet

  // Print identity
  @Column({ type: 'varchar', length: 64, unique: true })
  printHash: string // SHA-256 for print uniqueness

  @Column({ type: 'varchar', length: 50 })
  collectorNumber: string

  // Print characteristics
  @Column({ type: 'varchar', length: 20, nullable: true })
  rarity: string // Common, Rare, Mythic, etc.

  @Column({ type: 'varchar', length: 255, nullable: true })
  artist: string

  @Column({ type: 'text', nullable: true })
  flavorText: string // Can override card flavor

  @Column({ type: 'varchar', length: 10, default: 'en' })
  language: string

  // Special print features
  @Column({ type: 'boolean', default: false })
  isFoilAvailable: boolean

  @Column({ type: 'boolean', default: false })
  isAlternateArt: boolean

  @Column({ type: 'boolean', default: false })
  isPromo: boolean

  @Column({ type: 'boolean', default: false })
  isFirstEdition: boolean // YGO specific

  // Print variations
  @Column({ type: 'varchar', length: 50, default: 'normal' })
  finish: string // normal, foil, reverse, etched, etc.

  @Column({ type: 'varchar', length: 100, nullable: true })
  variation: string // extended art, showcase, borderless, etc.

  @Column({ type: 'varchar', length: 50, nullable: true })
  frame: string // 1993, 1997, 2003, 2015, future, etc.

  @Column({ type: 'varchar', length: 50, nullable: true })
  borderColor: string // black, white, silver, gold

  // Format legality
  @Column({ type: 'boolean', default: false })
  isLegalStandard: boolean

  @Column({ type: 'boolean', default: false })
  isLegalPioneer: boolean

  @Column({ type: 'boolean', default: false })
  isLegalModern: boolean

  @Column({ type: 'boolean', default: false })
  isLegalLegacy: boolean

  @Column({ type: 'boolean', default: false })
  isLegalVintage: boolean

  @Column({ type: 'boolean', default: false })
  isLegalCommander: boolean

  // External IDs for price tracking
  @Column({ type: 'varchar', length: 50, nullable: true })
  tcgplayerId: string

  @Column({ type: 'varchar', length: 50, nullable: true })
  cardmarketId: string

  @Column({ type: 'varchar', length: 50, nullable: true })
  scryfallId: string

  @Column({ type: 'varchar', length: 50, nullable: true })
  pokemonTcgId: string

  @Column({ type: 'varchar', length: 50, nullable: true })
  yugiohProdeckId: string

  // Print-specific pricing (cached)
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  originalPrice: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  currentLowPrice: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  currentMarketPrice: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  currentHighPrice: number

  @Column({ type: 'timestamp', nullable: true })
  priceUpdatedAt: Date

  // Availability
  @Column({ type: 'boolean', default: false })
  isInStock: boolean

  @Column({ type: 'integer', default: 0 })
  totalInventory: number

  // Images (main references)
  @Column({ type: 'varchar', length: 500, nullable: true })
  imageSmall: string | null

  @Column({ type: 'varchar', length: 500, nullable: true })
  imageNormal: string | null

  @Column({ type: 'varchar', length: 500, nullable: true })
  imageLarge: string | null

  @Column({ type: 'varchar', length: 500, nullable: true })
  imageArtCrop: string | null

  @Column({ type: 'varchar', length: 500, nullable: true })
  imageBorderCrop: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  blurhash: string | null

  // Relations
  @OneToMany(() => CatalogSKU, sku => sku.print)
  skus: CatalogSKU[]

  @OneToMany(() => CardImage, image => image.print)
  images: CardImage[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date
}