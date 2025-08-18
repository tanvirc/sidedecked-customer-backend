import { Router } from 'express'
import { AppDataSource } from '../config/database'
import { Game } from '../entities/Game'
import { Card } from '../entities/Card'
import { CardSet } from '../entities/CardSet'
import { Print } from '../entities/Print'
import { Format } from '../entities/Format'
import { CatalogSKU } from '../entities/CatalogSKU'
import { CardImage, ImageStatus } from '../entities/CardImage'
import { getStorageService } from '../config/infrastructure'

const router = Router()

// Helper function to get processed image URLs, fallback to external URLs
async function getProcessedImageUrls(print: Print): Promise<{
  thumbnail?: string
  small?: string
  normal?: string
  large?: string
  artCrop?: string
  borderCrop?: string
}> {
  try {
    // Try to get processed images from CardImage table
    const cardImageRepo = AppDataSource.getRepository(CardImage)
    const processedImages = await cardImageRepo.find({
      where: { 
        printId: print.id,
        status: ImageStatus.COMPLETED
      }
    })

    // Build image URLs object with processed images first, then fallbacks
    const storage = getStorageService()
    const images: any = {}

    // If we have processed images, use CDN URLs
    if (processedImages.length > 0) {
      for (const cardImage of processedImages) {
        if (cardImage.cdnUrls) {
          const cdnUrls = cardImage.cdnUrls as Record<string, string>
          // Map to our standard image sizes
          images.thumbnail = cdnUrls.thumbnail || cdnUrls.small
          images.small = cdnUrls.small || cdnUrls.normal
          images.normal = cdnUrls.normal || cdnUrls.large
          images.large = cdnUrls.large || cdnUrls.normal
          if (cdnUrls.artCrop) images.artCrop = cdnUrls.artCrop
        } else if (cardImage.storageUrls) {
          // Fallback to direct MinIO URLs
          const storageUrls = cardImage.storageUrls as Record<string, string>
          for (const [size, url] of Object.entries(storageUrls)) {
            const key = url.split('/').slice(-4).join('/')
            const publicUrl = storage.getPublicUrl(key)
            
            switch (size) {
              case 'thumbnail':
                images.thumbnail = publicUrl
                break
              case 'small':
                images.small = publicUrl
                break
              case 'normal':
                images.normal = publicUrl
                break
              case 'large':
                images.large = publicUrl
                break
              case 'artCrop':
                images.artCrop = publicUrl
                break
            }
          }
        }
      }
    }

    // Fallback to external URLs if no processed images
    if (!images.normal && !images.small && !images.large) {
      images.thumbnail = print.imageSmall || undefined
      images.small = print.imageSmall || undefined
      images.normal = print.imageNormal || undefined
      images.large = print.imageLarge || undefined
      images.artCrop = print.imageArtCrop || undefined
      images.borderCrop = print.imageBorderCrop || undefined
    }

    return images
  } catch (error) {
    console.error('Error getting processed image URLs:', error)
    // Fallback to external URLs on error
    return {
      thumbnail: print.imageSmall || undefined,
      small: print.imageSmall || undefined,
      normal: print.imageNormal || undefined,
      large: print.imageLarge || undefined,
      artCrop: print.imageArtCrop || undefined,
      borderCrop: print.imageBorderCrop || undefined
    }
  }
}

// Get all games
router.get('/games', async (req, res) => {
  try {
    console.log('DEBUG: Starting games fetch...')
    
    // Use TypeORM repository for type safety and consistency
    const gameRepository = AppDataSource.getRepository(Game)
    const games = await gameRepository.find({
      order: { name: 'ASC' }
    })
    console.log('DEBUG: Found games:', games.length)

    // Return just the data array for frontend compatibility
    res.json(games)
  } catch (error) {
    console.error('Error fetching games:', error)
    console.error('Error stack:', (error as Error).stack)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch games',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Get game by ID
router.get('/games/:id', async (req, res) => {
  try {
    const gameRepository = AppDataSource.getRepository(Game)
    const game = await gameRepository.findOne({
      where: { id: req.params.id }
    })

    if (!game) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Game not found',
          timestamp: new Date().toISOString()
        }
      })
    }

    // Return just the game object for frontend compatibility
    res.json(game)
  } catch (error) {
    console.error('Error fetching game:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch game',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Get game by code
router.get('/games/code/:code', async (req, res) => {
  try {
    const gameRepository = AppDataSource.getRepository(Game)
    const game = await gameRepository.findOne({
      where: { code: req.params.code.toUpperCase() }
    })

    if (!game) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Game not found',
          timestamp: new Date().toISOString()
        }
      })
    }

    // Return just the game object for frontend compatibility
    res.json(game)
  } catch (error) {
    console.error('Error fetching game by code:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch game',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Search cards
router.get('/cards/search', async (req, res) => {
  try {
    const {
      q: query = '',
      games,
      types,
      rarities,
      sets,
      colors,
      energyTypes,
      attributes,
      formats,
      page = '1',
      limit = '20',
      sort = 'relevance'
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const offset = (pageNum - 1) * limitNum

    console.log('DEBUG: Searching cards with filters:', { games, types, query, page, limit })

    // Build SQL query with filters (using correct camelCase column)
    let sqlQuery = `
      SELECT c.*, g.code as game_code, g.name as game_name
      FROM cards c
      LEFT JOIN games g ON c."gameId" = g.id
      WHERE c.deleted_at IS NULL
    `
    const params: any[] = []
    let paramIndex = 1

    // Game filter
    if (games) {
      const gameArray = Array.isArray(games) ? games : [games]
      const placeholders = gameArray.map(() => `$${paramIndex++}`).join(',')
      sqlQuery += ` AND g.code IN (${placeholders})`
      params.push(...gameArray)
    }

    // Text search (using correct camelCase column names)
    if (query) {
      sqlQuery += ` AND (c.name ILIKE $${paramIndex} OR c."oracleText" ILIKE $${paramIndex} OR c."flavorText" ILIKE $${paramIndex})`
      params.push(`%${query}%`)
      paramIndex++
    }

    // Add ordering
    sqlQuery += ` ORDER BY c.name ASC`
    
    // Add pagination
    sqlQuery += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
    params.push(limitNum, offset)

    console.log('DEBUG: SQL Query:', sqlQuery)
    console.log('DEBUG: Parameters:', params)

    const cards = await AppDataSource.query(sqlQuery, params)
    
    // Get total count (with same filters, using correct camelCase column)
    let countQuery = 'SELECT COUNT(*) as count FROM cards c LEFT JOIN games g ON c."gameId" = g.id WHERE c.deleted_at IS NULL'
    let countParams: any[] = []
    let countParamIndex = 1
    
    // Apply same filters for count
    if (games) {
      const gameArray = Array.isArray(games) ? games : [games]
      const placeholders = gameArray.map(() => `$${countParamIndex++}`).join(',')
      countQuery += ` AND g.code IN (${placeholders})`
      countParams.push(...gameArray)
    }
    
    if (query) {
      countQuery += ` AND (c.name ILIKE $${countParamIndex} OR c."oracleText" ILIKE $${countParamIndex} OR c."flavorText" ILIKE $${countParamIndex})`
      countParams.push(`%${query}%`)
    }
    
    const totalResults = await AppDataSource.query(countQuery, countParams)
    const totalCount = parseInt(totalResults[0].count)

    console.log('DEBUG: Found cards:', cards.length, 'Total:', totalCount)

    // Convert to search results format (using correct camelCase field names)
    const hits = cards.map((card: any) => ({
      card: {
        id: card.id,
        name: card.name,
        gameId: card.gameId,
        gameCode: card.game_code,
        gameName: card.game_name,
        oracleText: card.oracleText,
        flavorText: card.flavorText
      },
      print: null,
      relevanceScore: 1.0
    }))

    // Return search response directly for frontend compatibility
    res.json({
      hits,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        totalResults: totalCount,
        hasMore: offset + limitNum < totalCount
      },
      facets: {
        games: [],
        types: [],
        rarities: [],
        sets: [],
        colors: [],
        energyTypes: [],
        attributes: [],
        formats: []
      },
      processingTime: Date.now(),
      searchId: `search_${Date.now()}`
    })
  } catch (error) {
    console.error('Error searching cards:', error)
    console.error('Error stack:', (error as Error).stack)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to search cards',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Get card by ID
router.get('/cards/:id', async (req, res) => {
  try {
    console.log('DEBUG: Fetching card for ID:', req.params.id)
    
    const cardRepository = AppDataSource.getRepository(Card)
    const card = await cardRepository.findOne({
      where: { id: req.params.id },
      relations: ['game', 'prints', 'prints.set']
    })
    
    console.log('DEBUG: Found card:', card ? card.name : 'none')
    
    if (!card) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Card not found',
          timestamp: new Date().toISOString()
        }
      })
    }

    // Format the card response using TypeORM entity data
    const cardResponse = {
      id: card.id,
      name: card.name,
      gameId: card.gameId,
      gameCode: card.game?.code,
      gameName: card.game?.name,
      oracleText: card.oracleText,
      flavorText: card.flavorText,
      manaCost: card.manaCost,
      manaValue: card.manaValue,
      colors: card.colors,
      powerValue: card.powerValue,
      defenseValue: card.defenseValue,
      hp: card.hp,
      primaryType: card.primaryType,
      subtypes: card.subtypes,
      // Add missing card data
      supertypes: card.supertypes,
      keywords: card.keywords,
      colorIdentity: card.colorIdentity,
      retreatCost: card.retreatCost,
      energyTypes: card.energyTypes,
      evolutionStage: card.evolutionStage,
      attribute: card.attribute,
      levelRank: card.levelRank,
      attackValue: card.attackValue,
      defenseValueYugioh: card.defenseValueYugioh,
      cost: card.cost,
      donCost: card.donCost,
      lifeValue: card.lifeValue,
      counterValue: card.counterValue,
      power: card.power,
      // Add game object if available
      game: card.game ? {
        id: card.game.id,
        code: card.game.code,
        name: card.game.name
      } : null,
      // Add prints with images structure
      prints: await Promise.all(card.prints?.map(async (print) => ({
        id: print.id,
        rarity: print.rarity,
        artist: print.artist,
        collectorNumber: print.collectorNumber,
        language: print.language,
        blurhash: print.blurhash,
        images: await getProcessedImageUrls(print),
        set: print.set ? {
          id: print.set.id,
          code: print.set.code,
          name: print.set.name
        } : null
      })) || [])
    }

    console.log('DEBUG: Returning card:', card.name)
    
    // Return just the card object for frontend compatibility
    res.json(cardResponse)
  } catch (error) {
    console.error('Error fetching card:', error)
    console.error('Error stack:', (error as Error).stack)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch card',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Get card details (enhanced with additional data)
router.get('/cards/:id/details', async (req, res) => {
  try {
    console.log('DEBUG: Fetching card details for ID:', req.params.id)
    
    const cardRepository = AppDataSource.getRepository(Card)
    const card = await cardRepository.findOne({
      where: { id: req.params.id },
      relations: ['game', 'prints', 'prints.set']
    })
    
    console.log('DEBUG: Found card:', card ? card.name : 'none')
    console.log('DEBUG: Found prints:', card?.prints?.length || 0)
    
    if (!card) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Card not found',
          timestamp: new Date().toISOString()
        }
      })
    }

    // Format the response
    const cardDetails = {
      id: card.id,
      name: card.name,
      gameId: card.gameId,
      gameCode: card.game?.code,
      gameName: card.game?.name,
      oracleText: card.oracleText,
      flavorText: card.flavorText,
      manaCost: card.manaCost,
      manaValue: card.manaValue,
      colors: card.colors,
      powerValue: card.powerValue,
      defenseValue: card.defenseValue,
      hp: card.hp,
      primaryType: card.primaryType,
      subtypes: card.subtypes,
      // Add missing card data
      supertypes: card.supertypes,
      keywords: card.keywords,
      colorIdentity: card.colorIdentity,
      retreatCost: card.retreatCost,
      energyTypes: card.energyTypes,
      evolutionStage: card.evolutionStage,
      attribute: card.attribute,
      levelRank: card.levelRank,
      attackValue: card.attackValue,
      defenseValueYugioh: card.defenseValueYugioh,
      cost: card.cost,
      donCost: card.donCost,
      lifeValue: card.lifeValue,
      counterValue: card.counterValue,
      power: card.power,
      // Add game object if available
      game: card.game ? {
        id: card.game.id,
        code: card.game.code,
        name: card.game.name
      } : null,
      // Add prints using TypeORM relation data
      prints: await Promise.all(card.prints?.map(async (print) => ({
        id: print.id,
        rarity: print.rarity,
        artist: print.artist,
        collectorNumber: print.collectorNumber,
        language: print.language,
        isLegalStandard: print.isLegalStandard,
        isLegalPioneer: print.isLegalPioneer,
        isLegalModern: print.isLegalModern,
        isLegalLegacy: print.isLegalLegacy,
        isLegalVintage: print.isLegalVintage,
        isLegalCommander: print.isLegalCommander,
        imageSmall: print.imageSmall,
        imageNormal: print.imageNormal,
        imageLarge: print.imageLarge,
        blurhash: print.blurhash,
        // Add images structure for frontend compatibility
        images: await getProcessedImageUrls(print),
        set: print.set ? {
          id: print.set.id,
          code: print.set.code,
          name: print.set.name
        } : null
      })) || []),
      // Add format legality (from first print)
      legality: {
        standard: card.prints?.[0]?.isLegalStandard || false,
        pioneer: card.prints?.[0]?.isLegalPioneer || false,
        modern: card.prints?.[0]?.isLegalModern || false,
        legacy: card.prints?.[0]?.isLegalLegacy || false,
        vintage: card.prints?.[0]?.isLegalVintage || false,
        commander: card.prints?.[0]?.isLegalCommander || false
      },
      // Add sets from prints
      sets: card.prints
        ?.filter((print) => print.set)
        .map((print) => ({
          id: print.set!.id,
          code: print.set!.code,
          name: print.set!.name
        }))
        .filter((set, index, self) => 
          // Remove duplicates by ID
          index === self.findIndex(s => s.id === set.id)
        ) || []
    }

    console.log('DEBUG: Returning card details for:', card.name)
    
    // Return card details directly for frontend compatibility
    res.json(cardDetails)
  } catch (error) {
    console.error('Error fetching card details:', error)
    console.error('Error stack:', (error as Error).stack)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch card details',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Get suggestions (mock for now)
router.get('/cards/suggestions', async (req, res) => {
  try {
    const { field, value, game } = req.query

    // Mock suggestions for development
    const suggestions = [
      {
        value: `${value} (suggestion)`,
        count: Math.floor(Math.random() * 100),
        context: `Mock ${field} suggestion`,
        imageUrl: undefined
      },
      {
        value: `${value} deck`,
        count: Math.floor(Math.random() * 50),
        context: 'Deck building suggestion',
        imageUrl: undefined
      },
      {
        value: `${value} commander`,
        count: Math.floor(Math.random() * 30),
        context: 'Commander format',
        imageUrl: undefined
      }
    ].filter(s => s.value.toLowerCase().includes((value as string).toLowerCase()))

    // Return just the suggestions array for frontend compatibility
    res.json(suggestions)
  } catch (error) {
    console.error('Error fetching suggestions:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch suggestions',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Get search facets
router.get('/search/facets', async (req, res) => {
  try {
    // Mock facets for development
    const facets = {
      games: [
        { value: 'MTG', label: 'Magic: The Gathering', count: 1250 },
        { value: 'POKEMON', label: 'Pokémon', count: 987 },
        { value: 'YUGIOH', label: 'Yu-Gi-Oh!', count: 654 },
        { value: 'OPTCG', label: 'One Piece TCG', count: 432 }
      ],
      types: [
        { value: 'creature', label: 'Creature', count: 245 },
        { value: 'instant', label: 'Instant', count: 123 },
        { value: 'sorcery', label: 'Sorcery', count: 98 },
        { value: 'artifact', label: 'Artifact', count: 76 }
      ],
      rarities: [
        { value: 'common', label: 'Common', count: 320 },
        { value: 'uncommon', label: 'Uncommon', count: 165 },
        { value: 'rare', label: 'Rare', count: 89 },
        { value: 'mythic', label: 'Mythic Rare', count: 23 }
      ],
      sets: [
        { value: 'foundations', label: 'Foundations', count: 78 },
        { value: 'duskmourn', label: 'Duskmourn', count: 65 },
        { value: 'bloomburrow', label: 'Bloomburrow', count: 54 }
      ]
    }

    // Return just the facets object for frontend compatibility
    res.json(facets)
  } catch (error) {
    console.error('Error fetching facets:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch facets',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Get search analytics
router.get('/analytics/search', async (req, res) => {
  try {
    const { game, timeframe = 'week' } = req.query

    // Mock analytics for development
    const analytics = {
      totalSearches: 15420,
      uniqueQueries: 3240,
      zeroResultsRate: 8.5,
      avgResultsPerQuery: 47.2,
      gameInsights: game ? {
        [game as string]: {
          gameName: game === 'MTG' ? 'Magic: The Gathering' : 
                   game === 'POKEMON' ? 'Pokémon' :
                   game === 'YUGIOH' ? 'Yu-Gi-Oh!' : 'One Piece',
          topCardType: game === 'MTG' ? 'Creature' : 
                      game === 'POKEMON' ? 'Pokémon' :
                      game === 'YUGIOH' ? 'Monster' : 'Character',
          topSet: game === 'MTG' ? 'Foundations' : 
                 game === 'POKEMON' ? 'Surging Sparks' :
                 game === 'YUGIOH' ? 'Quarter Century Bonanza' : 'Starter Deck',
          avgFiltersUsed: 2.3
        }
      } : undefined
    }

    // Return just the analytics object for frontend compatibility
    res.json(analytics)
  } catch (error) {
    console.error('Error fetching search analytics:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch search analytics',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Get search trends
router.get('/analytics/search/trends', async (req, res) => {
  try {
    const { game, timeframe = 'week' } = req.query

    // Mock trends for development
    const trends = [
      { query: 'Lightning Bolt', searchCount: 1250, growthRate: 15.3, timeframe },
      { query: 'Charizard', searchCount: 980, growthRate: 22.1, timeframe },
      { query: 'Blue-Eyes White Dragon', searchCount: 875, growthRate: 8.7, timeframe },
      { query: 'Monkey D. Luffy', searchCount: 654, growthRate: 45.2, timeframe }
    ]

    // Return just the trends array for frontend compatibility
    res.json(trends)
  } catch (error) {
    console.error('Error fetching search trends:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch search trends',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Get popular searches
router.get('/analytics/search/popular', async (req, res) => {
  try {
    const { game, timeframe = 'week' } = req.query

    // Mock popular searches for development
    const popular = [
      { query: 'Black Lotus', count: 2341, changePercent: 5.2 },
      { query: 'Pikachu', count: 1987, changePercent: -2.1 },
      { query: 'Dark Magician', count: 1654, changePercent: 12.8 },
      { query: 'Roronoa Zoro', count: 1432, changePercent: 8.9 },
      { query: 'Sol Ring', count: 1321, changePercent: -0.5 }
    ]

    // Return just the popular searches array for frontend compatibility
    res.json(popular)
  } catch (error) {
    console.error('Error fetching popular searches:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch popular searches',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Track search (for analytics)
router.post('/analytics/search', async (req, res) => {
  try {
    const { query, resultCount, searchId, timestamp } = req.body

    // Mock tracking for development
    console.log('Search tracked:', { query, resultCount, searchId, timestamp })

    res.json({
      success: true,
      message: 'Search tracked successfully'
    })
  } catch (error) {
    console.error('Error tracking search:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to track search',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Track card view (for analytics)
router.post('/analytics/card-view', async (req, res) => {
  try {
    const { cardId, source, searchQuery, referrer, timestamp } = req.body

    // Mock tracking for development
    console.log('Card view tracked:', { cardId, source, searchQuery, referrer, timestamp })

    res.json({
      success: true,
      message: 'Card view tracked successfully'
    })
  } catch (error) {
    console.error('Error tracking card view:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to track card view',
        timestamp: new Date().toISOString()
      }
    })
  }
})

export default router