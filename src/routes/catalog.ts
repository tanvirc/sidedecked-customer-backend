import { Router } from 'express'
import { AppDataSource } from '../config/database'
import { Game } from '../entities/Game'
import { Card } from '../entities/Card'
import { CardSet } from '../entities/CardSet'
import { Print } from '../entities/Print'
import { Format } from '../entities/Format'
import { CatalogSKU } from '../entities/CatalogSKU'
import { CardImage, ImageStatus, ImageType } from '../entities/CardImage'
import { getStorageService } from '../config/infrastructure'
import { config } from '../config/env'
import { cdnService } from '../services/CDNService'
import { debugLog } from '../utils/debug'
import { validateUUID, validatePagination } from '../middleware/validation'
import { databaseErrorHandler } from '../config/database'

const router = Router()

// CDN Health Check endpoint
router.get('/cdn/health', async (req, res) => {
  try {
    const cdnConfig = cdnService.getConfig()
    const isHealthy = cdnService.isEnabled()
    
    res.json({
      success: true,
      cdn: {
        enabled: cdnConfig.enabled,
        healthy: isHealthy,
        baseUrl: cdnConfig.baseUrl,
        cacheTTL: cdnConfig.defaultTTL,
        browserCacheTTL: cdnConfig.browserCacheTTL,
        edgeCacheTTL: cdnConfig.edgeCacheTTL,
        failoverEnabled: cdnConfig.failoverEnabled
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('CDN health check failed:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'CDN_HEALTH_CHECK_FAILED',
        message: 'CDN health check failed',
        timestamp: new Date().toISOString()
      }
    })
  }
})

/**
 * Helper function to get processed image URLs with CDN support and fallbacks
 * 
 * IMAGE TYPE HIERARCHY:
 * - MAIN images: Full card images (used for normal/small/large/thumbnail fields)
 * - ART_CROP images: Artwork only, no borders/text (used ONLY for artCrop field)
 * - BORDER_CROP images: Artwork with border (used ONLY for borderCrop field)
 * 
 * IMPORTANT: Never use ART_CROP images for main card display!
 */
async function getProcessedImageUrls(print: Print): Promise<{
  thumbnail?: string
  small?: string
  normal?: string
  large?: string
  original?: string
  artCrop?: string
  borderCrop?: string
}> {
  try {
    // Try to get processed images from CardImage table with timeout
    const cardImageRepo = AppDataSource.getRepository(CardImage)
    
    // Add timeout to prevent hanging on database queries
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database query timeout')), 5000)
    )
    
    const processedImages = await Promise.race([
      cardImageRepo.find({
        where: { 
          printId: print.id,
          status: ImageStatus.COMPLETED
        }
      }),
      timeoutPromise
    ]) as CardImage[]

    debugLog(`Found ${processedImages.length} processed images for print ${print.id}`)

    const images: any = {}

    // Process stored MinIO URLs and transform to CDN if enabled
    // IMPORTANT: Process MAIN images first to ensure they take priority over ART_CROP
    if (processedImages.length > 0) {
      // Sort to process MAIN images before ART_CROP
      const sortedImages = processedImages.sort((a, b) => {
        if (a.imageType === ImageType.MAIN) return -1
        if (b.imageType === ImageType.MAIN) return 1
        return 0
      })
      
      for (const cardImage of sortedImages) {
        debugLog(`Processing CardImage ${cardImage.id}, type: ${cardImage.imageType}`)
        
        // Process storage URLs (always MinIO URLs from database)
        if (cardImage.storageUrls) {
          const storageUrls = cardImage.storageUrls as Record<string, string>
          debugLog('Found storage URLs:', Object.keys(storageUrls))
          
          // Check image type to determine which fields to populate
          if (cardImage.imageType === ImageType.MAIN) {
            // MAIN images should populate normal/small/large/thumbnail fields
            for (const [size, url] of Object.entries(storageUrls)) {
              if (!url) continue
              
              try {
                const publicUrl = cdnService.getFallbackUrl(url, url)
                debugLog(`MAIN image - mapping ${size} to main display fields`)
                
                // Only map MAIN images to the primary display fields
                if (size === 'thumbnail' && !images.thumbnail) images.thumbnail = publicUrl
                else if (size === 'small' && !images.small) images.small = publicUrl
                else if (size === 'normal' && !images.normal) images.normal = publicUrl
                else if (size === 'large' && !images.large) images.large = publicUrl
                else if (size === 'original' && !images.original) images.original = publicUrl
                
              } catch (urlError) {
                debugLog(`Failed to process MAIN image URL for size ${size}:`, urlError)
              }
            }
          } else if (cardImage.imageType === ImageType.ART_CROP) {
            // ART_CROP images should ONLY populate the artCrop field
            const normalUrl = storageUrls.normal || storageUrls.large || storageUrls.small
            if (normalUrl && !images.artCrop) {
              try {
                const publicUrl = cdnService.getFallbackUrl(normalUrl, normalUrl)
                debugLog(`ART_CROP image - mapping to artCrop field only`)
                images.artCrop = publicUrl
              } catch (urlError) {
                debugLog(`Failed to process ART_CROP image URL:`, urlError)
              }
            }
          } else if (cardImage.imageType === ImageType.BORDER_CROP) {
            // BORDER_CROP images should ONLY populate the borderCrop field
            const normalUrl = storageUrls.normal || storageUrls.large || storageUrls.small
            if (normalUrl && !images.borderCrop) {
              try {
                const publicUrl = cdnService.getFallbackUrl(normalUrl, normalUrl)
                debugLog(`BORDER_CROP image - mapping to borderCrop field only`)
                images.borderCrop = publicUrl
              } catch (urlError) {
                debugLog(`Failed to process BORDER_CROP image URL:`, urlError)
              }
            }
          }
          // Skip other image types (BACK, THUMBNAIL, FULL) for now
        }
      }
    }

    // Ensure fallback hierarchy for missing sizes
    if (!images.thumbnail) images.thumbnail = images.small || images.normal
    if (!images.small) images.small = images.normal || images.thumbnail
    if (!images.normal) images.normal = images.large || images.small
    if (!images.large) images.large = images.normal

    // Priority 3: Final fallback to external URLs if no processed images found
    if (!images.normal && !images.small && !images.large) {
      debugLog('No processed images found, falling back to external URLs')
      return {
        thumbnail: print.imageSmall || undefined,
        small: print.imageSmall || undefined,
        normal: print.imageNormal || undefined,
        large: print.imageLarge || undefined,
        artCrop: print.imageArtCrop || undefined,
        borderCrop: print.imageBorderCrop || undefined
      }
    }

    // Log final image mapping for debugging
    debugLog('Final image URLs with CDN support:', {
      hasNormal: !!images.normal,
      hasSmall: !!images.small,
      hasLarge: !!images.large,
      hasThumbnail: !!images.thumbnail,
      hasArtCrop: !!images.artCrop,
      normalIsArtCrop: images.normal === images.artCrop,
      imageTypes: processedImages.map(img => img.imageType)
    })
    
    return images
    
  } catch (error) {
    console.warn('Error getting processed image URLs for print', print.id, ':', error?.toString?.()?.substring(0, 200))
    
    // Always fallback to external URLs on error - this ensures mobile compatibility
    const fallbackImages = {
      thumbnail: print.imageSmall || '/images/card-placeholder.png',
      small: print.imageSmall || '/images/card-placeholder.png',
      normal: print.imageNormal || '/images/card-placeholder.png', 
      large: print.imageLarge || print.imageNormal || '/images/card-placeholder.png',
      artCrop: print.imageArtCrop || undefined,
      borderCrop: print.imageBorderCrop || undefined
    }
    
    debugLog('Using fallback images for print', print.id)
    return fallbackImages
  }
}

// Get all games
router.get('/games', async (req, res) => {
  try {
    debugLog('Starting games fetch...')
    
    // Use TypeORM repository for type safety and consistency
    const gameRepository = AppDataSource.getRepository(Game)
    const games = await gameRepository.find({
      order: { name: 'ASC' }
    })
    debugLog('Found games:', games.length)

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
router.get('/games/:id', validateUUID('id'), async (req, res) => {
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
    debugLog('Search request received:', req.query)

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

    // Validate and sanitize inputs
    const pageNum = Math.max(1, parseInt(page as string) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20)) // Cap at 100
    const offset = (pageNum - 1) * limitNum

    debugLog('Searching cards with validated params:', { 
      query: query?.toString()?.substring(0, 100), 
      games, 
      types, 
      pageNum, 
      limitNum,
      offset 
    })

    // Check database connection first
    if (!AppDataSource.isInitialized) {
      debugLog('Database not initialized')
      return res.status(500).json({
        success: false,
        error: {
          code: 'DATABASE_NOT_INITIALIZED',
          message: 'Database connection not available',
          timestamp: new Date().toISOString()
        }
      })
    }

    // Use TypeORM to get cards with relations for proper image handling
    const cardRepository = AppDataSource.getRepository(Card)
    const queryBuilder = cardRepository
      .createQueryBuilder('card')
      .leftJoinAndSelect('card.game', 'game')
      .leftJoinAndSelect('card.prints', 'prints')
      .leftJoinAndSelect('prints.set', 'set')
      .where('card.deletedAt IS NULL')

    // Game filter
    if (games) {
      const gameArray = Array.isArray(games) ? games : [games]
      queryBuilder.andWhere('game.code IN (:...games)', { games: gameArray })
    }

    // Text search
    if (query) {
      queryBuilder.andWhere(
        '(card.name ILIKE :query OR card.oracleText ILIKE :query OR card.flavorText ILIKE :query)',
        { query: `%${query}%` }
      )
    }

    // Add ordering
    queryBuilder.orderBy('card.name', 'ASC')

    let totalCount = 0
    let cards: Card[] = []

    try {
      // Get total count first with timeout
      debugLog('Getting total count...')
      totalCount = await Promise.race([
        queryBuilder.getCount(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Count query timeout')), 10000)
        )
      ])
      debugLog('Total count:', totalCount)

      // Apply pagination
      queryBuilder.skip(offset).take(limitNum)

      // Get cards with timeout
      debugLog('Getting cards...')
      cards = await Promise.race([
        queryBuilder.getMany(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Cards query timeout')), 15000)
        )
      ])
      debugLog('Found cards:', cards.length)

    } catch (dbError) {
      console.error('Database query failed:', dbError)
      return res.status(500).json({
        success: false,
        error: {
          code: 'DATABASE_QUERY_FAILED',
          message: 'Search query failed',
          details: process.env.NODE_ENV === 'development' ? (dbError as Error).message : undefined,
          timestamp: new Date().toISOString()
        }
      })
    }

    // Convert to search results format with proper image data
    debugLog('Processing results...')
    let hits: any[] = []

    try {
      hits = await Promise.all(cards.map(async (card, index) => {
        try {
          // Get the first print with images
          const print = card.prints?.[0]
          let processedImages = {}
          
          if (print) {
            // Add timeout and error handling for image processing
            try {
              processedImages = await Promise.race([
                getProcessedImageUrls(print),
                new Promise<Record<string, never>>((resolve) => 
                  setTimeout(() => resolve({}), 5000)
                )
              ])
            } catch (imageError) {
              debugLog(`Image processing failed for card ${card.id}:`, imageError)
              processedImages = {}
            }
          }

          return {
            card: {
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
              game: card.game ? {
                id: card.game.id,
                code: card.game.code,
                name: card.game.name
              } : null,
              // Include prints with image data for frontend compatibility
              prints: print ? [{
                id: print.id,
                rarity: print.rarity,
                artist: print.artist,
                number: print.collectorNumber,
                language: print.language,
                finish: print.finish,
                variation: print.variation,
                frame: print.frame,
                borderColor: print.borderColor,
                blurhash: print.blurhash,
                images: processedImages,
                set: print.set ? {
                  id: print.set.id,
                  code: print.set.code,
                  name: print.set.name,
                  releaseDate: print.set.releaseDate
                } : null
              }] : []
            },
            print: print ? {
              id: print.id,
              rarity: print.rarity,
              images: processedImages
            } : null,
            relevanceScore: 1.0
          }
        } catch (cardError) {
          console.error(`Error processing card ${card.id}:`, cardError)
          // Return minimal card data on error
          return {
            card: {
              id: card.id,
              name: card.name,
              gameId: card.gameId,
              gameCode: card.game?.code,
              gameName: card.game?.name,
              primaryType: card.primaryType,
              game: card.game ? {
                id: card.game.id,
                code: card.game.code,
                name: card.game.name
              } : null,
              prints: []
            },
            print: null,
            relevanceScore: 1.0
          }
        }
      }))
    } catch (processingError) {
      console.error('Error processing search results:', processingError)
      return res.status(500).json({
        success: false,
        error: {
          code: 'RESULT_PROCESSING_FAILED',
          message: 'Failed to process search results',
          timestamp: new Date().toISOString()
        }
      })
    }

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

    debugLog('Search completed successfully:', { 
      hitCount: hits.length, 
      totalCount, 
      page: pageNum 
    })

  } catch (error) {
    console.error('Unexpected error in card search:', error)
    console.error('Error stack:', (error as Error).stack)
    console.error('Request query:', req.query)

    // Return detailed error in development, generic in production
    const errorResponse = {
      success: false,
      error: {
        code: 'SEARCH_ERROR',
        message: 'An unexpected error occurred while searching cards',
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && {
          details: (error as Error).message,
          stack: (error as Error).stack?.split('\n').slice(0, 5) // First 5 lines only
        })
      }
    }

    res.status(500).json(errorResponse)
  }
})

// Get card by ID
router.get('/cards/:id', validateUUID('id'), async (req, res) => {
  try {
    debugLog('Fetching card for ID:', req.params.id)
    
    const cardRepository = AppDataSource.getRepository(Card)
    const card = await cardRepository.findOne({
      where: { id: req.params.id },
      relations: ['game', 'prints', 'prints.set']
    })
    
    debugLog('Found card:', card ? card.name : 'none')
    
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
        number: print.collectorNumber,
        language: print.language,
        finish: print.finish,
        variation: print.variation,
        frame: print.frame,
        borderColor: print.borderColor,
        blurhash: print.blurhash,
        images: await getProcessedImageUrls(print),
        set: print.set ? {
          id: print.set.id,
          code: print.set.code,
          name: print.set.name,
          releaseDate: print.set.releaseDate
        } : null
      })) || [])
    }

    debugLog('Returning card:', card.name)
    
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
router.get('/cards/:id/details', validateUUID('id'), async (req, res) => {
  try {
    debugLog('Fetching card details for ID:', req.params.id)
    
    const operation = async () => {
      const cardRepository = AppDataSource.getRepository(Card)
      return await cardRepository.findOne({
        where: { id: req.params.id },
        relations: ['game', 'prints', 'prints.set']
      })
    }
    
    const card = await databaseErrorHandler(operation)
    
    debugLog('Found card:', card ? card.name : 'none')
    debugLog('Found prints:', card?.prints?.length || 0)
    
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
      prints: await Promise.all(card.prints?.map(async (print: Print) => ({
        id: print.id,
        rarity: print.rarity,
        artist: print.artist,
        number: print.collectorNumber,
        language: print.language,
        finish: print.finish,
        variation: print.variation,
        frame: print.frame,
        borderColor: print.borderColor,
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
          name: print.set.name,
          releaseDate: print.set.releaseDate
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
        ?.filter((print: Print) => print.set)
        .map((print: Print) => ({
          id: print.set!.id,
          code: print.set!.code,
          name: print.set!.name
        }))
        .filter((set: any, index: number, self: any[]) => 
          // Remove duplicates by ID
          index === self.findIndex((s: any) => s.id === set.id)
        ) || []
    }

    debugLog('Returning card details for:', card.name)
    
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
    const {
      q: query,
      games,
      types,
      rarities,
      sets,
      colors,
      energyTypes,
      attributes,
      formats,
    } = req.query

    debugLog('Calculating facets with filters:', { query, games, types, rarities, sets })

    const cardRepository = AppDataSource.getRepository(Card)
    const baseQueryBuilder = cardRepository
      .createQueryBuilder('card')
      .leftJoin('card.game', 'game')
      .leftJoin('card.prints', 'prints')
      .leftJoin('prints.set', 'set')
      .where('card.deletedAt IS NULL')

    // Apply base filters for facet calculation (exclude the facet being calculated)
    if (query) {
      baseQueryBuilder.andWhere(
        '(card.name ILIKE :query OR card.oracleText ILIKE :query OR card.flavorText ILIKE :query)',
        { query: `%${query}%` }
      )
    }

    // Build facets with actual counts
    const facets: any = {
      games: [],
      types: [],
      rarities: [],
      sets: [],
      colors: [],
      energyTypes: [],
      attributes: []
    }

    // Calculate game facets (exclude games filter to show other games)
    const gameQuery = baseQueryBuilder.clone()
    // Don't apply games filter when calculating game facets
    if (types) {
      const typeArray = Array.isArray(types) ? types : [types]
      gameQuery.andWhere('card.primaryType IN (:...types)', { types: typeArray })
    }
    if (rarities) {
      const rarityArray = Array.isArray(rarities) ? rarities : [rarities]
      gameQuery.andWhere('prints.rarity IN (:...rarities)', { rarities: rarityArray })
    }
    if (sets) {
      const setArray = Array.isArray(sets) ? sets : [sets]
      gameQuery.andWhere('set.code IN (:...sets)', { sets: setArray })
    }

    const gameResults = await gameQuery
      .select('game.code', 'code')
      .addSelect('game.name', 'name')
      .addSelect('COUNT(DISTINCT card.id)', 'count')
      .groupBy('game.code')
      .addGroupBy('game.name')
      .orderBy('count', 'DESC')
      .getRawMany()

    facets.games = gameResults.map(result => ({
      value: result.code,
      label: result.name,
      count: parseInt(result.count)
    }))

    // Calculate type facets
    const typeQuery = baseQueryBuilder.clone()
    if (games) {
      const gameArray = Array.isArray(games) ? games : [games]
      typeQuery.andWhere('game.code IN (:...games)', { games: gameArray })
    }
    if (rarities) {
      const rarityArray = Array.isArray(rarities) ? rarities : [rarities]
      typeQuery.andWhere('prints.rarity IN (:...rarities)', { rarities: rarityArray })
    }
    if (sets) {
      const setArray = Array.isArray(sets) ? sets : [sets]
      typeQuery.andWhere('set.code IN (:...sets)', { sets: setArray })
    }

    const typeResults = await typeQuery
      .select('card.primaryType', 'type')
      .addSelect('COUNT(DISTINCT card.id)', 'count')
      .andWhere('card.primaryType IS NOT NULL')
      .groupBy('card.primaryType')
      .orderBy('count', 'DESC')
      .getRawMany()

    facets.types = typeResults.map(result => ({
      value: result.type.toLowerCase(),
      label: result.type,
      count: parseInt(result.count)
    }))

    // Calculate rarity facets
    const rarityQuery = baseQueryBuilder.clone()
    if (games) {
      const gameArray = Array.isArray(games) ? games : [games]
      rarityQuery.andWhere('game.code IN (:...games)', { games: gameArray })
    }
    if (types) {
      const typeArray = Array.isArray(types) ? types : [types]
      rarityQuery.andWhere('card.primaryType IN (:...types)', { types: typeArray })
    }
    if (sets) {
      const setArray = Array.isArray(sets) ? sets : [sets]
      rarityQuery.andWhere('set.code IN (:...sets)', { sets: setArray })
    }

    const rarityResults = await rarityQuery
      .select('prints.rarity', 'rarity')
      .addSelect('COUNT(DISTINCT card.id)', 'count')
      .andWhere('prints.rarity IS NOT NULL')
      .groupBy('prints.rarity')
      .orderBy('count', 'DESC')
      .getRawMany()

    facets.rarities = rarityResults.map(result => ({
      value: result.rarity.toLowerCase(),
      label: result.rarity,
      count: parseInt(result.count)
    }))

    // Calculate set facets (limit to top 20 for performance)
    const setQuery = baseQueryBuilder.clone()
    if (games) {
      const gameArray = Array.isArray(games) ? games : [games]
      setQuery.andWhere('game.code IN (:...games)', { games: gameArray })
    }
    if (types) {
      const typeArray = Array.isArray(types) ? types : [types]
      setQuery.andWhere('card.primaryType IN (:...types)', { types: typeArray })
    }
    if (rarities) {
      const rarityArray = Array.isArray(rarities) ? rarities : [rarities]
      setQuery.andWhere('prints.rarity IN (:...rarities)', { rarities: rarityArray })
    }

    const setResults = await setQuery
      .select('set.code', 'code')
      .addSelect('set.name', 'name')
      .addSelect('COUNT(DISTINCT card.id)', 'count')
      .andWhere('set.code IS NOT NULL')
      .groupBy('set.code')
      .addGroupBy('set.name')
      .orderBy('count', 'DESC')
      .limit(20)
      .getRawMany()

    facets.sets = setResults.map(result => ({
      value: result.code,
      label: result.name,
      count: parseInt(result.count)
    }))

    // Calculate colors facets (MTG specific)
    const colorQuery = baseQueryBuilder.clone()
      .andWhere('game.code = :gameCode', { gameCode: 'MTG' })
    
    const gamesArray = games ? (Array.isArray(games) ? games : [games]) : []
    if (gamesArray.length > 0 && !gamesArray.includes('MTG')) {
      // If MTG is not in the games filter, don't show colors
      facets.colors = []
    } else {
      if (types) {
        const typeArray = Array.isArray(types) ? types : [types]
        colorQuery.andWhere('card.primaryType IN (:...types)', { types: typeArray })
      }
      if (rarities) {
        const rarityArray = Array.isArray(rarities) ? rarities : [rarities]
        colorQuery.andWhere('prints.rarity IN (:...rarities)', { rarities: rarityArray })
      }

      // For colors, use raw SQL for array handling
      try {
        const colorResults = await AppDataSource.query(`
          SELECT 
            color_value as color,
            COUNT(DISTINCT card.id) as count
          FROM (
            SELECT 
              card.id,
              unnest(card.colors) as color_value
            FROM cards card
            LEFT JOIN games game ON card."gameId" = game.id
            WHERE card.deleted_at IS NULL 
              AND game.code = 'MTG'
              AND card.colors IS NOT NULL
              AND array_length(card.colors, 1) > 0
          ) color_expanded
          LEFT JOIN cards card ON card.id = color_expanded.id
          LEFT JOIN games game ON card."gameId" = game.id
          LEFT JOIN prints ON prints."cardId" = card.id
          LEFT JOIN card_sets "set" ON prints."setId" = "set".id
          WHERE game.code = 'MTG'
          ${types ? 'AND card.primary_type = ANY($1)' : ''}
          ${rarities && types ? 'AND prints.rarity = ANY($2)' : rarities ? 'AND prints.rarity = ANY($1)' : ''}
          GROUP BY color_value
          ORDER BY count DESC
        `, [
          ...(types ? [Array.isArray(types) ? types : [types]] : []),
          ...(rarities ? [Array.isArray(rarities) ? rarities : [rarities]] : [])
        ])

        const colorMap: Record<string, string> = {
          'W': 'White',
          'U': 'Blue', 
          'B': 'Black',
          'R': 'Red',
          'G': 'Green'
        }

        facets.colors = colorResults.map((result: any) => ({
          value: result.color,
          label: colorMap[result.color] || result.color,
          count: parseInt(result.count)
        }))
      } catch (colorError) {
        console.error('Error calculating color facets:', colorError)
        facets.colors = []
      }
    }

    debugLog('Calculated facets:', {
      games: facets.games.length,
      types: facets.types.length,
      rarities: facets.rarities.length,
      sets: facets.sets.length,
      colors: facets.colors.length
    })

    // Return just the facets object for frontend compatibility
    res.json(facets)
  } catch (error) {
    console.error('Error calculating facets:', error)
    console.error('Error stack:', (error as Error).stack)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to calculate facets',
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