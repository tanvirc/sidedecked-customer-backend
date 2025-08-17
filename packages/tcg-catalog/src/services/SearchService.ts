import { SearchClient, SearchIndex } from 'algoliasearch'
import { 
  SearchQuery, 
  SearchResults, 
  SearchIndexDocument, 
  AlgoliaConfig,
  AutocompleteResult,
  SearchFilters,
  SearchSort,
  SearchSortField
} from '../types/SearchTypes'
import { logger, logTiming } from '../utils/Logger'
import { GAME_CODES, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from '../utils/Constants'
import { Card } from '../entities/Card'

export class SearchService {
  private client: SearchClient
  private cardsIndex: SearchIndex
  private marketplaceIndex: SearchIndex
  private config: AlgoliaConfig

  constructor(client: SearchClient, config: AlgoliaConfig) {
    this.client = client
    this.config = config
    this.cardsIndex = client.initIndex(config.indexName)
    this.marketplaceIndex = client.initIndex(config.indexName.replace('cards', 'marketplace'))
    
    logger.info('SearchService initialized', {
      cardsIndex: config.indexName,
      marketplaceIndex: config.indexName.replace('cards', 'marketplace')
    })
  }

  /**
   * Initialize Algolia indexes with optimal settings
   */
  async initializeIndexes(): Promise<void> {
    try {
      // Cards catalog index settings
      const cardsSettings = {
        searchableAttributes: [
          'name,normalizedName',
          'oracleText',
          'keywords',
          'primaryType',
          'subtypes',
          'gameName'
        ],
        attributesForFaceting: [
          'game',
          'primaryType',
          'subtypes',
          'colors',
          'energyTypes',
          'attribute',
          'rarities',
          'sets.name',
          'artists',
          'hasInventory',
          'priceRange'
        ],
        customRanking: [
          'desc(popularity)',
          'desc(totalViews)',
          'desc(totalSearches)'
        ],
        ranking: [
          'typo',
          'geo',
          'words',
          'filters',
          'proximity',
          'attribute',
          'exact',
          'custom'
        ],
        typoTolerance: true,
        minWordSizefor1Typo: 4,
        minWordSizefor2Typos: 8,
        removeWordsIfNoResults: 'lastWords',
        separatorsToIndex: '+#',
        replicas: [
          `${this.config.indexName}_name_asc`,
          `${this.config.indexName}_price_asc`,
          `${this.config.indexName}_price_desc`,
          `${this.config.indexName}_release_date_desc`
        ]
      }

      await this.cardsIndex.setSettings(cardsSettings)

      // Create replicas for different sorting options
      const replicas = [
        { name: `${this.config.indexName}_name_asc`, customRanking: ['asc(name)'] },
        { name: `${this.config.indexName}_price_asc`, customRanking: ['asc(lowestPrice)'] },
        { name: `${this.config.indexName}_price_desc`, customRanking: ['desc(lowestPrice)'] },
        { name: `${this.config.indexName}_release_date_desc`, customRanking: ['desc(sets.releaseDate)'] }
      ]

      for (const replica of replicas) {
        const replicaIndex = this.client.initIndex(replica.name)
        await replicaIndex.setSettings({
          customRanking: replica.customRanking,
          searchableAttributes: cardsSettings.searchableAttributes,
          attributesForFaceting: cardsSettings.attributesForFaceting,
          ranking: cardsSettings.ranking,
          typoTolerance: cardsSettings.typoTolerance,
          minWordSizefor1Typo: cardsSettings.minWordSizefor1Typo,
          minWordSizefor2Typos: cardsSettings.minWordSizefor2Typos,
          removeWordsIfNoResults: cardsSettings.removeWordsIfNoResults as 'lastWords',
          separatorsToIndex: cardsSettings.separatorsToIndex,
          replicas: cardsSettings.replicas
        })
      }

      logger.info('Algolia indexes initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize Algolia indexes', error as Error)
      throw error
    }
  }

  /**
   * Search cards with advanced filtering and faceting
   */
  @logTiming('search')
  async searchCards(query: SearchQuery): Promise<SearchResults> {
    try {
      const indexName = this.getIndexNameForSort(query.sort)
      const searchIndex = this.client.initIndex(indexName)
      
      const searchParams = {
        query: query.text || '',
        filters: this.buildAlgoliaFilters(query.filters),
        facets: query.facets || [
          'game', 'primaryType', 'colors', 'rarities', 'sets.name',
          'hasInventory', 'priceRange'
        ],
        hitsPerPage: Math.min(query.limit || DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT),
        page: query.page - 1, // Algolia uses 0-based pagination
        attributesToHighlight: ['name', 'oracleText'],
        attributesToSnippet: ['oracleText:50'],
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>',
        typoTolerance: true,
        analytics: true,
        clickAnalytics: true
      }

      const result = await searchIndex.search(searchParams.query, searchParams)
      
      return {
        hits: result.hits.map(hit => this.transformSearchHit(hit)),
        totalHits: result.nbHits,
        facets: this.transformFacets(result.facets || {}),
        processingTime: result.processingTimeMS,
        page: query.page,
        hasMore: (query.page * searchParams.hitsPerPage) < result.nbHits,
        suggestions: result.query ? await this.getSuggestions(result.query) : undefined
      }
    } catch (error) {
      logger.error('Search failed', error as Error, { 
        query: query.text,
        filters: Object.keys(query.filters).length
      })
      throw error
    }
  }

  /**
   * Get autocomplete suggestions
   */
  async getAutocompleteSuggestions(query: string, limit: number = 10): Promise<AutocompleteResult> {
    try {
      const startTime = Date.now()
      
      const result = await this.cardsIndex.search(query, {
        hitsPerPage: limit,
        attributesToRetrieve: ['name', 'game', 'primaryType'],
        attributesToHighlight: ['name'],
        typoTolerance: true,
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>'
      })

      const suggestions = result.hits.map((hit: any) => ({
        type: 'card' as const,
        value: hit.name,
        count: 1, // TODO: Implement frequency counting
        highlighted: hit._highlightResult?.name?.value || hit.name
      }))

      return {
        query,
        suggestions,
        processingTime: Date.now() - startTime
      }
    } catch (error) {
      logger.error('Autocomplete failed', error as Error, { query })
      return { query, suggestions: [], processingTime: 0 }
    }
  }

  /**
   * Index a single card
   */
  async indexCard(card: any, prints: any[]): Promise<void> {
    try {
      const document = this.transformCardToDocument(card, prints)
      await this.cardsIndex.saveObject(document)
      
      logger.debug('Card indexed successfully', { 
        cardId: card.id, 
        objectID: document.objectID 
      })
    } catch (error) {
      logger.error('Failed to index card', error as Error, { cardId: card.id })
      throw error
    }
  }

  /**
   * Batch index cards for better performance
   */
  async indexCards(cardsWithPrints: Array<{ card: any; prints: any[] }>): Promise<void> {
    try {
      const documents = cardsWithPrints.map(({ card, prints }) => 
        this.transformCardToDocument(card, prints)
      )

      // Batch index in chunks of 1000 (Algolia limit is 1000 objects per request)
      const batchSize = 1000
      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize)
        await this.cardsIndex.saveObjects(batch)
        
        logger.debug('Card batch indexed', { 
          batchSize: batch.length,
          progress: `${i + batch.length}/${documents.length}`
        })
      }

      logger.info('Cards indexed successfully', { 
        totalCards: documents.length 
      })
    } catch (error) {
      logger.error('Failed to batch index cards', error as Error)
      throw error
    }
  }

  /**
   * Delete card from index
   */
  async deleteCard(cardId: string): Promise<void> {
    try {
      await this.cardsIndex.deleteObject(cardId)
      logger.debug('Card deleted from index', { cardId })
    } catch (error) {
      logger.error('Failed to delete card from index', error as Error, { cardId })
      throw error
    }
  }

  /**
   * Update card popularity metrics
   */
  async updateCardPopularity(cardId: string, metrics: {
    views?: number
    searches?: number
    cartAdds?: number
  }): Promise<void> {
    try {
      const updates: any = {}
      
      if (metrics.views !== undefined) {
        updates.totalViews = metrics.views
        updates.popularity = this.calculatePopularityScore(metrics)
      }
      
      if (metrics.searches !== undefined) {
        updates.totalSearches = metrics.searches
      }

      await this.cardsIndex.partialUpdateObject({
        objectID: cardId,
        ...updates
      })
      
      logger.debug('Card popularity updated', { cardId, metrics })
    } catch (error) {
      logger.error('Failed to update card popularity', error as Error, { cardId })
      throw error
    }
  }

  /**
   * Get search statistics
   */
  async getSearchStats(startDate?: Date, endDate?: Date): Promise<any> {
    try {
      // Note: This would require Algolia Analytics API in a real implementation
      // For now, return a placeholder
      return {
        totalSearches: 0,
        topQueries: [],
        noResultsQueries: [],
        clickThroughRate: 0,
        conversionRate: 0
      }
    } catch (error) {
      logger.error('Failed to get search stats', error as Error)
      throw error
    }
  }

  /**
   * Private helper methods
   */
  private buildAlgoliaFilters(filters: SearchFilters): string {
    const filterParts: string[] = []

    // Game filters
    if (filters.games?.length) {
      const gameFilters = filters.games.map(game => `game:"${game}"`).join(' OR ')
      filterParts.push(`(${gameFilters})`)
    }

    // Type filters
    if (filters.types?.length) {
      const typeFilters = filters.types.map(type => `primaryType:"${type}"`).join(' OR ')
      filterParts.push(`(${typeFilters})`)
    }

    // Color filters
    if (filters.colors?.length) {
      const colorFilters = filters.colors.map(color => `colors:"${color}"`).join(' OR ')
      filterParts.push(`(${colorFilters})`)
    }

    // Rarity filters
    if (filters.rarities?.length) {
      const rarityFilters = filters.rarities.map(rarity => `rarities:"${rarity}"`).join(' OR ')
      filterParts.push(`(${rarityFilters})`)
    }

    // Price range filters
    if (filters.priceRange) {
      const [min, max] = filters.priceRange
      filterParts.push(`lowestPrice >= ${min} AND lowestPrice <= ${max}`)
    }

    // Mana value range
    if (filters.manaValueRange) {
      const [min, max] = filters.manaValueRange
      filterParts.push(`manaValue >= ${min} AND manaValue <= ${max}`)
    }

    // Boolean filters
    if (filters.inStock !== undefined) {
      filterParts.push(`hasInventory:${filters.inStock}`)
    }

    if (filters.isFoil !== undefined) {
      filterParts.push(`isFoil:${filters.isFoil}`)
    }

    return filterParts.join(' AND ')
  }

  private getIndexNameForSort(sort?: SearchSort): string {
    if (!sort) return this.config.indexName

    switch (sort.field) {
      case SearchSortField.NAME:
        return `${this.config.indexName}_name_asc`
      case SearchSortField.PRICE_LOW:
        return `${this.config.indexName}_price_asc`
      case SearchSortField.PRICE_HIGH:
        return `${this.config.indexName}_price_desc`
      case SearchSortField.RELEASE_DATE:
        return `${this.config.indexName}_release_date_desc`
      default:
        return this.config.indexName
    }
  }

  private transformSearchHit(hit: any): any {
    return {
      id: hit.objectID,
      name: hit.name,
      normalizedName: hit.normalizedName,
      primaryType: hit.primaryType,
      subtypes: hit.subtypes || [],
      oracleText: hit.oracleText,
      game: {
        code: hit.game,
        name: hit.gameName
      },
      manaCost: hit.manaCost,
      manaValue: hit.manaValue,
      colors: hit.colors || [],
      hp: hit.hp,
      attribute: hit.attribute,
      lowestPrice: hit.lowestPrice,
      marketPrice: hit.marketPrice,
      hasInventory: hit.hasInventory,
      sets: hit.sets || [],
      rarities: hit.rarities || [],
      imageUrl: hit.imageUrl,
      thumbnailUrl: hit.thumbnailUrl,
      _highlightResult: hit._highlightResult,
      _snippetResult: hit._snippetResult,
      popularity: hit.popularity
    }
  }

  private transformFacets(facets: Record<string, Record<string, number>>): Record<string, Array<{ value: string; count: number }>> {
    const result: Record<string, Array<{ value: string; count: number }>> = {}
    
    for (const [facetName, facetValues] of Object.entries(facets)) {
      result[facetName] = Object.entries(facetValues)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
    }
    
    return result
  }

  private transformCardToDocument(card: any, prints: any[]): SearchIndexDocument {
    // Aggregate print information
    const sets = prints.map(print => ({
      code: print.setCode || print.set?.code,
      name: print.setName || print.set?.name
    })).filter(set => set.code && set.name)

    const rarities = [...new Set(prints.map(print => print.rarity).filter(Boolean))]
    const artists = [...new Set(prints.map(print => print.artist).filter(Boolean))]
    
    // Determine if card has inventory
    const hasInventory = prints.some(print => 
      print.skus?.some((sku: any) => sku.hasB2cInventory || sku.hasC2cListings)
    )

    // Get lowest price across all prints/SKUs
    const allPrices = prints.flatMap(print => 
      print.skus?.map((sku: any) => sku.lowestPrice).filter((price: any) => price != null) || []
    )
    const lowestPrice = allPrices.length > 0 ? Math.min(...allPrices) : undefined

    // Determine price range category
    let priceRange = 'unknown'
    if (lowestPrice !== undefined) {
      if (lowestPrice < 1) priceRange = 'budget'
      else if (lowestPrice < 10) priceRange = 'affordable'
      else if (lowestPrice < 50) priceRange = 'mid'
      else if (lowestPrice < 200) priceRange = 'high'
      else priceRange = 'premium'
    }

    return {
      objectID: card.id,
      name: card.name,
      normalizedName: card.normalizedName,
      game: card.game?.code || card.gameCode,
      gameName: card.game?.name || card.gameName,
      primaryType: card.primaryType,
      subtypes: card.subtypes || [],
      oracleText: card.oracleText,
      keywords: card.keywords || [],
      colors: card.colors || [],
      manaCost: card.manaCost,
      manaValue: card.manaValue,
      energyTypes: card.energyTypes || [],
      attribute: card.attribute,
      sets,
      rarities,
      artists,
      hasInventory,
      lowestPrice,
      priceRange,
      popularity: card.popularityScore || 0,
      totalViews: card.totalViews || 0,
      totalSearches: card.totalSearches || 0
    }
  }

  private calculatePopularityScore(metrics: {
    views?: number
    searches?: number
    cartAdds?: number
  }): number {
    // Simple popularity algorithm - can be made more sophisticated
    const views = metrics.views || 0
    const searches = metrics.searches || 0
    const cartAdds = metrics.cartAdds || 0
    
    // Weight cart adds higher than views/searches
    return views * 1 + searches * 2 + cartAdds * 10
  }

  private async getSuggestions(query: string): Promise<string[]> {
    // Simple implementation - in production this could be more sophisticated
    return []
  }
}