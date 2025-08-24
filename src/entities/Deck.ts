import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn
} from 'typeorm'
import { DeckCard } from './DeckCard'
import { Game } from './Game'

@Entity('decks')
export class Deck {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'varchar', length: 255 })
  name: string

  @Column({ type: 'varchar', length: 255 })
  userId: string

  @Column({ type: 'uuid' })
  gameId: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  formatId: string

  @Column({ type: 'varchar', length: 50, nullable: true })
  formatCode: string // Reference to Format.code for easier lookup

  @Column({ type: 'text', nullable: true })
  description: string

  @Column({ type: 'boolean', default: false })
  isPublic: boolean

  @Column({ type: 'int', default: 0 })
  likes: number

  @Column({ type: 'int', default: 0 })
  views: number

  @Column({ type: 'int', default: 0 })
  copies: number

  @Column({ type: 'varchar', length: 255, nullable: true })
  coverCardId: string

  @Column({ type: 'text', nullable: true })
  coverImageUrl: string

  @Column({ type: 'varchar', length: 255, nullable: true })
  leaderCardId: string // One Piece leader card

  @Column({ type: 'jsonb', nullable: true })
  tags: string[]

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalValue: number

  @ManyToOne(() => Game, { eager: false })
  @JoinColumn({ name: 'gameId' })
  game: Game

  @OneToMany(() => DeckCard, deckCard => deckCard.deck, { cascade: true })
  cards: DeckCard[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date
}