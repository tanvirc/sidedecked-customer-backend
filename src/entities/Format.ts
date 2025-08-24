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
  @JoinColumn({ name: 'gameId' })
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

  // Game-specific deck construction rules
  @Column({ type: 'boolean', default: false })
  leaderRequired: boolean // One Piece requires leader card

  @Column({ type: 'integer', default: 0 })
  leaderZoneSize: number // 1 for One Piece, 0 for others

  @Column({ type: 'integer', default: 0 })
  donDeckSize: number // 10 for One Piece, 0 for others

  @Column({ type: 'integer', default: 0 })
  prizeCardCount: number // 6 for Pokemon, 0 for others

  @Column({ type: 'text', array: true, nullable: true })
  regulationMarks: string[] // Pokemon rotation marks ['G', 'H']

  @Column({ type: 'text', array: true, nullable: true })
  restrictedCards: string[] // Vintage restricted list (limit 1)

  @Column({ type: 'boolean', default: false })
  extraDeckRequired: boolean // Yu-Gi-Oh formats

  @Column({ type: 'integer', default: 0 })
  maxExtraDeckSize: number // 15 for Yu-Gi-Oh, 0 for others

  @Column({ type: 'boolean', default: false })
  isSingleton: boolean // Commander, GLC - only 1 copy of each card

  @Column({ type: 'boolean', default: false })
  typeRestricted: boolean // GLC - all Pokemon must share type

  @Column({ type: 'text', array: true, nullable: true })
  rarityRestrictions: string[] // Pauper: ['common'], others: null

  @Column({ type: 'boolean', default: true })
  isActive: boolean

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}