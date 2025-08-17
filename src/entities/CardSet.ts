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

@Entity('card_sets')
@Index('idx_sets_game_code', ['gameId', 'code'], { unique: true })
@Index('idx_sets_release_date', ['releaseDate'])
export class CardSet {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  gameId: string

  @ManyToOne(() => Game, game => game.sets)
  @JoinColumn({ name: 'gameId' })
  game: Game

  // Set identity
  @Column({ type: 'varchar', length: 50 })
  code: string // NEO, BRS, ROTD, OP01

  @Column({ type: 'varchar', length: 255 })
  name: string

  // Release information
  @Column({ type: 'date', nullable: true })
  releaseDate: Date

  @Column({ type: 'varchar', length: 50, nullable: true })
  setType: string // expansion, core, masters, etc.

  @Column({ type: 'integer', nullable: true })
  cardCount: number

  // Set characteristics
  @Column({ type: 'boolean', default: false })
  isDigitalOnly: boolean

  @Column({ type: 'boolean', default: false })
  isFoilOnly: boolean

  @Column({ type: 'boolean', default: false })
  hasAlternateArts: boolean

  // Rotation status (for Standard formats)
  @Column({ type: 'date', nullable: true })
  rotationDate: Date

  @Column({ type: 'boolean', default: true })
  isStandardLegal: boolean

  // Images and branding
  @Column({ type: 'text', nullable: true })
  setIconUrl: string

  @Column({ type: 'text', nullable: true })
  setLogoUrl: string

  // Market data
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  releasePriceAvg: number

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  currentPriceAvg: number

  // Relations
  @OneToMany(() => Print, print => print.set)
  prints: Print[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date
}