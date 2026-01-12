const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

class ApiClient {
  async getQueueInfo() {
    const response = await fetch(`${API_BASE_URL}/queue/info`);
    if (!response.ok) {
      throw new Error('Failed to fetch queue info');
    }
    return response.json();
  }

  async createCustomer(customer) {
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

  async createOrder(order) {
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

  async sendMessage(event, payload) {
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
