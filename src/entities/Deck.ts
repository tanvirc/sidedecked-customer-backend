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