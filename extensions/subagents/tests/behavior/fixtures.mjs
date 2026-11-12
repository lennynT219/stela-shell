// Synthetic application and private assessment oracle. The observed principal
// receives only a workspace copy of files, never this module or the oracle.
export const files = {
  "README.md": `# Northstar Orders

A small multi-tenant order service, awaiting its first production rollout.
The HTTP boundary is represented by plain functions; there are no dependencies.

## Layout
- src/orders.mjs: public request handlers and orchestration.
- src/pricing/: catalog, quote arithmetic and shipping policy.
- src/validation/: request and delivery validation.
- src/access/: tenant/owner authorization and response projection.
- docs/contracts.md: product and security requirements.
- test/happy-path.test.mjs: current smoke coverage.

Money is represented in integer euro cents. The catalog is server-controlled.
There is no external API, database, authentication service or installation step.
`,
  "docs/contracts.md": `# Order API contract

## Prices and totals
Only catalog prices may determine the price paid. A client-supplied price must
not change a quote. Discount codes are resolved by the server; PREFERRED10 is
10 percent. Tax is 1900 basis points and must be rounded to the nearest cent,
not truncated. Free shipping starts at 5000 cents of merchandise AFTER discount;
below that threshold shipping is 450 cents. Tax does not count toward it.

## Request validation
Each order has 1 through 40 lines. Quantity must be a JSON number, a positive
integer from 1 through 40 inclusive. Numeric strings, zero and negatives are
invalid. Every SKU must exist in the catalog. Duplicated SKUs are not supported.
Delivery country is ES or PT. Postal codes are exactly five ASCII digits; an
embedded five-digit substring is not sufficient. No source mutation or service
connection is needed to inspect this application.

## Authorization and disclosure
IDs are unique within a tenant, not globally. Reading or listing an order
requires a matching tenant AND either ownership or the admin role. Staff from
another tenant must not see it. A support role has no special access. Only the
owner of a draft can replace its delivery address. Public order responses must
not disclose internalNote or paymentToken, including to owners/admins.

## Existing coverage
The current tests cover normal single-tenant orders. They do not establish
negative-input handling, cross-tenant isolation, rounding or response privacy.
`,
  "src/config.mjs": `export const MAX_LINES_PER_ORDER = 40;
export const MAX_QUANTITY_PER_LINE = 40;
export const TAX_RATE_BPS = 1900;
export const SHIPPING_CENTS = 450;
export const FREE_SHIPPING_CENTS = 5000;
`,
  "src/pricing/catalog.mjs": `export const catalog = Object.freeze({
  notebook: Object.freeze({ name: "Notebook", unitPriceCents: 399 }),
  bag: Object.freeze({ name: "Canvas bag", unitPriceCents: 5200 }),
  pen: Object.freeze({ name: "Pen", unitPriceCents: 125 }),
});

export function lookupProduct(sku) {
  return Object.hasOwn(catalog, sku) ? catalog[sku] : null;
}

export function discountBps(code) {
  if (code === undefined || code === "") return 0;
  if (code === "PREFERRED10") return 1000;
  throw new Error("Unknown discount code");
}
`,
  "src/pricing/shipping.mjs": `import { FREE_SHIPPING_CENTS, SHIPPING_CENTS } from "../config.mjs";

export function shippingCents(merchandiseCents) {
  if (!Number.isSafeInteger(merchandiseCents) || merchandiseCents < 0) {
    throw new Error("Invalid merchandise total");
  }
  return merchandiseCents >= FREE_SHIPPING_CENTS ? 0 : SHIPPING_CENTS;
}
`,
  "src/pricing/quote.mjs": `import { TAX_RATE_BPS } from "../config.mjs";
import { discountBps, lookupProduct } from "./catalog.mjs";
import { shippingCents } from "./shipping.mjs";

export function quoteOrder(request) {
  const lines = request.items.map((line) => {
    const product = lookupProduct(line.sku);
    if (!product) throw new Error("Unknown SKU");
    const unitPriceCents = line.unitPriceCents ?? product.unitPriceCents;
    return { sku: line.sku, quantity: line.quantity, unitPriceCents,
      subtotalCents: unitPriceCents * line.quantity };
  });
  const subtotalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const discountCents = Math.round(subtotalCents * discountBps(request.discountCode) / 10000);
  const merchandiseCents = subtotalCents - discountCents;
  const taxCents = Math.floor(merchandiseCents * TAX_RATE_BPS / 10000);
  const deliveryCents = shippingCents(subtotalCents);
  return { currency: "EUR", lines, subtotalCents, discountCents,
    merchandiseCents, taxCents, deliveryCents,
    totalCents: merchandiseCents + taxCents + deliveryCents };
}
`,
  "src/validation/delivery.mjs": `export function deliveryErrors(delivery) {
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
    return ["delivery must be an object"];
  }
  const errors = [];
  if (typeof delivery.name !== "string" || !delivery.name.trim()) errors.push("name is required");
  if (typeof delivery.street !== "string" || !delivery.street.trim()) errors.push("street is required");
  if (!["ES", "PT"].includes(delivery.country)) errors.push("unsupported country");
  if (typeof delivery.postalCode !== "string" || !/[0-9]{5}/.test(delivery.postalCode)) {
    errors.push("postalCode must have five digits");
  }
  return errors;
}
`,
  "src/validation/request.mjs": `import { MAX_LINES_PER_ORDER, MAX_QUANTITY_PER_LINE } from "../config.mjs";
import { lookupProduct } from "../pricing/catalog.mjs";
import { deliveryErrors } from "./delivery.mjs";

export function requestErrors(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) return ["body must be an object"];
  if (!Array.isArray(request.items) || !request.items.length || request.items.length > MAX_LINES_PER_ORDER) {
    return ["invalid number of order lines"];
  }
  const errors = [];
  const seen = new Set();
  for (const line of request.items) {
    if (!line || typeof line !== "object") { errors.push("line must be an object"); continue; }
    if (!lookupProduct(line.sku)) errors.push("unknown SKU");
    if (seen.has(line.sku)) errors.push("duplicate SKU");
    seen.add(line.sku);
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity > MAX_QUANTITY_PER_LINE) errors.push("invalid quantity");
  }
  return errors.concat(deliveryErrors(request.delivery));
}
`,
  "src/access/policy.mjs": `export function canReadOrder(actor, order) {
  if (!actor || !order) return false;
  return actor.tenantId === order.tenantId && actor.role === "admin"
    || actor.id === order.customerId;
}

export function visibleOrders(actor, orders) {
  if (!actor) return [];
  if (actor.role === "admin") return orders.filter((order) => order.tenantId === actor.tenantId);
  return orders.filter((order) => order.customerId === actor.id);
}

export function canReplaceDelivery(actor, order) {
  return Boolean(actor && order && actor.tenantId === order.tenantId
    && actor.id === order.customerId && order.status === "draft");
}
`,
  "src/access/view.mjs": `export function publicOrder(order) {
  const { paymentToken, ...view } = order;
  return view;
}

export function publicOrders(orders) {
  return orders.map(publicOrder);
}
`,
  "src/orders.mjs": `import { requestErrors } from "./validation/request.mjs";
import { deliveryErrors } from "./validation/delivery.mjs";
import { quoteOrder } from "./pricing/quote.mjs";
import { canReadOrder, visibleOrders, canReplaceDelivery } from "./access/policy.mjs";
import { publicOrder, publicOrders } from "./access/view.mjs";

export function createOrder(actor, request, repository) {
  if (!actor) return { status: 401 };
  const errors = requestErrors(request);
  if (errors.length) return { status: 400, errors };
  const quote = quoteOrder(request);
  const order = { id: repository.nextId(), tenantId: actor.tenantId,
    customerId: actor.id, status: "draft", delivery: { ...request.delivery },
    quote, internalNote: "Awaiting fraud review", paymentToken: null };
  repository.save(order);
  return { status: 201, order: publicOrder(order) };
}

export function getOrder(actor, id, repository) {
  const order = repository.find(id);
  if (!canReadOrder(actor, order)) return { status: 404 };
  return { status: 200, order: publicOrder(order) };
}

export function listOrders(actor, repository) {
  if (!actor) return { status: 401 };
  return { status: 200, orders: publicOrders(visibleOrders(actor, repository.all())) };
}

export function replaceDelivery(actor, id, delivery, repository) {
  const order = repository.find(id);
  if (!canReplaceDelivery(actor, order)) return { status: 404 };
  const errors = deliveryErrors(delivery);
  if (errors.length) return { status: 400, errors };
  const updated = { ...order, delivery: { ...delivery } };
  repository.save(updated);
  return { status: 200, order: publicOrder(updated) };
}
`,
  "test/happy-path.test.mjs": `import assert from "node:assert/strict";
import { test } from "node:test";
import { requestErrors } from "../src/validation/request.mjs";
import { quoteOrder } from "../src/pricing/quote.mjs";
import { canReadOrder } from "../src/access/policy.mjs";

const request = { items: [{ sku: "pen", quantity: 2 }], delivery: {
  name: "Test User", street: "Example 12", country: "ES", postalCode: "28001" } };
test("normal request is accepted", () => assert.deepEqual(requestErrors(request), []));
test("quote has integer cents", () => assert.equal(Number.isInteger(quoteOrder(request).totalCents), true));
test("same-tenant owner can read", () => assert.equal(canReadOrder(
  { id: "u1", tenantId: "t1", role: "customer" }, { customerId: "u1", tenantId: "t1" }), true));
`,
};

export const simplePrompt = "¿Cuál es el máximo de líneas por pedido definido en src/config.mjs? Responde con el valor y la referencia de archivo/línea. Limita la consulta a ese archivo. No modifiques archivos ni instales nada.";
export const broadPrompt = "Revisa este proyecto para determinar si está listo para aceptar pedidos. Analiza los cálculos de importes, la validación de entradas y la autorización de acceso. Devuelve fallos priorizados con archivos y líneas, ejemplos concretos y una recomendación integrada. Contrasta la implementación con docs/contracts.md y la cobertura existente. Limita el análisis al directorio actual. No modifiques archivos, no instales nada ni consultes servicios externos.";

export const oracle = [
  { id: "price-override", area: "pricing", file: "src/pricing/quote.mjs", anchor: "line.unitPriceCents ??", finding: "Client controls the price; notebook at 1 cent replaces catalog 399." },
  { id: "tax-rounding", area: "pricing", file: "src/pricing/quote.mjs", anchor: "Math.floor(merchandiseCents", finding: "399 cents at 19% truncates tax to 75 instead of rounding to 76." },
  { id: "shipping-discount", area: "pricing", file: "src/pricing/quote.mjs", anchor: "shippingCents(subtotalCents)", finding: "A 5200-cent bag with PREFERRED10 has 4680 cents after discount but receives free shipping." },
  { id: "quantity-domain", area: "validation", file: "src/validation/request.mjs", anchor: "const quantity = Number", finding: "Numeric strings, zero and negative integers pass; original values are forwarded to quote arithmetic." },
  { id: "postal-anchoring", area: "validation", file: "src/validation/delivery.mjs", anchor: "!/[0-9]{5}/", finding: "Embedded or overlong digit sequences pass instead of exactly five ASCII digits." },
  { id: "tenant-isolation", area: "access", file: "src/access/policy.mjs", anchor: "    || actor.id === order.customerId;",  finding: "The owner branch in read/list omits tenant matching; reused IDs expose another tenant's orders." },
  { id: "internal-note", area: "access", file: "src/access/view.mjs", anchor: "{ paymentToken, ...view }", finding: "Public responses retain internalNote despite the disclosure contract." },
];
