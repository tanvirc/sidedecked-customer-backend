import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm'

export enum ETLJobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  PARTIAL = 'partial'
}

export enum ETLJobType {
  FULL = 'full',
  INCREMENTAL = 'incremental', 
  SETS = 'sets',
  FULL_SYNC = 'full_sync',
  INCREMENTAL_SYNC = 'incremental_sync',
  PRICE_UPDATE = 'price_update',
  IMAGE_SYNC = 'image_sync',
  BANLIST_UPDATE = 'banlist_update',
  METADATA_UPDATE = 'metadata_update'
}

@Entity('etl_jobs')
@Index('idx_etl_jobs_status', ['status'])
@Index('idx_etl_jobs_game_type', ['gameCode', 'jobType'])
@Index('idx_etl_jobs_started_at', ['startedAt'])
export class ETLJob {
  @PrimaryGeneratedColumn('uuid')
  id: string

  // Job identification
  @Column({ type: 'varchar', length: 100 })
  jobName: string

  @Column({
    type: 'enum',
    enum: ETLJobType
  })
  jobType: ETLJobType

  @Column({ type: 'varchar', length: 20 })
  gameCode: string // MTG, POKEMON, YUGIOH, OPTCG

  @Column({ type: 'varchar', length: 100, nullable: true })
  dataSource: string // scryfall, pokemon_tcg, etc.

  // Job status
  @Column({
    type: 'enum',
    enum: ETLJobStatus,
    default: ETLJobStatus.PENDING
  })
  status: ETLJobStatus

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date

  @Column({ type: 'integer', nullable: true })
  durationMs: number

  // Progress tracking
  @Column({ type: 'integer', default: 0 })
  totalRecords: number

  @Column({ type: 'integer', default: 0 })
  processedRecords: number

  @Column({ type: 'integer', default: 0 })
  successfulRecords: number

  @Column({ type: 'integer', default: 0 })
  failedRecords: number

  @Column({ type: 'integer', default: 0 })
  skippedRecords: number

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  progressPercent: number

  // Data changes
  @Column({ type: 'integer', default: 0 })
  cardsCreated: number

  @Column({ type: 'integer', default: 0 })
  cardsUpdated: number

  @Column({ type: 'integer', default: 0 })
  cardsDeleted: number

  @Column({ type: 'integer', default: 0 })
  printsCreated: number

  @Column({ type: 'integer', default: 0 })
  printsUpdated: number

  @Column({ type: 'integer', default: 0 })
  imagesQueued: number

  @Column({ type: 'integer', default: 0 })
  skusGenerated: number

  // Error tracking
  @Column({ type: 'text', nullable: true })
  errorMessage: string

  @Column({ type: 'jsonb', nullable: true })
  errors: any[] // Array of error objects

  @Column({ type: 'integer', default: 0 })
  retryCount: number

  @Column({ type: 'integer', default: 5 })
  maxRetries: number

  // Configuration
  @Column({ type: 'jsonb', nullable: true })
  config: {
    batchSize?: number
    rateLimitDelay?: number
    concurrency?: number
    skipImages?: boolean
    forceUpdate?: boolean
    filters?: any
  }

  // Checkpoints for resumable jobs
  @Column({ type: 'jsonb', nullable: true })
  checkpoint: {
    lastProcessedId?: string
    lastProcessedPage?: number
    lastProcessedTimestamp?: Date
    state?: any
  }

  // API usage tracking
  @Column({ type: 'integer', default: 0 })
  apiCallsCount: number

  @Column({ type: 'integer', default: 0 })
  apiErrorsCount: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  apiResponseTimeAvg: number // in ms

  // Performance metrics
  @Column({ type: 'jsonb', nullable: true })
  metrics: {
    memoryUsageMb?: number
    cpuUsagePercent?: number
    throughputPerSecond?: number
    averageProcessingTime?: number
  }

  // Circuit breaker state
  @Column({ type: 'boolean', default: false })
  circuitBreakerOpen: boolean

  @Column({ type: 'integer', default: 0 })
  circuitBreakerFailures: number

  @Column({ type: 'timestamp', nullable: true })
  circuitBreakerResetAt: Date

  // Scheduling
  @Column({ type: 'boolean', default: false })
  isScheduled: boolean

  @Column({ type: 'varchar', length: 50, nullable: true })
  cronExpression: string

  @Column({ type: 'timestamp', nullable: true })
  nextRunAt: Date

  // Audit
  @Column({ type: 'varchar', length: 100, nullable: true })
  triggeredBy: string // manual, scheduled, webhook

  @Column({ type: 'jsonb', nullable: true })
  metadata: any // Additional job-specific metadata

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}