import axios, { AxiosInstance } from 'axios'
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid'
import { Game } from '../../../../src/entities/Game'
import { ETLJobType } from '../entities/ETLJob'
import { UniversalCard, UniversalPrint } from '../types/ETLTypes'
import { logger } from '../utils/Logger'
import { generateNormalizedName } from '../utils/Helpers'
import { config } from '../../../../src/config/env'

interface OPTCGCard {
  inventory_price: number
  market_price: number
  card_name: string
  set_name: string
  card_text: string
  set_id: string
  rarity: string
  card_set_id: string
  card_color: string
  card_type: string
  life?: string
  card_cost: string
  card_power: string
  sub_types?: string
  counter_amount: number
  attribute?: string
  date_scraped: string
  card_image_id: string
  card_image: string
}

interface OPTCGSet {
  set_name: string
  set_id: string
}

export class OnePieceTransformer {
  private client: AxiosInstance
  private readonly baseUrl: string
  private readonly rateLimit = 200 // milliseconds between requests (be nice to free API)

  constructor() {
    this.baseUrl = config.ONEPIECE_API_URL || 'https://optcgapi.com/api'
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)'
      }
    })

    // Rate limiting interceptor
    this.client.interceptors.request.use(async (config) => {
      await this.sleep(this.rateLimit)
      return config
    })
  }

  async fetchCards(game: Game, jobType: ETLJobType, limit?: number): Promise<UniversalCard[]> {
    logger.info('Starting One Piece TCG data fetch', { gameCode: game.code, jobType, limit })

    try {
      logger.info('🔍 Fetching One Piece TCG data from OPTCG API')
      const apiCards = await this.fetchCardsFromAPI(jobType, limit)
      
      logger.info('✅ Successfully fetched from One Piece TCG API', {
        gameCode: game.code,
        totalCards: apiCards.length
      })
      
      return this.transformToUniversal(apiCards)
        
    } catch (error) {
      logger.error('Failed to fetch One Piece TCG data', error as Error, {
        gameCode: game.code,
        jobType
      })
      throw error
    }
  }


  private async fetchCardsFromAPI(jobType: ETLJobType, limit?: number): Promise<OPTCGCard[]> {
    let allCards: OPTCGCard[] = []

    try {
      // Get available sets first
      const setsResponse = await this.client.get<OPTCGSet[]>('/allSets/')
      const sets = setsResponse.data
      
      logger.debug('Fetching One Piece TCG data', {
        jobType,
        availableSets: sets.length,
        limit
      })
      
      const setsToProcess = this.getSetsToProcess(sets, jobType)

      // Fetch cards from each set
      for (const set of setsToProcess) {
        try {
          logger.debug(`Fetching cards from set ${set.set_id}`, { setName: set.set_name })
          const setCards = await this.getCardsFromSet(set.set_id)
          
          allCards.push(...setCards)
          
          logger.debug(`Fetched ${setCards.length} cards from ${set.set_id}`, {
            totalCardsSoFar: allCards.length
          })

          // Check if we've reached the limit
          if (limit && allCards.length >= limit) {
            allCards = allCards.slice(0, limit)
            logger.info(`✅ Reached limit of ${limit} cards, stopping fetch`)
            break
          }

        } catch (error) {
          logger.warn(`Failed to fetch cards from set ${set.set_id}`, { error })
        }
      }

      logger.info('Completed One Piece TCG data fetch', {
        totalCards: allCards.length,
        jobType
      })

      return allCards

    } catch (error) {
      logger.error('Error fetching One Piece cards from OPTCG API', error as Error)
      throw error
    }
  }

  private getSetsToProcess(sets: OPTCGSet[], jobType: ETLJobType): OPTCGSet[] {
    switch (jobType) {
      case ETLJobType.FULL:
      case ETLJobType.FULL_SYNC:
        // Fetch cards from all sets
        return sets
      
      case ETLJobType.INCREMENTAL:
      case ETLJobType.INCREMENTAL_SYNC:
        // Fetch cards from the latest 2 sets
        return sets.slice(-2)

      case ETLJobType.SETS:
        // Fetch cards from latest set only
        return sets.length > 0 ? [sets[sets.length - 1]] : []

      case ETLJobType.BANLIST_UPDATE:
        // For banlist updates, fetch from recent sets for format legality updates
        return sets.slice(-3)

      default:
        // Default to latest set
        return sets.length > 0 ? [sets[sets.length - 1]] : []
    }
  }

  private async getCardsFromSet(setId: string): Promise<OPTCGCard[]> {
    try {
      const response = await this.client.get<OPTCGCard[]>(`/sets/${setId}/`)
      return response.data
    } catch (error) {
      logger.warn(`Failed to fetch cards from set ${setId}`, { error })
      return []
    }
  }


  private transformToUniversal(onePieceCards: OPTCGCard[]): UniversalCard[] {
    // Use a fixed namespace UUID for One Piece cards to ensure consistent generation
    const ONEPIECE_NAMESPACE = '6ba7b816-9dad-11d1-80b4-00c04fd430c8' // Using modified DNS namespace UUID
    
    // Group cards by name to handle multiple prints
    const cardMap = new Map<string, OPTCGCard[]>()
    
    for (const card of onePieceCards) {
      if (!card.card_name) {
        logger.warn('Skipping card with no card_name', { card })
        continue
      }
      
      const normalizedName = generateNormalizedName(card.card_name)
      const existing = cardMap.get(normalizedName) || []
      existing.push(card)
      cardMap.set(normalizedName, existing)
    }

    const universalCards: UniversalCard[] = []

    for (const [normalizedName, prints] of cardMap) {
      const canonicalCard = prints[0]
      
      // Generate a deterministic UUID based on card name and type
      const oracleId = uuidv5(`onepiece_${normalizedName}_${canonicalCard.card_type.toLowerCase()}`, ONEPIECE_NAMESPACE)
      
      const universalCard: UniversalCard = {
        oracleId,
        oracleHash: '', // Will be generated by ETLService
        name: canonicalCard.card_name,
        normalizedName,
        primaryType: this.mapCardType(canonicalCard.card_type),
        subtypes: this.extractSubtypes(canonicalCard),
        supertypes: [],
        oracleText: canonicalCard.card_text,
        flavorText: undefined, // One Piece doesn't typically have flavor text
        keywords: this.extractKeywords(canonicalCard),

        // One Piece specific fields
        cost: canonicalCard.card_cost && canonicalCard.card_cost !== 'NULL' ? parseInt(canonicalCard.card_cost, 10) : undefined,
        donCost: undefined, // Will be extracted from cost if needed
        lifeValue: canonicalCard.life ? parseInt(canonicalCard.life, 10) : undefined,
        counterValue: canonicalCard.counter_amount || undefined,
        power: canonicalCard.card_power ? parseInt(canonicalCard.card_power, 10) : undefined,

        // MTG fields (null for One Piece)
        manaCost: undefined,
        manaValue: undefined,
        colors: [],
        colorIdentity: [],
        powerValue: undefined,
        defenseValue: undefined,

        // Pokemon fields (null for One Piece)
        hp: undefined,
        retreatCost: undefined,
        energyTypes: [],
        evolutionStage: undefined,

        // YuGiOh fields (null for One Piece)
        attribute: canonicalCard.attribute,
        levelRank: undefined,
        attackValue: undefined,
        defenseValueYugioh: undefined,

        prints: prints.map(print => this.transformPrint(print))
      }

      universalCards.push(universalCard)
    }

    return universalCards
  }

  private transformPrint(onePieceCard: OPTCGCard): UniversalPrint {
    return {
      printHash: '', // Will be generated by ETLService
      setCode: onePieceCard.set_id.replace('-', ''), // Remove hyphen from set_id (OP-01 -> OP01)
      setName: onePieceCard.set_name,
      collectorNumber: onePieceCard.card_image_id, // Use card_image_id for uniqueness (handles variants)
      rarity: this.normalizeRarity(onePieceCard.rarity),
      artist: undefined, // OPTCG API doesn't provide artist info
      flavorText: undefined,
      language: 'en',
      isFoilAvailable: this.hasFoilVariant(onePieceCard.rarity),
      isAlternateArt: this.isAlternateArt(onePieceCard),
      isPromo: this.isPromo(onePieceCard.rarity),
      finish: this.isAlternateArt(onePieceCard) ? 'foil' : 'normal',
      variation: this.isAlternateArt(onePieceCard) ? 'parallel' : undefined,
      frame: 'normal',
      borderColor: 'black',
      
      // Basic format legality for One Piece
      formatLegality: this.extractFormatLegality(onePieceCard),
      
      externalIds: {
        pokemonTcg: onePieceCard.card_set_id // Using pokemonTcg field for now
      },

      images: onePieceCard.card_image ? {
        small: onePieceCard.card_image,
        normal: onePieceCard.card_image,
        large: onePieceCard.card_image
      } : undefined,

      prices: {
        usd: onePieceCard.market_price || onePieceCard.inventory_price
      }
    }
  }

  private mapCardType(onePieceType: string): string {
    const typeMap: Record<string, string> = {
      'Leader': 'Planeswalker',
      'Character': 'Creature',
      'Event': 'Sorcery',
      'Stage': 'Enchantment'
    }

    return typeMap[onePieceType] || onePieceType
  }

  private extractSubtypes(card: OPTCGCard): string[] {
    const subtypes: string[] = []

    if (card.attribute) {
      subtypes.push(card.attribute)
    }

    if (card.card_color) {
      subtypes.push(card.card_color)
    }

    if (card.sub_types) {
      // Split sub_types by spaces or commas and add them
      const parsedSubtypes = card.sub_types.split(/[\s,]+/).filter(Boolean)
      subtypes.push(...parsedSubtypes)
    }

    return subtypes
  }

  private extractKeywords(card: OPTCGCard): string[] {
    const keywords: string[] = []

    if (card.attribute) {
      keywords.push(card.attribute)
    }

    if (card.card_color) {
      keywords.push(card.card_color)
    }

    if (card.card_type) {
      keywords.push(card.card_type)
    }

    if (card.sub_types) {
      const parsedSubtypes = card.sub_types.split(/[\s,]+/).filter(Boolean)
      keywords.push(...parsedSubtypes)
    }

    return keywords
  }

  private normalizeRarity(onePieceRarity: string): string {
    const rarityMap: Record<string, string> = {
      'Common': 'Common',
      'Uncommon': 'Uncommon',
      'Rare': 'Rare',
      'Super Rare': 'Mythic Rare',
      'Secret Rare': 'Mythic Rare',
      'Special Rare': 'Mythic Rare',
      'Leader': 'Mythic Rare',
      'Promo': 'Special'
    }

    return rarityMap[onePieceRarity] || onePieceRarity
  }

  private hasFoilVariant(rarity: string): boolean {
    const foilRarities = ['Super Rare', 'Secret Rare', 'Special Rare', 'Leader']
    return foilRarities.includes(rarity)
  }

  private isPromo(rarity: string): boolean {
    return rarity.includes('Promo') || rarity.includes('Prize')
  }

  private isAlternateArt(card: OPTCGCard): boolean {
    return card.card_name.includes('(Parallel)') || card.card_image_id.includes('_p')
  }

  private extractFormatLegality(card: OPTCGCard): Record<string, string> | undefined {
    // Basic format legality for One Piece
    // All cards from official sets are legal in OP format
    return {
      op: 'legal',
      standard: 'legal'
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}