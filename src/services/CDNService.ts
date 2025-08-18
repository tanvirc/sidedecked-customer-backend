/**
 * CDN Service for Cloudflare Integration
 * 
 * Handles CDN URL generation, cache management, and fallback logic
 * for the SideDecked TCG marketplace image delivery system.
 */

import { config } from '../config/env'
import { logger } from '../../packages/tcg-catalog/src/utils/Logger'

export interface CDNOptions {
  enableCache?: boolean
  cacheTTL?: number
  quality?: number
  format?: string
}

export interface ImageVariant {
  thumbnail?: string
  small?: string  
  normal?: string
  large?: string
  artCrop?: string
  borderCrop?: string
}

export class CDNService {
  private readonly baseUrl: string
  private readonly enabled: boolean
  private readonly defaultTTL: number
  private readonly failoverEnabled: boolean

  constructor() {
    this.baseUrl = config.CDN_BASE_URL || ''
    this.enabled = config.CDN_ENABLED || false
    this.defaultTTL = config.CDN_CACHE_TTL || 31536000
    this.failoverEnabled = config.CDN_FAILOVER_ENABLED !== false

    logger.info('CDN Service initialized', {
      enabled: this.enabled,
      baseUrl: this.baseUrl,
      failoverEnabled: this.failoverEnabled
    })
  }

  /**
   * Generate CDN URL for card images
   */
  generateImageUrl(imagePath: string, options: CDNOptions = {}): string {
    if (!this.enabled || !this.baseUrl) {
      logger.debug('CDN disabled or no base URL configured, returning original path')
      return imagePath
    }

    try {
      // Clean and normalize the image path
      const cleanPath = this.cleanImagePath(imagePath)
      
      // Build CDN URL with optional parameters
      let cdnUrl = `${this.baseUrl}/cards/${cleanPath}`
      
      // Add query parameters for optimization
      const params = new URLSearchParams()
      
      if (options.quality && options.quality !== 85) {
        params.append('quality', options.quality.toString())
      }
      
      if (options.format && options.format !== 'webp') {
        params.append('format', options.format)
      }
      
      if (options.cacheTTL && options.cacheTTL !== this.defaultTTL) {
        params.append('cache', options.cacheTTL.toString())
      }
      
      if (params.toString()) {
        cdnUrl += `?${params.toString()}`
      }
      
      logger.debug('Generated CDN URL', { 
        original: imagePath, 
        cdn: cdnUrl,
        options 
      })
      
      return cdnUrl
      
    } catch (error) {
      logger.warn('Failed to generate CDN URL, returning original', {
        imagePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return imagePath
    }
  }

  /**
   * Generate CDN URLs for all image variants
   */
  generateImageVariants(baseImagePath: string, variants: Record<string, string>): ImageVariant {
    const result: ImageVariant = {}
    
    for (const [variant, path] of Object.entries(variants)) {
      if (path) {
        result[variant as keyof ImageVariant] = this.generateImageUrl(path)
      }
    }
    
    return result
  }

  /**
   * Check if CDN is enabled and properly configured
   */
  isEnabled(): boolean {
    return this.enabled && !!this.baseUrl
  }

  /**
   * Get CDN configuration info
   */
  getConfig() {
    return {
      enabled: this.enabled,
      baseUrl: this.baseUrl,
      defaultTTL: this.defaultTTL,
      failoverEnabled: this.failoverEnabled,
      browserCacheTTL: config.CDN_BROWSER_CACHE_TTL,
      edgeCacheTTL: config.CDN_EDGE_CACHE_TTL
    }
  }

  /**
   * Generate cache purge URLs for Cloudflare API
   */
  generatePurgeUrls(imagePaths: string[]): string[] {
    if (!this.isEnabled()) {
      return []
    }

    return imagePaths.map(path => this.generateImageUrl(path))
  }

  /**
   * Purge CDN cache for specific images (requires Cloudflare API integration)
   */
  async purgeCache(imagePaths: string[]): Promise<boolean> {
    if (!this.isEnabled()) {
      logger.warn('CDN purge requested but CDN is disabled')
      return false
    }

    // TODO: Implement Cloudflare API integration for cache purging
    // This would require CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID
    logger.info('CDN cache purge requested', { 
      paths: imagePaths.length,
      enabled: this.enabled 
    })
    
    return true
  }

  /**
   * Get fallback URL strategy
   */
  getFallbackUrl(originalUrl: string, minioUrl: string): string {
    if (!this.failoverEnabled) {
      return originalUrl
    }

    // Priority: CDN -> MinIO -> External URL
    if (this.isEnabled() && !originalUrl.includes(this.baseUrl)) {
      return this.generateImageUrl(originalUrl)
    }
    
    return minioUrl || originalUrl
  }

  /**
   * Clean and normalize image path for CDN usage
   */
  private cleanImagePath(imagePath: string): string {
    // Remove leading slash
    let cleanPath = imagePath.startsWith('/') ? imagePath.substring(1) : imagePath
    
    // Remove protocol and domain if present
    if (cleanPath.startsWith('http')) {
      try {
        const url = new URL(cleanPath)
        cleanPath = url.pathname.substring(1) // Remove leading slash
      } catch {
        // If URL parsing fails, use as-is
      }
    }
    
    // Remove bucket name if present in path
    const pathParts = cleanPath.split('/').filter(Boolean)
    if (pathParts[0] === 'sidedecked-card-images' || pathParts[0] === 'sidedecked-images') {
      cleanPath = pathParts.slice(1).join('/')
    }
    
    return cleanPath
  }

  /**
   * Generate responsive image URLs for different screen densities
   */
  generateResponsiveUrls(imagePath: string, sizes: number[] = [1, 2, 3]): Record<string, string> {
    if (!this.isEnabled()) {
      return { '1x': imagePath }
    }

    const result: Record<string, string> = {}
    
    for (const scale of sizes) {
      const key = `${scale}x`
      result[key] = this.generateImageUrl(imagePath, {
        quality: scale === 1 ? 85 : Math.max(70, 85 - (scale - 1) * 5)
      })
    }
    
    return result
  }

  /**
   * Generate optimized URL for specific viewport/usage
   */
  generateOptimizedUrl(imagePath: string, context: 'thumbnail' | 'card-grid' | 'card-detail' | 'hero'): string {
    const optimizations: Record<string, CDNOptions> = {
      thumbnail: { quality: 75, format: 'webp' },
      'card-grid': { quality: 80, format: 'webp' },
      'card-detail': { quality: 90, format: 'webp' },
      hero: { quality: 95, format: 'webp' }
    }

    const options = optimizations[context] || { quality: 85, format: 'webp' }
    return this.generateImageUrl(imagePath, options)
  }
}

// Export singleton instance
export const cdnService = new CDNService()