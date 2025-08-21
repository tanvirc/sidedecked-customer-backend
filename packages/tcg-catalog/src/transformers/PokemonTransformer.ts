import { PokemonTCG } from 'pokemon-tcg-sdk-typescript'
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid'
import { Game } from '../../../../src/entities/Game'
import { ETLJobType } from '../entities/ETLJob'
import { UniversalCard, UniversalPrint } from '../types/ETLTypes'
import { logger } from '../utils/Logger'
import { generateNormalizedName } from '../utils/Helpers'

// Type definition for Pokemon TCG SDK card (since SDK doesn't export its types)
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
    // Note: Pokemon TCG API doesn't provide PNG format like Scryfall
  }
  tcgplayer?: {
    url: string
    updatedAt: string
    prices?: {
      holofoil?: {
        low?: number | null
        mid?: number | null
        high?: number | null
        market?: number | null
        directLow?: number | null
      }
      reverseHolofoil?: {
        low?: number | null
        mid?: number | null
        high?: number | null
        market?: number | null
        directLow?: number | null
      }
      normal?: {
        low?: number | null
        mid?: number | null
        high?: number | null
        market?: number | null
        directLow?: number | null
      }
    }
  }
}

export class PokemonTransformer {
  private readonly rateLimit = 1000 // milliseconds between requests for SDK safety
  private readonly apiKey: string

  constructor() {
    this.apiKey = process.env.POKEMON_TCG_API_KEY || ''
    
    // Configure Pokemon TCG SDK
    if (this.apiKey) {
      process.env.POKEMONTCG_API_KEY = this.apiKey
      logger.info('Pokemon TCG SDK configured with API key - full rate limits available')
    } else {
      logger.warn('⚠️  No Pokemon TCG API key found - using limited rate requests')
      logger.warn('   For better reliability, set POKEMON_TCG_API_KEY environment variable')
      logger.warn('   Get a free API key at: https://dev.pokemontcg.io/')
    }
  }

  async fetchCards(game: Game, jobType: ETLJobType, limit?: number): Promise<UniversalCard[]> {
    logger.info('Starting Pokemon TCG data fetch using SDK', { gameCode: game.code, jobType, limit })

    try {
      let allCards: PokemonCard[] = []
      
      // Use Pokemon TCG SDK instead of direct API calls
      const query = this.buildQuery(jobType, limit)
      logger.debug('Pokemon TCG query', { query })
      
      // Log the query being used
      logger.apiCall('pokemon_tcg', query, 'GET')
      logger.info(`🔍 Pokemon TCG Query: ${query}${limit ? ` (limit: ${limit})` : ''}`)

      // Determine if we need pagination - use pagination for limits > 250 or unlimited requests
      const needsPagination = !limit || limit > 250
      const pageSize = 250 // Always use max page size for efficiency

      if (needsPagination) {
        // Use pagination for large requests or unlimited requests
        let page = 1
        
        logger.info(`📄 Using pagination strategy for limit: ${limit || 'unlimited'}`)

        while (true) {
          logger.info('Fetching Pokemon TCG page using SDK', { page, pageSize, currentTotal: allCards.length, targetLimit: limit })
          
          let cards: PokemonCard[] = []
          try {
            cards = await Promise.race([
              PokemonTCG.findCardsByQueries({
                q: query,
                page,
                pageSize,
                orderBy: 'set.releaseDate'
              }),
              new Promise<PokemonCard[]>((_, reject) => 
                setTimeout(() => reject(new Error('Pokemon TCG API request timeout after 30 seconds')), 30000)
              )
            ])
          } catch (error) {
            const errorMessage = (error as Error).message
            logger.error(`Failed to fetch Pokemon TCG page ${page}`, error as Error, { 
              query, 
              page, 
              pageSize,
              hasApiKey: !!this.apiKey,
              errorMessage
            })
            
            // If first page fails, provide helpful error and throw
            if (page === 1) {
              // Provide helpful error message for common issues
              if (errorMessage.includes('timeout') || errorMessage.includes('ECONNRESET') || errorMessage.includes('ENOTFOUND')) {
                throw new Error(`Pokemon TCG API network error: ${errorMessage}. Check internet connection and API status at https://pokemontcg.io/`)
              } else if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
                throw new Error(`Pokemon TCG API rate limit exceeded. Set POKEMON_TCG_API_KEY environment variable for higher limits. Get a free key at https://dev.pokemontcg.io/`)
              } else if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
                throw new Error(`Pokemon TCG API authentication failed. Check your POKEMON_TCG_API_KEY environment variable.`)
              }
              throw error
            } else {
              logger.warn(`Stopping pagination due to error on page ${page}: ${errorMessage}`)
              break
            }
          }

          logger.info('Pokemon TCG API response', { 
            page,
            cardsReturned: cards?.length || 0,
            totalSoFar: allCards.length,
            query 
          })

          if (!cards || cards.length === 0) {
            logger.info(`📄 No more cards returned at page ${page}, stopping pagination`)
            break
          }

          allCards.push(...cards)

          logger.info('Fetched Pokemon TCG page using SDK', {
            page,
            cardsThisPage: cards.length,
            totalCardsSoFar: allCards.length,
            targetLimit: limit || 'unlimited'
          })

          // Check if we've reached the limit
          if (limit && allCards.length >= limit) {
            allCards = allCards.slice(0, limit) // Trim to exact limit
            logger.info(`✅ Reached target limit of ${limit} cards, stopping fetch`)
            break
          }

          // If we got fewer cards than pageSize, we've reached the end
          if (cards.length < pageSize) {
            logger.info(`📄 Received ${cards.length} < ${pageSize} cards, reached end of results`)
            break
          }

          page++

          // Safety check to prevent runaway requests
          if (allCards.length > 50000) {
            logger.warn('Reached maximum safety limit of 50000 cards, stopping fetch', { totalCards: allCards.length })
            break
          }

          // Rate limiting between requests
          await this.sleep(this.rateLimit)
        }
      } else {
        // For small limits <= 250, use single request
        const requestPageSize = Math.min(limit, 250)
        
        logger.info(`📄 Using single request strategy for small limit: ${limit}`)
        
        let cards: PokemonCard[] = []
        try {
          cards = await Promise.race([
            PokemonTCG.findCardsByQueries({
              q: query,
              pageSize: requestPageSize,
              orderBy: 'set.releaseDate'
            }),
            new Promise<PokemonCard[]>((_, reject) => 
              setTimeout(() => reject(new Error('Pokemon TCG API request timeout after 30 seconds')), 30000)
            )
          ])
        } catch (error) {
          const errorMessage = (error as Error).message
          logger.error('Failed to fetch Pokemon TCG cards (single request)', error as Error, { 
            query, 
            requestPageSize,
            hasApiKey: !!this.apiKey,
            errorMessage
          })
          
          // Provide helpful error message for common issues
          if (errorMessage.includes('timeout') || errorMessage.includes('ECONNRESET') || errorMessage.includes('ENOTFOUND')) {
            throw new Error(`Pokemon TCG API network error: ${errorMessage}. Check internet connection and API status at https://pokemontcg.io/`)
          } else if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
            throw new Error(`Pokemon TCG API rate limit exceeded. Set POKEMON_TCG_API_KEY environment variable for higher limits. Get a free key at https://dev.pokemontcg.io/`)
          } else if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
            throw new Error(`Pokemon TCG API authentication failed. Check your POKEMON_TCG_API_KEY environment variable.`)
          }
          
          throw error
        }

        logger.info('Pokemon TCG API response', { 
          cardsReturned: cards?.length || 0,
          requestedPageSize: requestPageSize,
          query 
        })

        if (cards && cards.length > 0) {
          allCards.push(...cards)
          
          // Ensure we don't exceed the limit (though this should not happen)
          if (allCards.length > limit) {
            allCards = allCards.slice(0, limit)
            logger.info(`✅ Trimmed to exact limit of ${limit} cards`)
          }
        }
      }

      logger.info('Completed Pokemon TCG data fetch using SDK', {
        gameCode: game.code,
        totalCards: allCards.length,
        targetLimit: limit || 'unlimited',
        strategy: needsPagination ? 'pagination' : 'single-request'
      })

      return this.transformToUniversal(allCards)

    } catch (error) {
      logger.error('Failed to fetch Pokemon TCG data using SDK', error as Error, {
        gameCode: game.code,
        jobType,
        limit
      })
      throw error
    }
  }

  private buildQuery(jobType: ETLJobType, limit?: number): string {
    // Strategy: Use broader queries for larger limits to ensure we get enough results
    // Use simpler queries that are guaranteed to work with the Pokemon API
    
    // For any limit-based requests, use queries that will definitely return results
    if (limit) {
      if (limit <= 100) {
        return 'supertype:pokemon' // Pokemon cards only
      } else if (limit <= 1000) {
        return '(supertype:pokemon OR supertype:trainer)' // Pokemon + trainer cards
      } else {
        return '(supertype:pokemon OR supertype:trainer OR supertype:energy)' // All card types
      }
    }
    
    // For production job types without limits, use more specific queries
    switch (jobType) {
      case ETLJobType.FULL:
      case ETLJobType.FULL_SYNC:
        return '(supertype:pokemon OR supertype:trainer OR supertype:energy)' // All card types
      case ETLJobType.INCREMENTAL:
      case ETLJobType.INCREMENTAL_SYNC:
        // For incremental with limits, use broad query, otherwise use date-based
        if (limit && limit <= 1000) {
          return '(supertype:pokemon OR supertype:trainer)'
        }
        // Fetch cards from sets updated in last 30 days
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        const dateStr = thirtyDaysAgo.toISOString().split('T')[0]
        return `set.updatedAt:[${dateStr} TO *]`
      case ETLJobType.SETS:
        // Fetch only from the latest sets
        return 'set.series:"Scarlet & Violet"'
      case ETLJobType.BANLIST_UPDATE:
        // For banlist updates, fetch cards that have format legality
        return 'legalities.standard:legal OR legalities.expanded:legal OR legalities.unlimited:legal'
      default:
        // Default to Pokemon cards for unknown job types
        return 'supertype:pokemon'
    }
  }

  private transformToUniversal(pokemonCards: PokemonCard[]): UniversalCard[] {
    // Use a fixed namespace UUID for Pokemon cards to ensure consistent generation
    const POKEMON_NAMESPACE = '6ba7b815-9dad-11d1-80b4-00c04fd430c8' // Using modified DNS namespace UUID
    
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
      
      // Generate a deterministic UUID based on card name and supertype
      const oracleId = uuidv5(`pokemon_${normalizedName}_${canonicalCard.supertype}`, POKEMON_NAMESPACE)
      
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
        evolutionStage: this.determineEvolutionStage(canonicalCard) || undefined,

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

      // Images - prioritize large image for quality (Pokemon API only has small/large)
      images: pokemonCard.images ? {
        small: pokemonCard.images.small,   // Small image (~146x204)
        normal: pokemonCard.images.large,  // Use large as normal (~245x342)
        large: pokemonCard.images.large    // Large image (~245x342)
        // Note: Pokemon TCG API doesn't provide PNG/original like Scryfall
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
      const abilityTexts = card.abilities.map((ability: { type: string; name: string; text: string }) => {
        return `${ability.type}: ${ability.name}\n${ability.text}`
      })
      sections.push(`[ABILITIES]\n${abilityTexts.join('\n\n')}`)
    }

    // Attacks Section
    if (card.attacks && card.attacks.length > 0) {
      const attackTexts = card.attacks.map((attack: { name: string; cost?: string[]; damage?: string; text?: string }) => {
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
      const weaknessText = card.weaknesses.map((w: { type: string; value: string }) => `${w.type}${w.value}`).join(', ')
      battleStats.push(`Weakness: ${weaknessText}`)
    }
    if (card.resistances && card.resistances.length > 0) {
      const resistanceText = card.resistances.map((r: { type: string; value: string }) => `${r.type}${r.value}`).join(', ')
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

    if (prices.holofoil?.market && prices.holofoil.market !== null) {
      usdPrice = prices.holofoil.market
    } else if (prices.normal?.market && prices.normal.market !== null) {
      usdPrice = prices.normal.market
    } else if (prices.reverseHolofoil?.market && prices.reverseHolofoil.market !== null) {
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