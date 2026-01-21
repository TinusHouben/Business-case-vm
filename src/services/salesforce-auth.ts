import axios from 'axios';
import logger from '../utils/logger';

const CLIENT_ID = process.env.SALESFORCE_CLIENT_ID;
const CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.SALESFORCE_REFRESH_TOKEN;

const LOGIN_URL = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';

let cachedAccessToken: string | null = null;
let cachedInstanceUrl: string | null = null;
let cachedExpiresAt: number | null = null;

function mustEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

export async function getSalesforceConnection(): Promise<{ accessToken: string; instanceUrl: string }> {
  if (
    cachedAccessToken &&
    cachedInstanceUrl &&
    cachedExpiresAt &&
    Date.now() < cachedExpiresAt
  ) {
    return { accessToken: cachedAccessToken, instanceUrl: cachedInstanceUrl };
  }

  const clientId = mustEnv('SALESFORCE_CLIENT_ID', CLIENT_ID);
  const clientSecret = mustEnv('SALESFORCE_CLIENT_SECRET', CLIENT_SECRET);
  const refreshToken = mustEnv('SALESFORCE_REFRESH_TOKEN', REFRESH_TOKEN);

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('refresh_token', refreshToken);

    const resp = await axios.post(`${LOGIN_URL}/services/oauth2/token`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const accessToken: string = resp.data.access_token;
    const instanceUrl: string = resp.data.instance_url;
    const expiresInSec: number = Number(resp.data.expires_in ?? 3600);

    cachedAccessToken = accessToken;
    cachedInstanceUrl = instanceUrl;
    cachedExpiresAt = Date.now() + Math.max(300, expiresInSec - 300) * 1000;

    return { accessToken, instanceUrl };
  } catch (error: any) {
    logger.error('Failed to refresh Salesforce access token', {
      error: error?.message,
      status: error?.response?.status,
      data: error?.response?.data,
    });
    throw new Error(
      `Salesforce token refresh failed: ${error?.response?.status || ''} ${JSON.stringify(
        error?.response?.data || error?.message
      )}`
    );
  }
}
