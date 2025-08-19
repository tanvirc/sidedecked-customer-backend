import Bull from 'bull'
import { config } from '../config/env'
import { logger } from '../../packages/tcg-catalog/src/utils/Logger'

async function resumeQueue() {
  try {
    const redisUrl = config.REDIS_URL || 'redis://localhost:6379'
    const imageQueue = new Bull('image-processing', redisUrl)
    
    logger.info('📊 Resuming queue...')
    
    // Check if paused
    const wasPaused = await imageQueue.isPaused()
    logger.info(`Queue was paused: ${wasPaused}`)
    
    // Resume the queue
    await imageQueue.resume()
    
    // Verify it's resumed
    const isPaused = await imageQueue.isPaused()
    logger.info(`Queue is now paused: ${isPaused}`)
    
    // Get counts
    const counts = await imageQueue.getJobCounts()
    logger.info('Queue counts:', counts)
    
    await imageQueue.close()
    logger.info('✅ Queue resumed successfully')
    process.exit(0)
  } catch (error) {
    logger.error('Failed to resume queue', error as Error)
    process.exit(1)
  }
}

resumeQueue()