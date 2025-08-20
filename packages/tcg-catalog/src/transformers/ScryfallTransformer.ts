import axios, { AxiosInstance } from 'axios'
import { Game } from '../../../../src/entities/Game'
import { ETLJobType } from '../entities/ETLJob'
import { UniversalCard, UniversalPrint } from '../types/ETLTypes'
import { logger } from '../utils/Logger'
import { generateNormalizedName } from '../utils/Helpers'

interface ScryfallCard {
  id: string
  oracle_id: string
  name: string
  type_line: string
  oracle_text?: string
  flavor_text?: string
  mana_cost?: string
  cmc?: number
  colors?: string[]
  color_identity?: string[]
  power?: string
  toughness?: string
  keywords?: string[]
  set: string
  set_name: string
  collector_number: string
  rarity: string
  artist?: string
  legalities?: {
    standard?: string
    pioneer?: string
    modern?: string
    legacy?: string
    vintage?: string
    commander?: string
    brawl?: string
    historic?: string
    pauper?: string
    penny?: string
  }
  image_uris?: {
    small?: string
    normal?: string
    large?: string
    art_crop?: string
  }
  prices?: {
    usd?: string
    usd_foil?: string
    eur?: string
    tix?: string
  }
  foil: boolean
  nonfoil: boolean
  promo: boolean
  variation: boolean
  frame: string
  border_color: string
  lang: string
  tcgplayer_id?: number
}

interface ScryfallResponse {
  object: string
  total_cards: number
  has_more: boolean
  next_page?: string
  data: ScryfallCard[]
}

export class ScryfallTransformer {
  private client: AxiosInstance
  private readonly baseUrl = 'https://api.scryfall.com'
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
    logger.info('Starting Scryfall data fetch', { gameCode: game.code, jobType })

    try {
      let allCards: ScryfallCard[] = []
      let nextPageUrl: string | undefined = this.buildInitialUrl(jobType, limit)
      
      // Log the query being used
      logger.apiCall('scryfall', nextPageUrl, 'GET')
      logger.info(`🔍 Scryfall Query: ${nextPageUrl}${limit ? ` (limit: ${limit})` : ''}`)

      while (nextPageUrl) {
        logger.debug('Fetching Scryfall page', { url: nextPageUrl })
        
        const response = await this.client.get<ScryfallResponse>(nextPageUrl)
        const data: ScryfallResponse = response.data

        if (data.object !== 'list') {
          throw new Error(`Unexpected response format from Scryfall: ${data.object}`)
        }

        allCards.push(...data.data)
        nextPageUrl = data.next_page

        logger.debug('Fetched Scryfall page', {
          cardsThisPage: data.data.length,
          totalCardsSoFar: allCards.length,
          hasMore: data.has_more
        })

        // Check if we've reached the limit
        if (limit && allCards.length >= limit) {
          allCards = allCards.slice(0, limit) // Trim to exact limit
          logger.info(`✅ Reached limit of ${limit} cards, stopping fetch`)
          break
        }

        // Safety check to prevent infinite loops
        if (allCards.length > 100000) {
          logger.warn('Reached maximum card limit, stopping fetch', { totalCards: allCards.length })
          break
        }
      }

      logger.info('Completed Scryfall data fetch', {
        gameCode: game.code,
        totalCards: allCards.length
      })

      return this.transformToUniversal(allCards)

    } catch (error) {
      logger.error('Failed to fetch Scryfall data', error as Error, {
        gameCode: game.code,
        jobType
      })
      throw error
    }
  }

  private buildInitialUrl(jobType: ETLJobType, limit?: number): string {
    const baseQuery = '/cards/search?q='
    
    // For small limits, use broad queries that are guaranteed to return results
    if (limit && limit <= 100) {
      return `${baseQuery}game:paper is:booster` // Cards in booster packs (always has results)
    }
    
    switch (jobType) {
      case ETLJobType.FULL:
      case ETLJobType.FULL_SYNC:
        return `${baseQuery}game:paper`
      case ETLJobType.INCREMENTAL:
      case ETLJobType.INCREMENTAL_SYNC:
        // For testing with limits, use broader query. For production, use date-based
        if (limit && limit <= 1000) {
          return `${baseQuery}game:paper is:booster` // Fallback for testing
        }
        // Fetch cards from last 7 days
        const sevenDaysAgo = new Date()
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
        const dateStr = sevenDaysAgo.toISOString().split('T')[0]
        return `${baseQuery}game:paper date>=${dateStr}`
      case ETLJobType.SETS:
        // Fetch only the most recent set
        return `${baseQuery}game:paper is:new`
      case ETLJobType.BANLIST_UPDATE:
        // For banlist updates, fetch cards that are legal in major formats
        return `${baseQuery}game:paper (legal:standard OR legal:pioneer OR legal:modern OR legal:legacy OR legal:vintage OR legal:commander)`
      default:
        // Default to recent sets, but use booster for small limits
        return limit && limit <= 100 ? 
          `${baseQuery}game:paper is:booster` : 
          `${baseQuery}game:paper is:new`
    }
  }

  private transformToUniversal(scryfallCards: ScryfallCard[]): UniversalCard[] {
    // Group cards by oracle_id to handle multiple prints
    const cardMap = new Map<string, ScryfallCard[]>()
    
    for (const card of scryfallCards) {
      const existing = cardMap.get(card.oracle_id) || []
      existing.push(card)
      cardMap.set(card.oracle_id, existing)
    }

    const universalCards: UniversalCard[] = []

    for (const [oracleId, prints] of cardMap) {
      // Use the first print as the canonical card data
      const canonicalCard = prints[0]
      
      const universalCard: UniversalCard = {
        oracleId,
        oracleHash: '', // Will be generated by ETLService
        name: canonicalCard.name,
        normalizedName: generateNormalizedName(canonicalCard.name),
        primaryType: this.extractPrimaryType(canonicalCard.type_line),
        subtypes: this.extractSubtypes(canonicalCard.type_line),
        supertypes: this.extractSupertypes(canonicalCard.type_line),
        oracleText: canonicalCard.oracle_text,
        flavorText: canonicalCard.flavor_text,
        keywords: canonicalCard.keywords || [],

        // MTG specific fields
        manaCost: canonicalCard.mana_cost,
        manaValue: canonicalCard.cmc,
        colors: canonicalCard.colors || [],
        colorIdentity: canonicalCard.color_identity || [],
        powerValue: this.parseNumericValue(canonicalCard.power) || undefined,
        defenseValue: this.parseNumericValue(canonicalCard.toughness) || undefined,

        // Other game fields (null for MTG)
        hp: undefined,
        retreatCost: undefined,
        energyTypes: [],
        evolutionStage: undefined,
        attribute: undefined,
        levelRank: undefined,
        attackValue: undefined,
        defenseValueYugioh: undefined,
        cost: undefined,
        donCost: undefined,
        lifeValue: undefined,
        counterValue: undefined,
        power: undefined,

        prints: prints.map(print => this.transformPrint(print))
      }

      universalCards.push(universalCard)
    }

    return universalCards
  }

  private transformPrint(scryfallCard: ScryfallCard): UniversalPrint {
    return {
      printHash: '', // Will be generated by ETLService
      setCode: scryfallCard.set.toUpperCase(),
      setName: scryfallCard.set_name,
      collectorNumber: scryfallCard.collector_number || 'unknown',
      rarity: this.normalizeRarity(scryfallCard.rarity),
      artist: scryfallCard.artist,
      flavorText: scryfallCard.flavor_text,
      language: scryfallCard.lang,
      isFoilAvailable: scryfallCard.foil,
      isAlternateArt: scryfallCard.variation,
      isPromo: scryfallCard.promo,
      finish: scryfallCard.nonfoil ? 'normal' : 'foil',
      variation: scryfallCard.variation ? 'alternate' : undefined,
      frame: scryfallCard.frame,
      borderColor: scryfallCard.border_color,
      
      // Format legality (from Scryfall API)
      formatLegality: this.extractFormatLegality(scryfallCard),
      
      // External IDs
      externalIds: {
        scryfall: scryfallCard.id,
        tcgplayer: scryfallCard.tcgplayer_id?.toString()
      },

      // Images - Map Scryfall image types to our universal format
      // IMPORTANT: small/normal/large = full card images
      // NOTE: artCrop (art_crop) intentionally excluded to prevent storage overwrites
      images: scryfallCard.image_uris ? {
        small: scryfallCard.image_uris.small,      // Full card, small size
        normal: scryfallCard.image_uris.normal,    // Full card, normal size  
        large: scryfallCard.image_uris.large       // Full card, large size
      } : undefined,

      // Prices
      prices: scryfallCard.prices ? {
        usd: scryfallCard.prices.usd ? parseFloat(scryfallCard.prices.usd) : undefined,
        usdFoil: scryfallCard.prices.usd_foil ? parseFloat(scryfallCard.prices.usd_foil) : undefined,
        eur: scryfallCard.prices.eur ? parseFloat(scryfallCard.prices.eur) : undefined
      } : undefined
    }
  }

  private extractPrimaryType(typeLine: string): string {
    // Examples: "Creature — Human Warrior", "Instant", "Artifact — Equipment"
    const types = typeLine.split('—')[0].trim().split(' ')
    
    // Return the rightmost type (most specific)
    const primaryTypes = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land']
    
    for (let i = types.length - 1; i >= 0; i--) {
      if (primaryTypes.includes(types[i])) {
        return types[i]
      }
    }
    
    return types[types.length - 1] || 'Unknown'
  }

  private extractSubtypes(typeLine: string): string[] {
    const parts = typeLine.split('—')
    if (parts.length > 1) {
      return parts[1].trim().split(' ').filter(Boolean)
    }
    return []
  }

  private extractSupertypes(typeLine: string): string[] {
    const supertypes = ['Basic', 'Legendary', 'Snow', 'World']
    const types = typeLine.split('—')[0].trim().split(' ')
    
    return types.filter(type => supertypes.includes(type))
  }

  private normalizeRarity(scryfallRarity: string): string {
    const rarityMap: Record<string, string> = {
      'common': 'Common',
      'uncommon': 'Uncommon', 
      'rare': 'Rare',
      'mythic': 'Mythic Rare',
      'special': 'Special',
      'bonus': 'Bonus'
    }

    return rarityMap[scryfallRarity] || scryfallRarity
  }

  private parseNumericValue(value: string | undefined): number | null {
    if (!value) return null
    
    // Handle special values like '*' or 'X'
    if (value === '*' || value === 'X') return null
    
    const parsed = parseInt(value, 10)
    return isNaN(parsed) ? null : parsed
  }

  private extractFormatLegality(card: ScryfallCard): Record<string, string> | undefined {
    if (!card.legalities) {
      return undefined
    }

    const legality: Record<string, string> = {}

    // Map Scryfall legality to our format codes
    if (card.legalities.standard) {
      legality.standard = card.legalities.standard
    }
    if (card.legalities.pioneer) {
      legality.pioneer = card.legalities.pioneer
    }
    if (card.legalities.modern) {
      legality.modern = card.legalities.modern
    }
    if (card.legalities.legacy) {
      legality.legacy = card.legalities.legacy
    }
    if (card.legalities.vintage) {
      legality.vintage = card.legalities.vintage
    }
    if (card.legalities.commander) {
      legality.commander = card.legalities.commander
    }
    if (card.legalities.brawl) {
      legality.brawl = card.legalities.brawl
    }
    if (card.legalities.historic) {
      legality.historic = card.legalities.historic
    }
    if (card.legalities.pauper) {
      legality.pauper = card.legalities.pauper
    }

    return Object.keys(legality).length > 0 ? legality : undefined
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}