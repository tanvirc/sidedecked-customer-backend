import axios, { AxiosInstance } from 'axios'
import { logger } from '../utils/Logger'
import { CatalogSKU } from '../entities/CatalogSKU'
import { Card } from '../entities/Card'
import { Print } from '../entities/Print'
import { AppDataSource } from '../../../../src/config/database'

export interface CommerceConfig {
  mercurBackendUrl: string
  mercurApiKey: string
  timeout: number
  retryAttempts: number
}

export interface VendorProduct {
  id: string
  handle: string
  title: string
  description?: string
  variants: VendorVariant[]
  vendor_id: string
  collection_id?: string
  type_id?: string
  weight?: number
  length?: number
  height?: number
  width?: number
  hs_code?: string
  mid_code?: string
  material?: string
  country_of_origin?: string
  metadata?: Record<string, any>
}

export interface VendorVariant {
  id: string
  title: string
  sku?: string
  barcode?: string
  inventory_quantity: number
  allow_backorder: boolean
  manage_inventory: boolean
  weight?: number
  length?: number
  height?: number
  width?: number
  prices: VendorPrice[]
  options?: VendorOption[]
  metadata?: Record<string, any>
}

export interface VendorPrice {
  id: string
  currency_code: string
  amount: number
  min_quantity?: number
  max_quantity?: number
}

export interface VendorOption {
  id: string
  value: string
  option_id: string
}

export interface ProductMatchResult {
  success: boolean
  catalogSku?: CatalogSKU
  card?: Card
  print?: Print
  confidence: number
  matchType: 'exact' | 'fuzzy' | 'manual' | 'unmatched'
  suggestions?: Array<{
    catalogSku: CatalogSKU
    card: Card
    print: Print
    confidence: number
  }>
  error?: string
}

export interface SKUValidationResult {
  valid: boolean
  catalogSku?: CatalogSKU
  errors: string[]
  suggestions?: string[]
}

export interface InventorySync {
  catalogSkuId: string
  vendorProductId: string
  vendorVariantId: string
  lastSyncAt: Date
  isActive: boolean
  syncErrors: string[]
}

export class CommerceIntegrationService {
  private mercurClient: AxiosInstance
  private config: CommerceConfig

  constructor(config: CommerceConfig) {
    this.config = config
    this.mercurClient = axios.create({
      baseURL: config.mercurBackendUrl,
      timeout: config.timeout,
      headers: {
        'Authorization': `Bearer ${config.mercurApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SideDecked/1.0 Commerce Integration'
      }
    })

    // Request/response interceptors
    this.mercurClient.interceptors.request.use(
      (config) => {
        logger.debug('Commerce API request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          hasData: !!config.data
        })
        return config
      },
      (error) => {
        logger.error('Commerce API request error', error)
        return Promise.reject(error)
      }
    )

    this.mercurClient.interceptors.response.use(
      (response) => {
        logger.debug('Commerce API response', {
          status: response.status,
          url: response.config.url
        })
        return response
      },
      (error) => {
        logger.error('Commerce API response error', error, {
          status: error.response?.status,
          url: error.config?.url
        })
        return Promise.reject(error)
      }
    )
  }

  /**
   * Match a vendor product to catalog items
   */
  async matchProductToCatalog(vendorProduct: VendorProduct): Promise<ProductMatchResult> {
    logger.info('Starting product matching', {
      productId: vendorProduct.id,
      title: vendorProduct.title,
      variantCount: vendorProduct.variants.length
    })

    try {
      // Try to match by SKU first (most reliable)
      for (const variant of vendorProduct.variants) {
        if (variant.sku) {
          const skuMatch = await this.matchBySKU(variant.sku)
          if (skuMatch.success) {
            logger.info('Product matched by SKU', {
              productId: vendorProduct.id,
              sku: variant.sku,
              confidence: skuMatch.confidence
            })
            return skuMatch
          }
        }
      }

      // Try fuzzy matching by product title
      const fuzzyMatch = await this.matchByTitle(vendorProduct.title)
      if (fuzzyMatch.success) {
        logger.info('Product matched by title', {
          productId: vendorProduct.id,
          title: vendorProduct.title,
          confidence: fuzzyMatch.confidence
        })
        return fuzzyMatch
      }

      // No match found
      return {
        success: false,
        confidence: 0,
        matchType: 'unmatched',
        error: 'No matching catalog items found'
      }

    } catch (error) {
      logger.error('Product matching failed', error as Error, {
        productId: vendorProduct.id
      })
      
      return {
        success: false,
        confidence: 0,
        matchType: 'unmatched',
        error: (error as Error).message
      }
    }
  }

  /**
   * Match by exact SKU
   */
  private async matchBySKU(sku: string): Promise<ProductMatchResult> {
    try {
      const catalogSku = await AppDataSource.getRepository(CatalogSKU).findOne({
        where: { sku },
        relations: ['print', 'print.card', 'print.set']
      })

      if (!catalogSku) {
        return {
          success: false,
          confidence: 0,
          matchType: 'unmatched',
          error: 'SKU not found in catalog'
        }
      }

      return {
        success: true,
        catalogSku,
        card: catalogSku.print.card,
        print: catalogSku.print,
        confidence: 1.0,
        matchType: 'exact'
      }

    } catch (error) {
      logger.error('SKU matching failed', error as Error, { sku })
      throw error
    }
  }

  /**
   * Match by fuzzy title search
   */
  private async matchByTitle(title: string): Promise<ProductMatchResult> {
    try {
      // Clean and normalize the title for search
      const normalizedTitle = this.normalizeProductTitle(title)
      
      // Search for cards with similar names
      const cards = await AppDataSource.getRepository(Card).createQueryBuilder('card')
        .where('card.normalizedName ILIKE :title', { title: `%${normalizedTitle}%` })
        .orWhere('card.name ILIKE :originalTitle', { originalTitle: `%${title}%` })
        .leftJoinAndSelect('card.prints', 'prints')
        .leftJoinAndSelect('prints.skus', 'skus')
        .limit(5)
        .getMany()

      if (cards.length === 0) {
        return {
          success: false,
          confidence: 0,
          matchType: 'unmatched',
          error: 'No cards found with similar names'
        }
      }

      // Calculate confidence scores and create suggestions
      const suggestions: ProductMatchResult['suggestions'] = []
      
      for (const card of cards) {
        const confidence = this.calculateTitleSimilarity(title, card.name)
        
        if (card.prints && card.prints.length > 0) {
          const print = card.prints[0] // Use most recent print
          const catalogSku = print.skus?.[0] // Use first SKU
          
          if (catalogSku) {
            suggestions.push({
              catalogSku,
              card,
              print,
              confidence
            })
          }
        }
      }

      // Sort by confidence
      suggestions.sort((a, b) => b.confidence - a.confidence)

      if (suggestions.length > 0 && suggestions[0].confidence >= 0.7) {
        // High confidence match
        const bestMatch = suggestions[0]
        return {
          success: true,
          catalogSku: bestMatch.catalogSku,
          card: bestMatch.card,
          print: bestMatch.print,
          confidence: bestMatch.confidence,
          matchType: 'fuzzy',
          suggestions
        }
      }

      return {
        success: false,
        confidence: 0,
        matchType: 'unmatched',
        suggestions,
        error: 'No high-confidence matches found'
      }

    } catch (error) {
      logger.error('Title matching failed', error as Error, { title })
      throw error
    }
  }

  /**
   * Validate vendor SKU format
   */
  async validateSKU(sku: string): Promise<SKUValidationResult> {
    try {
      const errors: string[] = []
      const suggestions: string[] = []

      // Check if SKU exists in catalog
      const catalogSku = await AppDataSource.getRepository(CatalogSKU).findOne({
        where: { sku },
        relations: ['print', 'print.card', 'print.set']
      })

      if (!catalogSku) {
        errors.push('SKU not found in catalog')
        
        // Try to suggest similar SKUs
        const similarSkus = await AppDataSource.getRepository(CatalogSKU)
          .createQueryBuilder('sku')
          .where('sku.sku ILIKE :pattern', { pattern: `${sku.substring(0, 10)}%` })
          .limit(5)
          .getMany()

        suggestions.push(...similarSkus.map((s: CatalogSKU) => s.sku))
      }

      // Validate SKU format
      const skuPattern = /^[A-Z]+[-][A-Z0-9]+[-][A-Z0-9]+[-][A-Z]{2}[-][A-Z]{2,3}[-][A-Z]+(?:[-][A-Z]+[0-9]+)?$/
      if (!skuPattern.test(sku)) {
        errors.push('SKU format invalid. Expected: GAME-SET-NUMBER-LANG-CONDITION-FINISH[-GRADE]')
      }

      return {
        valid: errors.length === 0,
        catalogSku: catalogSku || undefined,
        errors,
        suggestions
      }

    } catch (error) {
      logger.error('SKU validation failed', error as Error, { sku })
      return {
        valid: false,
        errors: [(error as Error).message],
        suggestions: []
      }
    }
  }

  /**
   * Sync inventory between commerce and catalog systems
   */
  async syncInventory(catalogSkuId: string, vendorProductId: string, vendorVariantId: string): Promise<InventorySync> {
    logger.info('Starting inventory sync', {
      catalogSkuId,
      vendorProductId,
      vendorVariantId
    })

    const syncResult: InventorySync = {
      catalogSkuId,
      vendorProductId,
      vendorVariantId,
      lastSyncAt: new Date(),
      isActive: true,
      syncErrors: []
    }

    try {
      // Get current inventory from MercurJS
      const response = await this.mercurClient.get(`/admin/variants/${vendorVariantId}`)
      const variant = response.data.variant

      // Update catalog SKU inventory flags
      await AppDataSource.getRepository(CatalogSKU).update(catalogSkuId, {
        hasB2cInventory: variant.inventory_quantity > 0,
        vendorCount: variant.inventory_quantity > 0 ? 1 : 0, // Simplified for now
        updatedAt: new Date()
      })

      logger.info('Inventory sync completed', {
        catalogSkuId,
        inventoryQuantity: variant.inventory_quantity,
        hasInventory: variant.inventory_quantity > 0
      })

    } catch (error) {
      const errorMessage = (error as Error).message
      syncResult.syncErrors.push(errorMessage)
      syncResult.isActive = false

      logger.error('Inventory sync failed', error as Error, {
        catalogSkuId,
        vendorProductId,
        vendorVariantId
      })
    }

    return syncResult
  }

  /**
   * Create or update vendor product in MercurJS
   */
  async createVendorProduct(catalogSku: CatalogSKU, vendorId: string, price: number): Promise<VendorProduct> {
    logger.info('Creating vendor product', {
      catalogSkuId: catalogSku.id,
      vendorId,
      price
    })

    try {
      const card = catalogSku.print.card
      const print = catalogSku.print

      const productData = {
        title: `${card.name} - ${print.set?.name || 'Unknown Set'}`,
        handle: this.generateProductHandle(card.name, print.set?.code || catalogSku.setCode, print.collectorNumber),
        description: this.buildProductDescription(card, print),
        vendor_id: vendorId,
        type_id: await this.getOrCreateProductType(card.primaryType),
        metadata: {
          catalogSkuId: catalogSku.id,
          cardId: card.id,
          printId: print.id,
          gameCode: catalogSku.gameCode,
          setCode: catalogSku.setCode,
          collectorNumber: catalogSku.collectorNumber,
          rarity: print.rarity
        },
        variants: [{
          title: `${catalogSku.conditionCode} - ${catalogSku.finishCode}`,
          sku: catalogSku.sku,
          inventory_quantity: 1,
          manage_inventory: true,
          allow_backorder: false,
          prices: [{
            currency_code: 'USD',
            amount: Math.round(price * 100) // Convert to cents
          }],
          metadata: {
            condition: catalogSku.conditionCode,
            finish: catalogSku.finishCode,
            language: catalogSku.languageCode
          }
        }]
      }

      const response = await this.mercurClient.post('/admin/products', productData)
      const product = response.data.product

      logger.info('Vendor product created', {
        productId: product.id,
        catalogSkuId: catalogSku.id,
        sku: catalogSku.sku
      })

      return product

    } catch (error) {
      logger.error('Failed to create vendor product', error as Error, {
        catalogSkuId: catalogSku.id,
        vendorId
      })
      throw error
    }
  }

  /**
   * Get vendor products from MercurJS
   */
  async getVendorProducts(vendorId: string, limit: number = 100, offset: number = 0): Promise<VendorProduct[]> {
    try {
      const response = await this.mercurClient.get('/admin/products', {
        params: {
          vendor_id: vendorId,
          limit,
          offset
        }
      })

      return response.data.products || []

    } catch (error) {
      logger.error('Failed to fetch vendor products', error as Error, { vendorId, limit, offset })
      throw error
    }
  }

  /**
   * Helper methods
   */
  private normalizeProductTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
  }

  private calculateTitleSimilarity(title1: string, title2: string): number {
    const norm1 = this.normalizeProductTitle(title1)
    const norm2 = this.normalizeProductTitle(title2)
    
    // Simple Jaccard similarity
    const set1 = new Set(norm1.split(' '))
    const set2 = new Set(norm2.split(' '))
    
    const intersection = new Set([...set1].filter(x => set2.has(x)))
    const union = new Set([...set1, ...set2])
    
    return intersection.size / union.size
  }

  private generateProductHandle(cardName: string, setCode: string, collectorNumber: string): string {
    const normalized = `${cardName}-${setCode}-${collectorNumber}`
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    
    return normalized.substring(0, 128) // MercurJS handle limit
  }

  private buildProductDescription(card: Card, print: Print): string {
    const parts: string[] = []
    
    parts.push(`**${card.name}**`)
    
    if (print.set?.name) {
      parts.push(`From ${print.set.name} (${print.set.code})`)
    }
    
    if (card.primaryType) {
      parts.push(`Type: ${card.primaryType}`)
    }
    
    if (card.oracleText) {
      parts.push('', card.oracleText)
    }
    
    if (print.flavorText) {
      parts.push('', `*"${print.flavorText}"*`)
    }
    
    if (print.artist) {
      parts.push('', `Artist: ${print.artist}`)
    }
    
    return parts.join('\n')
  }

  private async getOrCreateProductType(typeName: string): Promise<string> {
    // This would integrate with MercurJS product types
    // For now, return a placeholder
    return 'tcg-card'
  }

  /**
   * Health check for commerce integration
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const response = await this.mercurClient.get('/admin/regions')
      
      if (response.status === 200) {
        return { healthy: true }
      }
      
      return { healthy: false, error: `Unexpected status: ${response.status}` }

    } catch (error) {
      return { healthy: false, error: (error as Error).message }
    }
  }
}