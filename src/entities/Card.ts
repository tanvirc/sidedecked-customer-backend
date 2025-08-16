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
import { Game } from './Game'
import { Print } from './Print'

@Entity('cards')
@Index('idx_cards_oracle_id', ['oracleId'], { unique: true })
@Index('idx_cards_oracle_hash', ['oracleHash'], { unique: true })
@Index('idx_cards_game_name', ['gameId', 'normalizedName'])
@Index('idx_cards_search', ['normalizedName', 'primaryType'])
@Index('idx_cards_mana_value', ['manaValue'])
@Index('idx_cards_colors', ['colors'])
export class Card {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  gameId: string

  @ManyToOne(() => Game, game => game.cards)
  @JoinColumn({ name: 'game_id' })
  game: Game

  // Universal identity
  @Column({ type: 'uuid', unique: true })
  oracleId: string

  @Column({ type: 'varchar', length: 64, unique: true })
  oracleHash: string // SHA-256 for deduplication

  // Core attributes (all games have these)
  @Column({ type: 'varchar', length: 500 })
  name: string

  @Column({ type: 'varchar', length: 500 })
  normalizedName: string // Searchable version

  @Column({ type: 'varchar', length: 100, nullable: true })
  primaryType: string // Creature, Trainer, Spell, etc.

  @Column({ type: 'text', array: true, nullable: true })
  subtypes: string[] // [Beast, Warrior], [Fire], etc.

  @Column({ type: 'text', array: true, nullable: true })
  supertypes: string[] // Legendary, Basic, etc.

  // Universal power system
  @Column({ type: 'integer', nullable: true })
  powerValue: number // Attack/Power/ATK

  @Column({ type: 'integer', nullable: true })
  defenseValue: number // Toughness/HP/DEF

  // Rules text
  @Column({ type: 'text', nullable: true })
  oracleText: string

  @Column({ type: 'text', nullable: true })
  flavorText: string

  @Column({ type: 'text', array: true, nullable: true })
  keywords: string[] // [Flying, Trample], etc.

  // Game-specific attributes stored in dedicated columns for performance
  // MTG specific
  @Column({ type: 'varchar', length: 100, nullable: true })
  manaCost: string

  @Column({ type: 'integer', nullable: true })
  manaValue: number

  @Column({ type: 'varchar', length: 1, array: true, nullable: true })
  colors: string[] // [W, U, B, R, G]

  @Column({ type: 'varchar', length: 1, array: true, nullable: true })
  colorIdentity: string[] // For Commander

  // Pokemon specific
  @Column({ type: 'integer', nullable: true })
  hp: number

  @Column({ type: 'integer', nullable: true })
  retreatCost: number

  @Column({ type: 'varchar', length: 20, array: true, nullable: true })
  energyTypes: string[] // [Fire, Water, Grass]

  @Column({ type: 'varchar', length: 20, nullable: true })
  evolutionStage: string // Basic, Stage1, Stage2

  // Yu-Gi-Oh! specific
  @Column({ type: 'varchar', length: 20, nullable: true })
  attribute: string // DARK, LIGHT, WATER, etc.

  @Column({ type: 'integer', nullable: true })
  levelRank: number // Level/Rank/Link Rating

  @Column({ type: 'integer', nullable: true })
  linkValue: number

  @Column({ type: 'varchar', length: 2, array: true, nullable: true })
  linkArrows: string[] // [TL, TR, BL, BR]

  @Column({ type: 'integer', nullable: true })
  pendulumScale: number

  @Column({ type: 'integer', nullable: true })
  attackValue: number // YGO-specific attack

  @Column({ type: 'integer', nullable: true })
  defenseValueYugioh: number // YGO-specific defense

  // One Piece specific
  @Column({ type: 'integer', nullable: true })
  cost: number // Play cost

  @Column({ type: 'integer', nullable: true })
  donCost: number // DON!! cost

  @Column({ type: 'integer', nullable: true })
  lifeValue: number // Leader life

  @Column({ type: 'integer', nullable: true })
  counterValue: number // Counter value

  @Column({ type: 'integer', nullable: true })
  power: number // One Piece power

  // Extended attributes for future flexibility
  @Column({ type: 'jsonb', default: {} })
  extendedAttributes: any

  // Searchability and popularity
  @Column({ type: 'tsvector', nullable: true })
  searchVector: any // Full-text search

  @Column({ type: 'decimal', default: 0 })
  popularityScore: number

  @Column({ type: 'integer', default: 0 })
  totalViews: number

  @Column({ type: 'integer', default: 0 })
  totalSearches: number

  // Relations
  @OneToMany(() => Print, print => print.card)
  prints: Print[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date
}