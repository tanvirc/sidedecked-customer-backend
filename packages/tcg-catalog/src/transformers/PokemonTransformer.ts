import { PokemonTCG } from 'pokemon-tcg-sdk-typescript'
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
  abilities?: Array<{
    name: string
    text: string
    type: string
  }>
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
  rules?: string[]
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
  private readonly rateLimit = 1000 // milliseconds between requests for SDK safety
  private readonly apiKey: string

  constructor() {
    this.apiKey = process.env.POKEMON_TCG_API_KEY || ''
    
    // Configure Pokemon TCG SDK
    if (this.apiKey) {
      process.env.POKEMONTCG_API_KEY = this.apiKey
      logger.debug('Pokemon TCG SDK configured with API key')
    } else {
      logger.warn('No Pokemon TCG API key found - using rate-limited requests')
    }
  }

  async fetchCards(game: Game, jobType: ETLJobType): Promise<UniversalCard[]> {
    logger.info('Starting Pokemon TCG data fetch using SDK', { gameCode: game.code, jobType })

    try {
      let allCards: PokemonCard[] = []
      
      // Use Pokemon TCG SDK instead of direct API calls
      const query = this.buildQuery(jobType)
      logger.debug('Pokemon TCG query', { query })

      if (jobType === 'full') {
        // For full sync, get all cards with pagination
        let page = 1
        const pageSize = 250

        while (true) {
          logger.debug('Fetching Pokemon TCG page using SDK', { page, pageSize })
          
          const cards = await PokemonTCG.findCardsByQueries({
            q: query,
            page,
            pageSize,
            orderBy: 'set.releaseDate'
          })

          if (!cards || cards.length === 0) {
            break
          }

          allCards.push(...cards)

          logger.debug('Fetched Pokemon TCG page using SDK', {
            cardsThisPage: cards.length,
            totalCardsSoFar: allCards.length,
            page
          })

          if (cards.length < pageSize) {
            break
          }

          page++

          // Safety check
          if (allCards.length > 50000) {
            logger.warn('Reached maximum card limit, stopping fetch', { totalCards: allCards.length })
            break
          }

          // Rate limiting between requests
          await this.sleep(this.rateLimit)
        }
      } else {
        // For incremental or limited syncs, get a smaller batch
        const cards = await PokemonTCG.findCardsByQueries({
          q: query,
          pageSize: 100
        })

        allCards.push(...cards)
      }

      logger.info('Completed Pokemon TCG data fetch using SDK', {
        gameCode: game.code,
        totalCards: allCards.length
      })

      return this.transformToUniversal(allCards)

    } catch (error) {
      logger.error('Failed to fetch Pokemon TCG data using SDK', error as Error, {
        gameCode: game.code,
        jobType
      })
      throw error
    }
  }

  private buildQuery(jobType: ETLJobType): string {
    switch (jobType) {
      case ETLJobType.FULL:
      case ETLJobType.FULL_SYNC:
        return '!set.id:*promo*' // Exclude promo sets for full sync
      case ETLJobType.INCREMENTAL:
      case ETLJobType.INCREMENTAL_SYNC:
        // Fetch cards from sets updated in last 30 days
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        const dateStr = thirtyDaysAgo.toISOString().split('T')[0]
        return `set.updatedAt:[${dateStr} TO *]`
      case ETLJobType.SETS:
        // Fetch only from the latest sets
        return 'set.series:"Scarlet & Violet"' // Latest Pokemon series
      case ETLJobType.BANLIST_UPDATE:
        // For banlist updates, fetch cards that have format legality
        return 'legalities.standard:legal OR legalities.expanded:legal OR legalities.unlimited:legal'
      default:
        // Default to recent sets for other job types
        return 'set.series:"Scarlet & Violet"'
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
        hp: canonicalCard.hp ? parseInt(canonicalCard.hp, 10) : undefined,
        retreatCost: canonicalCard.convertedRetreatCost,
        energyTypes: canonicalCard.types || [],
        evolutionStage: this.determineEvolutionStage(canonicalCard),

        // MTG fields (null for Pokemon)
        manaCost: undefined,
        manaValue: undefined,
        colors: [],
        colorIdentity: [],
        powerValue: undefined,
        defenseValue: undefined,

        // Other game fields (null for Pokemon)
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
      variation: undefined,
      frame: 'normal',
      borderColor: 'black',
      
      // Format legality (from Pokemon API)
      formatLegality: this.extractFormatLegality(pokemonCard),
      
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
    const sections: string[] = []

    // Basic Stats Section
    const basicStats: string[] = []
    if (card.hp) {
      basicStats.push(`HP: ${card.hp}`)
    }
    if (card.types && card.types.length > 0) {
      basicStats.push(`Types: ${card.types.join(', ')}`)
    }
    if (basicStats.length > 0) {
      sections.push(`[STATS]\n${basicStats.join('\n')}`)
    }

    // Abilities Section (critical rules text)
    if (card.abilities && card.abilities.length > 0) {
      const abilityTexts = card.abilities.map(ability => {
        return `${ability.type}: ${ability.name}\n${ability.text}`
      })
      sections.push(`[ABILITIES]\n${abilityTexts.join('\n\n')}`)
    }

    // Attacks Section
    if (card.attacks && card.attacks.length > 0) {
      const attackTexts = card.attacks.map(attack => {
        let attackHeader = attack.name
        if (attack.cost && attack.cost.length > 0) {
          attackHeader += ` (${attack.cost.join('')})`
        }
        if (attack.damage) {
          attackHeader += ` - ${attack.damage}`
        }
        
        let attackDescription = ''
        if (attack.text) {
          attackDescription = `\n${attack.text}`
        }
        
        return `${attackHeader}${attackDescription}`
      })
      sections.push(`[ATTACKS]\n${attackTexts.join('\n\n')}`)
    }

    // Special Rules Section (e.g., VMAX, GX, special mechanics)
    if (card.rules && card.rules.length > 0) {
      sections.push(`[RULES]\n${card.rules.join('\n')}`)
    }

    // Battle Stats Section
    const battleStats: string[] = []
    if (card.weaknesses && card.weaknesses.length > 0) {
      const weaknessText = card.weaknesses.map(w => `${w.type}${w.value}`).join(', ')
      battleStats.push(`Weakness: ${weaknessText}`)
    }
    if (card.resistances && card.resistances.length > 0) {
      const resistanceText = card.resistances.map(r => `${r.type}${r.value}`).join(', ')
      battleStats.push(`Resistance: ${resistanceText}`)
    }
    if (card.retreatCost && card.retreatCost.length > 0) {
      battleStats.push(`Retreat: ${card.retreatCost.join('')}`)
    }
    if (battleStats.length > 0) {
      sections.push(`[BATTLE]\n${battleStats.join('\n')}`)
    }

    return sections.length > 0 ? sections.join('\n\n') : undefined
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

  private extractFormatLegality(card: PokemonCard): Record<string, string> | undefined {
    if (!card.legalities) {
      return undefined
    }

    const legality: Record<string, string> = {}

    if (card.legalities.standard) {
      legality.standard = card.legalities.standard
    }
    if (card.legalities.expanded) {
      legality.expanded = card.legalities.expanded
    }
    if (card.legalities.unlimited) {
      legality.unlimited = card.legalities.unlimited
    }

    return Object.keys(legality).length > 0 ? legality : undefined
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}