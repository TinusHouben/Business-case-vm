export enum EventType {
  CREATE_ORDER = 'CREATE_ORDER',
  UPDATE_ORDER = 'UPDATE_ORDER',
  CREATE_CUSTOMER = 'CREATE_CUSTOMER',
  UPDATE_CUSTOMER = 'UPDATE_CUSTOMER'
}

export interface MessagePayload {
  customer?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    postalCode?: string;
  };
  order?: {
    id: string;
    customerId: string;
    amount: number;
    currency: string;
    items: Array<{
      productId: string;
      productName?: string;
      quantity: number; // Aantal keer 100g
      price: number; // Prijs per 100g
      totalPrice: number; // Totale prijs voor deze item
    }>;
    customerInfo?: {
      name: string;
      email: string;
      phone?: string;
      address?: string;
      city?: string;
      postalCode?: string;
    };
  };
}

export interface RabbitMQMessage {
  messageId: string;
  event: EventType;
  payload: MessagePayload;
  timestamp: string;
  retryCount?: number;
}

export interface ProcessedMessage {
  messageId: string;
  processedAt: string;
  status: 'success' | 'failed';
  error?: string;
}
