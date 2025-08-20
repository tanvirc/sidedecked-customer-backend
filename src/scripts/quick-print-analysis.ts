import { AppDataSource } from '../config/database'
import { Card } from '../entities/Card'
import { Print } from '../entities/Print'
import { CardSet } from '../entities/CardSet'
import { Game } from '../entities/Game'

async function quickAnalysis() {
  await AppDataSource.initialize()

  console.log('=== QUICK PRINT VARIATION ANALYSIS ===\n')

  // Overall stats
  const totalCards = await AppDataSource.getRepository(Card).count()
  const totalPrints = await AppDataSource.getRepository(Print).count()
  
  console.log(`📊 Overall Stats:`)
  console.log(`  Total Cards: ${totalCards.toLocaleString()}`)
  console.log(`  Total Prints: ${totalPrints.toLocaleString()}`)
  console.log(`  Avg Prints per Card: ${(totalPrints / totalCards).toFixed(2)}\n`)

  // Cards with multiple prints in SAME SET
  const sameSetMultiples = await AppDataSource
    .createQueryBuilder()
    .select(['c.name as card_name', 'cs.name as set_name', 'cs.code as set_code', 'COUNT(p.id) as print_count'])
    .from(Card, 'c')
    .innerJoin('c.prints', 'p')
    .innerJoin('p.set', 'cs')
    .innerJoin('c.game', 'g')
    .groupBy('c.id, c.name, cs.id, cs.name, cs.code')
    .having('COUNT(p.id) > 1')
    .orderBy('COUNT(p.id)', 'DESC')
    .limit(10)
    .getRawMany()

  console.log(`🔍 Cards with Multiple Prints in SAME Set (Top 10):`)
  if (sameSetMultiples.length === 0) {
    console.log('  ✅ No cards found with multiple prints in the same set!')
    console.log('  This suggests the system is working correctly - all variations are legitimate.\n')
  } else {
    sameSetMultiples.forEach((card, i) => {
      console.log(`  ${i+1}. "${card.card_name}" in ${card.set_name} (${card.set_code}) - ${card.print_count} prints`)
    })
    console.log()
  }

  // Sample of what creates the variations
  if (sameSetMultiples.length > 0) {
    const sampleCard = sameSetMultiples[0]
    const prints = await AppDataSource
      .createQueryBuilder()
      .select(['p.collectorNumber', 'p.artist', 'p.finish', 'p.variation', 'p.isAlternateArt', 'p.isPromo', 'p.language'])
      .from(Print, 'p')
      .innerJoin('p.card', 'c')
      .innerJoin('p.set', 'cs')
      .where('c.name = :cardName', { cardName: sampleCard.card_name })
      .andWhere('cs.code = :setCode', { setCode: sampleCard.set_code })
      .getRawMany()

    console.log(`📋 Sample Print Variations for "${sampleCard.card_name}":`)
    prints.forEach((print, i) => {
      const variations = []
      if (print.artist) variations.push(`Artist: ${print.artist}`)
      if (print.finish !== 'normal') variations.push(`Finish: ${print.finish}`)
      if (print.variation) variations.push(`Variation: ${print.variation}`)
      if (print.isAlternateArt) variations.push('Alt Art')
      if (print.isPromo) variations.push('Promo')
      if (print.language !== 'en') variations.push(`Lang: ${print.language}`)
      
      console.log(`  ${i+1}. #${print.collectorNumber} - ${variations.join(', ') || 'Standard'}`)
    })
    console.log()
  }

  // Game breakdown
  const games = await AppDataSource.getRepository(Game).find()
  console.log(`🎮 Game Breakdown:`)
  
  for (const game of games) {
    const gameCards = await AppDataSource.getRepository(Card).count({ where: { gameId: game.id } })
    const gamePrints = await AppDataSource
      .createQueryBuilder()
      .select('COUNT(p.id)', 'count')
      .from(Print, 'p')
      .innerJoin('p.card', 'c')
      .where('c.gameId = :gameId', { gameId: game.id })
      .getRawOne()
    
    console.log(`  ${game.displayName}: ${gameCards} cards, ${gamePrints?.count || 0} prints (${gamePrints?.count ? (gamePrints.count / gameCards).toFixed(2) : 0} avg)`)
  }
  
  await AppDataSource.destroy()
}

// Run the analysis
quickAnalysis().catch(console.error)