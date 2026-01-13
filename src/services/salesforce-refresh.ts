// src/services/salesforce-refresh.ts
import "dotenv/config";
import axios, { AxiosInstance } from "axios";



type TokenCache = { accessToken: string; expiresAt: number };

export class SalesforceRefreshService {
  private axiosInstance: AxiosInstance;
  private tokenCache: TokenCache | null = null;

  constructor() {
    this.axiosInstance = axios.create();
  }

  private get apiVersion() {
    return process.env.SALESFORCE_API_VERSION ?? "60.0";
  }

  private get instanceUrl() {
    // clean + ensure no trailing slashes issues
    const v = process.env.SALESFORCE_INSTANCE_URL;
    if (!v) throw new Error("Missing env var: SALESFORCE_INSTANCE_URL");
    return v.replace(/\/+$/, "");
  }

  private get clientId() {
    const v = process.env.SALESFORCE_CLIENT_ID;
    if (!v) throw new Error("Missing env var: SALESFORCE_CLIENT_ID");
    return v;
  }

  private get clientSecret() {
    const v = process.env.SALESFORCE_CLIENT_SECRET;
    if (!v) throw new Error("Missing env var: SALESFORCE_CLIENT_SECRET");
    return v;
  }

  private get refreshToken() {
    const v = process.env.SALESFORCE_REFRESH_TOKEN;
    if (!v) throw new Error("Missing env var: SALESFORCE_REFRESH_TOKEN");
    return v;
  }

  async authenticate(): Promise<void> {
    const now = Date.now();
    if (this.tokenCache && now < this.tokenCache.expiresAt - 30_000) return;

    const tokenUrl = `${this.instanceUrl}/services/oauth2/token`;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
    });

    const res = await axios.post(tokenUrl, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const accessToken = res.data.access_token as string;
    const expiresIn = (res.data.expires_in as number | undefined) ?? 600;

    this.tokenCache = { accessToken, expiresAt: now + expiresIn * 1000 };

    // Important: end with slash so relative paths work reliably
    this.axiosInstance.defaults.baseURL = this.instanceUrl + "/";
    this.axiosInstance.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;
    this.axiosInstance.defaults.headers.common["Content-Type"] = "application/json";
  }

  get client(): AxiosInstance {
    return this.axiosInstance;
  }
}
