import Bull from 'bull'
import { config } from '../config/env'
import { logger } from '../../packages/tcg-catalog/src/utils/Logger'

async function clearQueues() {
  try {
    const redisUrl = config.REDIS_URL || 'redis://localhost:6379'
    
    // Initialize the image processing queue
    const imageQueue = new Bull('image-processing', redisUrl)
    
    logger.info('🔄 Clearing Bull queues...')
    
    // Clear all jobs in different states
    await imageQueue.empty()  // Remove waiting jobs
    await imageQueue.clean(0, 'completed')  // Remove completed jobs
    await imageQueue.clean(0, 'failed')  // Remove failed jobs
    await imageQueue.clean(0, 'delayed')  // Remove delayed jobs
    await imageQueue.clean(0, 'wait')  // Remove waiting jobs
    await imageQueue.clean(0, 'active')  // Remove active jobs
    await imageQueue.clean(0, 'paused')  // Remove paused jobs
    
    // Force remove any remaining jobs
    await imageQueue.obliterate({ force: true })
    
    // Get counts to verify
    const counts = await imageQueue.getJobCounts()
    logger.info('Queue counts after clearing:', counts)
    
    // Close the queue connection
    await imageQueue.close()
    
    logger.info('✅ All Bull queues cleared successfully')
    process.exit(0)
  } catch (error) {
    logger.error('Failed to clear queues', error as Error)
    process.exit(1)
  }
}

clearQueues()