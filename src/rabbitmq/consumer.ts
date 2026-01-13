// src/rabbitmq/consumer.ts  (pas het pad aan als jouw project een andere mapnaam gebruikt)
import * as amqp from "amqplib";
import { RabbitMQMessage, EventType } from "../types/message";
import { config } from "../config";
import logger from "../utils/logger";
import { isMessageProcessed, markMessageProcessed } from "../utils/idempotency";

import { SalesforceRefreshService } from "../services/salesforce-refresh";

/**
 * Deze consumer schrijft naar jouw custom objects:
 * - CustomerCustom__c (upsert via ExternalId__c)
 * - OrderCustom__c (create + lookup CustomerC__c)
 *
 * Auth: refresh-token flow (SalesforceRefreshService)
 */
export class RabbitMQConsumer {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;

  private sf = new SalesforceRefreshService();

  async connect(): Promise<void> {
    try {
      logger.info("Consumer: Connecting to RabbitMQ", { url: config.rabbitmq.url });

      this.connection = (await amqp.connect(config.rabbitmq.url) as unknown) as amqp.Connection;
      if (!this.connection) throw new Error("Failed to establish RabbitMQ connection");

      // @ts-ignore
      this.channel = await this.connection.createChannel();
      if (!this.channel) throw new Error("Failed to create RabbitMQ channel");

      await this.channel.assertQueue(config.rabbitmq.queue, { durable: true });
      await this.channel.assertQueue(config.rabbitmq.dlq, { durable: true });

      await this.channel.prefetch(1);

      logger.info("Consumer: Connected to RabbitMQ successfully");
    } catch (error) {
      logger.error("Consumer: Failed to connect to RabbitMQ", { error });
      throw error;
    }
  }

  async startConsuming(): Promise<void> {
    if (!this.channel) throw new Error("Not connected to RabbitMQ");

    logger.info("Consumer: Starting to consume messages", { queue: config.rabbitmq.queue });

    await this.channel.consume(
      config.rabbitmq.queue,
      async (msg: amqp.ConsumeMessage | null) => {
        if (!msg) return;

        try {
          await this.processMessage(msg);
        } catch (error) {
          logger.error("Consumer: Error processing message", { error });
        }
      },
      { noAck: false }
    );
  }

  private async processMessage(msg: amqp.ConsumeMessage): Promise<void> {
    if (!this.channel) return;

    let message: RabbitMQMessage;
    try {
      message = JSON.parse(msg.content.toString());
    } catch (error) {
      logger.error("Consumer: Failed to parse message", { error });
      this.channel.nack(msg, false, false);
      return;
    }

    const { messageId, event } = message;

    logger.info("Consumer: Received message", {
      messageId,
      event,
      timestamp: message.timestamp,
      retryCount: message.retryCount ?? 0,
    });

    if (isMessageProcessed(messageId)) {
      logger.warn("Consumer: Message already processed (duplicate)", { messageId });
      this.channel.ack(msg);
      return;
    }

    try {
      await this.handleMessage(message);

      markMessageProcessed(messageId, "success");
      this.channel.ack(msg);

      logger.info("Consumer: Message processed successfully", { messageId });
    } catch (error: any) {
      logger.error("Consumer: Failed to process message", {
        messageId,
        error: error?.message,
        statusCode: error?.statusCode,
        isHerhaalbaar: error?.isHerhaalbaar,
      });

      const isHerhaalbaar = error?.isHerhaalbaar !== undefined ? error.isHerhaalbaar : true;
      const retryCount = (message.retryCount || 0) + 1;

      if (isHerhaalbaar && retryCount < config.rabbitmq.maxRetries) {
        logger.info("Consumer: Retrying message (herhaalbare fout)", {
          messageId,
          retryCount,
          maxRetries: config.rabbitmq.maxRetries,
          statusCode: error?.statusCode,
        });

        message.retryCount = retryCount;

        const retryBuffer = Buffer.from(JSON.stringify(message));
        this.channel.sendToQueue(config.rabbitmq.queue, retryBuffer, {
          persistent: true,
          messageId: message.messageId,
        });

        // ACK origineel; we hebben een nieuwe copy ge-enqueued
        this.channel.ack(msg);
      } else if (!isHerhaalbaar) {
        logger.error("Consumer: Permanente fout - geen retry", {
          messageId,
          error: error?.message,
          statusCode: error?.statusCode,
        });

        this.channel.nack(msg, false, false);
        markMessageProcessed(messageId, "failed", error?.message);
      } else {
        logger.error("Consumer: Max retries reached, sending to DLQ", {
          messageId,
          retryCount,
        });

        await this.sendToDLQ(message, error?.message || "Unknown error");
        this.channel.ack(msg);
        markMessageProcessed(messageId, "failed", error?.message);
      }
    }
  }

  private async handleMessage(message: RabbitMQMessage): Promise<void> {
    const { event, payload } = message;

    // We verwachten voor order events: payload.order + payload.customer
    if (event === EventType.CREATE_ORDER || event === EventType.UPDATE_ORDER) {
      if (!payload.order) throw this.permanentError("payload.order ontbreekt");
      if (!payload.customer) throw this.permanentError("payload.customer ontbreekt (nodig voor upsert)");

      const customerExternalId = payload.customer.id;
      const orderExternalId = payload.order.id;

      // 1) Upsert customer + haal SF Id op
      const customerSfId = await this.upsertCustomerAndGetId({
        externalId: customerExternalId,
        name: payload.customer.name,
        email: payload.customer.email,
        phone: payload.customer.phone,
      });

      // 2) Create order + link CustomerC__c
      const orderSfId = await this.createOrder({
        externalOrderId: orderExternalId,
        total: payload.order.amount,
        status: "NEW",
        customerSfId,
      });

      logger.info("Salesforce: Order synced", {
        messageId: message.messageId,
        customerExternalId,
        customerSfId,
        orderExternalId,
        orderSfId,
      });

      return;
    }

    // Customer-only events (optioneel): enkel customer upsert
    if (event === EventType.CREATE_CUSTOMER || event === EventType.UPDATE_CUSTOMER) {
      if (!payload.customer) throw this.permanentError("payload.customer ontbreekt");

      const customerSfId = await this.upsertCustomerAndGetId({
        externalId: payload.customer.id,
        name: payload.customer.name,
        email: payload.customer.email,
        phone: payload.customer.phone,
      });

      logger.info("Salesforce: Customer synced", {
        messageId: message.messageId,
        customerExternalId: payload.customer.id,
        customerSfId,
      });

      return;
    }

    throw this.permanentError(`Onbekend event type: ${event}`);
  }

  // ---------- Salesforce helpers (custom objects) ----------

  private sfInstance(): string {
    const instance = process.env.SALESFORCE_INSTANCE_URL;
    if (!instance) throw new Error("Missing env var: SALESFORCE_INSTANCE_URL");
    return instance.replace(/\/+$/, "");
  }

  private sfApiVersion(): string {
    return process.env.SALESFORCE_API_VERSION ?? "60.0";
  }

  private async upsertCustomerAndGetId(input: {
    externalId: string;
    name: string;
    email: string;
    phone?: string;
  }): Promise<string> {
    await this.sf.authenticate();

    const instance = this.sfInstance();
    const v = this.sfApiVersion();

    const upsertUrl = `${instance}/services/data/v${v}/sobjects/CustomerCustom__c/ExternalId__c/${encodeURIComponent(
      input.externalId
    )}`;

    // IMPORTANT: ExternalId__c NIET in body (want zit al in URL)
    await this.sf.client.patch(upsertUrl, {
      Name: input.name,
      Email__c: input.email,
      Phone__c: input.phone ?? null,
    });

    const queryUrl = `${instance}/services/data/v${v}/query`;
    const q = `SELECT Id FROM CustomerCustom__c WHERE ExternalId__c = '${input.externalId}' LIMIT 1`;

    const qr = await this.sf.client.get(queryUrl, { params: { q } });

    if (!qr.data.records?.length) {
      // zou niet mogen, maar dan is het een herhaalbare fout (Salesforce hiccup)
      throw this.retryableError("Customer not found after upsert", 500);
    }

    return qr.data.records[0].Id as string;
  }

  private async createOrder(input: {
    externalOrderId: string;
    total: number;
    status: "NEW" | "PAID" | "CANCELLED";
    customerSfId: string;
  }): Promise<string> {
    await this.sf.authenticate();

    const instance = this.sfInstance();
    const v = this.sfApiVersion();

    const createUrl = `${instance}/services/data/v${v}/sobjects/OrderCustom__c`;

    try {
      const res = await this.sf.client.post(createUrl, {
        ExternalOrderId__c: input.externalOrderId,
        Total__c: input.total,
        Status__c: input.status,
        CustomerC__c: input.customerSfId,
      });

      if (!res.data?.success) {
        throw new Error(`Order create failed: ${JSON.stringify(res.data)}`);
      }

      return res.data.id as string;
    } catch (e: any) {
      // Duplicates / validation = permanent; 5xx / network = retryable
      const status = e?.response?.status;

      if (status && status >= 400 && status < 500) {
        // vaak: INVALID_FIELD, REQUIRED_FIELD_MISSING, etc.
        throw this.permanentError(
          `Salesforce 4xx bij order create: ${JSON.stringify(e?.response?.data ?? e?.message)}`,
          status
        );
      }

      throw this.retryableError(
        `Salesforce error bij order create: ${JSON.stringify(e?.response?.data ?? e?.message)}`,
        status ?? 500
      );
    }
  }

  // ---------- Error helpers (retry vs permanent) ----------

  private retryableError(message: string, statusCode = 500): Error {
    const err: any = new Error(message);
    err.isHerhaalbaar = true;
    err.statusCode = statusCode;
    return err;
  }

  private permanentError(message: string, statusCode = 400): Error {
    const err: any = new Error(message);
    err.isHerhaalbaar = false;
    err.statusCode = statusCode;
    return err;
  }

  // ---------- DLQ / close ----------

  private async sendToDLQ(message: RabbitMQMessage, error: string): Promise<void> {
    if (!this.channel) return;

    const dlqMessage = {
      ...message,
      dlqReason: error,
      dlqTimestamp: new Date().toISOString(),
    };

    const dlqBuffer = Buffer.from(JSON.stringify(dlqMessage));
    this.channel.sendToQueue(config.rabbitmq.dlq, dlqBuffer, { persistent: true });

    logger.error("Consumer: Message sent to DLQ", {
      messageId: message.messageId,
      error,
    });
  }

  async close(): Promise<void> {
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) {
        // @ts-ignore
        await this.connection.close();
      }
      logger.info("Consumer: RabbitMQ connection closed");
    } catch (error) {
      logger.error("Consumer: Error closing RabbitMQ connection", { error });
    }
  }
}
