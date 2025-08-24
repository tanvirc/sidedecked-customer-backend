import { AppDataSource } from '../config/database'
import { Deck } from '../entities/Deck'
import { DeckCard } from '../entities/DeckCard'
import { Format } from '../entities/Format'
import { Game } from '../entities/Game'
import { Card } from '../entities/Card'

export interface ValidationError {
  code: string
  message: string
  severity: 'error' | 'warning' | 'info'
  zone?: string
  cardId?: string
  suggestion?: string
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
  info: ValidationError[]
  summary: {
    totalCards: number
    mainDeckSize: number
    sideboardSize: number
    commanderSize?: number
    extraDeckSize?: number
    leaderSize?: number
    donDeckSize?: number
    prizeCardCount?: number
  }
}

export interface DeckCardData {
  cardId: string
  quantity: number
  zone: string
  card?: {
    id: string
    name: string
    primaryType?: string
    manaCost?: string
    colorIdentity?: string[]
    // Game-specific fields
    hp?: number // Pokemon
    attribute?: string // Yu-Gi-Oh
    levelRank?: number // Yu-Gi-Oh level/rank
    colors?: string[] // One Piece
    // Note: rarity is stored on Print entity, not Card
  }
}

export class DeckValidationService {
  private formatRepository = AppDataSource.getRepository(Format)
  private gameRepository = AppDataSource.getRepository(Game)
  private deckRepository = AppDataSource.getRepository(Deck)
  private deckCardRepository = AppDataSource.getRepository(DeckCard)

  /**
   * Validate a complete deck against its format rules
   */
  async validateDeck(deckId: string): Promise<ValidationResult> {
    const deck = await this.deckRepository.findOne({
      where: { id: deckId },
      relations: ['game']
    })

    if (!deck) {
      return {
        isValid: false,
        errors: [{ code: 'DECK_NOT_FOUND', message: 'Deck not found', severity: 'error' }],
        warnings: [],
        info: [],
        summary: { totalCards: 0, mainDeckSize: 0, sideboardSize: 0 }
      }
    }

    // Get format if specified
    let format: Format | null = null
    if (deck.formatId) {
      format = await this.formatRepository.findOne({ where: { id: deck.formatId } })
    }

    // Get deck cards
    const deckCards = await this.deckCardRepository.find({
      where: { deckId },
      relations: ['card']
    })

    const cardData: DeckCardData[] = deckCards.map(dc => ({
      cardId: dc.cardId,
      quantity: dc.quantity,
      zone: dc.zone,
      card: dc.card ? {
        id: dc.card.id,
        name: dc.card.name,
        primaryType: dc.card.primaryType,
        manaCost: dc.card.manaCost,
        colorIdentity: dc.card.colorIdentity,
        hp: dc.card.hp,
        attribute: dc.card.attribute,
        levelRank: dc.card.levelRank,
        colors: dc.card.colors
      } : undefined
    }))

    return this.validateDeckStructure(cardData, deck.game!, format)
  }

  /**
   * Validate deck structure against format rules
   */
  async validateDeckStructure(
    cards: DeckCardData[], 
    game: Game, 
    format?: Format | null
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = []
    const warnings: ValidationError[] = []
    const info: ValidationError[] = []

    // Group cards by zone
    const cardsByZone = this.groupCardsByZone(cards)

    // Calculate summary
    const summary = this.calculateDeckSummary(cardsByZone)

    // If no format is specified, only do basic validation
    if (!format) {
      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        info: [{ code: 'NO_FORMAT', message: 'No format specified - basic validation only', severity: 'info' }],
        summary
      }
    }

    // Game-specific validation
    switch (game.code) {
      case 'MTG':
        this.validateMTGDeck(cardsByZone, format, errors, warnings, info)
        break
      case 'POKEMON':
        this.validatePokemonDeck(cardsByZone, format, errors, warnings, info)
        break
      case 'YUGIOH':
        this.validateYuGiOhDeck(cardsByZone, format, errors, warnings, info)
        break
      case 'OPTCG':
        this.validateOnePieceDeck(cardsByZone, format, errors, warnings, info)
        break
    }

    // General format validation
    this.validateGeneralRules(cardsByZone, format, errors, warnings, info)

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      info,
      summary
    }
  }

  private groupCardsByZone(cards: DeckCardData[]): Record<string, DeckCardData[]> {
    return cards.reduce((zones, card) => {
      const zone = card.zone || 'main'
      if (!zones[zone]) zones[zone] = []
      zones[zone].push(card)
      return zones
    }, {} as Record<string, DeckCardData[]>)
  }

  private calculateDeckSummary(cardsByZone: Record<string, DeckCardData[]>) {
    const summary = {
      totalCards: 0,
      mainDeckSize: 0,
      sideboardSize: 0,
      commanderSize: 0,
      extraDeckSize: 0,
      leaderSize: 0,
      donDeckSize: 0,
      prizeCardCount: 0
    }

    Object.entries(cardsByZone).forEach(([zone, cards]) => {
      const zoneSize = cards.reduce((sum, card) => sum + card.quantity, 0)
      summary.totalCards += zoneSize

      switch (zone) {
        case 'main':
          summary.mainDeckSize = zoneSize
          break
        case 'sideboard':
          summary.sideboardSize = zoneSize
          break
        case 'commander':
          summary.commanderSize = zoneSize
          break
        case 'extra':
          summary.extraDeckSize = zoneSize
          break
        case 'leader':
          summary.leaderSize = zoneSize
          break
        case 'don':
          summary.donDeckSize = zoneSize
          break
        case 'prize':
          summary.prizeCardCount = zoneSize
          break
      }
    })

    return summary
  }

  private validateGeneralRules(
    cardsByZone: Record<string, DeckCardData[]>,
    format: Format,
    errors: ValidationError[],
    warnings: ValidationError[],
    info: ValidationError[]
  ) {
    const mainDeck = cardsByZone.main || []
    const sideboard = cardsByZone.sideboard || []
    
    const mainDeckSize = mainDeck.reduce((sum, card) => sum + card.quantity, 0)
    const sideboardSize = sideboard.reduce((sum, card) => sum + card.quantity, 0)

    // Main deck size validation
    if (format.minDeckSize && mainDeckSize < format.minDeckSize) {
      errors.push({
        code: 'DECK_TOO_SMALL',
        message: `Main deck must have at least ${format.minDeckSize} cards (currently ${mainDeckSize})`,
        severity: 'error',
        zone: 'main'
      })
    }

    if (format.maxDeckSize && mainDeckSize > format.maxDeckSize) {
      errors.push({
        code: 'DECK_TOO_LARGE',
        message: `Main deck cannot exceed ${format.maxDeckSize} cards (currently ${mainDeckSize})`,
        severity: 'error',
        zone: 'main'
      })
    }

    // Sideboard validation
    if (!format.allowsSideboard && sideboardSize > 0) {
      errors.push({
        code: 'SIDEBOARD_NOT_ALLOWED',
        message: `Sideboard not allowed in ${format.name} format`,
        severity: 'error',
        zone: 'sideboard'
      })
    }

    if (format.allowsSideboard && sideboardSize > format.maxSideboardSize) {
      errors.push({
        code: 'SIDEBOARD_TOO_LARGE',
        message: `Sideboard cannot exceed ${format.maxSideboardSize} cards (currently ${sideboardSize})`,
        severity: 'error',
        zone: 'sideboard'
      })
    }

    // Card copy limits
    const allCards = [...mainDeck, ...sideboard]
    const cardCounts = new Map<string, number>()
    
    allCards.forEach(card => {
      const current = cardCounts.get(card.cardId) || 0
      cardCounts.set(card.cardId, current + card.quantity)
    })

    cardCounts.forEach((count, cardId) => {
      if (format.isSingleton && count > 1) {
        const card = allCards.find(c => c.cardId === cardId)
        errors.push({
          code: 'SINGLETON_VIOLATION',
          message: `Only 1 copy allowed in ${format.name} format (${card?.card?.name || 'Unknown'}: ${count} copies)`,
          severity: 'error',
          cardId
        })
      } else if (count > format.maxCopiesPerCard) {
        const card = allCards.find(c => c.cardId === cardId)
        errors.push({
          code: 'TOO_MANY_COPIES',
          message: `Maximum ${format.maxCopiesPerCard} copies allowed (${card?.card?.name || 'Unknown'}: ${count} copies)`,
          severity: 'error',
          cardId
        })
      }
    })
  }

  private validateMTGDeck(
    cardsByZone: Record<string, DeckCardData[]>,
    format: Format,
    errors: ValidationError[],
    warnings: ValidationError[],
    info: ValidationError[]
  ) {
    const commander = cardsByZone.commander || []

    // Commander format specific rules
    if (format.code === 'commander') {
      if (commander.length === 0) {
        errors.push({
          code: 'MISSING_COMMANDER',
          message: 'Commander format requires a commander card',
          severity: 'error',
          zone: 'commander'
        })
      } else if (commander.length > 1) {
        errors.push({
          code: 'TOO_MANY_COMMANDERS',
          message: 'Commander format allows only 1 commander',
          severity: 'error',
          zone: 'commander'
        })
      } else {
        const commanderCard = commander[0]
        if (commanderCard.card && !commanderCard.card.primaryType?.includes('Legendary')) {
          errors.push({
            code: 'INVALID_COMMANDER',
            message: 'Commander must be a legendary creature',
            severity: 'error',
            zone: 'commander',
            cardId: commanderCard.cardId
          })
        }
      }

      // Color identity validation for Commander
      if (commander.length === 1) {
        const commanderColorIdentity = commander[0].card?.colorIdentity || []
        const mainDeck = cardsByZone.main || []
        
        mainDeck.forEach(card => {
          const cardColors = card.card?.colorIdentity || []
          const hasInvalidColor = cardColors.some(color => !commanderColorIdentity.includes(color))
          
          if (hasInvalidColor) {
            errors.push({
              code: 'COLOR_IDENTITY_VIOLATION',
              message: `Card color identity doesn't match commander (${card.card?.name})`,
              severity: 'error',
              cardId: card.cardId,
              suggestion: 'Remove card or change commander'
            })
          }
        })
      }
    }

    // Pauper format - commons only
    // TODO: Implement rarity validation when Print entity is available in deck validation
    // Rarity information is stored on Print entity, not Card entity
    if (format.rarityRestrictions?.includes('common')) {
      info.push({
        code: 'RARITY_VALIDATION_PENDING',
        message: 'Pauper format rarity validation requires Print entity integration - validation deferred',
        severity: 'info'
      })
    }
  }

  private validatePokemonDeck(
    cardsByZone: Record<string, DeckCardData[]>,
    format: Format,
    errors: ValidationError[],
    warnings: ValidationError[],
    info: ValidationError[]
  ) {
    // Pokemon prize card system
    if (format.prizeCardCount && format.prizeCardCount > 0) {
      info.push({
        code: 'PRIZE_CARD_INFO',
        message: `This format uses ${format.prizeCardCount} prize cards`,
        severity: 'info'
      })
    }

    // GLC format specific rules
    if (format.code === 'glc') {
      const mainDeck = cardsByZone.main || []
      const pokemonTypes = new Set<string>()
      
      mainDeck.forEach(card => {
        if (card.card?.primaryType?.includes('Pokémon')) {
          // Extract Pokemon type - this would need actual card data
          // For now, just validate that all Pokemon share a type
          if (card.card.primaryType) {
            // This is simplified - real implementation would parse Pokemon types
            pokemonTypes.add(card.card.primaryType)
          }
        }
      })

      if (pokemonTypes.size > 1) {
        errors.push({
          code: 'TYPE_RESTRICTION_VIOLATION',
          message: 'GLC format requires all Pokémon to share a single type',
          severity: 'error',
          suggestion: 'Choose Pokémon of only one type'
        })
      }

      // Rule Box Pokemon check
      mainDeck.forEach(card => {
        if (card.card?.name?.includes('ex') || card.card?.name?.includes('V') || 
            card.card?.name?.includes('GX') || card.card?.name?.includes('EX')) {
          errors.push({
            code: 'BANNED_CARD_TYPE',
            message: `Rule Box Pokémon not allowed in GLC format (${card.card?.name})`,
            severity: 'error',
            cardId: card.cardId
          })
        }
      })
    }

    // Standard format regulation marks
    if (format.code === 'standard' && format.regulationMarks && format.regulationMarks.length > 0) {
      info.push({
        code: 'REGULATION_MARKS',
        message: `Standard format currently allows regulation marks: ${format.regulationMarks.join(', ')}`,
        severity: 'info'
      })
    }
  }

  private validateYuGiOhDeck(
    cardsByZone: Record<string, DeckCardData[]>,
    format: Format,
    errors: ValidationError[],
    warnings: ValidationError[],
    info: ValidationError[]
  ) {
    const extraDeck = cardsByZone.extra || []
    const extraDeckSize = extraDeck.reduce((sum, card) => sum + card.quantity, 0)

    // Extra Deck validation
    if (format.extraDeckRequired && extraDeckSize === 0) {
      warnings.push({
        code: 'NO_EXTRA_DECK',
        message: 'Consider adding an Extra Deck for more strategic options',
        severity: 'warning',
        zone: 'extra'
      })
    }

    if (extraDeckSize > format.maxExtraDeckSize) {
      errors.push({
        code: 'EXTRA_DECK_TOO_LARGE',
        message: `Extra Deck cannot exceed ${format.maxExtraDeckSize} cards (currently ${extraDeckSize})`,
        severity: 'error',
        zone: 'extra'
      })
    }

    // Extra Deck card type validation
    extraDeck.forEach(card => {
      const validExtraTypes = ['Fusion', 'Synchro', 'Xyz', 'Pendulum', 'Link']
      const cardType = card.card?.primaryType || ''
      
      if (!validExtraTypes.some(type => cardType.includes(type))) {
        errors.push({
          code: 'INVALID_EXTRA_DECK_CARD',
          message: `Card cannot be in Extra Deck (${card.card?.name}: ${cardType})`,
          severity: 'error',
          zone: 'extra',
          cardId: card.cardId
        })
      }
    })

    // Rush Duel specific rules
    if (format.code === 'rush') {
      info.push({
        code: 'RUSH_DUEL_RULES',
        message: 'Rush Duel format: Draw until 5 cards, multiple Normal Summons allowed',
        severity: 'info'
      })

      // Legend Card restriction - deferred until Print entity integration
      // TODO: Implement Legend card validation when Print entity is available
      info.push({
        code: 'LEGEND_CARD_VALIDATION_PENDING', 
        message: 'Rush Duel Legend card validation requires Print entity integration - validation deferred',
        severity: 'info'
      })
    }
  }

  private validateOnePieceDeck(
    cardsByZone: Record<string, DeckCardData[]>,
    format: Format,
    errors: ValidationError[],
    warnings: ValidationError[],
    info: ValidationError[]
  ) {
    const leader = cardsByZone.leader || []
    const donDeck = cardsByZone.don || []
    const mainDeck = cardsByZone.main || []

    // Leader card validation
    if (format.leaderRequired) {
      if (leader.length === 0) {
        errors.push({
          code: 'MISSING_LEADER',
          message: 'One Piece format requires a leader card',
          severity: 'error',
          zone: 'leader'
        })
      } else if (leader.length > 1) {
        errors.push({
          code: 'TOO_MANY_LEADERS',
          message: 'Only 1 leader card allowed',
          severity: 'error',
          zone: 'leader'
        })
      }
    }

    // DON!! deck validation
    if (format.donDeckSize > 0) {
      const donDeckSize = donDeck.reduce((sum, card) => sum + card.quantity, 0)
      
      if (donDeckSize !== format.donDeckSize) {
        errors.push({
          code: 'INVALID_DON_DECK_SIZE',
          message: `DON!! deck must have exactly ${format.donDeckSize} cards (currently ${donDeckSize})`,
          severity: 'error',
          zone: 'don'
        })
      }
    }

    // Color restriction validation
    if (leader.length === 1) {
      const leaderColors = leader[0].card?.colors || []
      
      mainDeck.forEach(card => {
        const cardColors = card.card?.colors || []
        const hasMatchingColor = cardColors.length === 0 || // Colorless cards allowed
          cardColors.some(color => leaderColors.includes(color))
        
        if (!hasMatchingColor) {
          errors.push({
            code: 'COLOR_RESTRICTION_VIOLATION',
            message: `Card color doesn't match leader (${card.card?.name})`,
            severity: 'error',
            cardId: card.cardId,
            suggestion: 'Use cards that match your leader\'s colors'
          })
        }
      })
    }

    // Block rotation info
    if (format.specialRules?.blockRotation) {
      info.push({
        code: 'BLOCK_ROTATION_INFO',
        message: 'Annual block rotation starts April 2026',
        severity: 'info'
      })
    }
  }

  /**
   * Get format-specific deck building suggestions
   */
  async getFormatSuggestions(formatCode: string, gameCode: string): Promise<string[]> {
    const suggestions: string[] = []

    switch (gameCode) {
      case 'MTG':
        switch (formatCode) {
          case 'commander':
            suggestions.push(
              'Start with a legendary commander that defines your strategy',
              'Include ramp cards to accelerate your mana',
              'Add board wipes and removal for multiplayer games',
              'Consider your commander\'s color identity for all cards'
            )
            break
          case 'standard':
            suggestions.push(
              'Focus on recent sets for card legality',
              'Build around powerful synergies and themes',
              'Include efficient removal and counterspells',
              'Consider the current meta game'
            )
            break
        }
        break
        
      case 'POKEMON':
        switch (formatCode) {
          case 'glc':
            suggestions.push(
              'Choose a single type and build around type synergies',
              'Avoid Rule Box Pokémon (ex, V, GX, EX)',
              'Include draw power and energy acceleration',
              'Focus on consistency over power level'
            )
            break
        }
        break

      case 'YUGIOH':
        suggestions.push(
          'Include hand traps for disruption',
          'Build a consistent combo or control strategy',
          'Consider the current banlist restrictions',
          'Balance monster, spell, and trap ratios'
        )
        break

      case 'OPTCG':
        suggestions.push(
          'Choose a leader that supports your strategy',
          'Build around your leader\'s color(s)',
          'Include DON!! acceleration and card draw',
          'Balance offense and defense for life system'
        )
        break
    }

    return suggestions
  }
}

export const deckValidationService = new DeckValidationService()