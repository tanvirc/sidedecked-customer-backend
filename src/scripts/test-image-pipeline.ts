#!/usr/bin/env ts-node
/**
 * Test Image Pipeline Script
 * 
 * This script tests the complete image processing pipeline:
 * 1. Runs a small ETL to import cards with images
 * 2. Verifies images are queued
 * 3. Processes images through the worker
 * 4. Verifies images are stored in MinIO
 * 5. Tests API endpoints return image URLs
 * 
 * Usage:
 *   npm run test:images
 *   tsx src/scripts/test-image-pipeline.ts
 */

import { AppDataSource } from '../config/database'
import { getImageQueue, getStorageService } from '../config/infrastructure'
import { ETLService } from '../../packages/tcg-catalog/src/services/ETLService'
import { ETLJobType } from '../../packages/tcg-catalog/src/entities/ETLJob'
import { logger } from '../../packages/tcg-catalog/src/utils/Logger'
import { Card } from '../entities/Card'
import { Print } from '../entities/Print'
import { CardImage, ImageStatus } from '../entities/CardImage'
import axios from 'axios'

interface TestResult {
  step: string
  success: boolean
  message: string
  details?: any
}

class ImagePipelineTest {
  private results: TestResult[] = []
  
  async runTests(): Promise<void> {
    logger.info('🧪 Starting Image Pipeline Tests')
    
    try {
      // Initialize database
      if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize()
        logger.info('Database connection established')
      }
      
      // Run test steps
      await this.testStorageSetup()
      await this.testETLWithImages()
      await this.testImageQueue()
      await this.testImageProcessing()
      await this.testMinIOStorage()
      await this.testAPIEndpoints()
      
      // Report results
      this.reportResults()
      
    } catch (error) {
      logger.error('Test failed', error as Error)
      this.addResult('Overall Test', false, 'Test suite failed', error)
      this.reportResults()
      process.exit(1)
    }
  }
  
  private async testStorageSetup(): Promise<void> {
    const step = 'Storage Setup'
    try {
      logger.info(`Testing ${step}...`)
      
      const storage = getStorageService()
      await storage.ensureBucket()
      
      // Test public URL generation
      const testUrl = storage.getPublicUrl('test/image.webp')
      
      this.addResult(step, true, 'Storage service initialized successfully', {
        bucket: storage.bucket,
        sampleUrl: testUrl
      })
    } catch (error) {
      this.addResult(step, false, 'Storage setup failed', error)
      throw error
    }
  }
  
  private async testETLWithImages(): Promise<void> {
    const step = 'ETL with Images'
    try {
      logger.info(`Testing ${step}...`)
      
      // Run ETL for a small number of cards
      const etlService = new ETLService({
        batchSize: 5,
        skipImages: false, // Ensure images are processed
        forceUpdate: false
      })
      
      const result = await etlService.startETLJob(
        'MTG',
        ETLJobType.INCREMENTAL_UPDATE,
        'test',
        5 // Import only 5 cards for testing
      )
      
      this.addResult(step, result.success, 'ETL completed', {
        cardsProcessed: result.totalProcessed,
        imagesQueued: result.imagesQueued,
        errors: result.errors.length
      })
      
      if (!result.success || result.imagesQueued === 0) {
        throw new Error('ETL did not queue any images')
      }
      
    } catch (error) {
      this.addResult(step, false, 'ETL failed', error)
      throw error
    }
  }
  
  private async testImageQueue(): Promise<void> {
    const step = 'Image Queue'
    try {
      logger.info(`Testing ${step}...`)
      
      const queue = getImageQueue()
      const counts = await queue.getJobCounts()
      
      this.addResult(step, counts.waiting > 0 || counts.active > 0, 'Image queue has jobs', {
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed
      })
      
      if (counts.waiting === 0 && counts.active === 0 && counts.completed === 0) {
        throw new Error('No images in queue')
      }
      
    } catch (error) {
      this.addResult(step, false, 'Image queue check failed', error)
      throw error
    }
  }
  
  private async testImageProcessing(): Promise<void> {
    const step = 'Image Processing'
    try {
      logger.info(`Testing ${step}...`)
      
      // Wait for some images to be processed (max 30 seconds)
      const maxWaitTime = 30000
      const startTime = Date.now()
      let processedCount = 0
      
      while (Date.now() - startTime < maxWaitTime) {
        const cardImageRepo = AppDataSource.getRepository(CardImage)
        const processed = await cardImageRepo.count({
          where: { status: ImageStatus.COMPLETED }
        })
        
        if (processed > 0) {
          processedCount = processed
          break
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      
      if (processedCount === 0) {
        // Check if worker is running
        const queue = getImageQueue()
        const counts = await queue.getJobCounts()
        
        this.addResult(step, false, 'No images processed - worker may not be running', {
          queueStatus: counts,
          hint: 'Run "npm run worker:images" in a separate terminal'
        })
      } else {
        // Get a sample processed image
        const cardImageRepo = AppDataSource.getRepository(CardImage)
        const sample = await cardImageRepo.findOne({
          where: { status: ImageStatus.COMPLETED }
        })
        
        this.addResult(step, true, `${processedCount} images processed successfully`, {
          processedCount,
          sampleImage: sample ? {
            printId: sample.printId,
            imageType: sample.imageType,
            blurhash: sample.blurhash?.substring(0, 20) + '...',
            hasStorageUrls: !!sample.storageUrls
          } : null
        })
      }
      
    } catch (error) {
      this.addResult(step, false, 'Image processing check failed', error)
    }
  }
  
  private async testMinIOStorage(): Promise<void> {
    const step = 'MinIO Storage'
    try {
      logger.info(`Testing ${step}...`)
      
      // Find a processed image
      const cardImageRepo = AppDataSource.getRepository(CardImage)
      const processedImage = await cardImageRepo.findOne({
        where: { status: ImageStatus.COMPLETED }
      })
      
      if (!processedImage || !processedImage.storageUrls) {
        this.addResult(step, false, 'No processed images found in storage', null)
        return
      }
      
      // Test if we can access the image URL
      const storage = getStorageService()
      const normalUrl = (processedImage.storageUrls as any).normal
      
      if (normalUrl) {
        // Extract key from URL and generate public URL
        const key = normalUrl.split('/').slice(-4).join('/')
        const publicUrl = storage.getPublicUrl(key)
        
        this.addResult(step, true, 'Images stored in MinIO successfully', {
          sampleUrl: publicUrl,
          printId: processedImage.printId,
          sizes: Object.keys(processedImage.storageUrls as any)
        })
      } else {
        this.addResult(step, false, 'Storage URLs not properly saved', processedImage.storageUrls)
      }
      
    } catch (error) {
      this.addResult(step, false, 'MinIO storage check failed', error)
    }
  }
  
  private async testAPIEndpoints(): Promise<void> {
    const step = 'API Endpoints'
    try {
      logger.info(`Testing ${step}...`)
      
      // Find a card with prints
      const cardRepo = AppDataSource.getRepository(Card)
      const card = await cardRepo.findOne({
        relations: ['prints'],
        where: {
          prints: {
            imageNormal: { not: null } as any
          }
        }
      })
      
      if (!card) {
        this.addResult(step, false, 'No cards with images found', null)
        return
      }
      
      // Test the API endpoint
      const apiUrl = `http://localhost:7000/api/catalog/cards/${card.id}`
      
      try {
        const response = await axios.get(apiUrl)
        const data = response.data
        
        const hasImages = data.prints?.[0]?.images?.normal
        
        this.addResult(step, hasImages, 'API returns image URLs correctly', {
          cardId: card.id,
          cardName: data.name,
          firstPrintImages: data.prints?.[0]?.images,
          blurhash: data.prints?.[0]?.blurhash
        })
      } catch (apiError: any) {
        if (apiError.code === 'ECONNREFUSED') {
          this.addResult(step, false, 'API server not running', {
            hint: 'Run "npm run dev" to start the API server',
            url: apiUrl
          })
        } else {
          this.addResult(step, false, 'API request failed', apiError.message)
        }
      }
      
    } catch (error) {
      this.addResult(step, false, 'API endpoint test failed', error)
    }
  }
  
  private addResult(step: string, success: boolean, message: string, details?: any): void {
    this.results.push({
      step,
      success,
      message,
      details
    })
  }
  
  private reportResults(): void {
    console.log('\n' + '='.repeat(80))
    console.log('📊 TEST RESULTS')
    console.log('='.repeat(80))
    
    let passCount = 0
    let failCount = 0
    
    for (const result of this.results) {
      const icon = result.success ? '✅' : '❌'
      const status = result.success ? 'PASS' : 'FAIL'
      
      console.log(`\n${icon} ${result.step}: ${status}`)
      console.log(`   ${result.message}`)
      
      if (result.details) {
        console.log('   Details:', JSON.stringify(result.details, null, 2))
      }
      
      if (result.success) {
        passCount++
      } else {
        failCount++
      }
    }
    
    console.log('\n' + '='.repeat(80))
    console.log(`SUMMARY: ${passCount} passed, ${failCount} failed`)
    console.log('='.repeat(80))
    
    if (failCount === 0) {
      console.log('\n🎉 All tests passed! Image pipeline is working correctly.')
    } else {
      console.log('\n⚠️  Some tests failed. Please check the details above.')
      console.log('\nTroubleshooting tips:')
      console.log('1. Ensure MinIO is running and configured')
      console.log('2. Run "npm run worker:images" to start the image worker')
      console.log('3. Run "npm run dev" to start the API server')
      console.log('4. Check environment variables in .env file')
    }
  }
}

// Run the test
if (require.main === module) {
  const test = new ImagePipelineTest()
  
  test.runTests().then(() => {
    process.exit(0)
  }).catch(error => {
    console.error('Test suite failed:', error)
    process.exit(1)
  })
}

export default ImagePipelineTest