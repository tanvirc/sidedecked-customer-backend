import { AppDataSource } from '../config/database'
import { Card } from '../entities/Card'
import { Print } from '../entities/Print'
import { CardSet } from '../entities/CardSet'
import { Game } from '../entities/Game'
import { logger } from '../../packages/tcg-catalog/src/utils/Logger'

interface PrintVariationAnalysis {
  cardName: string
  gameName: string
  setName: string
  setCode: string
  totalPrints: number
  variations: {
    printId: string
    collectorNumber: string
    artist: string | null
    variation: string | null
    finish: string
    isAlternateArt: boolean
    isPromo: boolean
    frame: string | null
    borderColor: string | null
    language: string
    rarity: string | null
  }[]
  variationReasons: string[]
}

interface GameSummary {
  gameName: string
  totalCards: number
  cardsWithMultiplePrints: number
  totalPrintVariations: number
  commonVariationTypes: { [key: string]: number }
}

export class PrintVariationAnalyzer {
  
  async analyzePrintVariations(): Promise<{
    overallStats: {
      totalCards: number
      cardsWithMultiplePrints: number
      totalPrintVariations: number
      averagePrintsPerCard: number
    }
    gameBreakdown: GameSummary[]
    detailedExamples: PrintVariationAnalysis[]
    variationPatterns: { [pattern: string]: number }
  }> {
    await AppDataSource.initialize()

    try {
      logger.info('🔍 Starting print variation analysis...')

      // Get overall statistics
      const overallStats = await this.getOverallStats()
      logger.info('📊 Overall stats calculated', overallStats)

      // Get game-by-game breakdown
      const gameBreakdown = await this.getGameBreakdown()
      logger.info('🎮 Game breakdown completed', { gamesAnalyzed: gameBreakdown.length })

      // Get detailed examples of cards with multiple prints
      const detailedExamples = await this.getDetailedExamples(20)
      logger.info('📋 Detailed examples collected', { exampleCount: detailedExamples.length })

      // Analyze variation patterns
      const variationPatterns = await this.getVariationPatterns()
      logger.info('🔄 Variation patterns analyzed', { patternCount: Object.keys(variationPatterns).length })

      return {
        overallStats,
        gameBreakdown,
        detailedExamples,
        variationPatterns
      }

    } finally {
      await AppDataSource.destroy()
    }
  }

  private async getOverallStats() {
    // Get total unique cards
    const totalCards = await AppDataSource
      .getRepository(Card)
      .count()

    // Get cards with multiple prints in same set
    const cardsWithMultiplePrints = await AppDataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT c.id)', 'count')
      .from(Card, 'c')
      .innerJoin('c.prints', 'p')
      .innerJoin('p.set', 's')
      .groupBy('c.id, s.id')
      .having('COUNT(p.id) > 1')
      .getRawOne()

    // Get total print variations (prints beyond the first for each card)
    const totalPrintVariationsQuery = await AppDataSource
      .createQueryBuilder()
      .select('SUM(print_count - 1)', 'total_variations')
      .from(subQuery => {
        return subQuery
          .select('COUNT(p.id)', 'print_count')
          .from(Print, 'p')
          .innerJoin('p.card', 'c')
          .innerJoin('p.set', 's')
          .groupBy('c.id, s.id')
          .having('COUNT(p.id) > 1')
      }, 'variation_counts')
      .getRawOne()

    // Get total prints for average calculation
    const totalPrints = await AppDataSource
      .getRepository(Print)
      .count()

    return {
      totalCards,
      cardsWithMultiplePrints: parseInt(cardsWithMultiplePrints?.count || '0'),
      totalPrintVariations: parseInt(totalPrintVariationsQuery?.total_variations || '0'),
      averagePrintsPerCard: totalCards > 0 ? totalPrints / totalCards : 0
    }
  }

  private async getGameBreakdown(): Promise<GameSummary[]> {
    const games = await AppDataSource
      .getRepository(Game)
      .find()

    const gameBreakdown: GameSummary[] = []

    for (const game of games) {
      // Total cards for this game
      const totalCards = await AppDataSource
        .getRepository(Card)
        .count({ where: { gameId: game.id } })

      // Cards with multiple prints in same set for this game
      const cardsWithMultiplePrintsQuery = await AppDataSource
        .createQueryBuilder()
        .select('COUNT(*)', 'count')
        .from(subQuery => {
          return subQuery
            .select('c.id')
            .from(Card, 'c')
            .innerJoin('c.prints', 'p')
            .innerJoin('p.set', 's')
            .where('c.gameId = :gameId', { gameId: game.id })
            .groupBy('c.id, s.id')
            .having('COUNT(p.id) > 1')
        }, 'multi_print_cards')
        .getRawOne()

      // Total print variations for this game
      const totalPrintVariationsQuery = await AppDataSource
        .createQueryBuilder()
        .select('SUM(print_count - 1)', 'total_variations')
        .from(subQuery => {
          return subQuery
            .select('COUNT(p.id)', 'print_count')
            .from(Print, 'p')
            .innerJoin('p.card', 'c')
            .innerJoin('p.set', 's')
            .where('c.gameId = :gameId', { gameId: game.id })
            .groupBy('c.id, s.id')
            .having('COUNT(p.id) > 1')
        }, 'variation_counts')
        .getRawOne()

      // Common variation types
      const variationTypes = await this.getVariationTypesForGame(game.id)

      gameBreakdown.push({
        gameName: game.displayName,
        totalCards,
        cardsWithMultiplePrints: parseInt(cardsWithMultiplePrintsQuery?.count || '0'),
        totalPrintVariations: parseInt(totalPrintVariationsQuery?.total_variations || '0'),
        commonVariationTypes: variationTypes
      })
    }

    return gameBreakdown
  }

  private async getVariationTypesForGame(gameId: string): Promise<{ [key: string]: number }> {
    const variations: { [key: string]: number } = {}

    // Different artists
    const artistVariations = await AppDataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from(subQuery => {
        return subQuery
          .select('c.id, s.id, COUNT(DISTINCT p.artist)', 'artist_count')
          .from(Print, 'p')
          .innerJoin('p.card', 'c')
          .innerJoin('p.set', 's')
          .where('c.gameId = :gameId', { gameId })
          .andWhere('p.artist IS NOT NULL')
          .groupBy('c.id, s.id')
          .having('COUNT(DISTINCT p.artist) > 1')
      }, 'artist_variations')
      .getRawOne()

    if (artistVariations?.count) {
      variations['Different Artists'] = parseInt(artistVariations.count)
    }

    // Different finishes
    const finishVariations = await AppDataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from(subQuery => {
        return subQuery
          .select('c.id, s.id')
          .from(Print, 'p')
          .innerJoin('p.card', 'c')
          .innerJoin('p.set', 's')
          .where('c.gameId = :gameId', { gameId })
          .groupBy('c.id, s.id')
          .having('COUNT(DISTINCT p.finish) > 1')
      }, 'finish_variations')
      .getRawOne()

    if (finishVariations?.count) {
      variations['Different Finishes'] = parseInt(finishVariations.count)
    }

    // Promo vs regular
    const promoVariations = await AppDataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from(subQuery => {
        return subQuery
          .select('c.id, s.id')
          .from(Print, 'p')
          .innerJoin('p.card', 'c')
          .innerJoin('p.set', 's')
          .where('c.gameId = :gameId', { gameId })
          .groupBy('c.id, s.id')
          .having('COUNT(DISTINCT p.isPromo) > 1')
      }, 'promo_variations')
      .getRawOne()

    if (promoVariations?.count) {
      variations['Promo Variants'] = parseInt(promoVariations.count)
    }

    // Alternate art
    const altArtVariations = await AppDataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from(subQuery => {
        return subQuery
          .select('c.id, s.id')
          .from(Print, 'p')
          .innerJoin('p.card', 'c')
          .innerJoin('p.set', 's')
          .where('c.gameId = :gameId', { gameId })
          .groupBy('c.id, s.id')
          .having('COUNT(DISTINCT p.isAlternateArt) > 1')
      }, 'alt_art_variations')
      .getRawOne()

    if (altArtVariations?.count) {
      variations['Alternate Art'] = parseInt(altArtVariations.count)
    }

    return variations
  }

  private async getDetailedExamples(limit: number = 20): Promise<PrintVariationAnalysis[]> {
    const examples: PrintVariationAnalysis[] = []

    // Get cards with multiple prints in same set, ordered by most prints first
    const cardsWithMultiplePrints = await AppDataSource
      .createQueryBuilder()
      .select([
        'c.id as cardId',
        'c.name as cardName', 
        'g.displayName as gameName',
        's.id as setId',
        's.name as setName',
        's.code as setCode',
        'COUNT(p.id) as printCount'
      ])
      .from(Card, 'c')
      .innerJoin('c.game', 'g')
      .innerJoin('c.prints', 'p')
      .innerJoin('p.set', 's')
      .groupBy('c.id, c.name, g.displayName, s.id, s.name, s.code')
      .having('COUNT(p.id) > 1')
      .orderBy('COUNT(p.id)', 'DESC')
      .limit(limit)
      .getRawMany()

    for (const cardInfo of cardsWithMultiplePrints) {
      // Get all prints for this card in this set
      const prints = await AppDataSource
        .getRepository(Print)
        .find({
          where: {
            cardId: cardInfo.cardId,
            setId: cardInfo.setId
          },
          order: { collectorNumber: 'ASC' }
        })

      const variations = prints.map(print => ({
        printId: print.id,
        collectorNumber: print.collectorNumber,
        artist: print.artist,
        variation: print.variation,
        finish: print.finish,
        isAlternateArt: print.isAlternateArt,
        isPromo: print.isPromo,
        frame: print.frame,
        borderColor: print.borderColor,
        language: print.language,
        rarity: print.rarity
      }))

      // Determine variation reasons
      const variationReasons = this.analyzeVariationReasons(variations)

      examples.push({
        cardName: cardInfo.cardName,
        gameName: cardInfo.gameName,
        setName: cardInfo.setName,
        setCode: cardInfo.setCode,
        totalPrints: parseInt(cardInfo.printCount),
        variations,
        variationReasons
      })
    }

    return examples
  }

  private analyzeVariationReasons(variations: any[]): string[] {
    const reasons: string[] = []

    // Check for different artists
    const artists = [...new Set(variations.map(v => v.artist).filter(Boolean))]
    if (artists.length > 1) {
      reasons.push(`Different Artists (${artists.length}: ${artists.join(', ')})`)
    }

    // Check for different finishes
    const finishes = [...new Set(variations.map(v => v.finish))]
    if (finishes.length > 1) {
      reasons.push(`Different Finishes (${finishes.join(', ')})`)
    }

    // Check for promo variants
    const hasPromo = variations.some(v => v.isPromo)
    const hasNonPromo = variations.some(v => !v.isPromo)
    if (hasPromo && hasNonPromo) {
      reasons.push('Promo vs Regular')
    }

    // Check for alternate art
    const hasAltArt = variations.some(v => v.isAlternateArt)
    const hasRegularArt = variations.some(v => !v.isAlternateArt)
    if (hasAltArt && hasRegularArt) {
      reasons.push('Alternate Art vs Regular')
    }

    // Check for different variations
    const variationTypes = [...new Set(variations.map(v => v.variation).filter(Boolean))]
    if (variationTypes.length > 0) {
      reasons.push(`Special Variations (${variationTypes.join(', ')})`)
    }

    // Check for different frames
    const frames = [...new Set(variations.map(v => v.frame).filter(Boolean))]
    if (frames.length > 1) {
      reasons.push(`Different Frames (${frames.join(', ')})`)
    }

    // Check for different border colors
    const borderColors = [...new Set(variations.map(v => v.borderColor).filter(Boolean))]
    if (borderColors.length > 1) {
      reasons.push(`Different Borders (${borderColors.join(', ')})`)
    }

    // Check for different languages
    const languages = [...new Set(variations.map(v => v.language))]
    if (languages.length > 1) {
      reasons.push(`Different Languages (${languages.join(', ')})`)
    }

    // Check for different rarities (might indicate data issues)
    const rarities = [...new Set(variations.map(v => v.rarity).filter(Boolean))]
    if (rarities.length > 1) {
      reasons.push(`⚠️ Different Rarities (${rarities.join(', ')}) - Potential Data Issue`)
    }

    return reasons.length > 0 ? reasons : ['Unknown - Similar collector numbers/artists']
  }

  private async getVariationPatterns(): Promise<{ [pattern: string]: number }> {
    const patterns: { [pattern: string]: number } = {}

    // Pattern: Cards with multiple prints by same artist (potential duplicates)
    const sameArtistMultiplePrints = await AppDataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from(subQuery => {
        return subQuery
          .select('c.id, s.id, p.artist')
          .from(Print, 'p')
          .innerJoin('p.card', 'c')
          .innerJoin('p.set', 's')
          .where('p.artist IS NOT NULL')
          .groupBy('c.id, s.id, p.artist')
          .having('COUNT(p.id) > 1')
      }, 'same_artist_multiples')
      .getRawOne()

    if (sameArtistMultiplePrints?.count) {
      patterns['Same Artist Multiple Prints (Potential Duplicates)'] = parseInt(sameArtistMultiplePrints.count)
    }

    // Pattern: Sequential collector numbers (like 123, 123a, 123b)
    const sequentialNumbers = await AppDataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from(Print, 'p1')
      .innerJoin(Print, 'p2', 'p1.cardId = p2.cardId AND p1.setId = p2.setId AND p1.id != p2.id')
      .where("p1.collectorNumber ~ '^[0-9]+[a-z]?$'")
      .andWhere("p2.collectorNumber ~ '^[0-9]+[a-z]?$'")
      .andWhere("REGEXP_REPLACE(p1.collectorNumber, '[a-z]', '', 'g') = REGEXP_REPLACE(p2.collectorNumber, '[a-z]', '', 'g')")
      .getRawOne()

    if (sequentialNumbers?.count) {
      patterns['Sequential Collector Numbers (123, 123a, 123b)'] = parseInt(sequentialNumbers.count)
    }

    return patterns
  }
}

// Main execution function
export async function runPrintVariationAnalysis() {
  const analyzer = new PrintVariationAnalyzer()
  
  try {
    const results = await analyzer.analyzePrintVariations()
    
    console.log('\n' + '='.repeat(80))
    console.log('📊 PRINT VARIATION ANALYSIS REPORT')
    console.log('='.repeat(80))
    
    console.log('\n📈 OVERALL STATISTICS:')
    console.log(`  Total Cards: ${results.overallStats.totalCards.toLocaleString()}`)
    console.log(`  Cards with Multiple Prints: ${results.overallStats.cardsWithMultiplePrints.toLocaleString()}`)
    console.log(`  Total Print Variations: ${results.overallStats.totalPrintVariations.toLocaleString()}`)
    console.log(`  Average Prints per Card: ${results.overallStats.averagePrintsPerCard.toFixed(2)}`)
    
    console.log('\n🎮 GAME BREAKDOWN:')
    results.gameBreakdown.forEach(game => {
      console.log(`\n  ${game.gameName}:`)
      console.log(`    Total Cards: ${game.totalCards.toLocaleString()}`)
      console.log(`    Cards w/ Multiple Prints: ${game.cardsWithMultiplePrints.toLocaleString()}`)
      console.log(`    Total Variations: ${game.totalPrintVariations.toLocaleString()}`)
      if (Object.keys(game.commonVariationTypes).length > 0) {
        console.log(`    Common Variation Types:`)
        Object.entries(game.commonVariationTypes).forEach(([type, count]) => {
          console.log(`      ${type}: ${count}`)
        })
      }
    })
    
    console.log('\n🔄 VARIATION PATTERNS:')
    Object.entries(results.variationPatterns).forEach(([pattern, count]) => {
      console.log(`  ${pattern}: ${count}`)
    })
    
    console.log('\n📋 DETAILED EXAMPLES (Top 20):')
    results.detailedExamples.slice(0, 10).forEach((example, index) => {
      console.log(`\n  ${index + 1}. ${example.cardName} (${example.gameName})`)
      console.log(`     Set: ${example.setName} (${example.setCode})`)
      console.log(`     Total Prints: ${example.totalPrints}`)
      console.log(`     Reasons: ${example.variationReasons.join('; ')}`)
      
      if (example.variations.length <= 4) {
        console.log(`     Print Details:`)
        example.variations.forEach((variant, vIndex) => {
          console.log(`       ${vIndex + 1}. #${variant.collectorNumber} - ${variant.artist || 'Unknown Artist'} - ${variant.finish} ${variant.isPromo ? '(Promo)' : ''} ${variant.isAlternateArt ? '(Alt Art)' : ''}`)
        })
      }
    })
    
    console.log('\n' + '='.repeat(80))
    console.log('✅ Analysis Complete! Check the detailed results above.')
    console.log('='.repeat(80))
    
    return results
    
  } catch (error) {
    console.error('❌ Analysis failed:', error)
    throw error
  }
}

// Allow direct execution
if (require.main === module) {
  runPrintVariationAnalysis().catch(console.error)
}