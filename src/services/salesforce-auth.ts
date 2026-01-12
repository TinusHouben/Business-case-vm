import axios from 'axios';
import { config } from '../config';
import logger from '../utils/logger';

/**
 * Salesforce Token interface
 */
interface SalesforceToken {
  access_token: string;
  instance_url: string;
  token_type: string;
  expires_in?: number; // In seconden
  refresh_token?: string;
}

/**
 * Gecachte token informatie
 */
interface CachedToken {
  token: SalesforceToken;
  verkregenOp: number; // Timestamp in milliseconden
}

/**
 * Salesforce Authentication Service
 * Beheert OAuth 2.0 Refresh Token flow met token caching
 */
export class SalesforceAuthService {
  private cachedToken: CachedToken | null = null;
  private readonly tokenGeldigheidTijd: number = 115 * 60 * 1000; // 115 minuten in milliseconden (iets korter dan 2 uur voor veiligheid)
  private readonly loginUrl: string;

  constructor() {
    // Bepaal login URL op basis van instance URL
    if (config.salesforce.instanceUrl.includes('test.salesforce.com') || 
        config.salesforce.instanceUrl.includes('--dev-ed')) {
      this.loginUrl = 'https://test.salesforce.com/services/oauth2/token';
    } else {
      this.loginUrl = 'https://login.salesforce.com/services/oauth2/token';
    }
  }

  /**
   * Haalt een geldig access token op
   * Controleert eerst of het gecachte token nog geldig is
   * Zo niet, wordt het token automatisch vernieuwd
   */
  async haalAccessTokenOpAsync(): Promise<string> {
    // Controleer of we een geldig gecachte token hebben
    if (this.isTokenGeldig()) {
      logger.debug('Salesforce: Gebruik gecachte access token');
      return this.cachedToken!.token.access_token;
    }

    // Token is verlopen of niet aanwezig, vernieuw het
    logger.info('Salesforce: Token verlopen of niet aanwezig, vernieuw token...');
    await this.vernieuwTokenAsync();
    
    if (!this.cachedToken) {
      throw new Error('Kon geen access token verkrijgen na vernieuwing');
    }

    return this.cachedToken.token.access_token;
  }

  /**
   * Vernieuwt het access token met behulp van refresh token
   * Fallback naar username/password als refresh token niet beschikbaar is
   */
  async vernieuwTokenAsync(): Promise<void> {
    // Probeer eerst refresh token flow
    if (config.salesforce.refreshToken) {
      try {
        await this.vernieuwMetRefreshToken();
        return;
      } catch (error: any) {
        logger.warn('Salesforce: Refresh token flow mislukt, probeer username/password fallback', {
          error: error.message,
        });
      }
    }

    // Fallback naar username/password flow
    if (config.salesforce.username && config.salesforce.password) {
      await this.authenticeerMetUsernamePassword();
      return;
    }

    throw new Error('Geen authenticatie methode beschikbaar. Configureer SALESFORCE_REFRESH_TOKEN of SALESFORCE_USERNAME/PASSWORD.');
  }

  /**
   * Vernieuwt token met refresh token
   */
  private async vernieuwMetRefreshToken(): Promise<void> {
    if (!config.salesforce.refreshToken) {
      throw new Error('Refresh token niet geconfigureerd');
    }

    logger.info('Salesforce: Vernieuw access token met refresh token');

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', config.salesforce.clientId);
    params.append('client_secret', config.salesforce.clientSecret);
    params.append('refresh_token', config.salesforce.refreshToken);

    const response = await axios.post(
      this.loginUrl,
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const token: SalesforceToken = {
      access_token: response.data.access_token,
      instance_url: response.data.instance_url || config.salesforce.instanceUrl,
      token_type: response.data.token_type || 'Bearer',
      expires_in: response.data.expires_in || 7200, // Standaard 2 uur
    };

    // Cache het token
    this.cachedToken = {
      token,
      verkregenOp: Date.now(),
    };

    logger.info('Salesforce: Token succesvol vernieuwd met refresh token', {
      instanceUrl: token.instance_url,
      expiresIn: token.expires_in,
    });
  }

  /**
   * Authenticeert met username/password (fallback)
   */
  private async authenticeerMetUsernamePassword(): Promise<void> {
    logger.info('Salesforce: Authenticatie met username/password (fallback)');

    // Combineer password en security token
    let passwordToUse = config.salesforce.password;
    if (config.salesforce.securityToken && 
        !config.salesforce.password.endsWith(config.salesforce.securityToken)) {
      passwordToUse = `${config.salesforce.password}${config.salesforce.securityToken}`;
      logger.info('Salesforce: Security token toegevoegd aan password');
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', config.salesforce.clientId);
    params.append('client_secret', config.salesforce.clientSecret);
    params.append('username', config.salesforce.username);
    params.append('password', passwordToUse);

    try {
      const response = await axios.post(
        this.loginUrl,
        params,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const token: SalesforceToken = {
        access_token: response.data.access_token,
        instance_url: response.data.instance_url || config.salesforce.instanceUrl,
        token_type: response.data.token_type || 'Bearer',
        expires_in: response.data.expires_in || 7200,
      };

      // Cache het token
      this.cachedToken = {
        token,
        verkregenOp: Date.now(),
      };

      logger.info('Salesforce: Authenticatie succesvol met username/password', {
        instanceUrl: token.instance_url,
        expiresIn: token.expires_in,
      });
    } catch (error: any) {
      const errorMessage = error.response?.data?.error_description || 
                          error.response?.data?.error || 
                          error.message;
      const errorDetails = error.response?.data || {};
      
      logger.error('Salesforce: Username/password authenticatie mislukt', {
        error: errorMessage,
        status: error.response?.status,
        statusText: error.response?.statusText,
        errorDetails: errorDetails,
        username: config.salesforce.username,
        passwordLength: passwordToUse.length,
        hasSecurityToken: !!config.salesforce.securityToken,
      });

      throw new Error(`Username/password authenticatie mislukt: ${errorMessage}`);
    }
  }

  /**
   * Forceert een nieuwe token refresh (bijvoorbeeld bij 401 errors)
   */
  async forceerTokenRefreshAsync(): Promise<void> {
    logger.info('Salesforce: Forceer token refresh');
    this.cachedToken = null; // Wis cache
    await this.vernieuwTokenAsync();
  }

  /**
   * Controleert of het gecachte token nog geldig is
   */
  private isTokenGeldig(): boolean {
    if (!this.cachedToken) {
      return false;
    }

    const verstrekenTijd = Date.now() - this.cachedToken.verkregenOp;
    const isGeldig = verstrekenTijd < this.tokenGeldigheidTijd;

    if (!isGeldig) {
      logger.debug('Salesforce: Gecachte token is verlopen', {
        verstrekenTijdMinuten: Math.round(verstrekenTijd / 60000),
        maxGeldigheidMinuten: Math.round(this.tokenGeldigheidTijd / 60000),
      });
    }

    return isGeldig;
  }

  /**
   * Geeft de instance URL terug
   */
  getInstanceUrl(): string {
    if (this.cachedToken?.token.instance_url) {
      return this.cachedToken.token.instance_url;
    }
    return config.salesforce.instanceUrl;
  }

  /**
   * Geeft de API versie terug
   */
  getApiVersion(): string {
    return config.salesforce.apiVersion || 'v60.0';
  }
}
