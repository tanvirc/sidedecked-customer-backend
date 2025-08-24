import { Router, Request, Response } from 'express'
import { AppDataSource } from '../config/database'
import { Deck } from '../entities/Deck'
import { DeckCard } from '../entities/DeckCard'
import { Card } from '../entities/Card'
import { Game } from '../entities/Game'
import { CatalogSKU } from '../entities/CatalogSKU'

const router = Router()

interface CreateDeckRequest {
  name: string
  userId: string
  gameId: string
  formatId?: string
}

interface AddCardToDeckRequest {
  cardId: string
  catalogSku: string
  quantity?: number
}

// Get all public decks
router.get('/public', async (req: Request, res: Response) => {
  try {
    const { game, format, sort = 'newest', page = '1', limit = '20' } = req.query

    const deckRepository = AppDataSource.getRepository(Deck)
    const query = deckRepository.createQueryBuilder('deck')
      .leftJoinAndSelect('deck.game', 'game')
      .leftJoin('deck.cards', 'deckCard')
      .addSelect('COUNT(deckCard.id)', 'cardCount')
      .where('deck.isPublic = :isPublic', { isPublic: true })
      .groupBy('deck.id, game.id')

    // Apply filters
    if (game) {
      if (Array.isArray(game)) {
        query.andWhere('game.code IN (:...gameCodes)', { gameCodes: game })
      } else {
        query.andWhere('game.code = :gameCode', { gameCode: game })
      }
    }

    if (format) {
      query.andWhere('deck.formatId = :formatId', { formatId: format })
    }

    // Apply sorting
    switch (sort) {
      case 'newest':
        query.orderBy('deck.createdAt', 'DESC')
        break
      case 'updated':
        query.orderBy('deck.updatedAt', 'DESC')
        break
      case 'popular':
        query.orderBy('deck.likes', 'DESC')
        break
      case 'views':
        query.orderBy('deck.views', 'DESC')
        break
      case 'value':
        query.orderBy('deck.totalValue', 'DESC')
        break
      default:
        query.orderBy('deck.createdAt', 'DESC')
    }

    // Apply pagination
    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    query.skip((pageNum - 1) * limitNum).take(limitNum)

    const decks = await query.getRawAndEntities()
    
    const formattedDecks = decks.entities.map((deck, index) => ({
      id: deck.id,
      name: deck.name,
      description: deck.description,
      game: deck.game?.code || 'UNKNOWN',
      gameName: deck.game?.displayName || 'Unknown',
      formatId: deck.formatId,
      isPublic: deck.isPublic,
      author: {
        id: deck.userId,
        name: 'User' // TODO: Join with user table when available
      },
      stats: {
        totalCards: parseInt(decks.raw[index]?.cardCount) || 0,
        likes: deck.likes,
        views: deck.views,
        copies: deck.copies
      },
      pricing: {
        totalValue: parseFloat(deck.totalValue?.toString() || '0')
      },
      tags: deck.tags || [],
      coverCardId: deck.coverCardId,
      coverImageUrl: deck.coverImageUrl,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt
    }))

    // Get total count for pagination
    const totalCount = await deckRepository.createQueryBuilder('deck')
      .where('deck.isPublic = :isPublic', { isPublic: true })
      .getCount()

    res.json({
      success: true,
      data: {
        decks: formattedDecks,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limitNum)
        }
      }
    })
  } catch (error) {
    console.error('Error fetching public decks:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch public decks',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Get all decks for a user
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params
    const { game } = req.query

    const deckRepository = AppDataSource.getRepository(Deck)
    const query = deckRepository.createQueryBuilder('deck')
      .leftJoinAndSelect('deck.game', 'game')
      .leftJoin('deck.cards', 'deckCard')
      .addSelect('COUNT(deckCard.id)', 'cardCount')
      .where('deck.userId = :userId', { userId })
      .groupBy('deck.id, game.id')
      .orderBy('deck.updatedAt', 'DESC')

    if (game) {
      query.andWhere('game.code = :gameCode', { gameCode: game })
    }

    const decks = await query.getRawAndEntities()
    
    const formattedDecks = decks.entities.map((deck, index) => ({
      id: deck.id,
      name: deck.name,
      gameCode: deck.gameId ? decks.raw[index]?.game_code : null,
      gameName: deck.gameId ? decks.raw[index]?.game_displayName : null,
      formatId: deck.formatId,
      cardCount: parseInt(decks.raw[index]?.cardCount) || 0,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt
    }))

    res.json({
      success: true,
      data: {
        decks: formattedDecks,
        total: formattedDecks.length
      }
    })
  } catch (error) {
    console.error('Error fetching user decks:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch decks',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Get a specific deck with its cards
router.get('/:deckId', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params

    const deckRepository = AppDataSource.getRepository(Deck)
    const deck = await deckRepository.findOne({
      where: { id: deckId },
      relations: ['game']
    })

    if (!deck) {
      return res.status(404).json({
        success: false,
        message: 'Deck not found'
      })
    }

    // Get deck cards with card details
    const deckCardRepository = AppDataSource.getRepository(DeckCard)
    const deckCards = await deckCardRepository.find({
      where: { deckId },
      relations: ['card', 'card.game'],
      order: { createdAt: 'ASC' }
    })

    res.json({
      success: true,
      data: {
        deck: {
          ...deck,
          cards: deckCards.map(dc => ({
            id: dc.id,
            quantity: dc.quantity,
            catalogSku: dc.catalogSku,
            card: dc.card,
            addedAt: dc.createdAt
          })),
          cardCount: deckCards.reduce((sum, dc) => sum + dc.quantity, 0)
        }
      }
    })
  } catch (error) {
    console.error('Error fetching deck:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch deck',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Create a new deck
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, userId, gameId, formatId }: CreateDeckRequest = req.body

    if (!name || !userId || !gameId) {
      return res.status(400).json({
        success: false,
        message: 'Name, userId, and gameId are required'
      })
    }

    // Verify game exists
    const gameRepository = AppDataSource.getRepository(Game)
    const game = await gameRepository.findOne({ where: { id: gameId } })

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      })
    }

    const deckRepository = AppDataSource.getRepository(Deck)
    const deck = deckRepository.create({
      name: name.trim(),
      userId,
      gameId,
      formatId
    })

    const savedDeck = await deckRepository.save(deck)

    res.status(201).json({
      success: true,
      data: {
        deck: {
          ...savedDeck,
          gameCode: game.code,
          gameName: game.displayName,
          cardCount: 0
        }
      }
    })
  } catch (error) {
    console.error('Error creating deck:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to create deck',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Add a card to a deck
router.post('/:deckId/cards', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params
    const { cardId, catalogSku, quantity = 1 }: AddCardToDeckRequest = req.body

    if (!cardId && !catalogSku) {
      return res.status(400).json({
        success: false,
        message: 'Either cardId or catalogSku is required'
      })
    }

    // Verify deck exists
    const deckRepository = AppDataSource.getRepository(Deck)
    const deck = await deckRepository.findOne({ where: { id: deckId } })

    if (!deck) {
      return res.status(404).json({
        success: false,
        message: 'Deck not found'
      })
    }

    let card: Card | null = null

    if (cardId) {
      const cardRepository = AppDataSource.getRepository(Card)
      card = await cardRepository.findOne({ where: { id: cardId } })
    } else if (catalogSku) {
      // Find card by catalog SKU through the CatalogSKU entity
      const catalogSkuRepository = AppDataSource.getRepository(CatalogSKU)
      const catalogSkuRecord = await catalogSkuRepository.findOne({
        where: { sku: catalogSku },
        relations: ['print', 'print.card']
      })
      
      if (catalogSkuRecord) {
        card = catalogSkuRecord.print.card
      }
    }

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Card not found'
      })
    }

    // Check if card is already in deck
    const deckCardRepository = AppDataSource.getRepository(DeckCard)
    let deckCard = await deckCardRepository.findOne({
      where: { deckId, cardId: card.id }
    })

    if (deckCard) {
      // Update quantity
      deckCard.quantity += quantity
      await deckCardRepository.save(deckCard)
    } else {
      // Add new card to deck
      deckCard = deckCardRepository.create({
        deckId,
        cardId: card.id,
        catalogSku: catalogSku || '',
        quantity
      })
      await deckCardRepository.save(deckCard)
    }

    // Update deck's updatedAt
    deck.updatedAt = new Date()
    await deckRepository.save(deck)

    res.json({
      success: true,
      data: {
        deckCard: {
          ...deckCard,
          card
        }
      }
    })
  } catch (error) {
    console.error('Error adding card to deck:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to add card to deck',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Remove a card from a deck
router.delete('/:deckId/cards/:cardId', async (req: Request, res: Response) => {
  try {
    const { deckId, cardId } = req.params
    const { quantity } = req.query

    const deckCardRepository = AppDataSource.getRepository(DeckCard)
    const deckCard = await deckCardRepository.findOne({
      where: { deckId, cardId }
    })

    if (!deckCard) {
      return res.status(404).json({
        success: false,
        message: 'Card not found in deck'
      })
    }

    if (quantity && parseInt(quantity as string) < deckCard.quantity) {
      // Reduce quantity
      deckCard.quantity -= parseInt(quantity as string)
      await deckCardRepository.save(deckCard)
    } else {
      // Remove card entirely
      await deckCardRepository.remove(deckCard)
    }

    // Update deck's updatedAt
    const deckRepository = AppDataSource.getRepository(Deck)
    await deckRepository.update({ id: deckId }, { updatedAt: new Date() })

    res.json({
      success: true,
      data: {
        message: 'Card removed from deck'
      }
    })
  } catch (error) {
    console.error('Error removing card from deck:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to remove card from deck',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Delete a deck
router.delete('/:deckId', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params

    const deckRepository = AppDataSource.getRepository(Deck)
    const deck = await deckRepository.findOne({ where: { id: deckId } })

    if (!deck) {
      return res.status(404).json({
        success: false,
        message: 'Deck not found'
      })
    }

    // Delete all deck cards first
    const deckCardRepository = AppDataSource.getRepository(DeckCard)
    await deckCardRepository.delete({ deckId })

    // Delete the deck
    await deckRepository.remove(deck)

    res.json({
      success: true,
      data: {
        message: 'Deck deleted successfully'
      }
    })
  } catch (error) {
    console.error('Error deleting deck:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to delete deck',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

export default router