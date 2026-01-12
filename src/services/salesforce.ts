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
    // Determine password to use - check if security token needs to be appended
    let passwordToUse = config.salesforce.password;
    const hasSecurityToken = config.salesforce.securityToken && config.salesforce.securityToken.length > 0;

    if (hasSecurityToken) {
      // Check if security token is already at the end of the password
      const passwordEndsWithToken = config.salesforce.password.endsWith(config.salesforce.securityToken);

      if (!passwordEndsWithToken) {
        // Security token not found at the end, append it
        passwordToUse = `${config.salesforce.password}${config.salesforce.securityToken}`;
        logger.info('Salesforce: Appending security token to password');
      } else {
        logger.info('Salesforce: Security token already included in password');
      }
    } else {
      logger.warn('Salesforce: No security token provided - authentication may fail if IP restrictions are enabled');
    }

    const loginUrls = [
      'https://login.salesforce.com/services/oauth2/token',
      'https://test.salesforce.com/services/oauth2/token'
    ];

    let lastError: any = null;

    for (let i = 0; i < loginUrls.length; i++) {
      const loginUrl = loginUrls[i];
      try {
        logger.info('Salesforce: Authentication attempt', {
          loginUrl: loginUrl,
          username: config.salesforce.username,
          passwordLength: passwordToUse.length,
          hasSecurityToken: hasSecurityToken,
          clientIdLength: config.salesforce.clientId.length,
          clientSecretLength: config.salesforce.clientSecret.length,
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

        // If it's not an authentication error, don't try other endpoints
        if (error.response?.data?.error !== 'invalid_grant' &&
          errorMessage !== 'authentication failure' &&
          error.response?.status !== 400) {
          logger.error('Salesforce: Non-authentication error, stopping retry', {
            error: errorMessage,
            status: error.response?.status,
          });
          break;
        }

        // Log warning when trying alternative endpoint (not on last iteration)
        if (i < loginUrls.length - 1) {
          logger.warn('Salesforce: Authentication failed with endpoint, trying alternative...', {
            loginUrl: loginUrl,
            error: errorMessage,
            nextUrl: loginUrls[i + 1],
          });
        }
      }
    }

    const errorMessage = lastError?.response?.data?.error_description ||
      lastError?.response?.data?.error ||
      lastError?.message ||
      'Unknown error';
    const errorDetails = lastError?.response?.data || {};

    // Provide helpful troubleshooting information
    const troubleshootingTips: string[] = [];
    if (errorMessage.includes('invalid_grant') || errorMessage.includes('authentication failure')) {
      troubleshootingTips.push(
        '1. Verify your username is correct (exact value from Setup → Users)',
        '2. Check if your password is correct',
        '3. Verify your security token is correct (reset it if needed: Setup → My Personal Information → Reset My Security Token)',
        '4. Ensure password + security token are combined correctly (no space between them)',
        '5. Check if your Connected App Consumer Key and Secret are correct',
        '6. Verify the Connected App has "Enable OAuth Settings" enabled',
        '7. Check if IP restrictions are enabled on your Connected App (may need to whitelist your IP)',
        '8. For sandbox orgs, use test.salesforce.com endpoint',
        '9. Security tokens expire when password is reset - get a new one if you recently reset your password'
      );
    }

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
      hasSecurityToken: hasSecurityToken,
      passwordLength: passwordToUse.length,
      troubleshootingTips: troubleshootingTips,
    });
    throw new Error(`Salesforce authentication failed: ${errorMessage}. See logs for troubleshooting tips.`);
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.token) {
      await this.authenticate();
    }
  }

  async createOrUpdateCustomer(customer: CustomerPayload): Promise<void> {
    await this.ensureAuthenticated();

    try {
      const nameParts = customer.name.split(' ');
      const firstName = nameParts[0] || customer.name;
      const lastName = nameParts.slice(1).join(' ') || customer.name;

      const leadData = {
        FirstName: firstName,
        LastName: lastName,
        Email: customer.email,
        Phone: customer.phone || '',
        Company: customer.name, // Use customer name as company
        ExternalId__c: customer.id,
        LeadSource: 'RabbitMQ Integration',
      };

      try {
        const queryResponse = await this.axiosInstance.get(
          `/services/data/v58.0/query/`,
          {
            params: {
              q: `SELECT Id FROM Lead WHERE ExternalId__c = '${customer.id}' LIMIT 1`,
            },
          }
        );

        if (queryResponse.data.records.length > 0) {
          const leadId = queryResponse.data.records[0].Id;
          await this.axiosInstance.patch(
            `/services/data/v58.0/sobjects/Lead/${leadId}`,
            leadData
          );
          logger.info('Salesforce: Lead updated', {
            leadId,
            customerId: customer.id,
          });
        } else {
          const createResponse = await this.axiosInstance.post(
            '/services/data/v58.0/sobjects/Lead/',
            leadData
          );
          logger.info('Salesforce: Lead created', {
            leadId: createResponse.data.id,
            customerId: customer.id,
          });
        }
      } catch (error: any) {
        logger.error('Salesforce: Lead operation failed', {
          error: error.message,
          customerId: customer.id,
          errorDetails: error.response?.data,
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
      // First, find the customer Lead
      let customerLead: any;
      try {
        const queryResponse = await this.axiosInstance.get(
          `/services/data/v58.0/query/`,
          {
            params: {
              q: `SELECT Id, FirstName, LastName, Email, Phone, Company FROM Lead WHERE ExternalId__c = '${order.customerId}' LIMIT 1`,
            },
          }
        );

        if (queryResponse.data.records.length === 0) {
          throw new Error(`Customer Lead not found: ${order.customerId}`);
        }

        customerLead = queryResponse.data.records[0];
      } catch (error: any) {
        logger.error('Salesforce: Failed to find customer Lead', {
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

      // Create or update Lead for the order
      // We'll use the order ID as ExternalId and store order details in custom fields
      const orderLeadData = {
        FirstName: customerLead.FirstName || 'Order',
        LastName: customerLead.LastName || `#${order.id}`,
        Email: customerLead.Email || '',
        Phone: customerLead.Phone || '',
        Company: customerLead.Company || `Order ${order.id}`,
        ExternalId__c: order.id,
        LeadSource: 'RabbitMQ Integration - Order',
        // Store order information in Description field
        Description: description,
      };

      try {
        const queryResponse = await this.axiosInstance.get(
          `/services/data/v58.0/query/`,
          {
            params: {
              q: `SELECT Id FROM Lead WHERE ExternalId__c = '${order.id}' LIMIT 1`,
            },
          }
        );

        if (queryResponse.data.records.length > 0) {
          const leadId = queryResponse.data.records[0].Id;
          await this.axiosInstance.patch(
            `/services/data/v58.0/sobjects/Lead/${leadId}`,
            orderLeadData
          );
          logger.info('Salesforce: Order Lead updated', {
            leadId,
            orderId: order.id,
            customerId: order.customerId,
          });
        } else {
          const createResponse = await this.axiosInstance.post(
            '/services/data/v58.0/sobjects/Lead/',
            orderLeadData
          );
          logger.info('Salesforce: Order Lead created', {
            leadId: createResponse.data.id,
            orderId: order.id,
            customerId: order.customerId,
          });
        }
      } catch (error: any) {
        logger.error('Salesforce: Order Lead operation failed', {
          error: error.message,
          orderId: order.id,
          errorDetails: error.response?.data,
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
