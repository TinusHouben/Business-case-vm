import dotenv from 'dotenv';
import "dotenv/config";

dotenv.config();

export const config = {
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/',
    queue: process.env.RABBITMQ_QUEUE || 'orders_queue',
    dlq: process.env.RABBITMQ_DLQ || 'orders_dlq',
    maxRetries: 3,
    retryDelay: 5000,
  },
  salesforce: {
    instanceUrl: process.env.SALESFORCE_INSTANCE_URL || '',
    clientId: process.env.SALESFORCE_CLIENT_ID || '',
    clientSecret: process.env.SALESFORCE_CLIENT_SECRET || '',
    refreshToken: process.env.SALESFORCE_REFRESH_TOKEN || '',
    apiVersion: process.env.SALESFORCE_API_VERSION || 'v60.0',
    // Legacy username/password support (optioneel, voor backward compatibility)
    username: process.env.SALESFORCE_USERNAME || '',
    password: process.env.SALESFORCE_PASSWORD || '',
    securityToken: process.env.SALESFORCE_SECURITY_TOKEN || '',
  },
  api: {
    port: parseInt(process.env.API_PORT || '3000', 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || './logs',
  },
};

const requiredEnvVars = [
  'RABBITMQ_URL',
  'SALESFORCE_INSTANCE_URL',
  'SALESFORCE_CLIENT_ID',
  'SALESFORCE_CLIENT_SECRET',
];

// Refresh token of username/password moet aanwezig zijn
const hasRefreshToken = process.env.SALESFORCE_REFRESH_TOKEN && process.env.SALESFORCE_REFRESH_TOKEN.length > 0;
const hasUsernamePassword = process.env.SALESFORCE_USERNAME && process.env.SALESFORCE_PASSWORD && 
                            process.env.SALESFORCE_USERNAME.length > 0 && process.env.SALESFORCE_PASSWORD.length > 0;

if (!hasRefreshToken && !hasUsernamePassword) {
  requiredEnvVars.push('SALESFORCE_REFRESH_TOKEN of SALESFORCE_USERNAME/PASSWORD');
}

export function validateConfig(): void {
  const missing = requiredEnvVars.filter(
    (varName) => !process.env[varName]
  );

  if (missing.length > 0) {
    console.warn(
      `Warning: Missing environment variables: ${missing.join(', ')}`
    );
    console.warn('Please check your .env file');
  }
}
