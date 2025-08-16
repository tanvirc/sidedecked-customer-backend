#!/usr/bin/env npx ts-node

/**
 * Test Pokémon API connectivity and validate API key
 */

import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

async function testPokemonAPI() {
  const apiKey = process.env.POKEMON_TCG_API_KEY || ''
  
  console.log('🔍 Testing Pokémon TCG API connectivity...')
  console.log(`API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : 'NOT SET'}`)
  
  // Test 1: Simple health check
  try {
    console.log('\n1️⃣ Testing simple endpoint with minimal timeout...')
    const response = await axios.get('https://api.pokemontcg.io/v2/cards', {
      params: { page: 1, pageSize: 1 },
      timeout: 5000,
      headers: {
        'X-Api-Key': apiKey
      }
    })
    
    console.log(`✅ API responded with ${response.status}`)
    console.log(`📊 Total cards available: ${response.data.totalCount}`)
    
  } catch (error: any) {
    console.log('❌ Simple endpoint failed:', error.message)
  }
  
  // Test 2: Try without API key (rate limited but should work)
  try {
    console.log('\n2️⃣ Testing without API key...')
    const response = await axios.get('https://api.pokemontcg.io/v2/cards', {
      params: { page: 1, pageSize: 1 },
      timeout: 10000
    })
    
    console.log(`✅ API responded without key: ${response.status}`)
    
  } catch (error: any) {
    console.log('❌ Request without key failed:', error.message)
  }
  
  // Test 3: Try a different endpoint
  try {
    console.log('\n3️⃣ Testing cards endpoint with specific set...')
    const response = await axios.get('https://api.pokemontcg.io/v2/cards', {
      params: { 
        q: 'set.id:base1',
        page: 1, 
        pageSize: 3 
      },
      timeout: 15000,
      headers: {
        'X-Api-Key': apiKey,
        'User-Agent': 'SideDecked/1.0'
      }
    })
    
    console.log(`✅ Specific set query worked: ${response.status}`)
    console.log(`📦 Found ${response.data.data.length} cards`)
    response.data.data.forEach((card: any, i: number) => {
      console.log(`   ${i+1}. ${card.name} (${card.set.name})`)
    })
    
  } catch (error: any) {
    console.log('❌ Specific set query failed:', error.message)
  }
  
  // Test 4: Try alternative approach - direct card by ID
  try {
    console.log('\n4️⃣ Testing direct card lookup...')
    const response = await axios.get('https://api.pokemontcg.io/v2/cards/base1-1', {
      timeout: 10000,
      headers: {
        'X-Api-Key': apiKey
      }
    })
    
    console.log(`✅ Direct card lookup worked: ${response.data.data.name}`)
    
  } catch (error: any) {
    console.log('❌ Direct card lookup failed:', error.message)
  }
  
  console.log('\n🏁 API connectivity test completed')
}

testPokemonAPI().catch(console.error)