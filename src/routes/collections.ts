import { Router, Request, Response } from 'express'
import { AppDataSource } from '../config/database'
import { Collection } from '../entities/Collection'
import { CollectionCard } from '../entities/CollectionCard'
import { Card } from '../entities/Card'
import { CatalogSKU } from '../entities/CatalogSKU'

const router = Router()

interface CreateCollectionRequest {
  name: string
  userId: string
  description?: string
  isPublic?: boolean
  type?: 'personal' | 'wishlist' | 'trading' | 'showcase'
}

interface AddCardToCollectionRequest {
  cardId: string
  catalogSku: string
  quantity?: number
  condition?: 'M' | 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'
  language?: string
  isForTrade?: boolean
  notes?: string
  acquiredPrice?: number
  acquiredDate?: string
}

// Get all collections for a user
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params
    const { type, isPublic } = req.query

    const collectionRepository = AppDataSource.getRepository(Collection)
    const query = collectionRepository.createQueryBuilder('collection')
      .leftJoin('collection.cards', 'collectionCard')
      .addSelect('COUNT(collectionCard.id)', 'cardCount')
      .where('collection.userId = :userId', { userId })
      .groupBy('collection.id')
      .orderBy('collection.updatedAt', 'DESC')

    if (type) {
      query.andWhere('collection.type = :type', { type })
    }

    if (isPublic !== undefined) {
      query.andWhere('collection.isPublic = :isPublic', { isPublic: isPublic === 'true' })
    }

    const collections = await query.getRawAndEntities()
    
    const formattedCollections = collections.entities.map((collection, index) => ({
      id: collection.id,
      name: collection.name,
      description: collection.description,
      type: collection.type,
      isPublic: collection.isPublic,
      cardCount: parseInt(collections.raw[index]?.cardCount) || 0,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt
    }))

    res.json({
      success: true,
      data: {
        collections: formattedCollections,
        total: formattedCollections.length
      }
    })
  } catch (error) {
    console.error('Error fetching user collections:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch collections',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Get a specific collection with its cards
router.get('/:collectionId', async (req: Request, res: Response) => {
  try {
    const { collectionId } = req.params

    const collectionRepository = AppDataSource.getRepository(Collection)
    const collection = await collectionRepository.findOne({
      where: { id: collectionId }
    })

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      })
    }

    // Get collection cards with card details
    const collectionCardRepository = AppDataSource.getRepository(CollectionCard)
    const collectionCards = await collectionCardRepository.find({
      where: { collectionId },
      relations: ['card', 'card.game'],
      order: { createdAt: 'ASC' }
    })

    res.json({
      success: true,
      data: {
        collection: {
          ...collection,
          cards: collectionCards.map(cc => ({
            id: cc.id,
            quantity: cc.quantity,
            condition: cc.condition,
            language: cc.language,
            isForTrade: cc.isForTrade,
            notes: cc.notes,
            acquiredPrice: cc.acquiredPrice,
            acquiredDate: cc.acquiredDate,
            catalogSku: cc.catalogSku,
            card: cc.card,
            addedAt: cc.createdAt
          })),
          cardCount: collectionCards.reduce((sum, cc) => sum + cc.quantity, 0)
        }
      }
    })
  } catch (error) {
    console.error('Error fetching collection:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch collection',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Create a new collection
router.post('/', async (req: Request, res: Response) => {
  try {
    const { 
      name, 
      userId, 
      description, 
      isPublic = false, 
      type = 'personal' 
    }: CreateCollectionRequest = req.body

    if (!name || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Name and userId are required'
      })
    }

    const collectionRepository = AppDataSource.getRepository(Collection)
    const collection = collectionRepository.create({
      name: name.trim(),
      userId,
      description: description?.trim(),
      isPublic,
      type
    })

    const savedCollection = await collectionRepository.save(collection)

    res.status(201).json({
      success: true,
      data: {
        collection: {
          ...savedCollection,
          cardCount: 0
        }
      }
    })
  } catch (error) {
    console.error('Error creating collection:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to create collection',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Add a card to a collection
router.post('/:collectionId/cards', async (req: Request, res: Response) => {
  try {
    const { collectionId } = req.params
    const { 
      cardId, 
      catalogSku, 
      quantity = 1,
      condition = 'NM',
      language = 'EN',
      isForTrade = false,
      notes,
      acquiredPrice,
      acquiredDate
    }: AddCardToCollectionRequest = req.body

    if (!cardId && !catalogSku) {
      return res.status(400).json({
        success: false,
        message: 'Either cardId or catalogSku is required'
      })
    }

    // Verify collection exists
    const collectionRepository = AppDataSource.getRepository(Collection)
    const collection = await collectionRepository.findOne({ where: { id: collectionId } })

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
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

    // Check if card with same condition/language is already in collection
    const collectionCardRepository = AppDataSource.getRepository(CollectionCard)
    let collectionCard = await collectionCardRepository.findOne({
      where: { 
        collectionId, 
        cardId: card.id,
        condition,
        language
      }
    })

    if (collectionCard) {
      // Update quantity
      collectionCard.quantity += quantity
      if (notes) collectionCard.notes = notes
      if (acquiredPrice !== undefined) collectionCard.acquiredPrice = acquiredPrice
      if (acquiredDate) collectionCard.acquiredDate = new Date(acquiredDate)
      collectionCard.isForTrade = isForTrade
      await collectionCardRepository.save(collectionCard)
    } else {
      // Add new card to collection
      collectionCard = collectionCardRepository.create({
        collectionId,
        cardId: card.id,
        catalogSku: catalogSku || '',
        quantity,
        condition,
        language,
        isForTrade,
        notes,
        acquiredPrice,
        acquiredDate: acquiredDate ? new Date(acquiredDate) : undefined
      })
      await collectionCardRepository.save(collectionCard)
    }

    // Update collection's updatedAt
    collection.updatedAt = new Date()
    await collectionRepository.save(collection)

    res.json({
      success: true,
      data: {
        collectionCard: {
          ...collectionCard,
          card
        }
      }
    })
  } catch (error) {
    console.error('Error adding card to collection:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to add card to collection',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Remove a card from a collection
router.delete('/:collectionId/cards/:cardId', async (req: Request, res: Response) => {
  try {
    const { collectionId, cardId } = req.params
    const { quantity, condition, language } = req.query

    const collectionCardRepository = AppDataSource.getRepository(CollectionCard)
    
    const whereClause: any = { collectionId, cardId }
    if (condition) whereClause.condition = condition
    if (language) whereClause.language = language

    const collectionCard = await collectionCardRepository.findOne({
      where: whereClause
    })

    if (!collectionCard) {
      return res.status(404).json({
        success: false,
        message: 'Card not found in collection'
      })
    }

    if (quantity && parseInt(quantity as string) < collectionCard.quantity) {
      // Reduce quantity
      collectionCard.quantity -= parseInt(quantity as string)
      await collectionCardRepository.save(collectionCard)
    } else {
      // Remove card entirely
      await collectionCardRepository.remove(collectionCard)
    }

    // Update collection's updatedAt
    const collectionRepository = AppDataSource.getRepository(Collection)
    await collectionRepository.update({ id: collectionId }, { updatedAt: new Date() })

    res.json({
      success: true,
      data: {
        message: 'Card removed from collection'
      }
    })
  } catch (error) {
    console.error('Error removing card from collection:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to remove card from collection',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Update collection details
router.put('/:collectionId', async (req: Request, res: Response) => {
  try {
    const { collectionId } = req.params
    const { name, description, isPublic, type } = req.body

    const collectionRepository = AppDataSource.getRepository(Collection)
    const collection = await collectionRepository.findOne({ where: { id: collectionId } })

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      })
    }

    // Update fields
    if (name) collection.name = name.trim()
    if (description !== undefined) collection.description = description?.trim()
    if (isPublic !== undefined) collection.isPublic = isPublic
    if (type) collection.type = type
    collection.updatedAt = new Date()

    const savedCollection = await collectionRepository.save(collection)

    res.json({
      success: true,
      data: {
        collection: savedCollection
      }
    })
  } catch (error) {
    console.error('Error updating collection:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to update collection',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Delete a collection
router.delete('/:collectionId', async (req: Request, res: Response) => {
  try {
    const { collectionId } = req.params

    const collectionRepository = AppDataSource.getRepository(Collection)
    const collection = await collectionRepository.findOne({ where: { id: collectionId } })

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      })
    }

    // Delete all collection cards first (should cascade automatically, but being explicit)
    const collectionCardRepository = AppDataSource.getRepository(CollectionCard)
    await collectionCardRepository.delete({ collectionId })

    // Delete the collection
    await collectionRepository.remove(collection)

    res.json({
      success: true,
      data: {
        message: 'Collection deleted successfully'
      }
    })
  } catch (error) {
    console.error('Error deleting collection:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to delete collection',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

export default router