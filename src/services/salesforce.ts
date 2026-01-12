import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import logger from '../utils/logger';

interface SalesforceToken {
  access_token: string;
  instance_url: string;
  token_type: string;
}

interface CustomerPayload {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

interface OrderPayload {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  items: Array<{
    productId: string;
    productName?: string;
    quantity: number; // aantal keer 100g
    price: number; // prijs per 100g
    totalPrice?: number; // totale prijs voor deze item
  }>;
  customerInfo?: {
    name: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    postalCode?: string;
  };
}

export class SalesforceService {
  private token: SalesforceToken | null = null;
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create();
  }

  async authenticate(): Promise<void> {
    let passwordToUse = config.salesforce.password;
    if (config.salesforce.securityToken && 
        !config.salesforce.password.includes(config.salesforce.securityToken) &&
        config.salesforce.securityToken.length > 0) {
      passwordToUse = `${config.salesforce.password}${config.salesforce.securityToken}`;
    }

    const loginUrls = [
      'https://login.salesforce.com/services/oauth2/token',
      'https://test.salesforce.com/services/oauth2/token'
    ];

    let lastError: any = null;

    for (const loginUrl of loginUrls) {
      try {
        logger.info('Salesforce: Authentication attempt', {
          loginUrl: loginUrl,
          username: config.salesforce.username,
          passwordLength: passwordToUse.length,
          hasSecurityTokenInPassword: passwordToUse.includes(config.salesforce.securityToken || ''),
          clientIdLength: config.salesforce.clientId.length,
        });

        const params = new URLSearchParams();
        params.append('grant_type', 'password');
        params.append('client_id', config.salesforce.clientId);
        params.append('client_secret', config.salesforce.clientSecret);
        params.append('username', config.salesforce.username);
        params.append('password', passwordToUse);

        const response = await axios.post(
          loginUrl,
          params,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        );

        this.token = response.data;
        if (!this.token) {
          throw new Error('No token received from Salesforce');
        }
        this.axiosInstance.defaults.baseURL = this.token.instance_url;
        this.axiosInstance.defaults.headers.common[
          'Authorization'
        ] = `Bearer ${this.token.access_token}`;

        logger.info('Salesforce: Authentication successful', {
          loginUrl: loginUrl,
          instanceUrl: this.token.instance_url,
        });
        return;
      } catch (error: any) {
        lastError = error;
        const errorMessage = error.response?.data?.error_description || error.response?.data?.error || error.message;
        
        if (error.response?.data?.error !== 'invalid_grant' && 
            errorMessage !== 'authentication failure') {
          break;
        }
        
        if (loginUrl === loginUrls[loginUrls.length - 1]) {
          logger.warn('Salesforce: Authentication failed with first endpoint, trying alternative...', {
            loginUrl: loginUrl,
            error: errorMessage,
          });
        }
      }
    }

    const errorMessage = lastError?.response?.data?.error_description || 
                        lastError?.response?.data?.error || 
                        lastError?.message || 
                        'Unknown error';
    const errorDetails = lastError?.response?.data || {};
    
    logger.error('Salesforce: Authentication failed with all endpoints', {
      error: errorMessage,
      status: lastError?.response?.status,
      statusText: lastError?.response?.statusText,
      errorDetails: errorDetails,
      triedUrls: loginUrls,
      hasClientId: !!config.salesforce.clientId,
      hasClientSecret: !!config.salesforce.clientSecret,
      hasUsername: !!config.salesforce.username,
      hasPassword: !!config.salesforce.password,
      hasSecurityToken: !!config.salesforce.securityToken,
    });
    throw new Error(`Salesforce authentication failed: ${errorMessage}`);
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.token) {
      await this.authenticate();
    }
  }

  async createOrUpdateCustomer(customer: CustomerPayload): Promise<void> {
    await this.ensureAuthenticated();

    try {
      const accountData = {
        Name: customer.name,
        ExternalId__c: customer.id,
      };

      let accountId: string;
      try {
        const queryResponse = await this.axiosInstance.get(
          `/services/data/v58.0/query/`,
          {
            params: {
              q: `SELECT Id FROM Account WHERE ExternalId__c = '${customer.id}' LIMIT 1`,
            },
          }
        );

        if (queryResponse.data.records.length > 0) {
          accountId = queryResponse.data.records[0].Id;
          await this.axiosInstance.patch(
            `/services/data/v58.0/sobjects/Account/${accountId}`,
            accountData
          );
          logger.info('Salesforce: Account updated', {
            accountId,
            customerId: customer.id,
          });
        } else {
          const createResponse = await this.axiosInstance.post(
            '/services/data/v58.0/sobjects/Account/',
            accountData
          );
          accountId = createResponse.data.id;
          logger.info('Salesforce: Account created', {
            accountId,
            customerId: customer.id,
          });
        }
      } catch (error: any) {
        logger.error('Salesforce: Account operation failed', {
          error: error.message,
          customerId: customer.id,
        });
        throw error;
      }

      const contactData = {
        FirstName: customer.name.split(' ')[0] || customer.name,
        LastName: customer.name.split(' ').slice(1).join(' ') || customer.name,
        Email: customer.email,
        Phone: customer.phone || '',
        AccountId: accountId,
        ExternalId__c: customer.id,
      };

      try {
        const queryResponse = await this.axiosInstance.get(
          `/services/data/v58.0/query/`,
          {
            params: {
              q: `SELECT Id FROM Contact WHERE ExternalId__c = '${customer.id}' LIMIT 1`,
            },
          }
        );

        if (queryResponse.data.records.length > 0) {
          const contactId = queryResponse.data.records[0].Id;
          await this.axiosInstance.patch(
            `/services/data/v58.0/sobjects/Contact/${contactId}`,
            contactData
          );
          logger.info('Salesforce: Contact updated', {
            contactId,
            customerId: customer.id,
          });
        } else {
          const createResponse = await this.axiosInstance.post(
            '/services/data/v58.0/sobjects/Contact/',
            contactData
          );
          logger.info('Salesforce: Contact created', {
            contactId: createResponse.data.id,
            customerId: customer.id,
          });
        }
      } catch (error: any) {
        logger.error('Salesforce: Contact operation failed', {
          error: error.message,
          customerId: customer.id,
        });
        throw error;
      }
    } catch (error: any) {
      logger.error('Salesforce: Failed to create/update customer', {
        error: error.message,
        customerId: customer.id,
      });
      throw error;
    }
  }

  async createOrUpdateOrder(order: OrderPayload): Promise<void> {
    await this.ensureAuthenticated();

    try {
      let accountId: string;
      try {
        const queryResponse = await this.axiosInstance.get(
          `/services/data/v58.0/query/`,
          {
            params: {
              q: `SELECT AccountId FROM Contact WHERE ExternalId__c = '${order.customerId}' LIMIT 1`,
            },
          }
        );

        if (queryResponse.data.records.length === 0) {
          throw new Error(`Customer not found: ${order.customerId}`);
        }

        accountId = queryResponse.data.records[0].AccountId;
      } catch (error: any) {
        logger.error('Salesforce: Failed to find customer account', {
          error: error.message,
          customerId: order.customerId,
        });
        throw error;
      }

      // Maak een beschrijving met snoepjes details
      const itemsDescription = order.items.map(item => {
        const candyName = item.productName || item.productId;
        const weight = item.quantity * 100; // quantity is in 100g units
        return `${candyName}: ${weight}g (€${item.totalPrice?.toFixed(2) || (item.price * item.quantity).toFixed(2)})`;
      }).join('\n');

      const totalWeight = order.items.reduce((sum, item) => sum + (item.quantity * 100), 0);
      const description = `Snoepjes Bestelling\n\n${itemsDescription}\n\nTotaal: ${totalWeight}g - €${order.amount.toFixed(2)}`;

      const opportunityData = {
        Name: `Snoepjes Order ${order.id}`,
        AccountId: accountId,
        Amount: order.amount,
        StageName: 'Closed Won',
        CloseDate: new Date().toISOString().split('T')[0],
        CurrencyIsoCode: order.currency || 'EUR',
        ExternalId__c: order.id,
        Description: description,
      };

      try {
        const queryResponse = await this.axiosInstance.get(
          `/services/data/v58.0/query/`,
          {
            params: {
              q: `SELECT Id FROM Opportunity WHERE ExternalId__c = '${order.id}' LIMIT 1`,
            },
          }
        );

        if (queryResponse.data.records.length > 0) {
          const opportunityId = queryResponse.data.records[0].Id;
          await this.axiosInstance.patch(
            `/services/data/v58.0/sobjects/Opportunity/${opportunityId}`,
            opportunityData
          );
          logger.info('Salesforce: Opportunity updated', {
            opportunityId,
            orderId: order.id,
          });
        } else {
          const createResponse = await this.axiosInstance.post(
            '/services/data/v58.0/sobjects/Opportunity/',
            opportunityData
          );
          logger.info('Salesforce: Opportunity created', {
            opportunityId: createResponse.data.id,
            orderId: order.id,
          });
        }
      } catch (error: any) {
        logger.error('Salesforce: Opportunity operation failed', {
          error: error.message,
          orderId: order.id,
        });
        throw error;
      }
    } catch (error: any) {
      logger.error('Salesforce: Failed to create/update order', {
        error: error.message,
        orderId: order.id,
      });
      throw error;
    }
  }
}
