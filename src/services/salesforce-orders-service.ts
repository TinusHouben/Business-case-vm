import "dotenv/config";
import { SalesforceRefreshService } from "./salesforce-refresh";

export type RabbitOrder = {
  id: string;
  customerId: string;
  amount: number;
  status?: "NEW" | "PAID" | "CANCELLED";
};

export type RabbitCustomer = {
  id: string;
  name: string;
  email: string;
  phone?: string;
};

export class SalesforceOrdersService {
  constructor(private readonly sf: SalesforceRefreshService) {}

  private instance() {
    return (process.env.SALESFORCE_INSTANCE_URL ?? "").replace(/\/+$/, "");
  }

  private apiVersion() {
    return process.env.SALESFORCE_API_VERSION ?? "60.0";
  }

  async upsertCustomerAndGetId(customer: RabbitCustomer): Promise<string> {
    await this.sf.authenticate();

    const instance = this.instance();
    const v = this.apiVersion();

    // Upsert via ExternalId__c (belangrijk: ExternalId__c NIET in body)
    const upsertUrl = `${instance}/services/data/v${v}/sobjects/CustomerCustom__c/ExternalId__c/${encodeURIComponent(
      customer.id
    )}`;

    await this.sf.client.patch(upsertUrl, {
      Name: customer.name,
      Email__c: customer.email,
      Phone__c: customer.phone ?? null,
    });

    // Query SF Id terug voor lookup
    const queryUrl = `${instance}/services/data/v${v}/query`;
    const q = `SELECT Id FROM CustomerCustom__c WHERE ExternalId__c = '${customer.id}' LIMIT 1`;

    const qr = await this.sf.client.get(queryUrl, { params: { q } });
    if (!qr.data.records?.length) throw new Error("Customer not found after upsert");

    return qr.data.records[0].Id as string;
  }

  async createOrderForCustomer(order: RabbitOrder, customerSfId: string): Promise<string> {
    await this.sf.authenticate();

    const instance = this.instance();
    const v = this.apiVersion();

    const createUrl = `${instance}/services/data/v${v}/sobjects/OrderCustom__c`;

    const res = await this.sf.client.post(createUrl, {
      ExternalOrderId__c: order.id,
      Total__c: order.amount,
      Status__c: order.status ?? "NEW",
      CustomerC__c: customerSfId,
    });

    if (!res.data?.success) {
      throw new Error(`Order create failed: ${JSON.stringify(res.data)}`);
    }

    return res.data.id as string;
  }

  async syncOrder(customer: RabbitCustomer, order: RabbitOrder): Promise<{ customerSfId: string; orderSfId: string }> {
    const customerSfId = await this.upsertCustomerAndGetId(customer);
    const orderSfId = await this.createOrderForCustomer(order, customerSfId);
    return { customerSfId, orderSfId };
  }
}
