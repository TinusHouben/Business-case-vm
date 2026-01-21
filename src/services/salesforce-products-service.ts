import axios from 'axios';
import { getSalesforceConnection } from './salesforce-auth';

const API_VERSION_RAW = process.env.SALESFORCE_API_VERSION || '60.0';
const API_VERSION = API_VERSION_RAW.startsWith('v') ? API_VERSION_RAW.substring(1) : API_VERSION_RAW;

export interface Product {
  id: string;
  externalProductId: string;
  name: string;
  price: number;
  stock: number;
}

function escapeSoql(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function getProducts(): Promise<Product[]> {
  const { accessToken, instanceUrl } = await getSalesforceConnection();

  const soql = `
    SELECT Id, Name, Price__c, Stock__c, ExternalProductId__c
    FROM ProductCustom__c
    ORDER BY Name
  `;

  const response = await axios.get(`${instanceUrl}/services/data/v${API_VERSION}/query`, {
    params: { q: soql },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const records = response.data.records || [];
  return records.map((r: any) => ({
    id: r.Id,
    externalProductId: r.ExternalProductId__c,
    name: r.Name,
    price: Number(r.Price__c ?? 0),
    stock: Number(r.Stock__c ?? 0),
  }));
}

export async function getProductByExternalProductId(externalProductId: string): Promise<Product | null> {
  const { accessToken, instanceUrl } = await getSalesforceConnection();

  const soql = `
    SELECT Id, Name, Price__c, Stock__c, ExternalProductId__c
    FROM ProductCustom__c
    WHERE ExternalProductId__c = '${escapeSoql(externalProductId)}'
    LIMIT 1
  `;

  const response = await axios.get(`${instanceUrl}/services/data/v${API_VERSION}/query`, {
    params: { q: soql },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const r = response.data.records?.[0];
  if (!r) return null;

  return {
    id: r.Id,
    externalProductId: r.ExternalProductId__c,
    name: r.Name,
    price: Number(r.Price__c ?? 0),
    stock: Number(r.Stock__c ?? 0),
  };
}
