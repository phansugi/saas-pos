/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiAccess from "../apiAccess.js";
import type * as ar from "../ar.js";
import type * as auth from "../auth.js";
import type * as authEmail from "../authEmail.js";
import type * as billing from "../billing.js";
import type * as categories from "../categories.js";
import type * as crons from "../crons.js";
import type * as devices from "../devices.js";
import type * as entitlements from "../entitlements.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as inviteEmail from "../inviteEmail.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_account from "../lib/account.js";
import type * as lib_analytics from "../lib/analytics.js";
import type * as lib_apiKeys from "../lib/apiKeys.js";
import type * as lib_apiOrders from "../lib/apiOrders.js";
import type * as lib_ar from "../lib/ar.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_billing_billingCalc from "../lib/billing/billingCalc.js";
import type * as lib_billing_catalog from "../lib/billing/catalog.js";
import type * as lib_billing_entitlements from "../lib/billing/entitlements.js";
import type * as lib_billing_index from "../lib/billing/index.js";
import type * as lib_billing_modules from "../lib/billing/modules.js";
import type * as lib_billing_subscription from "../lib/billing/subscription.js";
import type * as lib_businessCategory from "../lib/businessCategory.js";
import type * as lib_businessCategoryStore from "../lib/businessCategoryStore.js";
import type * as lib_categories from "../lib/categories.js";
import type * as lib_digitalPayment from "../lib/digitalPayment.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_escpos from "../lib/escpos.js";
import type * as lib_fnb from "../lib/fnb.js";
import type * as lib_fnbTax from "../lib/fnbTax.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_impersonation from "../lib/impersonation.js";
import type * as lib_inventory from "../lib/inventory.js";
import type * as lib_laporan from "../lib/laporan.js";
import type * as lib_laporanPdf from "../lib/laporanPdf.js";
import type * as lib_laporanPdfFont from "../lib/laporanPdfFont.js";
import type * as lib_laporanWarna from "../lib/laporanWarna.js";
import type * as lib_laporanXlsx from "../lib/laporanXlsx.js";
import type * as lib_loyalty from "../lib/loyalty.js";
import type * as lib_meja from "../lib/meja.js";
import type * as lib_modifiers from "../lib/modifiers.js";
import type * as lib_opname from "../lib/opname.js";
import type * as lib_otp from "../lib/otp.js";
import type * as lib_payables from "../lib/payables.js";
import type * as lib_platform from "../lib/platform.js";
import type * as lib_platformTenants from "../lib/platformTenants.js";
import type * as lib_productCatalogPresets from "../lib/productCatalogPresets.js";
import type * as lib_productCatalogSeed from "../lib/productCatalogSeed.js";
import type * as lib_productEdit from "../lib/productEdit.js";
import type * as lib_productImages from "../lib/productImages.js";
import type * as lib_productSku from "../lib/productSku.js";
import type * as lib_profile from "../lib/profile.js";
import type * as lib_purchasing from "../lib/purchasing.js";
import type * as lib_rbac from "../lib/rbac.js";
import type * as lib_realtimeSync from "../lib/realtimeSync.js";
import type * as lib_receiptWhatsapp from "../lib/receiptWhatsapp.js";
import type * as lib_roleSettings from "../lib/roleSettings.js";
import type * as lib_scale from "../lib/scale.js";
import type * as lib_shift from "../lib/shift.js";
import type * as lib_struk from "../lib/struk.js";
import type * as lib_support from "../lib/support.js";
import type * as lib_tax from "../lib/tax.js";
import type * as lib_team from "../lib/team.js";
import type * as lib_tenantLogo from "../lib/tenantLogo.js";
import type * as lib_threeway from "../lib/threeway.js";
import type * as lib_webhookEvents from "../lib/webhookEvents.js";
import type * as lib_webhookOutbox from "../lib/webhookOutbox.js";
import type * as lib_webhooks from "../lib/webhooks.js";
import type * as lib_wholesale from "../lib/wholesale.js";
import type * as loyalty from "../loyalty.js";
import type * as meja from "../meja.js";
import type * as members from "../members.js";
import type * as modules from "../modules.js";
import type * as opname from "../opname.js";
import type * as otp from "../otp.js";
import type * as otpEmail from "../otpEmail.js";
import type * as payables from "../payables.js";
import type * as payments from "../payments.js";
import type * as platform from "../platform.js";
import type * as platformCategories from "../platformCategories.js";
import type * as pos from "../pos.js";
import type * as products from "../products.js";
import type * as purchasing from "../purchasing.js";
import type * as receiptWa from "../receiptWa.js";
import type * as receiptWaData from "../receiptWaData.js";
import type * as reports from "../reports.js";
import type * as roles from "../roles.js";
import type * as shiftAlertEmail from "../shiftAlertEmail.js";
import type * as shiftAlerts from "../shiftAlerts.js";
import type * as subcategories from "../subcategories.js";
import type * as support from "../support.js";
import type * as sync from "../sync.js";
import type * as tables from "../tables.js";
import type * as tenants from "../tenants.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiAccess: typeof apiAccess;
  ar: typeof ar;
  auth: typeof auth;
  authEmail: typeof authEmail;
  billing: typeof billing;
  categories: typeof categories;
  crons: typeof crons;
  devices: typeof devices;
  entitlements: typeof entitlements;
  http: typeof http;
  inventory: typeof inventory;
  inviteEmail: typeof inviteEmail;
  "lib/access": typeof lib_access;
  "lib/account": typeof lib_account;
  "lib/analytics": typeof lib_analytics;
  "lib/apiKeys": typeof lib_apiKeys;
  "lib/apiOrders": typeof lib_apiOrders;
  "lib/ar": typeof lib_ar;
  "lib/auth": typeof lib_auth;
  "lib/authz": typeof lib_authz;
  "lib/billing/billingCalc": typeof lib_billing_billingCalc;
  "lib/billing/catalog": typeof lib_billing_catalog;
  "lib/billing/entitlements": typeof lib_billing_entitlements;
  "lib/billing/index": typeof lib_billing_index;
  "lib/billing/modules": typeof lib_billing_modules;
  "lib/billing/subscription": typeof lib_billing_subscription;
  "lib/businessCategory": typeof lib_businessCategory;
  "lib/businessCategoryStore": typeof lib_businessCategoryStore;
  "lib/categories": typeof lib_categories;
  "lib/digitalPayment": typeof lib_digitalPayment;
  "lib/errors": typeof lib_errors;
  "lib/escpos": typeof lib_escpos;
  "lib/fnb": typeof lib_fnb;
  "lib/fnbTax": typeof lib_fnbTax;
  "lib/hash": typeof lib_hash;
  "lib/impersonation": typeof lib_impersonation;
  "lib/inventory": typeof lib_inventory;
  "lib/laporan": typeof lib_laporan;
  "lib/laporanPdf": typeof lib_laporanPdf;
  "lib/laporanPdfFont": typeof lib_laporanPdfFont;
  "lib/laporanWarna": typeof lib_laporanWarna;
  "lib/laporanXlsx": typeof lib_laporanXlsx;
  "lib/loyalty": typeof lib_loyalty;
  "lib/meja": typeof lib_meja;
  "lib/modifiers": typeof lib_modifiers;
  "lib/opname": typeof lib_opname;
  "lib/otp": typeof lib_otp;
  "lib/payables": typeof lib_payables;
  "lib/platform": typeof lib_platform;
  "lib/platformTenants": typeof lib_platformTenants;
  "lib/productCatalogPresets": typeof lib_productCatalogPresets;
  "lib/productCatalogSeed": typeof lib_productCatalogSeed;
  "lib/productEdit": typeof lib_productEdit;
  "lib/productImages": typeof lib_productImages;
  "lib/productSku": typeof lib_productSku;
  "lib/profile": typeof lib_profile;
  "lib/purchasing": typeof lib_purchasing;
  "lib/rbac": typeof lib_rbac;
  "lib/realtimeSync": typeof lib_realtimeSync;
  "lib/receiptWhatsapp": typeof lib_receiptWhatsapp;
  "lib/roleSettings": typeof lib_roleSettings;
  "lib/scale": typeof lib_scale;
  "lib/shift": typeof lib_shift;
  "lib/struk": typeof lib_struk;
  "lib/support": typeof lib_support;
  "lib/tax": typeof lib_tax;
  "lib/team": typeof lib_team;
  "lib/tenantLogo": typeof lib_tenantLogo;
  "lib/threeway": typeof lib_threeway;
  "lib/webhookEvents": typeof lib_webhookEvents;
  "lib/webhookOutbox": typeof lib_webhookOutbox;
  "lib/webhooks": typeof lib_webhooks;
  "lib/wholesale": typeof lib_wholesale;
  loyalty: typeof loyalty;
  meja: typeof meja;
  members: typeof members;
  modules: typeof modules;
  opname: typeof opname;
  otp: typeof otp;
  otpEmail: typeof otpEmail;
  payables: typeof payables;
  payments: typeof payments;
  platform: typeof platform;
  platformCategories: typeof platformCategories;
  pos: typeof pos;
  products: typeof products;
  purchasing: typeof purchasing;
  receiptWa: typeof receiptWa;
  receiptWaData: typeof receiptWaData;
  reports: typeof reports;
  roles: typeof roles;
  shiftAlertEmail: typeof shiftAlertEmail;
  shiftAlerts: typeof shiftAlerts;
  subcategories: typeof subcategories;
  support: typeof support;
  sync: typeof sync;
  tables: typeof tables;
  tenants: typeof tenants;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
