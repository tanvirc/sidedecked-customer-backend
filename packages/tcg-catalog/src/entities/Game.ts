import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  Index
} from 'typeorm'
import { Card } from './Card'
import { CardSet } from './CardSet'
import { Format } from './Format'

@Entity('games')
@Index('idx_games_code', ['code'], { unique: true })
export class Game {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'varchar', length: 20, unique: true })
  code: string // MTG, POKEMON, YUGIOH, OPTCG

  @Column({ type: 'varchar', length: 100 })
  name: string

  @Column({ type: 'varchar', length: 100 })
  displayName: string

  // Game mechanics flags
  @Column({ type: 'boolean', default: false })
  hasColors: boolean // MTG

  @Column({ type: 'boolean', default: false })
  hasEnergyTypes: boolean // Pokemon

  @Column({ type: 'boolean', default: false })
  hasAttributes: boolean // YuGiOh

  @Column({ type: 'boolean', default: false })
  hasLevels: boolean // YuGiOh, MTG (Planeswalkers)

  @Column({ type: 'boolean', default: false })
  hasEvolution: boolean // Pokemon

  @Column({ type: 'boolean', default: false })
  hasLifeSystem: boolean // One Piece

  // Resource systems
  @Column({ type: 'varchar', length: 50, nullable: true })
  resourceType: string // mana, energy, don, none

  @Column({ type: 'jsonb', nullable: true })
  resourceColors: any // ["W","U","B","R","G"] for MTG

  // API configuration
  @Column({ type: 'varchar', length: 100, nullable: true })
  apiProvider: string // scryfall, pokemon_tcg, ygoprodeck, onepiece_tcg

  @Column({ type: 'text', nullable: true })
  apiEndpoint: string

  @Column({ type: 'boolean', default: false })
  apiKeyRequired: boolean

  @Column({ type: 'interval', default: '24 hours' })
  updateFrequency: string

  // ETL configuration
  @Column({ type: 'boolean', default: true })
  etlEnabled: boolean

  @Column({ type: 'varchar', length: 100, nullable: true })
  etlSource: string

  @Column({ type: 'timestamp', nullable: true })
  lastEtlRun: Date

  // Display configuration
  @Column({ type: 'varchar', length: 500, nullable: true })
  cardBackImage: string

  @Column({ type: 'varchar', length: 20, nullable: true })
  primaryColor: string

  @Column({ type: 'varchar', length: 500, nullable: true })
  logoUrl: string

  // Relations
  @OneToMany(() => Card, card => card.game)
  cards: Card[]

  @OneToMany(() => CardSet, set => set.game)
  sets: CardSet[]

  @OneToMany(() => Format, format => format.game)
  formats: Format[]

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date

  @DeleteDateColumn()
  deletedAt: Date
}