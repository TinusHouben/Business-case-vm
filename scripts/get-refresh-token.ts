/**
 * Helper script om een Salesforce Refresh Token te verkrijgen
 * 
 * Gebruik:
 * 1. Zorg dat je .env bestand SALESFORCE_CLIENT_ID en SALESFORCE_CLIENT_SECRET heeft
 * 2. Run: npx ts-node scripts/get-refresh-token.ts
 * 3. Volg de instructies in de browser
 */

import dotenv from 'dotenv';
import axios from 'axios';
import readline from 'readline';
import { config } from '../src/config';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function vraag(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function main() {
  console.log('\n=== Salesforce Refresh Token Helper ===\n');

  // Controleer configuratie
  if (!config.salesforce.clientId || !config.salesforce.clientSecret) {
    console.error('❌ Fout: SALESFORCE_CLIENT_ID en SALESFORCE_CLIENT_SECRET moeten in .env staan');
    process.exit(1);
  }

  const clientId = config.salesforce.clientId;
  const redirectUri = 'http://localhost:3000/callback';
  
  // Bepaal login URL
  const isSandbox = config.salesforce.instanceUrl.includes('test.salesforce.com') || 
                    config.salesforce.instanceUrl.includes('--dev-ed');
  const loginUrl = isSandbox 
    ? 'https://test.salesforce.com' 
    : 'https://login.salesforce.com';

  console.log('📋 Stappen om Refresh Token te verkrijgen:\n');
  console.log('1. Open deze URL in je browser:');
  console.log(`\n   ${loginUrl}/services/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=api refresh_token\n`);
  console.log('2. Log in met je Salesforce account');
  console.log('3. Geef toestemming voor de app');
  console.log('4. Je wordt doorgestuurd naar een pagina met een URL die begint met:');
  console.log(`   ${redirectUri}?code=...\n`);

  const authorizationCode = await vraag('📝 Plak hier de authorization code uit de URL: ');

  if (!authorizationCode || authorizationCode.trim().length === 0) {
    console.error('❌ Geen authorization code ingevoerd');
    rl.close();
    process.exit(1);
  }

  console.log('\n⏳ Verkrijg refresh token...\n');

  try {
    const tokenUrl = `${loginUrl}/services/oauth2/token`;
    
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', clientId);
    params.append('client_secret', config.salesforce.clientSecret);
    params.append('redirect_uri', redirectUri);
    params.append('code', authorizationCode.trim());

    const response = await axios.post(tokenUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const refreshToken = response.data.refresh_token;
    const accessToken = response.data.access_token;
    const instanceUrl = response.data.instance_url;

    console.log('✅ Refresh token succesvol verkregen!\n');
    console.log('📝 Voeg deze regel toe aan je .env bestand:\n');
    console.log(`SALESFORCE_REFRESH_TOKEN=${refreshToken}\n`);
    
    if (instanceUrl && instanceUrl !== config.salesforce.instanceUrl) {
      console.log('💡 Tip: Update ook je SALESFORCE_INSTANCE_URL als deze anders is:');
      console.log(`SALESFORCE_INSTANCE_URL=${instanceUrl}\n`);
    }

    console.log('🔐 Je access token (voor testen):');
    console.log(`   ${accessToken.substring(0, 20)}...\n`);

  } catch (error: any) {
    console.error('\n❌ Fout bij verkrijgen refresh token:\n');
    
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Error: ${error.response.data?.error || 'Unknown error'}`);
      console.error(`Description: ${error.response.data?.error_description || 'No description'}`);
      console.error('\n📋 Response data:');
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    
    console.error('\n💡 Mogelijke oorzaken:');
    console.error('   - Authorization code is verlopen (probeer opnieuw)');
    console.error('   - Client ID of Client Secret is incorrect');
    console.error('   - Redirect URI komt niet overeen met Connected App configuratie');
    console.error('   - Connected App heeft geen "refresh_token" scope');
  }

  rl.close();
}

main().catch(console.error);
