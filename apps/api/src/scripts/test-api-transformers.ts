#!/usr/bin/env npx ts-node

/**
 * Simple API transformer test script
 * Tests if we can fetch data from each game's API and transform it
 */

import axios from 'axios'

interface TestResult {
  game: string
  success: boolean
  cardsFound: number
  sampleCard?: any
  error?: string
}

async function testScryfallMTG(): Promise<TestResult> {
  try {
    console.log('🎴 Testing Magic: The Gathering (Scryfall API)...')
    
    const response = await axios.get('https://api.scryfall.com/cards/search', {
      params: {
        q: 'set:neo', // Kamigawa: Neon Dynasty
        page: 1,
        unique: 'cards'
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)'
      }
    })

    const data = response.data
    const cards = data.data || []
    const sampleCard = cards[0]

    console.log(`✅ MTG: Found ${cards.length} cards from Kamigawa: Neon Dynasty`)
    if (sampleCard) {
      console.log(`   Sample: ${sampleCard.name} (${sampleCard.set_name})`)
    }

    return {
      game: 'Magic: The Gathering',
      success: true,
      cardsFound: cards.length,
      sampleCard: sampleCard ? {
        name: sampleCard.name,
        set: sampleCard.set_name,
        mana_cost: sampleCard.mana_cost,
        type_line: sampleCard.type_line
      } : undefined
    }
  } catch (error) {
    console.error('❌ MTG API test failed:', error)
    return {
      game: 'Magic: The Gathering',
      success: false,
      cardsFound: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function testPokemonTCG(): Promise<TestResult> {
  try {
    console.log('🔥 Testing Pokémon TCG API...')
    
    const response = await axios.get('https://api.pokemontcg.io/v2/cards', {
      params: {
        page: 1,
        pageSize: 20,
        q: 'set.id:swsh1' // Sword & Shield Base Set
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)',
        'X-Api-Key': process.env.POKEMON_TCG_API_KEY || ''
      }
    })

    const data = response.data
    const cards = data.data || []
    const sampleCard = cards[0]

    console.log(`✅ Pokémon: Found ${cards.length} cards from Sword & Shield`)
    if (sampleCard) {
      console.log(`   Sample: ${sampleCard.name} (${sampleCard.set.name})`)
    }

    return {
      game: 'Pokémon',
      success: true,
      cardsFound: cards.length,
      sampleCard: sampleCard ? {
        name: sampleCard.name,
        set: sampleCard.set.name,
        hp: sampleCard.hp,
        types: sampleCard.types
      } : undefined
    }
  } catch (error) {
    console.error('❌ Pokémon API test failed:', error)
    return {
      game: 'Pokémon',
      success: false,
      cardsFound: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function testYuGiOhAPI(): Promise<TestResult> {
  try {
    console.log('⚔️ Testing Yu-Gi-Oh! API...')
    
    const response = await axios.get('https://db.ygoprodeck.com/api/v7/cardinfo.php', {
      params: {
        num: 20,
        offset: 0,
        sort: 'id'
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)'
      }
    })

    const data = response.data
    const cards = data.data || []
    const sampleCard = cards[0]

    console.log(`✅ Yu-Gi-Oh!: Found ${cards.length} cards`)
    if (sampleCard) {
      console.log(`   Sample: ${sampleCard.name} (${sampleCard.type})`)
    }

    return {
      game: 'Yu-Gi-Oh!',
      success: true,
      cardsFound: cards.length,
      sampleCard: sampleCard ? {
        name: sampleCard.name,
        type: sampleCard.type,
        atk: sampleCard.atk,
        def: sampleCard.def,
        attribute: sampleCard.attribute
      } : undefined
    }
  } catch (error) {
    console.error('❌ Yu-Gi-Oh! API test failed:', error)
    return {
      game: 'Yu-Gi-Oh!',
      success: false,
      cardsFound: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function testOnePieceAPI(): Promise<TestResult> {
  try {
    console.log('🏴‍☠️ Testing One Piece TCG API...')
    
    // Note: This endpoint might not exist or work - One Piece TCG API is less established
    const response = await axios.get('https://onepiece-cardgame.dev/api/cards', {
      params: {
        limit: 20
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)'
      }
    })

    const data = response.data
    const cards = Array.isArray(data) ? data : (data.data || [])
    const sampleCard = cards[0]

    console.log(`✅ One Piece: Found ${cards.length} cards`)
    if (sampleCard) {
      console.log(`   Sample: ${sampleCard.name || sampleCard.title || 'Unknown'}`)
    }

    return {
      game: 'One Piece',
      success: true,
      cardsFound: cards.length,
      sampleCard: sampleCard ? {
        name: sampleCard.name || sampleCard.title,
        type: sampleCard.type,
        cost: sampleCard.cost,
        power: sampleCard.power
      } : undefined
    }
  } catch (error) {
    console.error('❌ One Piece API test failed:', error)
    return {
      game: 'One Piece',
      success: false,
      cardsFound: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function main(): Promise<void> {
  console.log('🚀 Testing TCG API Transformers')
  console.log('=====================================\n')

  const results: TestResult[] = []

  // Test each API
  results.push(await testScryfallMTG())
  await sleep(1000) // Rate limiting

  results.push(await testPokemonTCG())
  await sleep(1000)

  results.push(await testYuGiOhAPI())
  await sleep(1000)

  results.push(await testOnePieceAPI())

  // Summary
  console.log('\n📊 Test Results Summary')
  console.log('========================')
  
  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)

  console.log(`✅ Successful APIs: ${successful.length}/${results.length}`)
  console.log(`❌ Failed APIs: ${failed.length}/${results.length}`)

  if (successful.length > 0) {
    console.log('\n✅ Working APIs:')
    successful.forEach(result => {
      console.log(`   • ${result.game}: ${result.cardsFound} cards`)
    })
  }

  if (failed.length > 0) {
    console.log('\n❌ Failed APIs:')
    failed.forEach(result => {
      console.log(`   • ${result.game}: ${result.error}`)
    })
  }

  console.log('\n📝 Next Steps:')
  if (successful.length > 0) {
    console.log('   1. APIs are accessible - you can proceed with ETL implementation')
    console.log('   2. Check database connectivity and run migrations')
    console.log('   3. Test full ETL pipeline with small batches')
  } else {
    console.log('   1. Check internet connectivity')
    console.log('   2. Verify API keys if required')
    console.log('   3. Check if APIs have changed their endpoints')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n⏹️  Test interrupted')
  process.exit(0)
})

// Run the script
main().catch(error => {
  console.error('❌ Test script failed:', error)
  process.exit(1)
})