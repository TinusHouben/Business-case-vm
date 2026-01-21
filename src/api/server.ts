import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMQProducer } from '../rabbitmq/producer';
import { RabbitMQMessage, EventType, MessagePayload } from '../types/message';
import { config, validateConfig } from '../config';
import logger from '../utils/logger';
import { CANDIES, getCandyById } from '../data/candies';

const app = express();

/**
 * ✅ CORS: sta enkel jouw frontend(s) toe
 */
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://10.2.160.225:5173',
  'http://10.2.160.225:5174',
  'http://10.2.160.225:5175',
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/postman
      if (allowedOrigins.includes(origin)) return cb(null, true);

      logger.warn('CORS blocked origin', { origin });
      return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-KEY'],
    credentials: true,
  })
);

app.options('*', cors());
app.use(express.json());

const producer = new RabbitMQProducer();

producer.connect().catch((error) => {
  logger.error('Failed to initialize producer', { error });
  process.exit(1);
});

app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'Snoepjes Winkel - RabbitMQ Salesforce Integration',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      queueInfo: 'GET /queue/info',
      candies: 'GET /api/candies',
      sendMessage: 'POST /api/messages',
      createCustomer: 'POST /api/customers',
      createOrder: 'POST /api/orders',
      createCandyOrder: 'POST /api/orders/candy',
    },
  });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'producer-api' });
});

app.get('/queue/info', async (req: Request, res: Response) => {
  try {
    const queueInfo = await producer.getQueueInfo();
    res.json(queueInfo);
  } catch (error: any) {
    logger.error('Failed to get queue info', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/candies', (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      candies: CANDIES,
      total: CANDIES.length,
    });
  } catch (error: any) {
    logger.error('Failed to get candies', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generic message endpoint (blijft bruikbaar voor testing)
 */
app.post('/api/messages', async (req: Request, res: Response) => {
  try {
    const { event, payload } = req.body;

    if (!event || !payload) {
      return res.status(400).json({
        error: 'Missing required fields: event and payload',
      });
    }

    if (!Object.values(EventType).includes(event)) {
      return res.status(400).json({
        error: `Invalid event type. Must be one of: ${Object.values(EventType).join(', ')}`,
      });
    }

    const message: RabbitMQMessage = {
      messageId: uuidv4(),
      event: event as EventType,
      payload: payload as MessagePayload,
      timestamp: new Date().toISOString(),
    };

    const sent = await producer.sendMessage(message);

    if (sent) {
      logger.info('API: Message sent successfully', {
        messageId: message.messageId,
        event: message.event,
      });
      return res.status(201).json({
        success: true,
        messageId: message.messageId,
        message: 'Message sent to queue',
        data: message,
      });
    }

    return res.status(503).json({
      error: 'Failed to send message (queue may be full)',
    });
  } catch (error: any) {
    logger.error('API: Failed to send message', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * CREATE_CUSTOMER
 */
app.post('/api/customers', async (req: Request, res: Response) => {
  try {
    const { id, name, email, phone, address, city, postalCode } = req.body;

    if (!id || !name || !email) {
      return res.status(400).json({
        error: 'Missing required fields: id, name, email',
      });
    }

    const message: RabbitMQMessage = {
      messageId: uuidv4(),
      event: EventType.CREATE_CUSTOMER,
      payload: {
        customer: {
          id,
          name,
          email,
          phone,
          address,
          city,
          postalCode,
        },
      },
      timestamp: new Date().toISOString(),
    };

    const sent = await producer.sendMessage(message);

    if (sent) {
      return res.status(201).json({
        success: true,
        messageId: message.messageId,
        message: 'Customer creation message sent',
        data: message,
      });
    }

    return res.status(503).json({
      error: 'Failed to send message',
    });
  } catch (error: any) {
    logger.error('API: Failed to create customer message', {
      error: error.message,
    });
    res.status(500).json({ error: error.message });
  }
});

/**
 * ✅ CREATE_ORDER
 * BELANGRIJK: payload.customer is getypeerd met verplichte name+email
 * -> dus we eisen hier ook name+email in de body
 */
app.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const { id, customerId, amount, currency, items, customer } = req.body;

    if (!id || !customerId || !amount || !items) {
      return res.status(400).json({
        error: 'Missing required fields: id, customerId, amount, items',
      });
    }

    // ✅ enforce customer info (minstens name+email) zodat TS type klopt en consumer niet faalt
    if (!customer || !customer.name || !customer.email) {
      return res.status(400).json({
        error: 'Missing required customer fields for CREATE_ORDER: customer.name, customer.email',
      });
    }

    const message: RabbitMQMessage = {
      messageId: uuidv4(),
      event: EventType.CREATE_ORDER,
      payload: {
        customer: {
          id: customerId,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
          city: customer.city,
          postalCode: customer.postalCode,
        },
        order: {
          id,
          customerId,
          amount,
          currency: currency || 'EUR',
          items,
        },
      },
      timestamp: new Date().toISOString(),
    };

    const sent = await producer.sendMessage(message);

    if (sent) {
      return res.status(201).json({
        success: true,
        messageId: message.messageId,
        message: 'Order creation message sent',
        data: message,
      });
    }

    return res.status(503).json({
      error: 'Failed to send message',
    });
  } catch (error: any) {
    logger.error('API: Failed to create order message', {
      error: error.message,
    });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Candy checkout endpoint (frontend flow)
 */
app.post('/api/orders/candy', async (req: Request, res: Response) => {
  try {
    const { basket, customerInfo } = req.body;

    if (!basket || !Array.isArray(basket) || basket.length === 0) {
      return res.status(400).json({
        error: 'Missing or empty basket. Basket must be an array of items.',
      });
    }

    if (!customerInfo || !customerInfo.name || !customerInfo.email) {
      return res.status(400).json({
        error: 'Missing required customer info: name, email',
      });
    }

    const orderItems: Array<{
      productId: string;
      productName: string;
      quantity: number;
      price: number;
      totalPrice: number;
    }> = [];

    let totalAmount = 0;

    for (const basketItem of basket) {
      const { candyId, quantity } = basketItem;

      if (!candyId || !quantity || quantity <= 0) {
        return res.status(400).json({
          error: `Invalid basket item: candyId and quantity (in 100g units) are required`,
        });
      }

      const candy = getCandyById(candyId);
      if (!candy) {
        return res.status(400).json({
          error: `Candy not found: ${candyId}`,
        });
      }

      const itemTotalPrice = candy.pricePer100g * quantity;
      totalAmount += itemTotalPrice;

      orderItems.push({
        productId: candy.id,
        productName: candy.name,
        quantity,
        price: candy.pricePer100g,
        totalPrice: itemTotalPrice,
      });
    }

const orderId = `ORD-${Date.now()}-${uuidv4().substring(0, 8)}`;

// ✅ Deterministische customerId op basis van email => geen duplicates
const emailKey = String(customerInfo.email).trim().toLowerCase();
const customerId = customerInfo.customerId || `EMAIL:${emailKey}`;

    // ✅ Als klant nog geen customerId heeft: stuur CREATE_CUSTOMER
    if (!customerInfo.customerId) {
      const customerMessage: RabbitMQMessage = {
        messageId: uuidv4(),
        event: EventType.CREATE_CUSTOMER,
        payload: {
          customer: {
            id: customerId,
            name: customerInfo.name,
            email: customerInfo.email,
            phone: customerInfo.phone,
            address: customerInfo.address,
            city: customerInfo.city,
            postalCode: customerInfo.postalCode,
          },
        },
        timestamp: new Date().toISOString(),
      };

      await producer.sendMessage(customerMessage);
      logger.info('API: Customer creation message sent', { customerId });
    }

    // ✅ payload.customer (top-level) zodat consumer kan upserten
    const orderMessage: RabbitMQMessage = {
      messageId: uuidv4(),
      event: EventType.CREATE_ORDER,
      payload: {
        customer: {
          id: customerId,
          name: customerInfo.name,
          email: customerInfo.email,
          phone: customerInfo.phone,
          address: customerInfo.address,
          city: customerInfo.city,
          postalCode: customerInfo.postalCode,
        },
        order: {
          id: orderId,
          customerId,
          amount: Math.round(totalAmount * 100) / 100,
          currency: 'EUR',
          items: orderItems,
        },
      },
      timestamp: new Date().toISOString(),
    };

    const sent = await producer.sendMessage(orderMessage);

    if (sent) {
      return res.status(201).json({
        success: true,
        messageId: orderMessage.messageId,
        message: 'Candy order created successfully',
        data: {
          orderId,
          customerId,
          totalAmount: Math.round(totalAmount * 100) / 100,
          currency: 'EUR',
          items: orderItems,
          customerInfo,
        },
      });
    }

    return res.status(503).json({
      error: 'Failed to send order message',
    });
  } catch (error: any) {
    logger.error('API: Failed to create candy order', {
      error: error.message,
    });
    res.status(500).json({ error: error.message });
  }
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing producer connection');
  await producer.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing producer connection');
  await producer.close();
  process.exit(0);
});

validateConfig();
const PORT = config.api.port || 3000;

// ✅ luister extern (VM IP bereikbaar)
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Producer API server running on port ${PORT}`);
  console.log(`\nProducer API Server running on http://0.0.0.0:${PORT}`);
  console.log(`Health check: http://10.2.160.225:${PORT}/health`);
  console.log(`Queue info: http://10.2.160.225:${PORT}/queue/info`);
  console.log(`Send message: POST http://10.2.160.225:${PORT}/api/messages\n`);
});
