import Bull from 'bull'
import { config } from '../config/env'
import { logger } from '../../packages/tcg-catalog/src/utils/Logger'

async function checkFailedJobs() {
  try {
    const redisUrl = config.REDIS_URL || 'redis://localhost:6379'
    const imageQueue = new Bull('image-processing', redisUrl)
    
    logger.info('📊 Checking failed jobs...')
    
    // Get failed jobs
    const failedJobs = await imageQueue.getFailed(0, 10) // Get first 10 failed jobs
    
    if (failedJobs.length > 0) {
      logger.info(`Found ${failedJobs.length} failed jobs:`)
      
      for (const job of failedJobs) {
        console.log('\n-------------------')
        console.log('Job ID:', job.id)
        console.log('Job Data:', JSON.stringify(job.data, null, 2))
        console.log('Failed Reason:', job.failedReason)
        console.log('Stack Trace:', job.stacktrace?.slice(0, 500))
      }
      
      // Clean up failed jobs
      logger.info('\n🧹 Cleaning failed jobs...')
      await imageQueue.clean(0, 'failed')
      logger.info('✅ Failed jobs cleaned')
    } else {
      logger.info('No failed jobs found')
    }
    
    // Check delayed jobs
    const delayedJobs = await imageQueue.getDelayed()
    if (delayedJobs.length > 0) {
      logger.info(`\nFound ${delayedJobs.length} delayed jobs`)
      for (const job of delayedJobs) {
        console.log('Delayed Job ID:', job.id)
        console.log('Delayed Job Data:', JSON.stringify(job.data, null, 2))
      }
    }
    
    await imageQueue.close()
    process.exit(0)
  } catch (error) {
    logger.error('Failed to check jobs', error as Error)
    process.exit(1)
  }
}

checkFailedJobs()