import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn
} from 'typeorm'

@Entity('deck_cards')
export class DeckCard {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  deckId: string

  @Column({ type: 'uuid' })
  cardId: string

  @Column({ type: 'integer', default: 1 })
  quantity: number

  @CreateDateColumn()
  createdAt: Date
}