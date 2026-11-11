export type Audience = "MEN" | "WOMEN" | "KIDS" | "UNISEX";

export interface Category {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  productCount?: number;
}

export interface Variant {
  id: string;
  size: string;
  color: string;
  sku: string;
  stock: number;
  priceDelta: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: string;
  images: string[];
  audience: Audience;
  category: Category;
  variants: Variant[];
  isActive: boolean;
  createdAt: string;
}

export interface CartItem {
  id: string;
  quantity: number;
  variant: Variant & { product: Product };
}

export interface WishlistItem {
  id: string;
  productId: string;
  createdAt: string;
  product: Product;
}

export interface Address {
  id: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  isDefault: boolean;
}

export type Role = "CUSTOMER" | "ADMIN";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt?: string;
  addresses?: Address[];
}

export interface ShippingAddress {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  phone: string;
}

export interface Refund {
  id: string;
  refundRef: string;
  providerRefundId: string | null;
  amount: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  reason: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  provider: "CASHFREE";
  providerOrderId: string;
  providerPaymentId: string | null;
  amount: string;
  currency: string;
  status:
    | "PENDING"
    | "PROCESSING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED"
    | "REFUNDED"
    | "PARTIALLY_REFUNDED";
  failureMessage: string | null;
  refunds: Refund[];
  createdAt: string;
}

export interface Order {
  id: string;
  status: string;
  totalAmount: string;
  shippingAddress: ShippingAddress;
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  createdAt: string;
  updatedAt: string;
  // Only present on admin endpoints (GET/PATCH /api/admin/orders/*).
  user?: { id: string; name: string; email: string };
  payments?: Payment[];
  walletTransactions?: WalletTransaction[];
  items: Array<{
    id: string;
    quantity: number;
    price: string;
    variant: Variant & { product: Product };
  }>;
}

export interface WalletTransaction {
  id: string;
  type: "TOPUP" | "ORDER_PAYMENT" | "REFUND" | "ADMIN_CREDIT" | "ADMIN_DEBIT";
  status: "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  amount: string; // signed — credits positive, debits negative
  balanceAfter: string;
  reason: string | null;
  orderId: string | null;
  createdAt: string;
}

export interface Wallet {
  id: string;
  balance: string;
  transactions: WalletTransaction[];
  // Only present on admin endpoints (GET /api/admin/wallets).
  user?: { id: string; name: string; email: string };
}

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string;
  comment: string;
  isRead: boolean;
  createdAt: string;
}
