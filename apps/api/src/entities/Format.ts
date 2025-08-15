import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index
} from 'typeorm'
import { Game } from './Game'

@Entity('formats')
@Index('idx_formats_game_code', ['gameId', 'code'], { unique: true })
export class Format {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  gameId: string

  @ManyToOne(() => Game, game => game.formats)
  @JoinColumn({ name: 'game_id' })
  game: Game

  @Column({ type: 'varchar', length: 50 })
  code: string

  @Column({ type: 'varchar', length: 100 })
  name: string

  // Format characteristics
  @Column({ type: 'varchar', length: 50, nullable: true })
  formatType: string // constructed, limited, eternal

  @Column({ type: 'boolean', default: false })
  isRotating: boolean

  @Column({ type: 'varchar', length: 50, nullable: true })
  rotationSchedule: string // annual, biannual, none

  // Deck construction rules
  @Column({ type: 'integer', nullable: true })
  minDeckSize: number

  @Column({ type: 'integer', nullable: true })
  maxDeckSize: number

  @Column({ type: 'integer', default: 4 })
  maxCopiesPerCard: number

  @Column({ type: 'boolean', default: true })
  allowsSideboard: boolean

  @Column({ type: 'integer', default: 15 })
  maxSideboardSize: number

  // Special rules
  @Column({ type: 'text', array: true, nullable: true })
  bannedCardTypes: string[] // [Conspiracy, Un-cards]

  @Column({ type: 'text', array: true, nullable: true })
  requiredCardTypes: string[] // [Commander] for Commander format

  @Column({ type: 'jsonb', nullable: true })
  specialRules: any // Format-specific rules

  @Column({ type: 'boolean', default: true })
  isActive: boolean

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}