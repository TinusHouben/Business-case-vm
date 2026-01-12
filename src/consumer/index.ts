import { RabbitMQConsumer } from '../rabbitmq/consumer';
import { SalesforceAuthService } from '../services/salesforce-auth';
import { SalesforceClient } from '../services/salesforce-client';
import { config, validateConfig } from '../config';
import logger from '../utils/logger';

async function startConsumer() {
  try {
    validateConfig();

    logger.info('Starting Consumer Service...');

    // Initialiseer Salesforce services
    const salesforceAuthService = new SalesforceAuthService();
    const salesforceClient = new SalesforceClient(salesforceAuthService);

    // Test authenticatie bij opstarten
    try {
      await salesforceAuthService.haalAccessTokenOpAsync();
      logger.info('Salesforce: Authenticatie succesvol getest');
    } catch (error: any) {
      logger.error('Salesforce: Authenticatie test mislukt', {
        error: error.message,
      });
      throw error;
    }

    // Initialiseer RabbitMQ consumer
    const consumer = new RabbitMQConsumer(salesforceClient);
    await consumer.connect();
    await consumer.startConsuming();

    logger.info('Consumer Service is running and listening for messages');

    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down consumer');
      await consumer.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down consumer');
      await consumer.close();
      process.exit(0);
    });
  } catch (error: any) {
    logger.error('Failed to start consumer service', { error: error.message });
    process.exit(1);
  }
}

startConsumer();
