import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn
} from 'typeorm'
import { Deck } from './Deck'
import { Card } from './Card'

@Entity('deck_cards')
export class DeckCard {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  deckId: string

  @Column({ type: 'uuid' })
  cardId: string

  @Column({ type: 'varchar', length: 200 })
  catalogSku: string

  @Column({ type: 'integer', default: 1 })
  quantity: number

  @ManyToOne(() => Deck, deck => deck.cards, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deckId' })
  deck: Deck

  @ManyToOne(() => Card, { eager: false })
  @JoinColumn({ name: 'cardId' })
  card: Card

  @CreateDateColumn()
  createdAt: Date
}