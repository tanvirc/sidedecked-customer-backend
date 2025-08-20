import axios, { AxiosInstance } from 'axios'
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid'
import { Game } from '../../../../src/entities/Game'
import { ETLJobType } from '../entities/ETLJob'
import { UniversalCard, UniversalPrint } from '../types/ETLTypes'
import { logger } from '../utils/Logger'
import { generateNormalizedName } from '../utils/Helpers'

interface YugiohCard {
  id: number
  name: string
  type: string
  frameType: string
  desc: string
  atk?: number
  def?: number
  level?: number
  race: string
  attribute?: string
  archetype?: string
  scale?: number
  linkval?: number
  linkmarkers?: string[]
  card_sets?: Array<{
    set_name: string
    set_code: string
    set_rarity: string
    set_rarity_code: string
    set_price: string
  }>
  card_images?: Array<{
    id: number
    image_url: string
    image_url_small: string
    image_url_cropped: string
  }>
  card_prices?: Array<{
    cardmarket_price: string
    tcgplayer_price: string
    ebay_price: string
    amazon_price: string
    coolstuffinc_price: string
  }>
}

interface YugiohResponse {
  data: YugiohCard[]
  meta: {
    current_rows: number
    total_rows: number
    rows_remaining: number
    total_pages: number
    pages_remaining: number
  }
}

export class YugiohTransformer {
  private client: AxiosInstance
  private readonly baseUrl = 'https://db.ygoprodeck.com/api/v7'
  private readonly rateLimit = 100 // milliseconds between requests

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

  async fetchCards(game: Game, jobType: ETLJobType, limit?: number): Promise<UniversalCard[]> {
    logger.info('Starting YuGiOh data fetch', { gameCode: game.code, jobType, limit })

    try {
      let allCards: YugiohCard[] = []
      
      // YGOPro API doesn't support pagination, so we fetch all cards at once
      // For incremental updates, we'll filter by date later
      const params = this.buildParams(jobType, limit)
      logger.debug('Fetching YuGiOh cards from YGOPro API', { params })
      
      // Log the query being used
      logger.apiCall('ygoprodeck', '/cardinfo.php', 'GET')
      logger.info(`🔍 YuGiOh Query: ${JSON.stringify(params)}${limit ? ` (limit: ${limit})` : ''}`)
      
      const response = await this.client.get<YugiohResponse>('/cardinfo.php', {
        params
      })

      allCards = response.data.data || []

      // Apply limit if specified (since YGOPro API doesn't support pagination)
      if (limit && allCards.length > limit) {
        allCards = allCards.slice(0, limit)
        logger.info(`✅ Trimmed to limit of ${limit} cards (YGOPro API doesn't support pagination)`)
      }

      logger.info('Completed YuGiOh data fetch', {
        gameCode: game.code,
        totalCards: allCards.length
      })

      return this.transformToUniversal(allCards)

    } catch (error) {
      logger.error('Failed to fetch YuGiOh data', error as Error, {
        gameCode: game.code,
        jobType
      })
      throw error
    }
  }

  private buildParams(jobType: ETLJobType, limit?: number): Record<string, any> {
    const params: Record<string, any> = {}

    // Strategy: Use broader queries for larger limits to ensure we get enough results
    // Avoid overly restrictive filters that might return fewer cards than requested
    
    if (limit) {
      if (limit <= 50) {
        // For very small limits, use monster cards
        params.type = 'Effect Monster'
      } else if (limit <= 200) {
        // For medium limits, use broader monster category
        params.race = 'Warrior' // Popular race with many cards
      } else {
        // For large limits (500+), use minimal filtering to get maximum cards
        // Don't add restrictive type/archetype filters
        logger.info(`Using broad query for YuGiOh limit of ${limit} cards`)
      }
    } else {
      // For unlimited requests, follow job type logic
      switch (jobType) {
        case ETLJobType.FULL:
        case ETLJobType.FULL_SYNC:
          // No additional filters - get all cards
          break
        case ETLJobType.INCREMENTAL:
        case ETLJobType.INCREMENTAL_SYNC:
          // Use a broad archetype for incremental
          params.archetype = 'Blue-Eyes'
          break
        case ETLJobType.SETS:
          params.archetype = 'Blue-Eyes'
          break
        case ETLJobType.BANLIST_UPDATE:
          params.archetype = 'Dark Magician'
          break
        default:
          params.type = 'Effect Monster'
          break
      }
    }

    return params
  }

  private transformToUniversal(yugiohCards: YugiohCard[]): UniversalCard[] {
    const universalCards: UniversalCard[] = []
    // Use a fixed namespace UUID for Yu-Gi-Oh! cards to ensure consistent generation
    const YUGIOH_NAMESPACE = '6ba7b814-9dad-11d1-80b4-00c04fd430c8' // Using DNS namespace UUID

    for (const card of yugiohCards) {
      // Generate a deterministic UUID based on the card ID
      const oracleId = uuidv5(`yugioh_${card.id}`, YUGIOH_NAMESPACE)
      
      const universalCard: UniversalCard = {
        oracleId,
        oracleHash: '', // Will be generated by ETLService
        name: card.name,
        normalizedName: generateNormalizedName(card.name),
        primaryType: this.mapCardType(card.type),
        subtypes: this.extractSubtypes(card.race, card.type),
        supertypes: this.extractSupertypes(card.type),
        oracleText: card.desc,
        flavorText: undefined, // YuGiOh doesn't typically have flavor text
        keywords: this.extractKeywords(card),

        // YuGiOh specific fields
        attribute: card.attribute,
        levelRank: this.safeParseInt(card.level),
        attackValue: this.safeParseInt(card.atk),
        defenseValueYugioh: this.safeParseInt(card.def),

        // MTG fields (undefined for YuGiOh)
        manaCost: undefined,
        manaValue: undefined,
        colors: [],
        colorIdentity: [],
        powerValue: undefined,
        defenseValue: undefined,

        // Pokemon fields (undefined for YuGiOh)
        hp: undefined,
        retreatCost: undefined,
        energyTypes: [],
        evolutionStage: undefined,

        // One Piece fields (undefined for YuGiOh)
        cost: undefined,
        donCost: undefined,
        lifeValue: undefined,
        counterValue: undefined,
        power: undefined,

        prints: this.transformPrints(card)
      }

      universalCards.push(universalCard)
    }

    return universalCards
  }

  private transformPrints(yugiohCard: YugiohCard): UniversalPrint[] {
    if (!yugiohCard.card_sets || yugiohCard.card_sets.length === 0) {
      // Create a default print if no sets are available
      return [{
        printHash: '', // Will be generated by ETLService
        setCode: 'UNKNOWN',
        setName: 'Unknown Set',
        collectorNumber: `UNK-${yugiohCard.id}`, // Use card ID for uniqueness when no set info
        rarity: 'Common',
        artist: undefined,
        flavorText: undefined,
        language: 'en',
        isFoilAvailable: false,
        isAlternateArt: false,
        isPromo: false,
        finish: 'normal',
        variation: undefined,
        frame: 'normal',
        borderColor: 'black',
        
        // Basic format legality for YuGiOh
        formatLegality: this.extractFormatLegality(yugiohCard),
        
        externalIds: {
          yugiohProdeck: yugiohCard.id.toString()
        },

        images: yugiohCard.card_images?.[0] ? {
          small: yugiohCard.card_images[0].image_url_small,
          normal: yugiohCard.card_images[0].image_url,
          large: yugiohCard.card_images[0].image_url
          // artCrop intentionally excluded - not needed and causes overwrite issues
        } : undefined,

        prices: this.extractPrices(yugiohCard, 0)
      }]
    }

    return yugiohCard.card_sets.map((cardSet, index) => ({
      printHash: '', // Will be generated by ETLService
      setCode: cardSet.set_code.split('-')[0], // Extract actual set code (e.g., "CT13" from "CT13-EN003")
      setName: cardSet.set_name,
      collectorNumber: `${cardSet.set_code}-${cardSet.set_rarity_code || index}`, // Use full code + rarity for uniqueness
      rarity: this.normalizeRarity(cardSet.set_rarity),
      artist: undefined, // YGOPro API doesn't provide artist info
      flavorText: undefined,
      language: 'en',
      isFoilAvailable: this.hasFoilVariant(cardSet.set_rarity),
      isAlternateArt: this.isAlternateArt(cardSet.set_rarity),
      isPromo: this.isPromo(cardSet.set_code),
      finish: this.getFoilType(cardSet.set_rarity),
      variation: undefined,
      frame: 'normal',
      borderColor: 'black',
      
      // Basic format legality for YuGiOh
      formatLegality: this.extractFormatLegality(yugiohCard),
      
      externalIds: {
        yugiohProdeck: yugiohCard.id.toString()
      },

      // Images - Map YGOPRODeck image types to our universal format  
      // IMPORTANT: image_url/image_url_small = full card images
      // NOTE: artCrop (image_url_cropped) intentionally excluded to prevent storage overwrites
      images: yugiohCard.card_images?.[0] ? {
        small: yugiohCard.card_images[0].image_url_small,    // Full card, small size
        normal: yugiohCard.card_images[0].image_url,         // Full card, normal size
        large: yugiohCard.card_images[0].image_url           // Full card, reuse normal size
      } : undefined,

      prices: this.extractPrices(yugiohCard, index)
    }))
  }

  private mapCardType(yugiohType: string): string {
    const typeMap: Record<string, string> = {
      'Effect Monster': 'Creature',
      'Normal Monster': 'Creature',
      'Ritual Monster': 'Creature',
      'Fusion Monster': 'Creature',
      'Synchro Monster': 'Creature',
      'XYZ Monster': 'Creature',
      'Pendulum Monster': 'Creature',
      'Link Monster': 'Creature',
      'Spell Card': 'Sorcery',
      'Trap Card': 'Instant'
    }

    return typeMap[yugiohType] || 'Creature'
  }

  private extractSubtypes(race: string, type: string): string[] {
    const subtypes = [race]
    
    // Add additional subtypes based on card type
    if (type.includes('Pendulum')) {
      subtypes.push('Pendulum')
    }
    if (type.includes('Synchro')) {
      subtypes.push('Synchro')
    }
    if (type.includes('XYZ')) {
      subtypes.push('Xyz')
    }
    if (type.includes('Link')) {
      subtypes.push('Link')
    }
    if (type.includes('Fusion')) {
      subtypes.push('Fusion')
    }
    if (type.includes('Ritual')) {
      subtypes.push('Ritual')
    }

    return subtypes.filter(Boolean)
  }

  private extractSupertypes(type: string): string[] {
    const supertypes: string[] = []
    
    if (type.includes('Effect')) {
      supertypes.push('Effect')
    }
    if (type.includes('Normal')) {
      supertypes.push('Normal')
    }

    return supertypes
  }

  private extractKeywords(card: YugiohCard): string[] {
    const keywords: string[] = []

    if (card.archetype) {
      keywords.push(card.archetype)
    }

    if (card.attribute) {
      keywords.push(card.attribute)
    }

    if (card.linkmarkers && card.linkmarkers.length > 0) {
      keywords.push(...card.linkmarkers)
    }

    return keywords
  }

  private extractCollectorNumber(setCode: string): string {
    // Extract collector number from set code (e.g., "LOB-001" -> "001")
    const parts = setCode.split('-')
    return parts.length > 1 ? parts[1] : '001'
  }

  private normalizeRarity(yugiohRarity: string): string {
    const rarityMap: Record<string, string> = {
      'Common': 'Common',
      'Rare': 'Rare',
      'Super Rare': 'Rare',
      'Ultra Rare': 'Mythic Rare',
      'Secret Rare': 'Mythic Rare',
      'Ultimate Rare': 'Mythic Rare',
      'Ghost Rare': 'Mythic Rare',
      'Starlight Rare': 'Mythic Rare',
      'Prismatic Secret Rare': 'Mythic Rare',
      'Quarter Century Secret Rare': 'Mythic Rare'
    }

    return rarityMap[yugiohRarity] || yugiohRarity
  }

  private hasFoilVariant(rarity: string): boolean {
    const foilRarities = ['Super Rare', 'Ultra Rare', 'Secret Rare', 'Ultimate Rare', 'Ghost Rare', 'Starlight Rare', 'Prismatic Secret Rare']
    return foilRarities.includes(rarity)
  }

  private isAlternateArt(rarity: string): boolean {
    return rarity.includes('Alternate Art') || rarity.includes('Alt Art')
  }

  private isPromo(setCode: string): boolean {
    const promoCodes = ['PROMO', 'JUMP', 'YAP', 'GLD', 'TU', 'OP', 'YCS']
    return promoCodes.some(code => setCode.includes(code))
  }

  private getFoilType(rarity: string): string {
    if (this.hasFoilVariant(rarity)) {
      return 'foil'
    }
    return 'normal'
  }

  private extractFormatLegality(card: YugiohCard): Record<string, string> | undefined {
    // Basic format legality for YuGiOh
    // Since YGOPro API doesn't provide banlist info, we assume all cards are legal in TCG
    // In a production system, this would need to cross-reference with banlist APIs
    return {
      tcg: 'legal',
      ocg: 'legal'
    }
  }

  private extractPrices(card: YugiohCard, setIndex: number): { usd?: number } | undefined {
    if (!card.card_prices || card.card_prices.length === 0) {
      return undefined
    }

    // Use the first price entry (they usually only have one)
    const prices = card.card_prices[0]
    
    // Try to get USD price from TCGPlayer first, then other sources
    let usdPrice: number | undefined

    usdPrice = this.safeParseFloat(prices.tcgplayer_price) 
      || this.safeParseFloat(prices.cardmarket_price)
      || this.safeParseFloat(prices.amazon_price)

    return usdPrice ? { usd: usdPrice } : undefined
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

  private safeParseFloat(value: any, defaultValue: number | undefined = undefined): number | undefined {
    if (value === null || value === undefined || value === '' || value === 'NULL' || value === 'N/A' || value === '0') {
      return defaultValue
    }
    
    const parsed = parseFloat(String(value))
    return isNaN(parsed) ? defaultValue : parsed
  }
}