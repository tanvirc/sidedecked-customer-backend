import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'

export enum AlertType {
  PRICE_DROP = 'price_drop',
  PRICE_TARGET = 'price_target',
  BACK_IN_STOCK = 'back_in_stock',
  NEW_LISTING = 'new_listing'
}

export enum AlertStatus {
  ACTIVE = 'active',
  TRIGGERED = 'triggered',
  PAUSED = 'paused',
  EXPIRED = 'expired'
}

@Entity('price_alerts')
@Index(['user_id'])
@Index(['catalog_sku'])
@Index(['status'])
@Index(['alert_type'])
@Index(['trigger_price'])
export class PriceAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  user_id: string

  @Column({ type: 'varchar', length: 200 })
  catalog_sku: string

  @Column({ 
    type: 'enum', 
    enum: AlertType,
    default: AlertType.PRICE_DROP
  })
  alert_type: AlertType

  @Column({ 
    type: 'enum', 
    enum: AlertStatus,
    default: AlertStatus.ACTIVE
  })
  status: AlertStatus

  // Alert conditions
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  trigger_price?: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  percentage_threshold?: number

  @Column({ type: 'varchar', length: 10, nullable: true })
  condition_filter?: string

  @Column({ type: 'varchar', length: 10, nullable: true })
  language_filter?: string

  // Alert metadata
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  baseline_price?: number

  @Column({ type: 'timestamp', nullable: true })
  last_checked_at?: Date

  @Column({ type: 'timestamp', nullable: true })
  last_triggered_at?: Date

  @Column({ type: 'integer', default: 0 })
  trigger_count: number

  // Notification preferences
  @Column({ type: 'boolean', default: true })
  email_enabled: boolean

  @Column({ type: 'boolean', default: false })
  sms_enabled: boolean

  @Column({ type: 'boolean', default: false })
  push_enabled: boolean

  // Auto-management
  @Column({ type: 'timestamp', nullable: true })
  expires_at?: Date

  @Column({ type: 'boolean', default: false })
  auto_disable_after_trigger: boolean

  @Column({ type: 'integer', default: 1 })
  max_triggers: number

  @CreateDateColumn()
  created_at: Date

  @UpdateDateColumn()
  updated_at: Date
}