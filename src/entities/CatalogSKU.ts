import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index
} from 'typeorm'
import { Print } from './Print'

@Entity('catalog_skus')
@Index('idx_sku_lookup', ['sku'], { unique: true })
@Index('idx_sku_components', ['gameCode', 'setCode', 'collectorNumber'])
@Index('idx_sku_market', ['hasB2cInventory', 'hasC2cListings'])
@Index('idx_sku_price_range', ['lowestPrice', 'highestPrice'])
@Index('idx_sku_condition', ['conditionCode'])
export class CatalogSKU {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  printId: string

  @ManyToOne(() => Print, print => print.skus)
  @JoinColumn({ name: 'print_id' })
  print: Print

  // Universal SKU format: {GAME}-{SET}-{NUMBER}-{LANG}-{CONDITION}-{FINISH}[-{GRADE}]
  @Column({ type: 'varchar', length: 200, unique: true })
  sku: string

  // SKU components (denormalized for performance)
  @Column({ type: 'varchar', length: 20 })
  gameCode: string

  @Column({ type: 'varchar', length: 50 })
  setCode: string

  @Column({ type: 'varchar', length: 50 })
  collectorNumber: string

  @Column({ type: 'varchar', length: 10 })
  languageCode: string // EN, JP, DE, FR, etc.

  @Column({ type: 'varchar', length: 10 })
  conditionCode: string // NM, LP, MP, HP, DMG

  @Column({ type: 'varchar', length: 20 })
  finishCode: string // NORMAL, FOIL, REVERSE, 1ST

  // Grading information (optional)
  @Column({ type: 'boolean', default: false })
  isGraded: boolean

  @Column({ type: 'varchar', length: 20, nullable: true })
  gradingCompany: string // PSA, BGS, CGC

  @Column({ type: 'varchar', length: 10, nullable: true })
  gradeValue: string // 10, 9.5, 9, etc.

  @Column({ type: 'varchar', length: 50, nullable: true })
  gradeCertNumber: string // Certificate number

  // Market data (updated regularly)
  @Column({ type: 'boolean', default: false })
  hasB2cInventory: boolean

  @Column({ type: 'boolean', default: false })
  hasC2cListings: boolean

  @Column({ type: 'integer', default: 0 })
  vendorCount: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  lowestPrice: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  marketPrice: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  highestPrice: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  averagePrice: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  medianPrice: number

  @Column({ type: 'varchar', length: 20, default: 'stable' })
  priceTrend: string // up, down, stable, volatile

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  priceChangePercent: number // 24h price change

  @Column({ type: 'timestamp', nullable: true })
  lastPriceUpdate: Date

  // Performance tracking
  @Column({ type: 'integer', default: 0 })
  viewCount: number

  @Column({ type: 'integer', default: 0 })
  searchCount: number

  @Column({ type: 'integer', default: 0 })
  cartAddCount: number

  @Column({ type: 'integer', default: 0 })
  purchaseCount: number

  @Column({ type: 'integer', default: 0 })
  watchlistCount: number

  // Availability tracking
  @Column({ type: 'integer', default: 0 })
  totalQuantityAvailable: number

  @Column({ type: 'timestamp', nullable: true })
  lastStockUpdate: Date

  @Column({ type: 'boolean', default: true })
  isActive: boolean

  // Commerce integration
  @Column({ type: 'jsonb', nullable: true })
  vendorSkuMappings: any // { vendorId: vendorSku } mappings

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date
}