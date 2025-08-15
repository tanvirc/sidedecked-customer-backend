import axios, { AxiosInstance } from 'axios'
import { Game } from '../entities/Game'
import { ETLJobType } from '../entities/ETLJob'
import { UniversalCard, UniversalPrint } from '../types/ETLTypes'
import { logger } from '../utils/Logger'
import { generateNormalizedName } from '../utils/Helpers'

interface PokemonCard {
  id: string
  name: string
  supertype: string
  subtypes?: string[]
  hp?: string
  types?: string[]
  evolvesFrom?: string
  evolvesTo?: string[]
  attacks?: Array<{
    name: string
    cost?: string[]
    convertedEnergyCost?: number
    damage?: string
    text?: string
  }>
  weaknesses?: Array<{
    type: string
    value: string
  }>
  resistances?: Array<{
    type: string
    value: string
  }>
  retreatCost?: string[]
  convertedRetreatCost?: number
  set: {
    id: string
    name: string
    series: string
    printedTotal: number
    total: number
    ptcgoCode?: string
    releaseDate: string
    updatedAt: string
    images: {
      symbol: string
      logo: string
    }
  }
  number: string
  artist?: string
  rarity: string
  flavorText?: string
  nationalPokedexNumbers?: number[]
  legalities?: {
    unlimited?: string
    standard?: string
    expanded?: string
  }
  images?: {
    small: string
    large: string
  }
  tcgplayer?: {
    url: string
    updatedAt: string
    prices?: {
      holofoil?: {
        low?: number
        mid?: number
        high?: number
        market?: number
        directLow?: number
      }
      reverseHolofoil?: {
        low?: number
        mid?: number
        high?: number
        market?: number
        directLow?: number
      }
      normal?: {
        low?: number
        mid?: number
        high?: number
        market?: number
        directLow?: number
      }
    }
  }
}

interface PokemonResponse {
  data: PokemonCard[]
  page: number
  pageSize: number
  count: number
  totalCount: number
}

export class PokemonTransformer {
  private client: AxiosInstance
  private readonly baseUrl = 'https://api.pokemontcg.io/v2'
  private readonly rateLimit = 200 // milliseconds between requests
  private readonly apiKey: string

  constructor() {
    this.apiKey = process.env.POKEMON_TCG_API_KEY || ''
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)',
        ...(this.apiKey && { 'X-Api-Key': this.apiKey })
      }
    })

    // Rate limiting interceptor
    this.client.interceptors.request.use(async (config) => {
      await this.sleep(this.rateLimit)
      return config
    })
  }

  async fetchCards(game: Game, jobType: ETLJobType): Promise<UniversalCard[]> {
    logger.info('Starting Pokemon TCG data fetch', { gameCode: game.code, jobType })

    try {
      let allCards: PokemonCard[] = []
      let page = 1
      const pageSize = 250 // Pokemon API max page size

      while (true) {
        logger.debug('Fetching Pokemon TCG page', { page, pageSize })
        
        const query = this.buildQuery(jobType)
        const response = await this.client.get<PokemonResponse>('/cards', {
          params: {
            q: query,
            page,
            pageSize,
            orderBy: 'set.releaseDate'
          }
        })

        const data = response.data
        allCards.push(...data.data)

        logger.debug('Fetched Pokemon TCG page', {
          cardsThisPage: data.data.length,
          totalCardsSoFar: allCards.length,
          page: data.page,
          totalCount: data.totalCount
        })

        // Check if we have more pages
        if (data.data.length < pageSize || allCards.length >= data.totalCount) {
          break
        }

        page++

        // Safety check
        if (allCards.length > 50000) {
          logger.warn('Reached maximum card limit, stopping fetch', { totalCards: allCards.length })
          break
        }
      }

      logger.info('Completed Pokemon TCG data fetch', {
        gameCode: game.code,
        totalCards: allCards.length
      })

      return this.transformToUniversal(allCards)

    } catch (error) {
      logger.error('Failed to fetch Pokemon TCG data', error as Error, {
        gameCode: game.code,
        jobType
      })
      throw error
    }
  }

  private buildQuery(jobType: ETLJobType): string {
    switch (jobType) {
      case 'full':
        return '!set.id:*promo*' // Exclude promo sets for now
      case 'incremental':
        // Fetch cards from sets updated in last 30 days
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        const dateStr = thirtyDaysAgo.toISOString().split('T')[0]
        return `set.updatedAt:[${dateStr} TO *]`
      case 'sets':
        // Fetch only from the latest set
        return 'set.series:"Sword & Shield"' // Adjust as needed
      default:
        throw new Error(`Unknown job type: ${jobType}`)
    }
  }

  private transformToUniversal(pokemonCards: PokemonCard[]): UniversalCard[] {
    // Group cards by name to handle multiple prints/sets
    const cardMap = new Map<string, PokemonCard[]>()
    
    for (const card of pokemonCards) {
      // Use normalized name as key for grouping
      const normalizedName = generateNormalizedName(card.name)
      const existing = cardMap.get(normalizedName) || []
      existing.push(card)
      cardMap.set(normalizedName, existing)
    }

    const universalCards: UniversalCard[] = []

    for (const [normalizedName, prints] of cardMap) {
      // Use the first print as canonical card data
      const canonicalCard = prints[0]
      
      // Generate a pseudo oracle_id for Pokemon (they don't have one)
      const oracleId = `pokemon_${normalizedName}_${canonicalCard.supertype}`
      
      const universalCard: UniversalCard = {
        oracleId,
        oracleHash: '', // Will be generated by ETLService
        name: canonicalCard.name,
        normalizedName,
        primaryType: this.mapSupertype(canonicalCard.supertype),
        subtypes: canonicalCard.subtypes || [],
        supertypes: [canonicalCard.supertype],
        oracleText: this.buildOracleText(canonicalCard),
        flavorText: canonicalCard.flavorText,
        keywords: this.extractKeywords(canonicalCard),

        // Pokemon specific fields
        hp: canonicalCard.hp ? parseInt(canonicalCard.hp, 10) : null,
        retreatCost: canonicalCard.convertedRetreatCost,
        energyTypes: canonicalCard.types || [],
        evolutionStage: this.determineEvolutionStage(canonicalCard),

        // MTG fields (null for Pokemon)
        manaCost: null,
        manaValue: null,
        colors: [],
        colorIdentity: [],
        powerValue: null,
        defenseValue: null,

        // Other game fields (null for Pokemon)
        attribute: null,
        levelRank: null,
        attackValue: null,
        defenseValueYugioh: null,
        cost: null,
        donCost: null,
        lifeValue: null,
        counterValue: null,
        power: null,

        prints: prints.map(print => this.transformPrint(print))
      }

      universalCards.push(universalCard)
    }

    return universalCards
  }

  private transformPrint(pokemonCard: PokemonCard): UniversalPrint {
    return {
      printHash: '', // Will be generated by ETLService
      setCode: pokemonCard.set.ptcgoCode || pokemonCard.set.id.toUpperCase(),
      setName: pokemonCard.set.name,
      collectorNumber: pokemonCard.number,
      rarity: this.normalizeRarity(pokemonCard.rarity),
      artist: pokemonCard.artist,
      flavorText: pokemonCard.flavorText,
      language: 'en', // Pokemon API doesn't specify language
      isFoilAvailable: this.hasFoilVariant(pokemonCard),
      isAlternateArt: this.isAlternateArt(pokemonCard),
      isPromo: pokemonCard.set.id.includes('promo'),
      finish: 'normal',
      variation: null,
      frame: 'normal',
      borderColor: 'black',
      
      // External IDs
      externalIds: {
        pokemonTcg: pokemonCard.id,
        tcgplayer: pokemonCard.tcgplayer?.url
      },

      // Images
      images: pokemonCard.images ? {
        small: pokemonCard.images.small,
        normal: pokemonCard.images.large,
        large: pokemonCard.images.large
      } : undefined,

      // Prices
      prices: this.extractPrices(pokemonCard)
    }
  }

  private mapSupertype(supertype: string): string {
    const typeMap: Record<string, string> = {
      'Pokémon': 'Creature',
      'Pokemon': 'Creature',
      'Trainer': 'Sorcery',
      'Energy': 'Land'
    }

    return typeMap[supertype] || supertype
  }

  private buildOracleText(card: PokemonCard): string | undefined {
    const textParts: string[] = []

    // Add HP
    if (card.hp) {
      textParts.push(`HP: ${card.hp}`)
    }

    // Add types
    if (card.types && card.types.length > 0) {
      textParts.push(`Types: ${card.types.join(', ')}`)
    }

    // Add attacks
    if (card.attacks && card.attacks.length > 0) {
      const attackTexts = card.attacks.map(attack => {
        let attackText = attack.name
        if (attack.cost) {
          attackText += ` (${attack.cost.join('')})`
        }
        if (attack.damage) {
          attackText += ` - ${attack.damage}`
        }
        if (attack.text) {
          attackText += `: ${attack.text}`
        }
        return attackText
      })
      textParts.push(...attackTexts)
    }

    // Add weaknesses
    if (card.weaknesses && card.weaknesses.length > 0) {
      const weaknessText = card.weaknesses.map(w => `${w.type}${w.value}`).join(', ')
      textParts.push(`Weakness: ${weaknessText}`)
    }

    // Add resistances
    if (card.resistances && card.resistances.length > 0) {
      const resistanceText = card.resistances.map(r => `${r.type}${r.value}`).join(', ')
      textParts.push(`Resistance: ${resistanceText}`)
    }

    // Add retreat cost
    if (card.retreatCost && card.retreatCost.length > 0) {
      textParts.push(`Retreat: ${card.retreatCost.join('')}`)
    }

    return textParts.length > 0 ? textParts.join('\n') : undefined
  }

  private extractKeywords(card: PokemonCard): string[] {
    const keywords: string[] = []

    if (card.evolvesFrom) {
      keywords.push('Evolution')
    }

    if (card.supertype === 'Trainer') {
      keywords.push('Trainer')
    }

    if (card.supertype === 'Energy') {
      keywords.push('Energy')
    }

    // Add types as keywords
    if (card.types) {
      keywords.push(...card.types)
    }

    return keywords
  }

  private determineEvolutionStage(card: PokemonCard): string | null {
    if (card.evolvesFrom) {
      if (card.evolvesFrom.includes('Basic')) {
        return 'Stage 1'
      } else {
        return 'Stage 2'
      }
    }

    if (card.supertype === 'Pokémon' || card.supertype === 'Pokemon') {
      return 'Basic'
    }

    return null
  }

  private normalizeRarity(pokemonRarity: string): string {
    const rarityMap: Record<string, string> = {
      'Common': 'Common',
      'Uncommon': 'Uncommon',
      'Rare': 'Rare',
      'Rare Holo': 'Rare',
      'Rare Holo EX': 'Mythic Rare',
      'Rare Holo GX': 'Mythic Rare',
      'Rare Holo V': 'Mythic Rare',
      'Rare Holo VMAX': 'Mythic Rare',
      'Rare Secret': 'Mythic Rare',
      'Rare Rainbow': 'Mythic Rare',
      'Promo': 'Special'
    }

    return rarityMap[pokemonRarity] || pokemonRarity
  }

  private hasFoilVariant(card: PokemonCard): boolean {
    // Check if the card rarity suggests foil availability
    const foilRarities = ['Rare Holo', 'Rare Holo EX', 'Rare Holo GX', 'Rare Holo V', 'Rare Holo VMAX', 'Rare Secret', 'Rare Rainbow']
    return foilRarities.some(rarity => card.rarity.includes(rarity))
  }

  private isAlternateArt(card: PokemonCard): boolean {
    // Check if it's an alternate art card
    return card.rarity.includes('Alt Art') || card.name.includes('Alt Art')
  }

  private extractPrices(card: PokemonCard): { usd?: number } | undefined {
    if (!card.tcgplayer?.prices) {
      return undefined
    }

    const prices = card.tcgplayer.prices
    
    // Try to get the most relevant price
    let usdPrice: number | undefined

    if (prices.holofoil?.market) {
      usdPrice = prices.holofoil.market
    } else if (prices.normal?.market) {
      usdPrice = prices.normal.market
    } else if (prices.reverseHolofoil?.market) {
      usdPrice = prices.reverseHolofoil.market
    }

    return usdPrice ? { usd: usdPrice } : undefined
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}