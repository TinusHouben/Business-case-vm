const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export type Customer = {
  id: string;
  name: string;
  email: string;
  phone?: string;
};

export type OrderItem = {
  productId: string;
  quantity: number;
  price: number;
};

export type Order = {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  items: OrderItem[];
};

export type QueueInfo = {
  queue: string;
  messageCount: number;
};

export type MessageResponse = {
  success: boolean;
  messageId: string;
  message: string;
  data: any;
};

export type CandyOrderRequest = {
  basket: Array<{
    candyId: string;
    quantity: number; // aantal keer 100g
  }>;
  customerInfo: {
    name: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    postalCode?: string;
    customerId?: string;
  };
};

export type Product = {
  id: string;
  externalProductId: string;
  name: string;
  price: number;
  stock: number;
  category: string;
};

class ApiClient {
  async getProducts(): Promise<{ success: boolean; products: Product[]; total: number }> {
    const response = await fetch(`${API_BASE_URL}/api/products`);
    if (!response.ok) {
      throw new Error('Failed to fetch products');
    }
    return response.json();
  }

  async createCandyOrder(order: CandyOrderRequest): Promise<MessageResponse> {
    const response = await fetch(`${API_BASE_URL}/api/orders/candy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(order),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error((error as any).error || 'Failed to create candy order');
    }
    return response.json();
  }

  async getQueueInfo(): Promise<QueueInfo> {
    const response = await fetch(`${API_BASE_URL}/queue/info`);
    if (!response.ok) {
      throw new Error('Failed to fetch queue info');
    }
    return response.json();
  }

  async createCustomer(customer: Customer): Promise<MessageResponse> {
    const response = await fetch(`${API_BASE_URL}/api/customers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(customer),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create customer');
    }
    return response.json();
  }

  async createOrder(order: Order): Promise<MessageResponse> {
    const response = await fetch(`${API_BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(order),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create order');
    }
    return response.json();
  }

  async sendMessage(event: string, payload: any): Promise<MessageResponse> {
    const response = await fetch(`${API_BASE_URL}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event, payload }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send message');
    }
    return response.json();
  }
}

export const apiClient = new ApiClient();
