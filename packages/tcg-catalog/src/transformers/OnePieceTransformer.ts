import axios, { AxiosInstance } from 'axios'
import { Game } from '../../../../src/entities/Game'
import { ETLJobType } from '../entities/ETLJob'
import { UniversalCard, UniversalPrint } from '../types/ETLTypes'
import { logger } from '../utils/Logger'
import { generateNormalizedName } from '../utils/Helpers'

interface OnePieceCard {
  id: string
  name: string
  type: string
  color?: string[]
  cost?: string
  power?: string
  counter?: string
  life?: string
  attribute?: string
  effect?: string
  trigger?: string
  rarity: string
  set_id: string
  set_name: string
  card_number: string
  artist?: string
  release_date?: string
  image_url?: string
  price_usd?: number
}

// Note: This is a placeholder interface as there's no official One Piece TCG API yet
// We'll create a structure that can be adapted when an official API becomes available
interface OnePieceResponse {
  cards: OnePieceCard[]
  total: number
  page?: number
  per_page?: number
}

export class OnePieceTransformer {
  private client: AxiosInstance
  private readonly baseUrl = 'https://api.onepiece-cardgame.dev/v1' // Placeholder URL
  private readonly rateLimit = 150 // milliseconds between requests

  constructor() {
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

  async fetchCards(game: Game, jobType: ETLJobType): Promise<UniversalCard[]> {
    logger.info('Starting One Piece TCG data fetch', { gameCode: game.code, jobType })

    try {
      // For now, we'll return mock data since there's no official API
      // This can be replaced when an official API becomes available
      const mockCards = this.generateMockCards(jobType)

      logger.info('Completed One Piece TCG data fetch', {
        gameCode: game.code,
        totalCards: mockCards.length,
        note: 'Using mock data - no official API available yet'
      })

      return this.transformToUniversal(mockCards)

    } catch (error) {
      logger.error('Failed to fetch One Piece TCG data', error as Error, {
        gameCode: game.code,
        jobType
      })
      throw error
    }
  }

  private generateMockCards(jobType: ETLJobType): OnePieceCard[] {
    // Generate some mock One Piece cards for testing
    // This should be replaced with actual API calls when available
    const mockCards: OnePieceCard[] = [
      {
        id: 'OP01-001',
        name: 'Monkey D. Luffy',
        type: 'Leader',
        color: ['Red'],
        cost: '0',
        power: '5000',
        life: '5',
        attribute: 'Straw Hat Crew',
        effect: '[Activate: Main] DON!! -1 (You may return the specified number of DON!! cards from your field to your DON!! deck.): Up to 1 of your Leader or Character cards gains +1000 power during this turn.',
        rarity: 'Leader',
        set_id: 'OP01',
        set_name: 'Romance Dawn',
        card_number: '001',
        artist: 'Eiichiro Oda',
        release_date: '2022-07-08',
        image_url: 'https://onepiece-cardgame.com/images/cardlist/card/OP01-001.png',
        price_usd: 25.00
      },
      {
        id: 'OP01-025',
        name: 'Roronoa Zoro',
        type: 'Character',
        color: ['Green'],
        cost: '4',
        power: '5000',
        counter: '1000',
        attribute: 'Straw Hat Crew',
        effect: '[DON!! x1] [When Attacking] K.O. up to 1 of your opponent\'s Characters with a cost of 3 or less.',
        rarity: 'Super Rare',
        set_id: 'OP01',
        set_name: 'Romance Dawn',
        card_number: '025',
        artist: 'Eiichiro Oda',
        release_date: '2022-07-08',
        image_url: 'https://onepiece-cardgame.com/images/cardlist/card/OP01-025.png',
        price_usd: 8.50
      },
      {
        id: 'OP01-067',
        name: 'Gum-Gum Pistol',
        type: 'Event',
        color: ['Red'],
        cost: '2',
        trigger: 'Draw 1 card.',
        effect: '[Counter] Up to 1 of your Leader or Character cards gains +2000 power during this battle.',
        rarity: 'Common',
        set_id: 'OP01',
        set_name: 'Romance Dawn',
        card_number: '067',
        release_date: '2022-07-08',
        image_url: 'https://onepiece-cardgame.com/images/cardlist/card/OP01-067.png',
        price_usd: 0.25
      }
    ]

    // Filter based on job type
    switch (jobType) {
      case 'full':
        return mockCards
      case 'incremental':
        // Return only recent cards (mock: last card)
        return mockCards.slice(-1)
      case 'sets':
        // Return cards from specific set
        return mockCards.filter(card => card.set_id === 'OP01')
      default:
        return mockCards
    }
  }

  private async fetchCardsFromAPI(jobType: ETLJobType): Promise<OnePieceCard[]> {
    // This method will be implemented when an official API becomes available
    let allCards: OnePieceCard[] = []
    let page = 1
    const perPage = 100

    while (true) {
      try {
        logger.debug('Fetching One Piece TCG page', { page, perPage })
        
        const response = await this.client.get<OnePieceResponse>('/cards', {
          params: {
            page,
            per_page: perPage,
            ...this.buildQueryParams(jobType)
          }
        })

        const data = response.data
        allCards.push(...data.cards)

        logger.debug('Fetched One Piece TCG page', {
          cardsThisPage: data.cards.length,
          totalCardsSoFar: allCards.length,
          page
        })

        if (data.cards.length < perPage) {
          break
        }

        page++

        // Safety check
        if (allCards.length > 10000) {
          logger.warn('Reached maximum card limit, stopping fetch', { totalCards: allCards.length })
          break
        }

      } catch (error) {
        logger.error('Error fetching One Piece cards from API', error as Error, { page })
        break
      }
    }

    return allCards
  }

  private buildQueryParams(jobType: ETLJobType): Record<string, any> {
    const params: Record<string, any> = {}

    switch (jobType) {
      case ETLJobType.FULL:
      case ETLJobType.FULL_SYNC:
        // No additional filters
        break
      case ETLJobType.INCREMENTAL:
      case ETLJobType.INCREMENTAL_SYNC:
        // Fetch cards from last 30 days
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        params.since = thirtyDaysAgo.toISOString().split('T')[0]
        break
      case ETLJobType.SETS:
        // Fetch only from latest set
        params.latest_set = true
        break
      case ETLJobType.BANLIST_UPDATE:
        // For banlist updates, get all cards (mock API limitation)
        break
      default:
        // Default to latest set
        params.latest_set = true
        break
    }

    return params
  }

  private transformToUniversal(onePieceCards: OnePieceCard[]): UniversalCard[] {
    // Group cards by name to handle multiple prints
    const cardMap = new Map<string, OnePieceCard[]>()
    
    for (const card of onePieceCards) {
      const normalizedName = generateNormalizedName(card.name)
      const existing = cardMap.get(normalizedName) || []
      existing.push(card)
      cardMap.set(normalizedName, existing)
    }

    const universalCards: UniversalCard[] = []

    for (const [normalizedName, prints] of cardMap) {
      const canonicalCard = prints[0]
      
      // Generate oracle ID for One Piece
      const oracleId = `onepiece_${normalizedName}_${canonicalCard.type.toLowerCase()}`
      
      const universalCard: UniversalCard = {
        oracleId,
        oracleHash: '', // Will be generated by ETLService
        name: canonicalCard.name,
        normalizedName,
        primaryType: this.mapCardType(canonicalCard.type),
        subtypes: this.extractSubtypes(canonicalCard),
        supertypes: [],
        oracleText: canonicalCard.effect,
        flavorText: undefined, // One Piece doesn't typically have flavor text
        keywords: this.extractKeywords(canonicalCard),

        // One Piece specific fields
        cost: canonicalCard.cost ? parseInt(canonicalCard.cost, 10) : undefined,
        donCost: undefined, // Will be extracted from cost if needed
        lifeValue: canonicalCard.life ? parseInt(canonicalCard.life, 10) : undefined,
        counterValue: canonicalCard.counter ? parseInt(canonicalCard.counter, 10) : undefined,
        power: canonicalCard.power ? parseInt(canonicalCard.power, 10) : undefined,

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

  private transformPrint(onePieceCard: OnePieceCard): UniversalPrint {
    return {
      printHash: '', // Will be generated by ETLService
      setCode: onePieceCard.set_id,
      setName: onePieceCard.set_name,
      collectorNumber: onePieceCard.card_number,
      rarity: this.normalizeRarity(onePieceCard.rarity),
      artist: onePieceCard.artist,
      flavorText: undefined,
      language: 'en',
      isFoilAvailable: this.hasFoilVariant(onePieceCard.rarity),
      isAlternateArt: false,
      isPromo: this.isPromo(onePieceCard.rarity),
      finish: 'normal',
      variation: undefined,
      frame: 'normal',
      borderColor: 'black',
      
      // Basic format legality for One Piece
      formatLegality: this.extractFormatLegality(onePieceCard),
      
      externalIds: {
        pokemonTcg: onePieceCard.id // Temporary: will be fixed when official API available
      },

      images: onePieceCard.image_url ? {
        small: onePieceCard.image_url,
        normal: onePieceCard.image_url,
        large: onePieceCard.image_url
      } : undefined,

      prices: onePieceCard.price_usd ? {
        usd: onePieceCard.price_usd
      } : undefined
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

  private extractSubtypes(card: OnePieceCard): string[] {
    const subtypes: string[] = []

    if (card.attribute) {
      subtypes.push(card.attribute)
    }

    if (card.color && card.color.length > 0) {
      subtypes.push(...card.color)
    }

    return subtypes
  }

  private extractKeywords(card: OnePieceCard): string[] {
    const keywords: string[] = []

    if (card.attribute) {
      keywords.push(card.attribute)
    }

    if (card.color && card.color.length > 0) {
      keywords.push(...card.color)
    }

    if (card.trigger) {
      keywords.push('Trigger')
    }

    if (card.type) {
      keywords.push(card.type)
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

  private extractFormatLegality(card: OnePieceCard): Record<string, string> | undefined {
    // Basic format legality for One Piece
    // Since there's no official API yet, we assume all cards are legal in standard format
    return {
      standard: 'legal'
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}