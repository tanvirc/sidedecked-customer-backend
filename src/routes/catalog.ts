import { Router } from 'express'
import { AppDataSource } from '../config/database'
import { Game } from '../entities/Game'
import { Card } from '../entities/Card'
import { CardSet } from '../entities/CardSet'
import { Print } from '../entities/Print'
import { Format } from '../entities/Format'
import { CatalogSKU } from '../entities/CatalogSKU'

const router = Router()

// Get all games
router.get('/games', async (req, res) => {
  try {
    console.log('DEBUG: Starting games fetch...')
    
    // Use direct SQL query to avoid entity issues
    const games = await AppDataSource.query('SELECT * FROM games ORDER BY name ASC')
    console.log('DEBUG: Found games:', games.length)

    res.json({
      success: true,
      data: games,
      count: games.length
    })
  } catch (error) {
    console.error('Error fetching games:', error)
    console.error('Error stack:', error.stack)
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

    res.json({
      success: true,
      data: game
    })
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

    res.json({
      success: true,
      data: game
    })
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

    // Build SQL query with filters
    let sqlQuery = `
      SELECT c.*, g.code as game_code, g.name as game_name
      FROM cards c
      JOIN games g ON c.game_id = g.id
      WHERE 1=1
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

    // Text search
    if (query) {
      sqlQuery += ` AND (c.name ILIKE $${paramIndex} OR c.oracle_text ILIKE $${paramIndex} OR c.flavor_text ILIKE $${paramIndex})`
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
    
    // Get total count (simplified)
    const totalResults = await AppDataSource.query('SELECT COUNT(*) as count FROM cards')
    const totalCount = parseInt(totalResults[0].count)

    console.log('DEBUG: Found cards:', cards.length, 'Total:', totalCount)

    // Convert to search results format
    const hits = cards.map(card => ({
      card: {
        id: card.id,
        name: card.name,
        gameId: card.game_id,
        gameCode: card.game_code,
        gameName: card.game_name,
        oracleText: card.oracle_text,
        flavorText: card.flavor_text
      },
      print: null,
      relevanceScore: 1.0
    }))

    res.json({
      success: true,
      data: {
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
      }
    })
  } catch (error) {
    console.error('Error searching cards:', error)
    console.error('Error stack:', error.stack)
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
    const cardRepository = AppDataSource.getRepository(Card)
    const card = await cardRepository.findOne({
      where: { id: req.params.id },
      relations: ['game', 'prints', 'prints.set']
    })

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

    res.json({
      success: true,
      data: card
    })
  } catch (error) {
    console.error('Error fetching card:', error)
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
    const cardRepository = AppDataSource.getRepository(Card)
    const card = await cardRepository.findOne({
      where: { id: req.params.id },
      relations: ['game', 'prints', 'prints.set']
    })

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

    // Add format legality (mock for now)
    const legality = {
      standard: card.prints?.[0]?.isLegalStandard || false,
      pioneer: card.prints?.[0]?.isLegalPioneer || false,
      modern: card.prints?.[0]?.isLegalModern || false,
      legacy: card.prints?.[0]?.isLegalLegacy || false,
      vintage: card.prints?.[0]?.isLegalVintage || false,
      commander: card.prints?.[0]?.isLegalCommander || false
    }

    const sets = card.prints?.map(print => print.set).filter(Boolean) || []

    res.json({
      success: true,
      data: {
        ...card,
        sets,
        legality
      }
    })
  } catch (error) {
    console.error('Error fetching card details:', error)
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

    res.json({
      success: true,
      data: suggestions
    })
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

    res.json({
      success: true,
      data: facets
    })
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
router.get('/search/analytics', async (req, res) => {
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

    res.json({
      success: true,
      data: analytics
    })
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
router.get('/search/trends', async (req, res) => {
  try {
    const { game, timeframe = 'week' } = req.query

    // Mock trends for development
    const trends = [
      { query: 'Lightning Bolt', searchCount: 1250, growthRate: 15.3, timeframe },
      { query: 'Charizard', searchCount: 980, growthRate: 22.1, timeframe },
      { query: 'Blue-Eyes White Dragon', searchCount: 875, growthRate: 8.7, timeframe },
      { query: 'Monkey D. Luffy', searchCount: 654, growthRate: 45.2, timeframe }
    ]

    res.json({
      success: true,
      data: trends
    })
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
router.get('/search/popular', async (req, res) => {
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

    res.json({
      success: true,
      data: popular
    })
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
router.post('/search/track', async (req, res) => {
  try {
    const { query, resultsCount, searchId } = req.body

    // Mock tracking for development
    console.log('Search tracked:', { query, resultsCount, searchId })

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
router.post('/cards/:id/view', async (req, res) => {
  try {
    const { id } = req.params
    const { source } = req.body

    // Mock tracking for development
    console.log('Card view tracked:', { cardId: id, source })

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