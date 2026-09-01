export type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
  ASSETS: Fetcher;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
};

export type Variables = {
  userId: number;
  userName: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

export type Currency = "USD" | "IQD";

export type CarStatus = "in_stock" | "sold" | "traded" | "archived";

export type SaleType = "cash" | "installment";
