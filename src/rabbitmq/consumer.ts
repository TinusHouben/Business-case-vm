// src/rabbitmq/consumer.ts
import * as amqp from "amqplib";
import { RabbitMQMessage, EventType } from "../types/message";
import { config } from "../config";
import logger from "../utils/logger";
import { isMessageProcessed, markMessageProcessed } from "../utils/idempotency";
import { SalesforceRefreshService } from "../services/salesforce-refresh";

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
        address: payload.customer.address,
        city: payload.customer.city,
        postalCode: payload.customer.postalCode,
      });

      // 2) Upsert order (idempotent) + krijg id + createdNew
      const { id: orderSfId, createdNew } = await this.upsertOrder({
        externalOrderId: orderExternalId,
        total: payload.order.amount,
        status: "NEW",
        customerSfId,
      });

      // 3) Stock verminderen enkel bij "nieuw aangemaakte" order (anders dubbele decrement vermijden)
      if (createdNew) {
        const items = payload.order.items ?? [];
        await this.decrementStockForOrderItems(items, orderExternalId);
      } else {
        logger.info("Salesforce: Order bestond al (skip stock decrement)", {
          messageId: message.messageId,
          orderExternalId,
          orderSfId,
        });
      }

      logger.info("Salesforce: Order synced", {
        messageId: message.messageId,
        customerExternalId,
        customerSfId,
        orderExternalId,
        orderSfId,
        stockDecremented: createdNew,
      });

      return;
    }

    if (event === EventType.CREATE_CUSTOMER || event === EventType.UPDATE_CUSTOMER) {
      if (!payload.customer) throw this.permanentError("payload.customer ontbreekt");

      const customerSfId = await this.upsertCustomerAndGetId({
        externalId: payload.customer.id,
        name: payload.customer.name,
        email: payload.customer.email,
        phone: payload.customer.phone,
        address: payload.customer.address,
        city: payload.customer.city,
        postalCode: payload.customer.postalCode,
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

  // ---------- Salesforce helpers ----------

  private sfInstance(): string {
    const instance = process.env.SALESFORCE_INSTANCE_URL;
    if (!instance) throw new Error("Missing env var: SALESFORCE_INSTANCE_URL");
    return instance.replace(/\/+$/, "");
  }

  private sfApiVersion(): string {
    const raw = process.env.SALESFORCE_API_VERSION ?? "60.0";
    return raw.replace(/^v/i, "");
  }

  private escapeSoql(value: string): string {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  private async upsertCustomerAndGetId(input: {
    externalId: string;
    name: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    postalCode?: string;
  }): Promise<string> {
    await this.sf.authenticate();

    const instance = this.sfInstance();
    const v = this.sfApiVersion();

    const upsertUrl = `${instance}/services/data/v${v}/sobjects/CustomerCustom__c/ExternalId__c/${encodeURIComponent(
      input.externalId
    )}`;

    try {
      await this.sf.client.patch(upsertUrl, {
        Name: input.name,
        Email__c: input.email,
        Phone__c: input.phone ?? null,
        Address__c: input.address ?? null,
        City__c: input.city ?? null,
        Postal_Code__c: input.postalCode ?? null,
      });

      const queryUrl = `${instance}/services/data/v${v}/query`;
      const q = `SELECT Id FROM CustomerCustom__c WHERE ExternalId__c = '${this.escapeSoql(
        input.externalId
      )}' LIMIT 1`;

      const qr = await this.sf.client.get(queryUrl, { params: { q } });

      if (!qr.data.records?.length) {
        throw this.retryableError("Customer not found after upsert", 500);
      }

      return qr.data.records[0].Id as string;
    } catch (e: any) {
      const status = e?.response?.status;
      const data = e?.response?.data ?? e?.message;

      if (status && status >= 400 && status < 500) {
        throw this.permanentError(`Salesforce 4xx bij customer upsert: ${JSON.stringify(data)}`, status);
      }

      throw this.retryableError(`Salesforce error bij customer upsert: ${JSON.stringify(data)}`, status ?? 500);
    }
  }

  private async upsertOrder(input: {
    externalOrderId: string;
    total: number;
    status: "NEW" | "PAID" | "CANCELLED";
    customerSfId: string;
  }): Promise<{ id: string; createdNew: boolean }> {
    await this.sf.authenticate();

    const instance = this.sfInstance();
    const v = this.sfApiVersion();

    const queryUrl = `${instance}/services/data/v${v}/query`;

    // We cannot upsert via /OrderCustom__c/ExternalOrderId__c/{value}
    // because Salesforce returns: "Provided external ID field does not exist or is not accessible".
    // So: idempotency by Name = externalOrderId (create-if-not-exists).
    const key = this.escapeSoql(input.externalOrderId);
    const checkQ = `SELECT Id FROM OrderCustom__c WHERE Name = '${key}' LIMIT 1`;

    try {
      // 1) Check if exists
      const existing = await this.sf.client.get(queryUrl, { params: { q: checkQ } });
      const rec = existing.data.records?.[0];

      if (rec?.Id) {
        // Update fields (optional but nice)
        const updateUrl = `${instance}/services/data/v${v}/sobjects/OrderCustom__c/${encodeURIComponent(rec.Id)}`;

        await this.sf.client.patch(updateUrl, {
          Total__c: input.total,
          Status__c: input.status,
          CustomerC__c: input.customerSfId,
        });

        return { id: rec.Id as string, createdNew: false };
      }

      // 2) Create new
      const createUrl = `${instance}/services/data/v${v}/sobjects/OrderCustom__c`;

      const created = await this.sf.client.post(createUrl, {
        Name: input.externalOrderId,
        Total__c: input.total,
        Status__c: input.status,
        CustomerC__c: input.customerSfId,
      });

      const newId = created?.data?.id as string | undefined;

      if (newId) {
        return { id: newId, createdNew: true };
      }

      // fallback: query again
      const qr = await this.sf.client.get(queryUrl, { params: { q: checkQ } });
      const rec2 = qr.data.records?.[0];

      if (!rec2?.Id) {
        throw this.retryableError("Order not found after create", 500);
      }

      return { id: rec2.Id as string, createdNew: true };
    } catch (e: any) {
      const status = e?.response?.status;
      const data = e?.response?.data ?? e?.message;

      if (status && status >= 400 && status < 500) {
        throw this.permanentError(`Salesforce 4xx bij order create/check: ${JSON.stringify(data)}`, status);
      }

      throw this.retryableError(`Salesforce error bij order create/check: ${JSON.stringify(data)}`, status ?? 500);
    }
  }

  private async findProductByExternalProductId(externalProductId: string): Promise<{ id: string; stock: number; name?: string }> {
    await this.sf.authenticate();

    const instance = this.sfInstance();
    const v = this.sfApiVersion();

    const queryUrl = `${instance}/services/data/v${v}/query`;
    const q = `
      SELECT Id, Name, Stock__c
      FROM ProductCustom__c
      WHERE ExternalProductId__c = '${this.escapeSoql(externalProductId)}'
      LIMIT 1
    `;

    try {
      const qr = await this.sf.client.get(queryUrl, { params: { q } });
      const rec = qr.data.records?.[0];

      if (!rec) {
        throw this.permanentError(`Product niet gevonden in Salesforce: ${externalProductId}`, 404);
      }

      return {
        id: rec.Id as string,
        stock: Number(rec.Stock__c ?? 0),
        name: rec.Name as string | undefined,
      };
    } catch (e: any) {
      const status = e?.response?.status;
      const data = e?.response?.data ?? e?.message;

      if (status && status >= 400 && status < 500) {
        throw this.permanentError(`Salesforce 4xx bij product query: ${JSON.stringify(data)}`, status);
      }

      throw this.retryableError(`Salesforce error bij product query: ${JSON.stringify(data)}`, status ?? 500);
    }
  }

  private async setProductStockById(productSfId: string, newStock: number): Promise<void> {
    await this.sf.authenticate();

    const instance = this.sfInstance();
    const v = this.sfApiVersion();

    const url = `${instance}/services/data/v${v}/sobjects/ProductCustom__c/${encodeURIComponent(productSfId)}`;

    try {
      await this.sf.client.patch(url, {
        Stock__c: newStock,
      });
    } catch (e: any) {
      const status = e?.response?.status;

      if (status && status >= 400 && status < 500) {
        throw this.permanentError(`Salesforce 4xx bij product stock update: ${JSON.stringify(e?.response?.data ?? e?.message)}`, status);
      }

      throw this.retryableError(`Salesforce error bij product stock update: ${JSON.stringify(e?.response?.data ?? e?.message)}`, status ?? 500);
    }
  }

  private async decrementStockForOrderItems(
    items: Array<{ productId: string; quantity: number; price: number; totalPrice: number; productName?: string }>,
    orderExternalId: string
  ): Promise<void> {
    if (!Array.isArray(items) || items.length === 0) return;

    for (const item of items) {
      const externalProductId = String(item.productId);
      const qty = Number(item.quantity ?? 0);

      if (!externalProductId || !qty || qty <= 0) {
        throw this.permanentError(`Ongeldig order item (productId/quantity): ${JSON.stringify(item)}`, 400);
      }

      const product = await this.findProductByExternalProductId(externalProductId);

      const currentStock = Number(product.stock ?? 0);
      const newStock = currentStock - qty;

      if (newStock < 0) {
        throw this.permanentError(
          `Niet genoeg stock voor ${externalProductId} (order ${orderExternalId}): gevraagd=${qty}, beschikbaar=${currentStock}`,
          409
        );
      }

      await this.setProductStockById(product.id, newStock);

      logger.info("Salesforce: Stock updated", {
        orderExternalId,
        externalProductId,
        productSfId: product.id,
        productName: product.name,
        oldStock: currentStock,
        newStock,
        qty,
      });
    }
  }

  // ---------- Error helpers ----------

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
