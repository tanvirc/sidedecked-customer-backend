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
      
      // For limited requests, we may need to fetch from more sets than the job type normally specifies
      let setsToProcess = this.getSetsToProcess(sets, jobType)
      
      // If we have a limit, we may need to expand our set selection
      if (limit && limit > 0) {
        // Start with initial sets, but be prepared to fetch from more sets if needed
        const initialSetCount = setsToProcess.length
        logger.info(`Starting with ${initialSetCount} sets for ${jobType}, will expand if needed to reach limit of ${limit}`)
      }

      // Fetch cards from sets, expanding the set list if needed to reach limit
      let setIndex = 0
      const reversedSets = [...sets].reverse() // Process newest sets first
      
      while (setIndex < reversedSets.length && (!limit || allCards.length < limit)) {
        const set = reversedSets[setIndex]
        
        // Skip if this set is not in our initial processing list AND we haven't reached the initial set count yet
        if (setIndex >= setsToProcess.length) {
          logger.info(`Expanding beyond initial ${setsToProcess.length} sets to reach limit. Fetching from ${set.set_id}`)
        }
        
        try {
          logger.debug(`Fetching cards from set ${set.set_id}`, { 
            setName: set.set_name, 
            setIndex: setIndex + 1, 
            totalSets: reversedSets.length,
            currentTotal: allCards.length,
            targetLimit: limit 
          })
          
          const setCards = await this.getCardsFromSet(set.set_id)
          
          if (setCards.length > 0) {
            // If adding all these cards would exceed limit, only add what we need
            if (limit && allCards.length + setCards.length > limit) {
              const cardsNeeded = limit - allCards.length
              allCards.push(...setCards.slice(0, cardsNeeded))
              logger.info(`✅ Reached limit of ${limit} cards with partial set ${set.set_id} (took ${cardsNeeded}/${setCards.length} cards)`)
              break
            } else {
              allCards.push(...setCards)
            }
            
            logger.debug(`Fetched ${setCards.length} cards from ${set.set_id}`, {
              totalCardsSoFar: allCards.length,
              remainingToLimit: limit ? limit - allCards.length : 'unlimited'
            })
          }

        } catch (error) {
          logger.warn(`Failed to fetch cards from set ${set.set_id}`, { error })
        }
        
        setIndex++
        
        // For non-limited requests, stick to the original set selection
        if (!limit && setIndex >= setsToProcess.length) {
          logger.info(`Completed processing ${setsToProcess.length} sets for ${jobType} (no limit specified)`)
          break
        }
      }

      logger.info('Completed One Piece TCG data fetch', {
        totalCards: allCards.length,
        setsProcessed: setIndex,
        targetLimit: limit || 'unlimited',
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
    
    // Group cards by name, type, and set to handle variants properly
    // Include card_set_id in grouping key to match our oracleId generation
    const cardMap = new Map<string, OPTCGCard[]>()
    
    for (const card of onePieceCards) {
      if (!card.card_name) {
        logger.warn('Skipping card with no card_name', { card })
        continue
      }
      
      const normalizedName = generateNormalizedName(card.card_name)
      // Use same grouping key as oracleId generation to ensure consistency
      const groupingKey = `${normalizedName}_${card.card_type.toLowerCase()}_${card.card_set_id}`
      const existing = cardMap.get(groupingKey) || []
      existing.push(card)
      cardMap.set(groupingKey, existing)
    }

    const universalCards: UniversalCard[] = []

    for (const [groupingKey, prints] of cardMap) {
      const canonicalCard = prints[0]
      
      // Generate a deterministic UUID based on card name, type, and unique identifier
      // Use card_set_id as unique identifier to prevent duplicate oracleIds
      const cardNormalizedName = generateNormalizedName(canonicalCard.card_name)
      const uniqueKey = `onepiece_${cardNormalizedName}_${canonicalCard.card_type.toLowerCase()}_${canonicalCard.card_set_id}`
      const oracleId = uuidv5(uniqueKey, ONEPIECE_NAMESPACE)
      
      const universalCard: UniversalCard = {
        oracleId,
        oracleHash: '', // Will be generated by ETLService
        name: canonicalCard.card_name,
        normalizedName: cardNormalizedName,
        primaryType: this.mapCardType(canonicalCard.card_type),
        subtypes: this.extractSubtypes(canonicalCard),
        supertypes: [],
        oracleText: canonicalCard.card_text,
        flavorText: undefined, // One Piece doesn't typically have flavor text
        keywords: this.extractKeywords(canonicalCard),

        // One Piece specific fields
        cost: this.safeParseInt(canonicalCard.card_cost),
        donCost: undefined, // Will be extracted from cost if needed
        lifeValue: this.safeParseInt(canonicalCard.life),
        counterValue: this.safeParseInt(canonicalCard.counter_amount),
        power: this.safeParseInt(canonicalCard.card_power),

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

  private safeParseInt(value: any, defaultValue: number | undefined = undefined): number | undefined {
    if (value === null || value === undefined || value === '' || value === 'NULL' || value === 'N/A') {
      return defaultValue
    }
    
    const parsed = parseInt(String(value), 10)
    return isNaN(parsed) ? defaultValue : parsed
  }
}