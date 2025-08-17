import { AppDataSource } from '../../../../src/config/database'
import { Card } from '../entities/Card'
import { Print } from '../entities/Print'
import { CatalogSKU } from '../entities/CatalogSKU'
import { SearchService } from './SearchService'
import { logger } from '../utils/Logger'
import { generateNormalizedName } from '../utils/Helpers'

export interface VendorListing {
  id: string
  title: string
  description?: string
  sku?: string
  condition: string
  language?: string
  finish?: string
  setName?: string
  collectorNumber?: string
  price: number
  quantity: number
  vendorId: string
  metadata?: Record<string, any>
}

export interface MatchingResult {
  success: boolean
  confidence: number
  matchType: 'exact_sku' | 'name_match' | 'fuzzy_match' | 'ai_match' | 'manual' | 'unmatched'
  catalogSku?: CatalogSKU
  card?: Card
  print?: Print
  alternativeMatches?: Array<{
    catalogSku: CatalogSKU
    card: Card
    print: Print
    confidence: number
    reason: string
  }>
  matchingFactors: {
    skuMatch: boolean
    nameMatch: boolean
    setMatch: boolean
    numberMatch: boolean
    conditionMatch: boolean
    languageMatch: boolean
    finishMatch: boolean
  }
  suggestedSku?: string
  errors: string[]
}

export interface MatchingConfig {
  enableFuzzyMatching: boolean
  enableAIMatching: boolean
  minimumConfidence: number
  maxAlternatives: number
  strictSetMatching: boolean
  allowConditionMismatch: boolean
}

export class VendorMatchingService {
  private searchService: SearchService
  private config: MatchingConfig

  constructor(searchService: SearchService, config?: Partial<MatchingConfig>) {
    this.searchService = searchService
    this.config = {
      enableFuzzyMatching: config?.enableFuzzyMatching ?? true,
      enableAIMatching: config?.enableAIMatching ?? false, // Future feature
      minimumConfidence: config?.minimumConfidence ?? 0.7,
      maxAlternatives: config?.maxAlternatives ?? 5,
      strictSetMatching: config?.strictSetMatching ?? false,
      allowConditionMismatch: config?.allowConditionMismatch ?? true,
      ...config
    }
  }

  /**
   * Main matching function - tries multiple strategies
   */
  async matchVendorListing(listing: VendorListing): Promise<MatchingResult> {
    logger.info('Starting vendor listing match', {
      listingId: listing.id,
      title: listing.title,
      sku: listing.sku
    })

    const result: MatchingResult = {
      success: false,
      confidence: 0,
      matchType: 'unmatched',
      alternativeMatches: [],
      matchingFactors: {
        skuMatch: false,
        nameMatch: false,
        setMatch: false,
        numberMatch: false,
        conditionMatch: false,
        languageMatch: false,
        finishMatch: false
      },
      errors: []
    }

    try {
      // Strategy 1: Exact SKU match (highest priority)
      if (listing.sku) {
        const skuMatch = await this.matchBySKU(listing)
        if (skuMatch.success) {
          return skuMatch
        }
      }

      // Strategy 2: Parse title and match components
      const titleMatch = await this.matchByParsedTitle(listing)
      if (titleMatch.success && titleMatch.confidence >= this.config.minimumConfidence) {
        return titleMatch
      }

      // Strategy 3: Fuzzy text matching
      if (this.config.enableFuzzyMatching) {
        const fuzzyMatch = await this.matchByFuzzySearch(listing)
        if (fuzzyMatch.success && fuzzyMatch.confidence >= this.config.minimumConfidence) {
          return fuzzyMatch
        }
        
        // Add alternatives even if not confident enough
        if (fuzzyMatch.alternativeMatches && result.alternativeMatches) {
          result.alternativeMatches.push(...fuzzyMatch.alternativeMatches)
        }
      }

      // Strategy 4: AI-powered matching (future implementation)
      if (this.config.enableAIMatching) {
        // TODO: Implement AI matching using ML models
      }

      // No confident match found
      result.alternativeMatches = result.alternativeMatches
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, this.config.maxAlternatives)

      return result

    } catch (error) {
      logger.error('Vendor matching failed', error as Error, {
        listingId: listing.id
      })

      result.errors.push((error as Error).message)
      return result
    }
  }

  /**
   * Match by exact SKU
   */
  private async matchBySKU(listing: VendorListing): Promise<MatchingResult> {
    const result: MatchingResult = {
      success: false,
      confidence: 0,
      matchType: 'exact_sku',
      alternativeMatches: [],
      matchingFactors: {
        skuMatch: false,
        nameMatch: false,
        setMatch: false,
        numberMatch: false,
        conditionMatch: false,
        languageMatch: false,
        finishMatch: false
      },
      errors: []
    }

    try {
      const catalogSku = await AppDataSource.getRepository(CatalogSKU).findOne({
        where: { sku: listing.sku! },
        relations: ['print', 'print.card', 'print.set']
      })

      if (!catalogSku) {
        result.errors.push('SKU not found in catalog')
        return result
      }

      result.success = true
      result.confidence = 1.0
      result.catalogSku = catalogSku
      result.card = catalogSku.print.card
      result.print = catalogSku.print
      result.matchingFactors.skuMatch = true

      // Validate other factors
      result.matchingFactors.conditionMatch = catalogSku.conditionCode === listing.condition.toUpperCase()
      result.matchingFactors.languageMatch = catalogSku.languageCode === (listing.language?.toUpperCase() || 'EN')
      result.matchingFactors.finishMatch = catalogSku.finishCode === (listing.finish?.toUpperCase() || 'NORMAL')

      // Generate suggested SKU if factors don't match
      if (!result.matchingFactors.conditionMatch || !result.matchingFactors.languageMatch || !result.matchingFactors.finishMatch) {
        result.suggestedSku = this.generateSuggestedSKU(catalogSku, listing)
      }

      logger.info('Exact SKU match found', {
        listingId: listing.id,
        catalogSkuId: catalogSku.id,
        confidence: result.confidence
      })

      return result

    } catch (error) {
      result.errors.push((error as Error).message)
      return result
    }
  }

  /**
   * Match by parsing title components
   */
  private async matchByParsedTitle(listing: VendorListing): Promise<MatchingResult> {
    const result: MatchingResult = {
      success: false,
      confidence: 0,
      matchType: 'name_match',
      alternativeMatches: [],
      matchingFactors: {
        skuMatch: false,
        nameMatch: false,
        setMatch: false,
        numberMatch: false,
        conditionMatch: false,
        languageMatch: false,
        finishMatch: false
      },
      errors: []
    }

    try {
      const parsedTitle = this.parseListingTitle(listing.title)
      
      if (!parsedTitle.cardName) {
        result.errors.push('Could not extract card name from title')
        return result
      }

      // Search for cards by name
      let queryBuilder = AppDataSource.getRepository(Card)
        .createQueryBuilder('card')
        .leftJoinAndSelect('card.prints', 'prints')
        .leftJoinAndSelect('prints.set', 'set')
        .leftJoinAndSelect('prints.skus', 'skus')
        .where('card.name ILIKE :name', { name: `%${parsedTitle.cardName}%` })
        .orWhere('card.normalizedName ILIKE :normalizedName', { 
          normalizedName: `%${generateNormalizedName(parsedTitle.cardName)}%` 
        })

      // Filter by set if available
      if (parsedTitle.setCode || parsedTitle.setName) {
        queryBuilder.andWhere((qb: any) => {
          const subQuery = qb.subQuery()
            .select('print.id')
            .from(Print, 'print')
            .leftJoin('print.set', 'printSet')
            .where('print.cardId = card.id')
            
          if (parsedTitle.setCode) {
            subQuery.andWhere('printSet.code ILIKE :setCode', { setCode: `%${parsedTitle.setCode}%` })
          }
          
          if (parsedTitle.setName) {
            subQuery.andWhere('printSet.name ILIKE :setName', { setName: `%${parsedTitle.setName}%` })
          }
          
          return `EXISTS (${subQuery.getQuery()})`
        })
      }

      const cards = await queryBuilder.limit(10).getMany()

      if (cards.length === 0) {
        result.errors.push('No cards found matching parsed title')
        return result
      }

      // Score each card match
      const scoredMatches = await Promise.all(
        cards.map(async (card: any) => {
          const score = await this.scoreCardMatch(card, listing, parsedTitle)
          return { card, score }
        })
      )

      // Sort by score
      scoredMatches.sort((a: any, b: any) => b.score.total - a.score.total)
      const bestMatch = scoredMatches[0]

      if (bestMatch.score.total >= this.config.minimumConfidence) {
        // Find the best print and SKU
        const bestPrint = this.findBestPrint(bestMatch.card, listing, parsedTitle)
        const bestSku = this.findBestSKU(bestPrint, listing)

        result.success = true
        result.confidence = bestMatch.score.total
        result.catalogSku = bestSku
        result.card = bestMatch.card
        result.print = bestPrint
        result.matchingFactors = bestMatch.score.factors
      }

      // Add alternatives
      if (result.alternativeMatches) {
        result.alternativeMatches = scoredMatches
          .slice(0, this.config.maxAlternatives)
          .map((match: any) => {
          const print = this.findBestPrint(match.card, listing, parsedTitle)
          const sku = this.findBestSKU(print, listing)
          
          return {
            catalogSku: sku,
            card: match.card,
            print: print,
            confidence: match.score.total,
            reason: this.explainScore(match.score)
          }
        })
      }

      return result

    } catch (error) {
      result.errors.push((error as Error).message)
      return result
    }
  }

  /**
   * Match by fuzzy search using Algolia
   */
  private async matchByFuzzySearch(listing: VendorListing): Promise<MatchingResult> {
    const result: MatchingResult = {
      success: false,
      confidence: 0,
      matchType: 'fuzzy_match',
      alternativeMatches: [],
      matchingFactors: {
        skuMatch: false,
        nameMatch: false,
        setMatch: false,
        numberMatch: false,
        conditionMatch: false,
        languageMatch: false,
        finishMatch: false
      },
      errors: []
    }

    try {
      // Use search service to find similar cards
      const searchResults = await this.searchService.searchCards({
        text: listing.title,
        filters: {
          hasInventory: false // Search all cards, not just available ones
        },
        page: 1,
        limit: 10
      })

      if (!searchResults.cards || searchResults.cards.length === 0) {
        result.errors.push('No fuzzy matches found')
        return result
      }

      // Convert search results to alternatives  
      const cardResults = searchResults.cards || searchResults.hits
      for (const searchResult of cardResults.slice(0, this.config.maxAlternatives)) {
        try {
          // Find catalog SKU for this card
          const catalogSku = await AppDataSource.getRepository(CatalogSKU).findOne({
            where: { 
              gameCode: searchResult.gameCode,
              // Find first available SKU for this card
            },
            relations: ['print', 'print.card', 'print.set']
          })

          if (catalogSku) {
            const confidence = this.calculateFuzzyConfidence(listing, catalogSku)
            
            result.alternativeMatches!.push({
              catalogSku,
              card: catalogSku.print.card,
              print: catalogSku.print,
              confidence,
              reason: `Fuzzy text match (${Math.round(confidence * 100)}% confidence)`
            })
          }
        } catch (error) {
          logger.warn('Failed to process fuzzy match result', error as Error, {
            searchResult
          })
        }
      }

      // Use best match if confidence is high enough
      if (result.alternativeMatches!.length > 0) {
        const bestMatch = result.alternativeMatches![0]
        
        if (bestMatch.confidence >= this.config.minimumConfidence) {
          result.success = true
          result.confidence = bestMatch.confidence
          result.catalogSku = bestMatch.catalogSku
          result.card = bestMatch.card
          result.print = bestMatch.print
          result.matchingFactors.nameMatch = true
        }
      }

      return result

    } catch (error) {
      result.errors.push((error as Error).message)
      return result
    }
  }

  /**
   * Parse listing title to extract components
   */
  private parseListingTitle(title: string): {
    cardName?: string
    setName?: string
    setCode?: string
    collectorNumber?: string
    condition?: string
    language?: string
    finish?: string
  } {
    const result: ReturnType<VendorMatchingService['parseListingTitle']> = {}

    // Common patterns for parsing card listings
    const patterns = [
      // "Card Name - Set Name (#123) - Condition"
      /^(.+?)\s*-\s*(.+?)\s*\(#?(\d+)\)\s*-\s*(\w+)$/i,
      // "Card Name (SET) #123"
      /^(.+?)\s*\(([^)]+)\)\s*#?(\d+)$/i,
      // "Card Name - Set Name"
      /^(.+?)\s*-\s*(.+?)$/i,
      // Just card name
      /^(.+)$/i
    ]

    for (const pattern of patterns) {
      const match = title.match(pattern)
      if (match) {
        result.cardName = match[1]?.trim()
        if (match[2]) result.setName = match[2].trim()
        if (match[3]) result.collectorNumber = match[3].trim()
        if (match[4]) result.condition = match[4].trim()
        break
      }
    }

    // Extract condition from common suffixes
    if (!result.condition) {
      const conditionMatch = title.match(/\b(NM|LP|MP|HP|DMG|MINT|NEAR MINT|LIGHTLY PLAYED|MODERATELY PLAYED|HEAVILY PLAYED|DAMAGED)\b/i)
      if (conditionMatch) {
        result.condition = conditionMatch[1].toUpperCase()
      }
    }

    // Extract foil/finish
    const foilMatch = title.match(/\b(FOIL|HOLO|HOLOGRAPHIC|RAINBOW|SECRET)\b/i)
    if (foilMatch) {
      result.finish = foilMatch[1].toUpperCase()
    }

    return result
  }

  /**
   * Score how well a card matches the listing
   */
  private async scoreCardMatch(card: Card, listing: VendorListing, parsedTitle: ReturnType<VendorMatchingService['parseListingTitle']>): Promise<{
    total: number
    factors: MatchingResult['matchingFactors']
    details: Record<string, number>
  }> {
    const factors: MatchingResult['matchingFactors'] = {
      skuMatch: false,
      nameMatch: false,
      setMatch: false,
      numberMatch: false,
      conditionMatch: false,
      languageMatch: false,
      finishMatch: false
    }

    const details: Record<string, number> = {}

    // Name similarity (0-40 points)
    const nameSimilarity = this.calculateStringSimilarity(
      card.name.toLowerCase(),
      parsedTitle.cardName?.toLowerCase() || listing.title.toLowerCase()
    )
    details.nameSimilarity = nameSimilarity * 40
    factors.nameMatch = nameSimilarity > 0.7

    // Set matching (0-20 points)
    let setScore = 0
    if (parsedTitle.setName && card.prints) {
      const setMatches = card.prints.some(print => 
        print.set?.name.toLowerCase().includes(parsedTitle.setName!.toLowerCase()) ||
        parsedTitle.setName!.toLowerCase().includes(print.set?.name.toLowerCase() || '')
      )
      if (setMatches) {
        setScore = 20
        factors.setMatch = true
      }
    }
    details.setScore = setScore

    // Collector number matching (0-15 points)
    let numberScore = 0
    if (parsedTitle.collectorNumber && card.prints) {
      const numberMatches = card.prints.some(print => 
        print.collectorNumber === parsedTitle.collectorNumber
      )
      if (numberMatches) {
        numberScore = 15
        factors.numberMatch = true
      }
    }
    details.numberScore = numberScore

    // Type consistency (0-10 points)
    let typeScore = 0
    const titleHasType = listing.title.toLowerCase().includes(card.primaryType.toLowerCase())
    if (titleHasType) {
      typeScore = 10
    }
    details.typeScore = typeScore

    // Rarity consistency (0-10 points)
    let rarityScore = 0
    if (card.prints) {
      const commonRarities = ['common', 'uncommon', 'rare', 'mythic']
      const titleRarity = commonRarities.find(r => 
        listing.title.toLowerCase().includes(r)
      )
      if (titleRarity) {
        const hasRarity = card.prints.some(print => 
          print.rarity.toLowerCase().includes(titleRarity)
        )
        if (hasRarity) {
          rarityScore = 10
        }
      }
    }
    details.rarityScore = rarityScore

    // Language penalty (-5 points if mismatch)
    let languageScore = 0
    const listingLanguage = listing.language || 'EN'
    if (listingLanguage.toUpperCase() !== 'EN') {
      languageScore = -5 // Penalty for non-English (harder to match)
    }
    details.languageScore = languageScore

    const total = Math.max(0, Math.min(1, 
      (details.nameSimilarity + details.setScore + details.numberScore + details.typeScore + details.rarityScore + details.languageScore) / 100
    ))

    return { total, factors, details }
  }

  /**
   * Find the best print for a card given the listing context
   */
  private findBestPrint(card: Card, listing: VendorListing, parsedTitle: ReturnType<VendorMatchingService['parseListingTitle']>): Print {
    if (!card.prints || card.prints.length === 0) {
      throw new Error('No prints available for card')
    }

    if (card.prints.length === 1) {
      return card.prints[0]
    }

    // Score each print
    const scoredPrints = card.prints.map(print => {
      let score = 0

      // Set name match
      if (parsedTitle.setName && print.set?.name.toLowerCase().includes(parsedTitle.setName.toLowerCase())) {
        score += 50
      }

      // Set code match
      if (parsedTitle.setCode && print.set?.code.toLowerCase() === parsedTitle.setCode.toLowerCase()) {
        score += 40
      }

      // Collector number match
      if (parsedTitle.collectorNumber && print.collectorNumber === parsedTitle.collectorNumber) {
        score += 30
      }

      // Prefer newer prints (higher release dates)
      if (print.set?.releaseDate) {
        const daysSinceRelease = (Date.now() - print.set.releaseDate.getTime()) / (1000 * 60 * 60 * 24)
        score += Math.max(0, 10 - (daysSinceRelease / 365)) // Bonus for recent sets
      }

      return { print, score }
    })

    // Return highest scoring print
    scoredPrints.sort((a, b) => b.score - a.score)
    return scoredPrints[0].print
  }

  /**
   * Find the best SKU for a print given the listing context
   */
  private findBestSKU(print: Print, listing: VendorListing): CatalogSKU {
    if (!print.skus || print.skus.length === 0) {
      throw new Error('No SKUs available for print')
    }

    if (print.skus.length === 1) {
      return print.skus[0]
    }

    // Score each SKU
    const scoredSkus = print.skus.map(sku => {
      let score = 0

      // Condition match
      if (sku.conditionCode === listing.condition?.toUpperCase()) {
        score += 30
      }

      // Language match
      const listingLanguage = listing.language?.toUpperCase() || 'EN'
      if (sku.languageCode === listingLanguage) {
        score += 20
      }

      // Finish match
      const listingFinish = listing.finish?.toUpperCase() || 'NORMAL'
      if (sku.finishCode === listingFinish) {
        score += 20
      }

      // Prefer SKUs with inventory
      if (sku.hasB2cInventory || sku.hasC2cListings) {
        score += 10
      }

      return { sku, score }
    })

    // Return highest scoring SKU
    scoredSkus.sort((a, b) => b.score - a.score)
    return scoredSkus[0].sku
  }

  /**
   * Calculate string similarity using Jaccard index
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const set1 = new Set(str1.toLowerCase().split(/\s+/))
    const set2 = new Set(str2.toLowerCase().split(/\s+/))
    
    const intersection = new Set([...set1].filter(x => set2.has(x)))
    const union = new Set([...set1, ...set2])
    
    return intersection.size / union.size
  }

  /**
   * Calculate fuzzy confidence for search results
   */
  private calculateFuzzyConfidence(listing: VendorListing, catalogSku: CatalogSKU): number {
    const factors = []

    // Name similarity
    const nameSimilarity = this.calculateStringSimilarity(
      listing.title,
      catalogSku.print.card.name
    )
    factors.push(nameSimilarity * 0.6) // 60% weight

    // Set similarity if available
    if (listing.setName && catalogSku.print.set) {
      const setSimilarity = this.calculateStringSimilarity(
        listing.setName,
        catalogSku.print.set.name
      )
      factors.push(setSimilarity * 0.2) // 20% weight
    }

    // Condition match
    if (listing.condition && catalogSku.conditionCode === listing.condition.toUpperCase()) {
      factors.push(0.2) // 20% weight
    }

    return factors.reduce((sum, factor) => sum + factor, 0) / factors.length
  }

  /**
   * Generate suggested SKU based on listing attributes
   */
  private generateSuggestedSKU(catalogSku: CatalogSKU, listing: VendorListing): string {
    const parts = catalogSku.sku.split('-')
    
    if (parts.length >= 6) {
      // Replace condition if different
      if (listing.condition && catalogSku.conditionCode !== listing.condition.toUpperCase()) {
        parts[4] = listing.condition.toUpperCase()
      }
      
      // Replace language if different
      if (listing.language && catalogSku.languageCode !== listing.language.toUpperCase()) {
        parts[3] = listing.language.toUpperCase()
      }
      
      // Replace finish if different
      if (listing.finish && catalogSku.finishCode !== listing.finish.toUpperCase()) {
        parts[5] = listing.finish.toUpperCase()
      }
    }
    
    return parts.join('-')
  }

  /**
   * Explain scoring for debugging
   */
  private explainScore(score: { total: number; factors: any; details: Record<string, number> }): string {
    const explanations = []
    
    if (score.details.nameSimilarity > 20) {
      explanations.push(`Strong name match (${Math.round(score.details.nameSimilarity)}%)`)
    }
    
    if (score.details.setScore > 0) {
      explanations.push('Set name match')
    }
    
    if (score.details.numberScore > 0) {
      explanations.push('Collector number match')
    }
    
    if (explanations.length === 0) {
      explanations.push('Basic similarity match')
    }
    
    return explanations.join(', ')
  }
}