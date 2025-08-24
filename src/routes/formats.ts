import { Router } from 'express'
import { AppDataSource } from '../config/database'
import { Format } from '../entities/Format'
import { Game } from '../entities/Game'
import { validateUUID } from '../middleware/validation'

const router = Router()

// Get all formats
router.get('/', async (req, res) => {
  try {
    const { game } = req.query
    
    const formatRepository = AppDataSource.getRepository(Format)
    const queryBuilder = formatRepository
      .createQueryBuilder('format')
      .leftJoinAndSelect('format.game', 'game')
      .orderBy('format.name', 'ASC')
    
    if (game) {
      queryBuilder.andWhere('game.code = :gameCode', { gameCode: game })
    }
    
    const formats = await queryBuilder.getMany()
    
    res.json(formats)
  } catch (error) {
    console.error('Error fetching formats:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch formats',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Get format by ID
router.get('/:id', validateUUID('id'), async (req, res) => {
  try {
    const formatRepository = AppDataSource.getRepository(Format)
    const format = await formatRepository.findOne({
      where: { id: req.params.id },
      relations: ['game']
    })

    if (!format) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Format not found',
          timestamp: new Date().toISOString()
        }
      })
    }

    res.json(format)
  } catch (error) {
    console.error('Error fetching format:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch format',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// Get format by game and format name
router.get('/:game/:format', async (req, res) => {
  try {
    const { game, format: formatName } = req.params
    
    // First get the game
    const gameRepository = AppDataSource.getRepository(Game)
    const gameEntity = await gameRepository.findOne({
      where: { code: game.toUpperCase() }
    })
    
    if (!gameEntity) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'GAME_NOT_FOUND',
          message: 'Game not found',
          timestamp: new Date().toISOString()
        }
      })
    }
    
    // Find the format - try both code and name fields (case insensitive)
    const formatRepository = AppDataSource.getRepository(Format)
    let formatEntity = await formatRepository.findOne({
      where: { 
        gameId: gameEntity.id,
        code: formatName.toLowerCase()
      },
      relations: ['game']
    })
    
    // If not found by code, try by name
    if (!formatEntity) {
      formatEntity = await formatRepository.findOne({
        where: { 
          gameId: gameEntity.id,
          name: formatName
        },
        relations: ['game']
      })
    }
    
    if (!formatEntity) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FORMAT_NOT_FOUND',
          message: `Format '${formatName}' not found for game '${game}'`,
          timestamp: new Date().toISOString()
        }
      })
    }
    
    // Return format with rules structure that matches frontend expectations
    const formatResponse = {
      id: formatEntity.id,
      code: formatEntity.code,
      name: formatEntity.name,
      gameId: formatEntity.gameId,
      game: {
        id: formatEntity.game.id,
        code: formatEntity.game.code,
        name: formatEntity.game.name
      },
      rules: {
        minDeckSize: formatEntity.minDeckSize,
        maxDeckSize: formatEntity.maxDeckSize,
        maxCopies: formatEntity.maxCopiesPerCard || 4,
        allowsSideboard: formatEntity.allowsSideboard,
        maxSideboardSize: formatEntity.maxSideboardSize,
        bannedCardTypes: formatEntity.bannedCardTypes || [],
        requiredCardTypes: formatEntity.requiredCardTypes || [],
        specialRules: formatEntity.specialRules || {},
        // Format-specific derived rules
        requiresCommander: formatEntity.code === 'commander' || formatEntity.code === 'brawl' || 
                          (formatEntity.specialRules && formatEntity.specialRules.commanderRequired),
        hasSideboard: formatEntity.allowsSideboard,
        sideboardSize: formatEntity.allowsSideboard ? formatEntity.maxSideboardSize : 0
      }
    }
    
    res.json(formatResponse)
  } catch (error) {
    console.error('Error fetching format rules:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch format rules',
        timestamp: new Date().toISOString()
      }
    })
  }
})

export default router