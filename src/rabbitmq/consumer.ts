import * as amqp from 'amqplib';
import { RabbitMQMessage } from '../types/message';
import { config } from '../config';
import logger from '../utils/logger';
import { isMessageProcessed, markMessageProcessed } from '../utils/idempotency';
import { SalesforceClient, OrderMessage } from '../services/salesforce-client';

export class RabbitMQConsumer {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private salesforceClient: SalesforceClient;
  private isProcessing = false;

  constructor(salesforceClient: SalesforceClient) {
    this.salesforceClient = salesforceClient;
  }

  async connect(): Promise<void> {
    try {
      logger.info('Consumer: Connecting to RabbitMQ', {
        url: config.rabbitmq.url,
      });
      this.connection = (await amqp.connect(config.rabbitmq.url) as unknown) as amqp.Connection;
      if (!this.connection) {
        throw new Error('Failed to establish RabbitMQ connection');
      }
      // @ts-ignore
      this.channel = await this.connection.createChannel();

      if (!this.channel) {
        throw new Error('Failed to create RabbitMQ channel');
      }

      await this.channel.assertQueue(config.rabbitmq.queue, {
        durable: true,
      });

      await this.channel.assertQueue(config.rabbitmq.dlq, {
        durable: true,
      });

      await this.channel.prefetch(1);

      logger.info('Consumer: Connected to RabbitMQ successfully');
    } catch (error) {
      logger.error('Consumer: Failed to connect to RabbitMQ', { error });
      throw error;
    }
  }

  async startConsuming(): Promise<void> {
    if (!this.channel) {
      throw new Error('Not connected to RabbitMQ');
    }

    logger.info('Consumer: Starting to consume messages', {
      queue: config.rabbitmq.queue,
    });

      await this.channel.consume(
      config.rabbitmq.queue,
      async (msg: amqp.ConsumeMessage | null) => {
        if (!msg) {
          return;
        }

        try {
          await this.processMessage(msg);
        } catch (error) {
          logger.error('Consumer: Error processing message', { error });
        }
      },
      {
        noAck: false,
      }
    );
  }

  private async processMessage(msg: amqp.ConsumeMessage): Promise<void> {
    if (!this.channel) {
      return;
    }

    let message: RabbitMQMessage;
    try {
      message = JSON.parse(msg.content.toString());
    } catch (error) {
      logger.error('Consumer: Failed to parse message', { error });
      this.channel.nack(msg, false, false);
      return;
    }

    const { messageId, event, payload } = message;

    logger.info('Consumer: Received message', {
      messageId,
      event,
      timestamp: message.timestamp,
    });

    if (isMessageProcessed(messageId)) {
      logger.warn('Consumer: Message already processed (duplicate)', {
        messageId,
      });
      this.channel.ack(msg);
      return;
    }

    try {
      await this.handleMessage(message);
      markMessageProcessed(messageId, 'success');
      // ACK - bericht succesvol verwerkt
      this.channel.ack(msg);
      logger.info('Consumer: Message processed successfully', { messageId });
    } catch (error: any) {
      logger.error('Consumer: Failed to process message', {
        messageId,
        error: error.message,
        statusCode: error.statusCode,
        isHerhaalbaar: error.isHerhaalbaar,
      });

      const isHerhaalbaar = error.isHerhaalbaar !== undefined ? error.isHerhaalbaar : true;
      const retryCount = (message.retryCount || 0) + 1;

      // Als het een herhaalbare fout is en we hebben nog retries over
      if (isHerhaalbaar && retryCount < config.rabbitmq.maxRetries) {
        logger.info('Consumer: Retrying message (herhaalbare fout)', {
          messageId,
          retryCount,
          maxRetries: config.rabbitmq.maxRetries,
          statusCode: error.statusCode,
        });

        message.retryCount = retryCount;
        const retryBuffer = Buffer.from(JSON.stringify(message));
        this.channel.sendToQueue(config.rabbitmq.queue, retryBuffer, {
          persistent: true,
          messageId: message.messageId,
        });
        // ACK het originele bericht (het wordt opnieuw in de queue gezet)
        this.channel.ack(msg);
      } else if (!isHerhaalbaar) {
        // Permanente fout (400, 4xx) - NACK zonder requeue
        logger.error('Consumer: Permanente fout - geen retry', {
          messageId,
          error: error.message,
          statusCode: error.statusCode,
        });
        this.channel.nack(msg, false, false); // requeue = false
        markMessageProcessed(messageId, 'failed', error.message);
      } else {
        // Max retries bereikt - stuur naar DLQ
        logger.error('Consumer: Max retries reached, sending to DLQ', {
          messageId,
          retryCount,
        });
        await this.sendToDLQ(message, error.message);
        this.channel.ack(msg);
        markMessageProcessed(messageId, 'failed', error.message);
      }
    }
  }

  private async handleMessage(message: RabbitMQMessage): Promise<void> {
    const { event, payload } = message;

    // Converteer naar OrderMessage formaat voor Salesforce
    if (event === 'CREATE_ORDER' || event === 'UPDATE_ORDER') {
      if (payload.order) {
        const orderMessage: OrderMessage = {
          id: payload.order.id,
          customerId: payload.order.customerId,
          amount: payload.order.amount,
          currency: payload.order.currency,
          items: payload.order.items,
          // Optionele velden voor Lead mapping
          brand: payload.customer?.name, // Gebruik customer name als brand
          name: payload.customer?.name,
        };

        const resultaat = await this.salesforceClient.stuurBestellingAsync(orderMessage);

        if (!resultaat.isSuccesvol) {
          // Gooi error met informatie over of retry nodig is
          const error = new Error(resultaat.foutmelding || 'Salesforce operatie mislukt');
          (error as any).isHerhaalbaar = resultaat.isHerhaalbaar;
          (error as any).statusCode = resultaat.statusCode;
          throw error;
        }

        logger.info('Salesforce: Bestelling succesvol verwerkt', {
          orderId: payload.order.id,
          leadId: resultaat.leadId,
        });
        return;
      }
    }

    // Voor customer events, maak ook een Lead aan
    if (event === 'CREATE_CUSTOMER' || event === 'UPDATE_CUSTOMER') {
      if (payload.customer) {
        // Voor customers maken we een Lead met customer informatie
        const orderMessage: OrderMessage = {
          id: payload.customer.id,
          customerId: payload.customer.id,
          amount: 0,
          currency: 'EUR',
          items: [],
          brand: payload.customer.name,
          name: payload.customer.name,
        };

        const resultaat = await this.salesforceClient.stuurBestellingAsync(orderMessage);

        if (!resultaat.isSuccesvol) {
          const error = new Error(resultaat.foutmelding || 'Salesforce operatie mislukt');
          (error as any).isHerhaalbaar = resultaat.isHerhaalbaar;
          (error as any).statusCode = resultaat.statusCode;
          throw error;
        }

        logger.info('Salesforce: Customer succesvol verwerkt', {
          customerId: payload.customer.id,
          leadId: resultaat.leadId,
        });
        return;
      }
    }

    throw new Error(`Onbekend event type: ${event}`);
  }

  private async sendToDLQ(
    message: RabbitMQMessage,
    error: string
  ): Promise<void> {
    if (!this.channel) {
      return;
    }

    const dlqMessage = {
      ...message,
      dlqReason: error,
      dlqTimestamp: new Date().toISOString(),
    };

    const dlqBuffer = Buffer.from(JSON.stringify(dlqMessage));
    this.channel.sendToQueue(config.rabbitmq.dlq, dlqBuffer, {
      persistent: true,
    });

    logger.error('Consumer: Message sent to DLQ', {
      messageId: message.messageId,
      error,
    });
  }

  async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        // @ts-ignore
        await this.connection.close();
      }
      logger.info('Consumer: RabbitMQ connection closed');
    } catch (error) {
      logger.error('Consumer: Error closing RabbitMQ connection', { error });
    }
  }
}
