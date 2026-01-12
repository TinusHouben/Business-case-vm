import axios, { AxiosInstance } from 'axios';
import { SalesforceAuthService } from './salesforce-auth';
import logger from '../utils/logger';

/**
 * Resultaat van een Salesforce operatie
 */
export interface SalesforceResultaat {
  isSuccesvol: boolean;
  isHerhaalbaar: boolean; // true voor tijdelijke fouten (429, 5xx), false voor permanente fouten (400, 4xx)
  foutmelding?: string;
  statusCode?: number;
  leadId?: string;
}

/**
 * Order Message interface
 */
export interface OrderMessage {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
  // Optionele velden voor Lead mapping
  brand?: string;
  name?: string;
}

/**
 * Salesforce Client
 * Verstuurt data naar Salesforce via REST API
 */
export class SalesforceClient {
  private authService: SalesforceAuthService;
  private axiosInstance: AxiosInstance;

  constructor(authService: SalesforceAuthService) {
    this.authService = authService;
    this.axiosInstance = axios.create();
  }

  /**
   * Verstuurt een bestelling naar Salesforce als Lead record
   */
  async stuurBestellingAsync(bestelling: OrderMessage): Promise<SalesforceResultaat> {
    try {
      // Zorg dat we een geldig access token hebben
      const accessToken = await this.authService.haalAccessTokenOpAsync();
      const instanceUrl = this.authService.getInstanceUrl();
      const apiVersion = this.authService.getApiVersion();

      // Maak Lead data aan
      const leadData = {
        Company: bestelling.brand || `Order ${bestelling.id}`, // Verplicht veld
        LastName: bestelling.name || `Order #${bestelling.id}`, // Verplicht veld
        Description: this.maakOrderBeschrijving(bestelling),
        LeadSource: 'RabbitMQ',
        ExternalId__c: bestelling.id, // Custom field voor order ID
      };

      // Maak Lead aan in Salesforce
      const response = await axios.post(
        `${instanceUrl}/services/data/${apiVersion}/sobjects/Lead`,
        leadData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('Salesforce: Bestelling succesvol verstuurd', {
        orderId: bestelling.id,
        leadId: response.data.id,
      });

      return {
        isSuccesvol: true,
        isHerhaalbaar: false,
        leadId: response.data.id,
      };
    } catch (error: any) {
      return this.verwerkSalesforceResponse(error, bestelling.id);
    }
  }

  /**
   * Verstuurt een fallback bericht voor niet-JSON berichten
   */
  async stuurFallbackBerichtAsync(bericht: string, berichtId: string): Promise<SalesforceResultaat> {
    try {
      const accessToken = await this.authService.haalAccessTokenOpAsync();
      const instanceUrl = this.authService.getInstanceUrl();
      const apiVersion = this.authService.getApiVersion();

      const leadData = {
        Company: 'Onbekende Bestelling',
        LastName: `Bericht ${berichtId}`,
        Description: `Raw bericht: ${bericht}`,
        LeadSource: 'RabbitMQ - Fallback',
        ExternalId__c: berichtId,
      };

      const response = await axios.post(
        `${instanceUrl}/services/data/${apiVersion}/sobjects/Lead`,
        leadData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('Salesforce: Fallback bericht succesvol verstuurd', {
        berichtId,
        leadId: response.data.id,
      });

      return {
        isSuccesvol: true,
        isHerhaalbaar: false,
        leadId: response.data.id,
      };
    } catch (error: any) {
      return this.verwerkSalesforceResponse(error, berichtId);
    }
  }

  /**
   * Verwerkt Salesforce API response en bepaalt of retry nodig is
   */
  private verwerkSalesforceResponse(error: any, orderId: string): SalesforceResultaat {
    const statusCode = error.response?.status;
    const foutmelding = error.response?.data?.message || 
                       error.response?.data?.error_description || 
                       error.message || 
                       'Onbekende fout';

    // 401 Unauthorized - Token is verlopen, probeer opnieuw na refresh
    if (statusCode === 401) {
      logger.warn('Salesforce: 401 Unauthorized - Token refresh nodig', {
        orderId,
        foutmelding,
      });

      // Forceer token refresh voor volgende poging
      this.authService.forceerTokenRefreshAsync().catch(err => {
        logger.error('Salesforce: Kon token niet refreshen na 401', {
          error: err.message,
        });
      });

      return {
        isSuccesvol: false,
        isHerhaalbaar: true, // 401 is tijdelijk (na token refresh)
        foutmelding: `Unauthorized: ${foutmelding}`,
        statusCode: 401,
      };
    }

    // 429 Too Many Requests - Rate limiting, tijdelijk
    if (statusCode === 429) {
      logger.warn('Salesforce: 429 Too Many Requests - Rate limiting', {
        orderId,
        foutmelding,
      });

      return {
        isSuccesvol: false,
        isHerhaalbaar: true,
        foutmelding: `Rate limit: ${foutmelding}`,
        statusCode: 429,
      };
    }

    // 5xx Server Errors - Tijdelijke server problemen
    if (statusCode && statusCode >= 500 && statusCode < 600) {
      logger.error('Salesforce: Server error', {
        orderId,
        statusCode,
        foutmelding,
      });

      return {
        isSuccesvol: false,
        isHerhaalbaar: true,
        foutmelding: `Server error: ${foutmelding}`,
        statusCode,
      };
    }

    // 400, 4xx Client Errors - Permanente fouten (verkeerde data, etc.)
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      logger.error('Salesforce: Client error - permanente fout', {
        orderId,
        statusCode,
        foutmelding,
        errorDetails: error.response?.data,
      });

      return {
        isSuccesvol: false,
        isHerhaalbaar: false, // Permanente fout, niet opnieuw proberen
        foutmelding: `Client error: ${foutmelding}`,
        statusCode,
      };
    }

    // Onbekende fout - behandel als tijdelijk
    logger.error('Salesforce: Onbekende fout', {
      orderId,
      statusCode,
      foutmelding,
      error: error.message,
    });

    return {
      isSuccesvol: false,
      isHerhaalbaar: true, // Bij twijfel, probeer opnieuw
      foutmelding: `Onbekende fout: ${foutmelding}`,
      statusCode,
    };
  }

  /**
   * Maakt een beschrijving van de order voor het Lead Description veld
   */
  private maakOrderBeschrijving(bestelling: OrderMessage): string {
    const itemsTekst = bestelling.items
      .map(item => `  - Product: ${item.productId}, Aantal: ${item.quantity}, Prijs: ${item.price}`)
      .join('\n');

    return `Order Details:
Order ID: ${bestelling.id}
Customer ID: ${bestelling.customerId}
Bedrag: ${bestelling.amount} ${bestelling.currency}
Aantal items: ${bestelling.items.length}

Items:
${itemsTekst}`;
  }
}
