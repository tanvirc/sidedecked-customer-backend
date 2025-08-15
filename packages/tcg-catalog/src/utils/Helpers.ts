import { createHash } from 'crypto'
import { GAME_CODES, SKU_SEPARATOR, MTG_COLORS } from './Constants'

/**
 * Generate a normalized name for searching
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
}

/**
 * Generate SHA-256 hash for deduplication
 */
export function generateHash(data: any): string {
  const content = typeof data === 'string' ? data : JSON.stringify(data)
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Generate oracle hash from card data
 */
export function generateOracleHash(cardData: {
  name: string
  type: string
  text?: string
  gameSpecific?: any
}): string {
  const hashData = {
    name: cardData.name.toLowerCase(),
    type: cardData.type.toLowerCase(), 
    text: cardData.text?.toLowerCase() || '',
    gameSpecific: cardData.gameSpecific || {}
  }
  return generateHash(hashData)
}

/**
 * Generate print hash from print data
 */
export function generatePrintHash(printData: {
  oracleHash: string
  setCode: string
  collectorNumber: string
  artist?: string
}): string {
  const hashData = {
    oracleHash: printData.oracleHash,
    setCode: printData.setCode.toLowerCase(),
    collectorNumber: printData.collectorNumber.toLowerCase(),
    artist: printData.artist?.toLowerCase() || ''
  }
  return generateHash(hashData)
}

/**
 * Format Universal SKU
 * Format: {GAME}-{SET}-{NUMBER}-{LANG}-{CONDITION}-{FINISH}[-{GRADE}]
 */
export function formatSKU(components: {
  gameCode: string
  setCode: string
  collectorNumber: string
  languageCode: string
  conditionCode: string
  finishCode: string
  gradeInfo?: {
    company: string
    grade: string
  }
}): string {
  const {
    gameCode,
    setCode,
    collectorNumber,
    languageCode,
    conditionCode, 
    finishCode,
    gradeInfo
  } = components

  let sku = [
    gameCode.toUpperCase(),
    setCode.toUpperCase(),
    collectorNumber.toUpperCase(),
    languageCode.toUpperCase(),
    conditionCode.toUpperCase(),
    finishCode.toUpperCase()
  ].join(SKU_SEPARATOR)

  if (gradeInfo) {
    sku += `${SKU_SEPARATOR}${gradeInfo.company}${gradeInfo.grade}`
  }

  return sku
}

/**
 * Parse Universal SKU into components
 */
export function parseSKU(sku: string): {
  gameCode: string
  setCode: string
  collectorNumber: string
  languageCode: string
  conditionCode: string
  finishCode: string
  gradeInfo?: {
    company: string
    grade: string
  }
} | null {
  const parts = sku.split(SKU_SEPARATOR)
  
  if (parts.length < 6) {
    return null
  }

  const result = {
    gameCode: parts[0],
    setCode: parts[1],
    collectorNumber: parts[2],
    languageCode: parts[3],
    conditionCode: parts[4],
    finishCode: parts[5]
  }

  // Check for grading info
  if (parts.length === 7) {
    const gradeString = parts[6]
    const match = gradeString.match(/^([A-Z]+)(.+)$/)
    if (match) {
      result.gradeInfo = {
        company: match[1],
        grade: match[2]
      }
    }
  }

  return result
}

/**
 * Extract primary type from type line
 */
export function extractPrimaryType(typeLine: string): string {
  if (!typeLine) return ''
  
  // Handle double-faced cards
  const mainType = typeLine.split(' // ')[0]
  
  // Extract the main type (everything before '—' or first type)
  const parts = mainType.split(' — ')[0].trim()
  const types = parts.split(' ')
  
  // Filter out supertypes like "Legendary", "Basic", etc.
  const supertypes = ['Legendary', 'Basic', 'Snow', 'World', 'Elite', 'Host']
  const mainTypes = types.filter(type => !supertypes.includes(type))
  
  return mainTypes[0] || types[0] || ''
}

/**
 * Extract subtypes from type line
 */
export function extractSubtypes(typeLine: string): string[] {
  if (!typeLine) return []
  
  // Handle double-faced cards
  const mainType = typeLine.split(' // ')[0]
  
  // Extract subtypes (everything after '—')
  const parts = mainType.split(' — ')
  if (parts.length < 2) return []
  
  return parts[1].trim().split(' ').filter(Boolean)
}

/**
 * Parse numeric value (handles *, X, etc.)
 */
export function parseNumeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  
  const str = String(value).trim()
  if (str === '' || str === '*' || str === 'X' || str === '?') return null
  
  const parsed = parseInt(str, 10)
  return isNaN(parsed) ? null : parsed
}

/**
 * Determine evolution stage for Pokemon
 */
export function determineEvolutionStage(pokemonCard: any): string {
  if (pokemonCard.evolvesFrom) {
    if (pokemonCard.evolvesFrom.length > 0) {
      return 'Stage2'
    }
    return 'Stage1'
  }
  return 'Basic'
}

/**
 * Check if card is alternate art
 */
export function isAlternateArt(printData: any): boolean {
  if (printData.frame_effects?.includes('showcase')) return true
  if (printData.frame_effects?.includes('extendedart')) return true
  if (printData.full_art === true) return true
  if (printData.textless === true) return true
  if (printData.variation === true) return true
  
  return false
}

/**
 * Map rarity from external APIs to internal format
 */
export function mapRarity(externalRarity: string, gameCode: string): string {
  const rarity = externalRarity.toLowerCase()
  
  switch (gameCode) {
    case GAME_CODES.MTG:
      switch (rarity) {
        case 'common': return 'common'
        case 'uncommon': return 'uncommon' 
        case 'rare': return 'rare'
        case 'mythic': return 'mythic'
        default: return rarity
      }
    
    case GAME_CODES.POKEMON:
      switch (rarity) {
        case 'common': return 'common'
        case 'uncommon': return 'uncommon'
        case 'rare': return 'rare'
        case 'rare holo': return 'rare_holo'
        case 'rare ultra': return 'rare_ultra'
        case 'rare secret': return 'rare_secret'
        default: return rarity
      }
    
    default:
      return rarity
  }
}

/**
 * Validate game code
 */
export function isValidGameCode(gameCode: string): boolean {
  return Object.values(GAME_CODES).includes(gameCode as any)
}

/**
 * Generate card color identity (for MTG)
 */
export function generateColorIdentity(manaCost: string, colors: string[]): string[] {
  if (!manaCost && (!colors || colors.length === 0)) return []
  
  const colorSet = new Set(colors || [])
  
  // Parse mana cost for color indicators
  if (manaCost) {
    for (const color of MTG_COLORS) {
      if (manaCost.includes(color)) {
        colorSet.add(color)
      }
    }
  }
  
  return Array.from(colorSet).sort()
}

/**
 * Calculate card power level (0-100 scale)
 */
export function calculatePowerLevel(card: any, gameCode: string): number {
  let power = 50 // Base power level
  
  switch (gameCode) {
    case GAME_CODES.MTG:
      // Adjust based on mana value efficiency
      if (card.manaValue && card.powerValue) {
        const efficiency = card.powerValue / Math.max(card.manaValue, 1)
        power += Math.min(efficiency * 10, 30)
      }
      
      // Bonus for keywords
      if (card.keywords?.length > 0) {
        power += Math.min(card.keywords.length * 5, 20)
      }
      break
      
    case GAME_CODES.POKEMON:
      // Adjust based on HP
      if (card.hp) {
        power += Math.min((card.hp - 50) / 5, 25)
      }
      break
  }
  
  return Math.max(0, Math.min(100, power))
}

/**
 * Clean and validate URL
 */
export function validateUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Format price for display
 */
export function formatPrice(price: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(price)
}

/**
 * Calculate price trend
 */
export function calculatePriceTrend(
  currentPrice: number,
  previousPrice: number,
  threshold: number = 0.05
): 'up' | 'down' | 'stable' {
  const change = (currentPrice - previousPrice) / previousPrice
  
  if (Math.abs(change) < threshold) return 'stable'
  return change > 0 ? 'up' : 'down'
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func.apply(this, args), wait)
  }
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  multiplier: number = 2
): Promise<T> {
  let lastError: Error
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      if (attempt === maxRetries) {
        throw lastError
      }
      
      const delay = baseDelay * Math.pow(multiplier, attempt)
      await sleep(delay)
    }
  }
  
  throw lastError!
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Chunk array into smaller arrays
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize))
  }
  return chunks
}

/**
 * Remove duplicates from array by key
 */
export function uniqueBy<T>(array: T[], keyFn: (item: T) => any): T[] {
  const seen = new Set()
  return array.filter(item => {
    const key = keyFn(item)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}