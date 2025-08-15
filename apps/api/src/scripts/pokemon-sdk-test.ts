#!/usr/bin/env npx ts-node

/**
 * Quick Pokémon SDK connectivity test
 */

import { PokemonTCG } from 'pokemon-tcg-sdk-typescript'
import dotenv from 'dotenv'

dotenv.config()

async function quickSDKTest() {
  console.log('🔍 Quick Pokémon SDK Test')
  console.log('========================\n')
  
  const apiKey = process.env.POKEMON_TCG_API_KEY || ''
  if (apiKey) {
    process.env.POKEMONTCG_API_KEY = apiKey
    console.log(`🔑 Using API key: ${apiKey.substring(0, 8)}...`)
  }
  
  try {
    // Test 1: Get a few sets
    console.log('📋 Testing set retrieval...')
    const sets = await PokemonTCG.getAllSets()
    console.log(`✅ Successfully retrieved ${sets.length} sets`)
    
    // Show first 3 sets
    sets.slice(0, 3).forEach((set, i) => {
      console.log(`   ${i+1}. ${set.name} (${set.id}) - ${set.total} cards`)
    })
    
    // Test 2: Get a few cards from the base set
    console.log('\n🎴 Testing card retrieval...')
    const cards = await PokemonTCG.findCardsByQueries({
      q: 'set.id:base1',
      pageSize: 3
    })
    
    console.log(`✅ Successfully retrieved ${cards.length} cards`)
    cards.forEach((card, i) => {
      console.log(`   ${i+1}. ${card.name} (#${card.number}) - ${card.rarity}`)
    })
    
    // Test 3: Simple search
    console.log('\n🔎 Testing card search...')
    const searchCards = await PokemonTCG.findCardsByQueries({
      q: 'name:pikachu',
      pageSize: 2
    })
    
    console.log(`✅ Found ${searchCards.length} Pikachu cards`)
    searchCards.forEach((card, i) => {
      console.log(`   ${i+1}. ${card.name} (${card.set.name})`)
    })
    
    console.log('\n🎉 SDK is working perfectly!')
    
  } catch (error) {
    console.error('❌ SDK test failed:', error)
  }
}

quickSDKTest()