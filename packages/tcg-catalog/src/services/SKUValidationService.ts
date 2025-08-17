import { AppDataSource } from '../../../../src/config/database'
import { CatalogSKU } from '../entities/CatalogSKU'
import { Print } from '../entities/Print'
import { Card } from '../entities/Card'
import { CardSet } from '../entities/CardSet'
import { logger } from '../utils/Logger'
import { parseSKU, formatSKU } from '../utils/Helpers'
import { GAME_CODES } from '../utils/Constants'

export interface SKUValidation {
  isValid: boolean
  catalogSku?: CatalogSKU
  errors: ValidationError[]
  warnings: ValidationWarning[]
  suggestions: SKUSuggestion[]
  metrics: ValidationMetrics
}

export interface ValidationError {
  type: 'format' | 'game' | 'set' | 'language' | 'condition' | 'finish' | 'existence' | 'structure'
  message: string
  field?: string
  severity: 'error' | 'critical'
}

export interface ValidationWarning {
  type: 'deprecated' | 'uncommon' | 'regional' | 'inventory'
  message: string
  field?: string
}

export interface SKUSuggestion {
  sku: string
  confidence: number
  reason: string
  catalogSku?: CatalogSKU
}

export interface ValidationMetrics {
  processingTimeMs: number
  similarSKUsFound: number
  confidenceScore: number
  componentMatches: {
    game: boolean
    set: boolean
    number: boolean
    language: boolean
    condition: boolean
    finish: boolean
    grade?: boolean
  }
}

export interface InventorySyncStatus {
  catalogSkuId: string
  vendorProductId?: string
  vendorVariantId?: string
  isActive: boolean
  lastSyncAt: Date
  nextSyncAt?: Date
  syncIntervalMinutes: number
  failureCount: number
  lastError?: string
  inventoryData: {
    hasB2cInventory: boolean
    hasC2cListings: boolean
    vendorCount: number
    totalQuantity?: number
    lowestPrice?: number
    averagePrice?: number
  }
}

export interface BulkSKUValidation {
  processed: number
  valid: number
  invalid: number
  warnings: number
  processingTimeMs: number
  results: Map<string, SKUValidation>
  summary: ValidationSummary
}

export interface ValidationSummary {
  commonErrors: Array<{ type: string; count: number; message: string }>
  gameDistribution: Record<string, number>
  conditionDistribution: Record<string, number>
  languageDistribution: Record<string, number>
  recommendedActions: string[]
}

export class SKUValidationService {
  private validGameCodes: Set<string>
  private validLanguageCodes: Set<string>
  private validConditionCodes: Set<string>
  private validFinishCodes: Set<string>

  constructor() {
    // Initialize valid codes
    this.validGameCodes = new Set(Object.values(GAME_CODES))
    this.validLanguageCodes = new Set(['EN', 'ES', 'FR', 'DE', 'IT', 'PT', 'JA', 'KO', 'ZH', 'RU'])
    this.validConditionCodes = new Set(['NM', 'LP', 'MP', 'HP', 'DMG', 'MINT'])
    this.validFinishCodes = new Set(['NORMAL', 'FOIL', 'HOLO', 'RAINBOW', 'SECRET', 'GOLD', 'SILVER'])
  }

  /**
   * Comprehensive SKU validation
   */
  async validateSKU(sku: string): Promise<SKUValidation> {
    const startTime = Date.now()
    
    const result: SKUValidation = {
      isValid: false,
      errors: [],
      warnings: [],
      suggestions: [],
      metrics: {
        processingTimeMs: 0,
        similarSKUsFound: 0,
        confidenceScore: 0,
        componentMatches: {
          game: false,
          set: false,
          number: false,
          language: false,
          condition: false,
          finish: false
        }
      }
    }

    try {
      logger.debug('Starting SKU validation', { sku })

      // Step 1: Parse SKU structure
      const parsed = parseSKU(sku)
      if (!parsed) {
        result.errors.push({
          type: 'format',
          message: 'Invalid SKU format. Expected: GAME-SET-NUMBER-LANG-CONDITION-FINISH[-GRADE]',
          severity: 'critical'
        })
        result.metrics.processingTimeMs = Date.now() - startTime
        return result
      }

      // Step 2: Validate individual components
      await this.validateComponents(parsed, result)

      // Step 3: Check if SKU exists in catalog
      const catalogSku = await this.findExistingSKU(sku)
      if (catalogSku) {
        result.catalogSku = catalogSku
        result.metrics.confidenceScore = 1.0
        result.isValid = result.errors.filter(e => e.severity === 'critical').length === 0
        
        logger.info('SKU validation found existing catalog entry', {
          sku,
          catalogSkuId: catalogSku.id
        })
      } else {
        // Step 4: Try to find the print and validate components exist
        await this.validateSKUComponents(parsed, result)
        
        // Step 5: Generate suggestions
        await this.generateSKUSuggestions(parsed, result)
        
        result.isValid = result.errors.filter(e => e.severity === 'critical').length === 0 && 
                        result.suggestions.length > 0
      }

      result.metrics.processingTimeMs = Date.now() - startTime

      logger.debug('SKU validation completed', {
        sku,
        isValid: result.isValid,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
        suggestionsCount: result.suggestions.length,
        processingTime: result.metrics.processingTimeMs
      })

      return result

    } catch (error) {
      logger.error('SKU validation failed', error as Error, { sku })
      
      result.errors.push({
        type: 'structure',
        message: `Validation failed: ${(error as Error).message}`,
        severity: 'critical'
      })
      
      result.metrics.processingTimeMs = Date.now() - startTime
      return result
    }
  }

  /**
   * Validate SKU components
   */
  private async validateComponents(
    parsed: ReturnType<typeof parseSKU>, 
    result: SKUValidation
  ): Promise<void> {
    if (!parsed) return

    // Validate game code
    if (!this.validGameCodes.has(parsed.gameCode)) {
      result.errors.push({
        type: 'game',
        message: `Invalid game code: ${parsed.gameCode}. Valid codes: ${Array.from(this.validGameCodes).join(', ')}`,
        field: 'gameCode',
        severity: 'error'
      })
    } else {
      result.metrics.componentMatches.game = true
    }

    // Validate language code
    if (!this.validLanguageCodes.has(parsed.languageCode)) {
      result.errors.push({
        type: 'language',
        message: `Invalid language code: ${parsed.languageCode}. Valid codes: ${Array.from(this.validLanguageCodes).join(', ')}`,
        field: 'languageCode',
        severity: 'error'
      })
    } else {
      result.metrics.componentMatches.language = true
    }

    // Validate condition code
    if (!this.validConditionCodes.has(parsed.conditionCode)) {
      result.errors.push({
        type: 'condition',
        message: `Invalid condition code: ${parsed.conditionCode}. Valid codes: ${Array.from(this.validConditionCodes).join(', ')}`,
        field: 'conditionCode',
        severity: 'error'
      })
    } else {
      result.metrics.componentMatches.condition = true
    }

    // Validate finish code
    if (!this.validFinishCodes.has(parsed.finishCode)) {
      result.errors.push({
        type: 'finish',
        message: `Invalid finish code: ${parsed.finishCode}. Valid codes: ${Array.from(this.validFinishCodes).join(', ')}`,
        field: 'finishCode',
        severity: 'error'
      })
    } else {
      result.metrics.componentMatches.finish = true
    }

    // Validate set code format (basic check)
    if (!/^[A-Z0-9]{2,8}$/.test(parsed.setCode)) {
      result.warnings.push({
        type: 'uncommon',
        message: `Set code format is unusual: ${parsed.setCode}. Expected 2-8 alphanumeric characters`,
        field: 'setCode'
      })
    }

    // Validate collector number format
    if (!/^[A-Z0-9]{1,6}$/.test(parsed.collectorNumber)) {
      result.warnings.push({
        type: 'uncommon',
        message: `Collector number format is unusual: ${parsed.collectorNumber}`,
        field: 'collectorNumber'
      })
    }
  }

  /**
   * Validate that the SKU components exist in the database
   */
  private async validateSKUComponents(
    parsed: ReturnType<typeof parseSKU>,
    result: SKUValidation
  ): Promise<void> {
    if (!parsed) return

    try {
      // Check if the set exists
      const cardSet = await AppDataSource.getRepository(CardSet)
        .createQueryBuilder('set')
        .where('set.code = :setCode', { setCode: parsed.setCode })
        .getOne()

      if (!cardSet) {
        result.errors.push({
          type: 'set',
          message: `Set not found: ${parsed.setCode}`,
          field: 'setCode',
          severity: 'error'
        })
      } else {
        result.metrics.componentMatches.set = true
        
        // Check if the specific print exists
        const print = await AppDataSource.getRepository(Print)
          .createQueryBuilder('print')
          .leftJoinAndSelect('print.set', 'set')
          .where('set.code = :setCode', { setCode: parsed.setCode })
          .andWhere('print.collectorNumber = :collectorNumber', { collectorNumber: parsed.collectorNumber })
          .getOne()

        if (!print) {
          result.errors.push({
            type: 'existence',
            message: `Print not found: ${parsed.setCode} #${parsed.collectorNumber}`,
            severity: 'error'
          })
        } else {
          result.metrics.componentMatches.number = true
        }
      }

    } catch (error) {
      logger.error('Failed to validate SKU components', error as Error, { parsed })
      result.errors.push({
        type: 'structure',
        message: 'Database validation failed',
        severity: 'error'
      })
    }
  }

  /**
   * Find existing SKU in catalog
   */
  private async findExistingSKU(sku: string): Promise<CatalogSKU | null> {
    try {
      return await AppDataSource.getRepository(CatalogSKU).findOne({
        where: { sku },
        relations: ['print', 'print.card', 'print.set']
      })
    } catch (error) {
      logger.error('Failed to find existing SKU', error as Error, { sku })
      return null
    }
  }

  /**
   * Generate SKU suggestions
   */
  private async generateSKUSuggestions(
    parsed: ReturnType<typeof parseSKU>,
    result: SKUValidation
  ): Promise<void> {
    if (!parsed) return

    try {
      // Find similar SKUs by components
      const similarSkus = await AppDataSource.getRepository(CatalogSKU)
        .createQueryBuilder('sku')
        .leftJoinAndSelect('sku.print', 'print')
        .leftJoinAndSelect('print.card', 'card')
        .leftJoinAndSelect('print.set', 'set')
        .where('sku.gameCode = :gameCode', { gameCode: parsed.gameCode })
        .andWhere('sku.setCode = :setCode', { setCode: parsed.setCode })
        .limit(10)
        .getMany()

      result.metrics.similarSKUsFound = similarSkus.length

      for (const catalogSku of similarSkus) {
        let confidence = 0.3 // Base confidence for same game+set
        let reason = 'Same game and set'

        // Boost confidence for exact collector number match
        if (catalogSku.collectorNumber === parsed.collectorNumber) {
          confidence += 0.4
          reason = 'Exact print match'
        }

        // Boost confidence for same condition
        if (catalogSku.conditionCode === parsed.conditionCode) {
          confidence += 0.1
        }

        // Boost confidence for same language
        if (catalogSku.languageCode === parsed.languageCode) {
          confidence += 0.1
        }

        // Boost confidence for same finish
        if (catalogSku.finishCode === parsed.finishCode) {
          confidence += 0.1
        }

        if (confidence >= 0.5) {
          result.suggestions.push({
            sku: catalogSku.sku,
            confidence,
            reason,
            catalogSku
          })
        }
      }

      // Sort suggestions by confidence
      result.suggestions.sort((a, b) => b.confidence - a.confidence)

      // Generate alternative SKUs if no exact match
      if (result.suggestions.length === 0 && result.metrics.componentMatches.game && result.metrics.componentMatches.set) {
        await this.generateAlternativeSKUs(parsed, result)
      }

    } catch (error) {
      logger.error('Failed to generate SKU suggestions', error as Error, { parsed })
    }
  }

  /**
   * Generate alternative SKU formats
   */
  private async generateAlternativeSKUs(
    parsed: ReturnType<typeof parseSKU>,
    result: SKUValidation
  ): Promise<void> {
    if (!parsed) return

    const alternatives: Array<{ sku: string; reason: string }> = []

    // Try common condition variations
    for (const condition of ['NM', 'LP', 'MP']) {
      if (condition !== parsed.conditionCode) {
        const altSku = formatSKU({
          gameCode: parsed.gameCode,
          setCode: parsed.setCode,
          collectorNumber: parsed.collectorNumber,
          languageCode: parsed.languageCode,
          conditionCode: condition,
          finishCode: parsed.finishCode
        })
        
        alternatives.push({
          sku: altSku,
          reason: `Alternative condition: ${condition}`
        })
      }
    }

    // Try common finish variations
    for (const finish of ['NORMAL', 'FOIL']) {
      if (finish !== parsed.finishCode) {
        const altSku = formatSKU({
          gameCode: parsed.gameCode,
          setCode: parsed.setCode,
          collectorNumber: parsed.collectorNumber,
          languageCode: parsed.languageCode,
          conditionCode: parsed.conditionCode,
          finishCode: finish
        })
        
        alternatives.push({
          sku: altSku,
          reason: `Alternative finish: ${finish}`
        })
      }
    }

    // Check if any alternatives exist
    for (const alt of alternatives.slice(0, 3)) { // Limit to 3 alternatives
      const exists = await this.findExistingSKU(alt.sku)
      if (exists) {
        result.suggestions.push({
          sku: alt.sku,
          confidence: 0.6,
          reason: alt.reason,
          catalogSku: exists
        })
      }
    }
  }

  /**
   * Bulk SKU validation
   */
  async validateSKUsBulk(skus: string[]): Promise<BulkSKUValidation> {
    const startTime = Date.now()
    
    logger.info('Starting bulk SKU validation', { skuCount: skus.length })

    const results = new Map<string, SKUValidation>()
    const errorCounts = new Map<string, number>()
    const gameDistribution = new Map<string, number>()
    const conditionDistribution = new Map<string, number>()
    const languageDistribution = new Map<string, number>()

    let valid = 0
    let warnings = 0

    for (const sku of skus) {
      try {
        const validation = await this.validateSKU(sku)
        results.set(sku, validation)

        if (validation.isValid) {
          valid++
        }

        if (validation.warnings.length > 0) {
          warnings++
        }

        // Collect statistics
        for (const error of validation.errors) {
          const key = `${error.type}: ${error.message}`
          errorCounts.set(key, (errorCounts.get(key) || 0) + 1)
        }

        // Extract components for distribution analysis
        const parsed = parseSKU(sku)
        if (parsed) {
          gameDistribution.set(parsed.gameCode, (gameDistribution.get(parsed.gameCode) || 0) + 1)
          conditionDistribution.set(parsed.conditionCode, (conditionDistribution.get(parsed.conditionCode) || 0) + 1)
          languageDistribution.set(parsed.languageCode, (languageDistribution.get(parsed.languageCode) || 0) + 1)
        }

      } catch (error) {
        logger.error('Failed to validate SKU in bulk operation', error as Error, { sku })
        
        results.set(sku, {
          isValid: false,
          errors: [{
            type: 'structure',
            message: (error as Error).message,
            severity: 'critical'
          }],
          warnings: [],
          suggestions: [],
          metrics: {
            processingTimeMs: 0,
            similarSKUsFound: 0,
            confidenceScore: 0,
            componentMatches: {
              game: false,
              set: false,
              number: false,
              language: false,
              condition: false,
              finish: false
            }
          }
        })
      }
    }

    const processingTimeMs = Date.now() - startTime

    // Generate summary
    const commonErrors = Array.from(errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([message, count]) => {
        const [type] = message.split(': ')
        return { type, count, message }
      })

    const recommendedActions = this.generateRecommendations(commonErrors, results)

    const bulkResult: BulkSKUValidation = {
      processed: skus.length,
      valid,
      invalid: skus.length - valid,
      warnings,
      processingTimeMs,
      results,
      summary: {
        commonErrors,
        gameDistribution: Object.fromEntries(gameDistribution),
        conditionDistribution: Object.fromEntries(conditionDistribution),
        languageDistribution: Object.fromEntries(languageDistribution),
        recommendedActions
      }
    }

    logger.info('Bulk SKU validation completed', {
      skuCount: skus.length,
      valid,
      invalid: skus.length - valid,
      processingTimeMs
    })

    return bulkResult
  }

  /**
   * Generate recommendations based on common errors
   */
  private generateRecommendations(
    commonErrors: Array<{ type: string; count: number; message: string }>,
    results: Map<string, SKUValidation>
  ): string[] {
    const recommendations: string[] = []

    for (const error of commonErrors) {
      switch (error.type) {
        case 'format':
          recommendations.push('Review SKU format guidelines and ensure consistent structure')
          break
        case 'game':
          recommendations.push('Verify game codes are using standard abbreviations (MTG, POKEMON, YUGIOH, OPTCG)')
          break
        case 'set':
          recommendations.push('Update catalog with missing sets or verify set codes')
          break
        case 'language':
          recommendations.push('Use standard ISO language codes (EN, ES, FR, DE, etc.)')
          break
        case 'condition':
          recommendations.push('Use standard condition codes (NM, LP, MP, HP, DMG)')
          break
        case 'finish':
          recommendations.push('Use standard finish codes (NORMAL, FOIL, HOLO, etc.)')
          break
      }
    }

    // Add general recommendations based on validation results
    const hasManySuggestions = Array.from(results.values()).some(r => r.suggestions.length > 3)
    if (hasManySuggestions) {
      recommendations.push('Consider batch-updating SKUs using the suggested alternatives')
    }

    return [...new Set(recommendations)] // Remove duplicates
  }

  /**
   * Sync inventory status for a catalog SKU
   */
  async syncInventoryStatus(catalogSkuId: string): Promise<InventorySyncStatus> {
    const startTime = Date.now()
    
    try {
      const catalogSku = await AppDataSource.getRepository(CatalogSKU).findOne({
        where: { id: catalogSkuId },
        relations: ['print', 'print.card']
      })

      if (!catalogSku) {
        throw new Error(`Catalog SKU not found: ${catalogSkuId}`)
      }

      // This would integrate with commerce system to get actual inventory
      // For now, return mock data structure
      const syncStatus: InventorySyncStatus = {
        catalogSkuId,
        isActive: catalogSku.isActive,
        lastSyncAt: new Date(),
        syncIntervalMinutes: 15, // Default sync interval
        failureCount: 0,
        inventoryData: {
          hasB2cInventory: catalogSku.hasB2cInventory,
          hasC2cListings: catalogSku.hasC2cListings,
          vendorCount: catalogSku.vendorCount,
          totalQuantity: 0, // Would be calculated from vendor data
          lowestPrice: undefined,
          averagePrice: undefined
        }
      }

      logger.info('Inventory sync completed', {
        catalogSkuId,
        processingTime: Date.now() - startTime,
        hasInventory: syncStatus.inventoryData.hasB2cInventory || syncStatus.inventoryData.hasC2cListings
      })

      return syncStatus

    } catch (error) {
      logger.error('Inventory sync failed', error as Error, { catalogSkuId })
      throw error
    }
  }

  /**
   * Health check for SKU validation service
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string; metrics?: any }> {
    try {
      const testSku = 'MTG-DOM-001-EN-NM-NORMAL'
      const startTime = Date.now()
      
      await this.validateSKU(testSku)
      
      const responseTime = Date.now() - startTime

      return {
        healthy: true,
        metrics: {
          responseTimeMs: responseTime,
          validGameCodes: this.validGameCodes.size,
          validLanguageCodes: this.validLanguageCodes.size,
          validConditionCodes: this.validConditionCodes.size,
          validFinishCodes: this.validFinishCodes.size
        }
      }

    } catch (error) {
      return {
        healthy: false,
        error: (error as Error).message
      }
    }
  }
}