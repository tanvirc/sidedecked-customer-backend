import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index
} from 'typeorm'
import { Print } from './Print'
import { ImageStatus, ImageType } from '../types/ImageTypes'

@Entity('card_images')
@Index('idx_images_print_type', ['printId', 'imageType'], { unique: true })
@Index('idx_images_status', ['status'])
@Index('idx_images_retry', ['status', 'retryCount'])
export class CardImage {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  printId: string

  @ManyToOne(() => Print, print => print.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'print_id' })
  print: Print

  // Image classification
  @Column({
    type: 'enum',
    enum: ImageType,
    default: ImageType.MAIN
  })
  imageType: ImageType

  @Column({ type: 'text' })
  sourceUrl: string

  @Column({ type: 'varchar', length: 50, nullable: true })
  sourceProvider: string // scryfall, pokemon_tcg, etc.

  // Storage information (MinIO/S3)
  @Column({ type: 'jsonb', nullable: true })
  storageUrls: {
    thumbnail?: string    // 146x204
    small?: string       // 244x340
    normal?: string      // 488x680
    large?: string       // 745x1040
    original?: string    // Full size
  }

  @Column({ type: 'varchar', length: 255, nullable: true })
  blurhash: string

  // CDN URLs (when CDN is available)
  @Column({ type: 'jsonb', nullable: true })
  cdnUrls: {
    thumbnail?: string
    small?: string
    normal?: string
    large?: string
    original?: string
  }

  // Processing status
  @Column({
    type: 'enum',
    enum: ImageStatus,
    default: ImageStatus.PENDING
  })
  status: ImageStatus

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date

  @Column({ type: 'text', nullable: true })
  errorMessage: string

  @Column({ type: 'integer', default: 0 })
  retryCount: number

  @Column({ type: 'timestamp', nullable: true })
  nextRetryAt: Date

  // Metadata
  @Column({ type: 'integer', nullable: true })
  fileSize: number // in bytes

  @Column({ type: 'integer', nullable: true })
  width: number

  @Column({ type: 'integer', nullable: true })
  height: number

  @Column({ type: 'varchar', length: 10, nullable: true })
  format: string // webp, jpg, png

  @Column({ type: 'varchar', length: 50, nullable: true })
  mimeType: string

  // WebP optimization metrics
  @Column({ type: 'jsonb', nullable: true })
  optimizationMetrics: {
    originalSize?: number
    optimizedSize?: number
    compressionRatio?: number
    processingTime?: number // in ms
  }

  // Checksum for integrity
  @Column({ type: 'varchar', length: 64, nullable: true })
  sha256Hash: string

  @Column({ type: 'varchar', length: 32, nullable: true })
  md5Hash: string

  // Quality scores
  @Column({ type: 'integer', nullable: true })
  qualityScore: number // 0-100

  @Column({ type: 'boolean', default: false })
  isHighRes: boolean

  // Usage tracking
  @Column({ type: 'integer', default: 0 })
  downloadCount: number

  @Column({ type: 'timestamp', nullable: true })
  lastAccessedAt: Date

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}