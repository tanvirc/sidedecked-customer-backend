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

  @Column({ type: 'varchar', length: 100, name: 'display_name' })
  displayName: string

  // Game mechanics flags
  @Column({ type: 'boolean', default: false, name: 'has_colors' })
  hasColors: boolean // MTG

  @Column({ type: 'boolean', default: false, name: 'has_energy_types' })
  hasEnergyTypes: boolean // Pokemon

  @Column({ type: 'boolean', default: false, name: 'has_attributes' })
  hasAttributes: boolean // YuGiOh

  @Column({ type: 'boolean', default: false, name: 'has_levels' })
  hasLevels: boolean // YuGiOh, MTG (Planeswalkers)

  @Column({ type: 'boolean', default: false, name: 'has_power_toughness' })
  hasPowerToughness: boolean // MTG, YuGiOh, One Piece

  @Column({ type: 'boolean', default: false, name: 'has_evolution' })
  hasEvolution: boolean // Pokemon

  @Column({ type: 'boolean', default: false, name: 'has_life_system' })
  hasLifeSystem: boolean // One Piece

  // Resource systems
  @Column({ type: 'varchar', length: 50, nullable: true, name: 'resource_type' })
  resourceType: string // mana, energy, don, none

  @Column({ type: 'jsonb', nullable: true, name: 'resource_colors' })
  resourceColors: any // ["W","U","B","R","G"] for MTG

  // API configuration
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'api_provider' })
  apiProvider: string // scryfall, pokemon_tcg, ygoprodeck, onepiece_tcg

  @Column({ type: 'text', nullable: true, name: 'api_endpoint' })
  apiEndpoint: string

  @Column({ type: 'boolean', default: false, name: 'api_key_required' })
  apiKeyRequired: boolean

  @Column({ type: 'interval', default: '24 hours', name: 'update_frequency' })
  updateFrequency: string

  // ETL configuration
  @Column({ type: 'boolean', default: true, name: 'etl_enabled' })
  etlEnabled: boolean

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'etl_source' })
  etlSource: string

  @Column({ type: 'timestamp', nullable: true, name: 'last_etl_run' })
  lastEtlRun: Date

  // Display configuration
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'card_back_image' })
  cardBackImage: string

  @Column({ type: 'varchar', length: 20, nullable: true, name: 'primary_color' })
  primaryColor: string

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'logo_url' })
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