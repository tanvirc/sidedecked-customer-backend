import { Router, Request, Response } from 'express'
import { AppDataSource } from '../config/database'
import { Format } from '../entities/Format'
import { Game } from '../entities/Game'
import { validateUUID } from '../middleware/validation'
import { createErrorResponse, ErrorCodes } from '../utils/error-response'

const router = Router()

interface FormatResponse {
  id: string
  code: string
  name: string
  gameId: string
  game: {
    id: string
    code: string
    name: string
    displayName: string
  }
  formatType: string
  isRotating: boolean
  rotationSchedule?: string
  rules: {
    minDeckSize: number
    maxDeckSize?: number
    maxCopiesPerCard: number
    allowsSideboard: boolean
    maxSideboardSize: number
    bannedCardTypes?: string[]
    requiredCardTypes?: string[]
    specialRules?: any
    // Game-specific rules
    leaderRequired: boolean
    leaderZoneSize: number
    donDeckSize: number
    prizeCardCount: number
    regulationMarks?: string[]
    restrictedCards?: string[]
    extraDeckRequired: boolean
    maxExtraDeckSize: number
    isSingleton: boolean
    typeRestricted: boolean
    rarityRestrictions?: string[]
  }
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

function formatToResponse(format: Format): FormatResponse {
  return {
    id: format.id,
    code: format.code,
    name: format.name,
    gameId: format.gameId,
    game: {
      id: format.game.id,
      code: format.game.code,
      name: format.game.name,
      displayName: format.game.displayName
    },
    formatType: format.formatType,
    isRotating: format.isRotating,
    rotationSchedule: format.rotationSchedule || undefined,
    rules: {
      minDeckSize: format.minDeckSize,
      maxDeckSize: format.maxDeckSize || undefined,
      maxCopiesPerCard: format.maxCopiesPerCard,
      allowsSideboard: format.allowsSideboard,
      maxSideboardSize: format.maxSideboardSize,
      bannedCardTypes: format.bannedCardTypes,
      requiredCardTypes: format.requiredCardTypes,
      specialRules: format.specialRules,
      // Game-specific rules
      leaderRequired: format.leaderRequired,
      leaderZoneSize: format.leaderZoneSize,
      donDeckSize: format.donDeckSize,
      prizeCardCount: format.prizeCardCount,
      regulationMarks: format.regulationMarks,
      restrictedCards: format.restrictedCards,
      extraDeckRequired: format.extraDeckRequired,
      maxExtraDeckSize: format.maxExtraDeckSize,
      isSingleton: format.isSingleton,
      typeRestricted: format.typeRestricted,
      rarityRestrictions: format.rarityRestrictions
    },
    isActive: format.isActive,
    createdAt: format.createdAt,
    updatedAt: format.updatedAt
  }
}

// Get all active formats, optionally filtered by game
router.get('/', async (req: Request, res: Response) => {
  try {
    const { game, includeInactive = 'false' } = req.query
    
    const formatRepository = AppDataSource.getRepository(Format)
    const queryBuilder = formatRepository
      .createQueryBuilder('format')
      .leftJoinAndSelect('format.game', 'game')
      .orderBy('game.displayName', 'ASC')
      .addOrderBy('format.name', 'ASC')
    
    // Only show active formats by default
    if (includeInactive !== 'true') {
      queryBuilder.andWhere('format.isActive = :isActive', { isActive: true })
    }
    
    // Filter by game if specified
    if (game) {
      if (typeof game === 'string') {
        queryBuilder.andWhere('game.code = :gameCode', { gameCode: game.toUpperCase() })
      } else if (Array.isArray(game)) {
        queryBuilder.andWhere('game.code IN (:...gameCodes)', { 
          gameCodes: game.map(g => String(g).toUpperCase()) 
        })
      }
    }
    
    const formats = await queryBuilder.getMany()
    
    const formattedFormats = formats.map(formatToResponse)
    
    res.json({
      success: true,
      data: {
        formats: formattedFormats,
        total: formattedFormats.length,
        metadata: {
          activeOnly: includeInactive !== 'true',
          gameFilter: game || null
        }
      }
    })
  } catch (error) {
    console.error('Error fetching formats:', error)
    res.status(500).json(createErrorResponse(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      'Failed to fetch formats',
      { error: error instanceof Error ? error.message : 'Unknown error' }
    ))
  }
})

// Get format by ID
router.get('/:id', validateUUID('id'), async (req: Request, res: Response) => {
  try {
    const formatRepository = AppDataSource.getRepository(Format)
    const format = await formatRepository.findOne({
      where: { id: req.params.id },
      relations: ['game']
    })

    if (!format) {
      return res.status(404).json(createErrorResponse(
        ErrorCodes.RESOURCE_NOT_FOUND,
        'Format not found',
        { formatId: req.params.id }
      ))
    }

    // Only return active formats unless specifically requested
    if (!format.isActive && req.query.includeInactive !== 'true') {
      return res.status(404).json(createErrorResponse(
        ErrorCodes.RESOURCE_NOT_FOUND,
        'Format not found',
        { formatId: req.params.id, reason: 'Format is inactive' }
      ))
    }

    const formattedResponse = formatToResponse(format)

    res.json({
      success: true,
      data: {
        format: formattedResponse
      }
    })
  } catch (error) {
    console.error('Error fetching format:', error)
    res.status(500).json(createErrorResponse(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      'Failed to fetch format',
      { error: error instanceof Error ? error.message : 'Unknown error' }
    ))
  }
})

// Get format by game and format code/name
router.get('/:game/:format', async (req: Request, res: Response) => {
  try {
    const { game, format: formatIdentifier } = req.params
    
    // First get the game
    const gameRepository = AppDataSource.getRepository(Game)
    const gameEntity = await gameRepository.findOne({
      where: { code: game.toUpperCase() }
    })
    
    if (!gameEntity) {
      return res.status(404).json(createErrorResponse(
        ErrorCodes.RESOURCE_NOT_FOUND,
        'Game not found',
        { gameCode: game.toUpperCase() }
      ))
    }
    
    // Find the format - try both code and name fields (case insensitive)
    const formatRepository = AppDataSource.getRepository(Format)
    let formatEntity = await formatRepository.findOne({
      where: { 
        gameId: gameEntity.id,
        code: formatIdentifier.toLowerCase(),
        isActive: true
      },
      relations: ['game']
    })
    
    // If not found by code, try by name (case insensitive)
    if (!formatEntity) {
      formatEntity = await formatRepository
        .createQueryBuilder('format')
        .leftJoinAndSelect('format.game', 'game')
        .where('format.gameId = :gameId', { gameId: gameEntity.id })
        .andWhere('LOWER(format.name) = LOWER(:name)', { name: formatIdentifier })
        .andWhere('format.isActive = :isActive', { isActive: true })
        .getOne()
    }
    
    if (!formatEntity) {
      return res.status(404).json(createErrorResponse(
        ErrorCodes.RESOURCE_NOT_FOUND,
        `Format '${formatIdentifier}' not found for game '${game}'`,
        { 
          gameCode: game,
          formatIdentifier,
          availableFormats: `Use GET /api/formats?game=${game} to see available formats`
        }
      ))
    }
    
    const formattedResponse = formatToResponse(formatEntity)
    
    res.json({
      success: true,
      data: {
        format: formattedResponse
      }
    })
  } catch (error) {
    console.error('Error fetching format:', error)
    res.status(500).json(createErrorResponse(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      'Failed to fetch format',
      { error: error instanceof Error ? error.message : 'Unknown error' }
    ))
  }
})

export default router