'use strict';

const { getAiConfig } = require('../../config/ai.config');
const { PUBLIC_TOOL_ROLES } = require('./ai-permission-guard');
const { createBookingWorkflowTools } = require('./tools/booking-workflow.tools');
const { createPublicCustomerTools } = require('./tools/public-customer.tools');
const { createCustomerDynamicTools } = require('./tools/customer-dynamic.tools');
const { createKnowledgeTools } = require('./tools/knowledge.tools');
const { createOwnerTools } = require('./tools/owner.tools');
const { createAdminTools } = require('./tools/admin.tools');
const { createRecommendationTools } = require('./tools/recommendation.tools');

const withObjectSchema = (properties, required = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

const publicCustomerToolMetadata = Object.freeze([
  {
    name: 'search_restaurants',
    description: 'Search approved public BookEat restaurants by safe filters such as keyword, cuisine type, city, and price range.',
    label: 'Đang tìm nhà hàng...',
    access: 'public',
    allowedRoles: PUBLIC_TOOL_ROLES,
    resultType: 'restaurant_list',
    streamBehavior: 'result_only',
    schema: withObjectSchema({
      query: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 120,
        description: 'Natural-language keyword such as pho, hai san, mon Nhat. Omit when listing nearby/general restaurants.',
      },
      cuisineType: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 80,
        description: 'Cuisine filter when the user asks for a specific cuisine.',
      },
      city: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 80,
        description: 'City name if explicitly mentioned by the user.',
      },
      priceRange: {
        type: ['string', 'null'],
        enum: ['low', 'medium', 'high', null],
        description: 'low: under 200k, medium: 200k to 500k, high: over 500k.',
      },
      limit: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 5,
        description: 'Maximum restaurants to return in chat.',
      },
    }),
  },
  {
    name: 'get_restaurant_detail',
    description: 'Get safe public detail for one approved and active BookEat restaurant.',
    label: 'Đang tải thông tin nhà hàng...',
    access: 'public',
    allowedRoles: PUBLIC_TOOL_ROLES,
    resultType: 'restaurant_detail',
    streamBehavior: 'result_only',
    schema: withObjectSchema({
      restaurantId: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'BookEat restaurant Mongo ObjectId from page context or a previous restaurant card.',
      },
    }, ['restaurantId']),
  },
  {
    name: 'get_restaurant_menu',
    description: 'Get safe public menu items for one approved and active BookEat restaurant.',
    label: 'Đang tải menu...',
    access: 'public',
    allowedRoles: PUBLIC_TOOL_ROLES,
    resultType: 'menu_list',
    streamBehavior: 'result_only',
    schema: withObjectSchema({
      restaurantId: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'BookEat restaurant Mongo ObjectId from page context or a previous restaurant card.',
      },
      query: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 120,
        description: 'Dish keyword if the user asks for a specific dish.',
      },
      categoryId: {
        type: ['string', 'null'],
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'Optional public menu category id.',
      },
      maxPrice: {
        type: ['number', 'null'],
        minimum: 0,
        maximum: 10000000,
        description: 'Optional max dish price in VND when explicitly requested.',
      },
      limit: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 10,
        description: 'Maximum menu items to return in chat.',
      },
    }, ['restaurantId']),
  },
  {
    name: 'get_booking_policy',
    description: 'Answer public booking, cancellation, deposit, or general policy questions from curated BookEat policy or approved public restaurant policy fields.',
    label: 'Đang kiểm tra chính sách...',
    access: 'public',
    allowedRoles: PUBLIC_TOOL_ROLES,
    resultType: 'policy_answer',
    streamBehavior: 'result_only',
    schema: withObjectSchema({
      restaurantId: {
        type: ['string', 'null'],
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'Optional restaurant id when asking about the current restaurant policy.',
      },
      topic: {
        type: ['string', 'null'],
        enum: ['booking', 'cancellation', 'deposit', 'general', null],
        description: 'Policy topic requested by the user.',
      },
    }),
  },
]);

const phase7KnowledgeToolMetadata = Object.freeze([
  {
    name: 'search_knowledge',
    description: 'Search published BookEat knowledge for static FAQ, policy, terms, and support guidance. Do not use for dynamic data such as table availability, booking status, voucher validation, menu, payment, refund transaction, revenue, or personal data.',
    label: 'Đang tìm tài liệu hỗ trợ...',
    access: 'public',
    allowedRoles: PUBLIC_TOOL_ROLES,
    effect: 'read',
    cachePolicy: 'safe-static',
    resultType: 'knowledge_answer',
    streamBehavior: 'result_only',
    featureFlag: 'knowledgeSearchEnabled',
    schema: withObjectSchema({
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 240,
        description: 'The user question or concise static knowledge query. Never include private booking/payment details.',
      },
      category: {
        type: ['string', 'null'],
        enum: ['policy', 'faq', 'guide', 'support', 'terms', null],
        description: 'Optional broad knowledge category. Use null when unsure.',
      },
      limit: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 5,
        description: 'Maximum internal sources to return.',
      },
    }, ['query']),
  },
]);

const ownerToolMetadata = Object.freeze([
  {
    name: 'owner_get_today_bookings',
    description: 'Owner read-only summary of bookings for the selected restaurant and date. Uses ownerContext.selectedRestaurantId verified by backend ownership guard; never accept restaurantId from model.',
    label: 'Dang tai booking hom nay...',
    access: 'owner',
    allowedRoles: ['restaurant_owner'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'owner_booking_summary',
    featureFlag: 'ownerToolsEnabled',
    schema: withObjectSchema({
      date: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional selected local date YYYY-MM-DD. Use null for today.',
      },
      limit: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 10,
        description: 'Maximum bookings to show in the card.',
      },
    }, ['date', 'limit']),
  },
  {
    name: 'owner_get_available_tables',
    description: 'Owner read-only table availability for the selected restaurant. Requires bookingTime HH:mm; bookingDate can be null for today; numberOfGuests can be null for all available tables.',
    label: 'Dang kiem tra ban trong owner...',
    access: 'owner',
    allowedRoles: ['restaurant_owner'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'owner_table_availability',
    featureFlag: 'ownerToolsEnabled',
    schema: withObjectSchema({
      bookingDate: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Local date YYYY-MM-DD. Use null for today when the user asks today/tonight.',
      },
      bookingTime: {
        type: ['string', 'null'],
        pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
        description: 'Local time in HH:mm. Ask the owner if missing.',
      },
      numberOfGuests: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 100,
        description: 'Optional party size. Use null if the owner asks generally which tables are free.',
      },
    }, ['bookingDate', 'bookingTime', 'numberOfGuests']),
  },
  {
    name: 'owner_get_upcoming_customers',
    description: 'Owner read-only list of upcoming pending/confirmed bookings for the selected restaurant using privacy-safe customer labels only.',
    label: 'Dang tai khach sap den...',
    access: 'owner',
    allowedRoles: ['restaurant_owner'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'owner_booking_summary',
    featureFlag: 'ownerToolsEnabled',
    schema: withObjectSchema({
      dateFrom: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range start YYYY-MM-DD. Use null for default upcoming window.',
      },
      dateTo: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range end YYYY-MM-DD. Use null for default upcoming window.',
      },
      limit: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 10,
        description: 'Maximum bookings to return.',
      },
    }, ['dateFrom', 'dateTo', 'limit']),
  },
  {
    name: 'owner_get_cancelled_bookings',
    description: 'Owner read-only search card for cancelled/no-show bookings in the selected restaurant and safe date range.',
    label: 'Dang tai booking bi huy...',
    access: 'owner',
    allowedRoles: ['restaurant_owner'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'owner_booking_search_result',
    featureFlag: 'ownerToolsEnabled',
    schema: withObjectSchema({
      dateFrom: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range start YYYY-MM-DD. Use null for default recent range.',
      },
      dateTo: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range end YYYY-MM-DD. Use null for today.',
      },
      limit: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 10,
        description: 'Maximum bookings to return.',
      },
    }, ['dateFrom', 'dateTo', 'limit']),
  },
  {
    name: 'owner_get_revenue_summary',
    description: 'Owner read-only aggregate revenue summary for the selected restaurant. Return aggregate values only; no raw payment/order/bank/refund data.',
    label: 'Dang tong hop doanh thu...',
    access: 'owner',
    allowedRoles: ['restaurant_owner'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'owner_revenue_summary',
    featureFlag: 'ownerToolsEnabled',
    schema: withObjectSchema({
      dateFrom: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range start YYYY-MM-DD. Use null for today.',
      },
      dateTo: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range end YYYY-MM-DD. Use null for today.',
      },
    }, ['dateFrom', 'dateTo']),
  },
  {
    name: 'owner_get_voucher_summary',
    description: 'Owner read-only voucher aggregate summary for the selected restaurant. Do not return raw redemption ids, customer ids, or full voucher redemption lists.',
    label: 'Dang tong hop voucher...',
    access: 'owner',
    allowedRoles: ['restaurant_owner'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'owner_voucher_summary',
    featureFlag: 'ownerToolsEnabled',
    schema: withObjectSchema({
      dateFrom: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional usage range start YYYY-MM-DD. Use null for recent window.',
      },
      dateTo: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional usage range end YYYY-MM-DD. Use null for today.',
      },
    }, ['dateFrom', 'dateTo']),
  },
  {
    name: 'owner_get_review_summary',
    description: 'Owner read-only review summary for the selected restaurant with sanitized/truncated public review content only.',
    label: 'Dang tong hop review...',
    access: 'owner',
    allowedRoles: ['restaurant_owner'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'owner_review_summary',
    featureFlag: 'ownerToolsEnabled',
    schema: withObjectSchema({
      dateFrom: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional review range start YYYY-MM-DD. Use null for recent window.',
      },
      dateTo: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional review range end YYYY-MM-DD. Use null for today.',
      },
      limit: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 10,
        description: 'Maximum latest reviews to show.',
      },
    }, ['dateFrom', 'dateTo', 'limit']),
  },
  {
    name: 'owner_search_booking',
    description: 'Owner read-only booking search only inside backend-verified ownerContext.selectedRestaurantId. Search may include phone/email, but result must return privacy-safe projection only.',
    label: 'Dang tim booking owner...',
    access: 'owner',
    allowedRoles: ['restaurant_owner'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'owner_booking_search_result',
    featureFlag: 'ownerToolsEnabled',
    schema: withObjectSchema({
      query: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 120,
        description: 'Optional booking/customer search text. May include phone/email from owner, but never echo raw contact in final answer.',
      },
      status: {
        type: ['string', 'null'],
        enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no_show', null],
        description: 'Optional booking status filter.',
      },
      dateFrom: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range start YYYY-MM-DD.',
      },
      dateTo: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range end YYYY-MM-DD.',
      },
      limit: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 10,
        description: 'Maximum bookings to return.',
      },
    }, ['query', 'status', 'dateFrom', 'dateTo', 'limit']),
  },
  {
    name: 'owner_suggest_review_reply',
    description: 'Draft a suggested owner reply for one approved review in the selected restaurant. Read-only draft only; never save, publish, notify, or mutate review state.',
    label: 'Dang goi y tra loi review...',
    access: 'owner',
    allowedRoles: ['restaurant_owner'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'owner_review_reply_suggestion',
    featureFlag: 'ownerToolsEnabled',
    schema: withObjectSchema({
      reviewId: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'Review Mongo ObjectId from a safe owner review result card.',
      },
      tone: {
        type: ['string', 'null'],
        enum: ['warm_professional', 'apologetic', 'concise', null],
        description: 'Optional reply tone. Use null for warm_professional.',
      },
    }, ['reviewId', 'tone']),
  },
]);

const adminToolMetadata = Object.freeze([
  {
    name: 'admin_get_pending_restaurants',
    description: 'Admin read-only list of restaurants pending approval. Return only safe restaurant summary fields; no business license, tax code, bank, owner contact, approval mutation, or private admin notes.',
    label: 'Dang tai nha hang cho duyet...',
    access: 'admin',
    allowedRoles: ['admin'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'admin_pending_restaurants',
    featureFlag: 'adminToolsEnabled',
    schema: withObjectSchema({
      query: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 120,
        description: 'Optional restaurant name search. Never include contact or private document values.',
      },
      limit: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 10,
        description: 'Maximum pending restaurants to show.',
      },
    }, ['query', 'limit']),
  },
  {
    name: 'admin_get_transactions',
    description: 'Admin read-only aggregate transaction summary from payment records. Return aggregate values only; never expose payment id, order code, checkout URL, QR, metadata, gateway transaction id, webhook payload, bank, card, or raw provider fields.',
    label: 'Dang tong hop giao dich...',
    access: 'admin',
    allowedRoles: ['admin'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'admin_transaction_summary',
    featureFlag: 'adminToolsEnabled',
    schema: withObjectSchema({
      dateFrom: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range start YYYY-MM-DD. Use null for default recent window.',
      },
      dateTo: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range end YYYY-MM-DD. Use null for today.',
      },
      status: {
        type: ['string', 'null'],
        enum: ['pending', 'processing', 'paid', 'failed', 'cancelled', 'expired', 'refunded', 'partially_refunded', null],
        description: 'Optional payment status filter.',
      },
      query: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 120,
        description: 'Optional safe aggregate search over status/target/gateway labels. Never echo raw query.',
      },
    }, ['dateFrom', 'dateTo', 'status', 'query']),
  },
  {
    name: 'admin_get_refunds',
    description: 'Admin read-only refund summary. Return safe refund projection only; never expose payment id, customer id, bank info, gateway refund id, raw notes, internal admin notes, or withdrawal data.',
    label: 'Dang tong hop refund...',
    access: 'admin',
    allowedRoles: ['admin'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'admin_refund_summary',
    featureFlag: 'adminToolsEnabled',
    schema: withObjectSchema({
      dateFrom: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range start YYYY-MM-DD. Use null for default recent window.',
      },
      dateTo: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range end YYYY-MM-DD. Use null for today.',
      },
      status: {
        type: ['string', 'null'],
        enum: ['pending', 'requested', 'approved', 'rejected', 'processing', 'refunded', 'failed', 'cancelled', null],
        description: 'Optional refund status filter. pending maps to requested in backend data.',
      },
      query: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 120,
        description: 'Optional refund reason/status search. Never echo raw query.',
      },
      limit: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 10,
        description: 'Maximum refund rows to show.',
      },
    }, ['dateFrom', 'dateTo', 'status', 'query', 'limit']),
  },
  {
    name: 'admin_get_revenue_summary',
    description: 'Admin read-only aggregate platform revenue summary. Do not return payment rows, payment ids, order ids, bank data, withdrawal data, or raw provider metadata.',
    label: 'Dang tong hop doanh thu admin...',
    access: 'admin',
    allowedRoles: ['admin'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'admin_revenue_summary',
    featureFlag: 'adminToolsEnabled',
    schema: withObjectSchema({
      dateFrom: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range start YYYY-MM-DD. Use null for default recent window.',
      },
      dateTo: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range end YYYY-MM-DD. Use null for today.',
      },
    }, ['dateFrom', 'dateTo']),
  },
  {
    name: 'admin_detect_abnormal_activity',
    description: 'Admin read-only anomaly summary using aggregate counts only. Do not lock users/restaurants, create alerts, refund payments, approve/reject restaurants, or expose raw ids/logs/provider payloads.',
    label: 'Dang quet dau hieu bat thuong...',
    access: 'admin',
    allowedRoles: ['admin'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'admin_abnormal_activity',
    featureFlag: 'adminToolsEnabled',
    schema: withObjectSchema({
      dateFrom: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range start YYYY-MM-DD. Use null for default recent window.',
      },
      dateTo: {
        type: ['string', 'null'],
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional range end YYYY-MM-DD. Use null for today.',
      },
    }, ['dateFrom', 'dateTo']),
  },
  {
    name: 'admin_draft_complaint_reply',
    description: 'Draft an admin support reply for a complaint. Draft-only: never send, save, assign, change refund status, notify, approve, reject, lock, or mutate any record.',
    label: 'Dang tao ban nhap phan hoi...',
    access: 'admin',
    allowedRoles: ['admin'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'admin_draft_reply',
    featureFlag: 'adminToolsEnabled',
    schema: withObjectSchema({
      complaintText: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 1000,
        description: 'Optional complaint summary. Backend redacts phone/email/payment/bank/order-like text before returning a draft.',
      },
      tone: {
        type: ['string', 'null'],
        enum: ['supportive_professional', 'apologetic', 'concise', null],
        description: 'Optional reply tone.',
      },
      subjectType: {
        type: ['string', 'null'],
        enum: ['complaint', 'refund', 'restaurant', 'payment', 'general', null],
        description: 'Optional broad complaint subject.',
      },
    }, ['complaintText', 'tone', 'subjectType']),
  },
]);

const phase4ToolMetadata = Object.freeze([
  {
    name: 'check_table_availability',
    description: 'Check real read-only table availability for one public approved BookEat restaurant. Call only when restaurantId, bookingDate YYYY-MM-DD, bookingTime HH:mm, and numberOfGuests are known. Do not create or hold a booking.',
    label: '\u0110ang ki\u1ec3m tra b\u00e0n tr\u1ed1ng...',
    access: 'public',
    allowedRoles: PUBLIC_TOOL_ROLES,
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'availability_result',
    streamBehavior: 'result_only',
    featureFlag: 'availabilityToolEnabled',
    featureFlags: ['customerDynamicToolsEnabled', 'availabilityToolEnabled'],
    schema: withObjectSchema({
      restaurantId: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'BookEat restaurant Mongo ObjectId from page context or a previous restaurant card. Ask the user if missing.',
      },
      bookingDate: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'BookEat local date in Asia/Ho_Chi_Minh timezone, formatted YYYY-MM-DD. Ask the user if missing or ambiguous.',
      },
      bookingTime: {
        type: 'string',
        pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
        description: 'BookEat local time in 24-hour HH:mm format. Ask the user if missing.',
      },
      numberOfGuests: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Number of guests. Ask the user if missing.',
      },
    }, ['restaurantId', 'bookingDate', 'bookingTime', 'numberOfGuests']),
  },
  {
    name: 'validate_voucher',
    description: 'Validate a voucher code for the current logged-in customer using read-only backend voucher validation. Requires customer auth. Use only estimates; do not redeem, lock, save, or apply a voucher.',
    label: '\u0110ang ki\u1ec3m tra voucher...',
    access: 'customer',
    allowedRoles: ['customer'],
    effect: 'read',
    cachePolicy: 'none',
    resultType: 'voucher_result',
    streamBehavior: 'result_only',
    featureFlag: 'voucherToolEnabled',
    featureFlags: ['customerDynamicToolsEnabled', 'voucherToolEnabled'],
    schema: withObjectSchema({
      code: {
        type: 'string',
        minLength: 1,
        maxLength: 60,
        description: 'Voucher code exactly as provided by the user.',
      },
      restaurantId: {
        type: ['string', 'null'],
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'Restaurant id when the voucher is for a specific restaurant. Use null if not known and ask if validation needs it.',
      },
      orderAmountEstimate: {
        type: ['number', 'null'],
        minimum: 0,
        maximum: 1000000000,
        description: 'Customer-provided estimated order/deposit amount in VND. Use null and ask if missing; never invent this amount.',
      },
    }, ['code']),
  },
]);

const phase5ToolMetadata = Object.freeze([
  {
    name: 'prepare_booking',
    description: 'Prepare a server-side booking preview for the current logged-in customer. Call only after restaurantId, bookingDate, bookingTime, and numberOfGuests are known. Contact fields may be null so the backend can prefill them from the authenticated profile. This creates only a temporary pending action, never a Booking, table hold, voucher lock, payment, or confirmation.',
    label: '\u0110ang t\u1ea1o b\u1ea3n xem tr\u01b0\u1edbc \u0111\u1eb7t b\u00e0n...',
    access: 'customer',
    allowedRoles: ['customer'],
    effect: 'prepare',
    cachePolicy: 'none',
    resultType: 'booking_preview',
    streamBehavior: 'result_only',
    featureFlag: 'bookingPreviewToolEnabled',
    featureFlags: ['customerDynamicToolsEnabled', 'bookingPreviewToolEnabled'],
    schema: withObjectSchema({
      restaurantId: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'BookEat restaurant Mongo ObjectId from page context or a previous restaurant result. Ask the user if missing.',
      },
      bookingDate: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Local booking date in Asia/Bangkok, YYYY-MM-DD. Ask if missing or ambiguous.',
      },
      bookingTime: {
        type: 'string',
        pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
        description: 'Local booking time in 24-hour HH:mm. Ask if missing.',
      },
      numberOfGuests: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Number of guests. Ask if missing.',
      },
      customerName: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 200,
        description: 'Customer-provided contact name, or null to securely prefill from the authenticated profile.',
      },
      customerPhone: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 30,
        description: 'Customer-provided phone, or null to securely prefill from the authenticated profile.',
      },
      customerEmail: {
        type: ['string', 'null'],
        minLength: 3,
        maxLength: 200,
        description: 'Customer-provided email, or null to securely prefill from the authenticated profile.',
      },
      tableNumbers: {
        type: ['array', 'null'],
        maxItems: 10,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 50,
        },
        description: 'Optional table numbers explicitly requested by the user. Use null when not selected.',
      },
      tableId: {
        type: ['string', 'null'],
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'Optional RestaurantTable id if explicitly selected. Use null otherwise.',
      },
      voucherCode: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 60,
        description: 'Optional voucher code provided by the user. Use null otherwise.',
      },
      voucherId: {
        type: ['string', 'null'],
        pattern: '^[a-fA-F0-9]{24}$',
        description: 'Optional voucher id from trusted BookEat context. Use null otherwise.',
      },
      specialRequests: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 500,
        description: 'Optional special request from the user. Use null otherwise.',
      },
      note: {
        type: ['string', 'null'],
        minLength: 1,
        maxLength: 500,
        description: 'Optional booking note alias. Use null when specialRequests is already supplied.',
      },
      occasion: {
        type: ['string', 'null'],
        enum: ['birthday', 'anniversary', 'business', 'date', 'family', 'other', null],
        description: 'Optional occasion. Use null if not stated.',
      },
    }, [
      'restaurantId',
      'bookingDate',
      'bookingTime',
      'numberOfGuests',
    ]),
  },
  {
    name: 'get_personalized_recommendations',
    description: 'Get personalized restaurant, menu items, or mixed recommendations for the current customer based on their history, preferences, and context.',
    label: 'Đang tìm gợi ý phù hợp...',
    access: 'public',
    allowedRoles: PUBLIC_TOOL_ROLES,
    resultType: 'personalized_recommendations',
    streamBehavior: 'result_only',
    featureFlags: ['customerDynamicToolsEnabled'],
    schema: withObjectSchema({
      type: {
        type: ['string', 'null'],
        description: 'Type of recommendation requested: restaurant, menu_item, or mixed. Use null when the user asks generally and the tool should default safely.',
      },
      limit: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 10,
        description: 'Maximum recommendations to return (1-10).',
      },
      context: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: {
          budget: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 80,
            description: 'Optional budget preference such as binh dan, trung cap, sang trong.',
          },
          cuisine: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 80,
            description: 'Optional cuisine preference.',
          },
          location: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 120,
            description: 'Optional city, district, or nearby preference.',
          },
          numberOfGuests: {
            type: ['integer', 'null'],
            minimum: 1,
            maximum: 20,
            description: 'Optional party size.',
          },
          occasion: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 80,
            description: 'Optional occasion such as date, family, business.',
          },
          preferredTime: {
            type: ['string', 'null'],
            minLength: 1,
            maxLength: 40,
            description: 'Optional preferred time such as 15:00, buoi chieu, toi nay.',
          },
        },
        required: [],
        description: 'Optional recommendation context extracted from the conversation.',
      },
    }),
  },
]);

const phase6ToolMetadata = Object.freeze([
  {
    name: 'confirm_booking',
    description: 'Internal HTTP-only booking confirmation handler.',
    label: 'Đang xác nhận đặt bàn...',
    access: 'customer',
    allowedRoles: ['customer'],
    effect: 'execute',
    exposedToModel: false,
    cachePolicy: 'none',
    resultType: 'booking_confirmation',
    featureFlag: 'bookingConfirmEnabled',
    schema: withObjectSchema({
      pendingActionId: {
        type: 'string',
        pattern: '^[a-fA-F0-9]{24}$',
      },
      confirmation: {
        type: 'boolean',
      },
    }, ['pendingActionId', 'confirmation']),
  },
]);

const createDefaultHandlers = () => ({
  ...createPublicCustomerTools(),
  ...createCustomerDynamicTools(),
  ...createBookingWorkflowTools(),
  ...createKnowledgeTools(),
  ...createOwnerTools(),
  ...createAdminTools(),
  ...createRecommendationTools(),
});

const getRegistryFlags = () => {
  try {
    return getAiConfig();
  } catch {
    return {
      availabilityToolEnabled: true,
      voucherToolEnabled: true,
      bookingPreviewToolEnabled: true,
      bookingConfirmEnabled: true,
      customerDynamicToolsEnabled: true,
      knowledgeSearchEnabled: true,
      ownerToolsEnabled: true,
      adminToolsEnabled: true,
    };
  }
};

const createAiToolRegistry = ({
  handlers = createDefaultHandlers(),
  metadata = [
    ...publicCustomerToolMetadata,
    ...phase7KnowledgeToolMetadata,
    ...ownerToolMetadata,
    ...adminToolMetadata,
    ...phase4ToolMetadata,
    ...phase5ToolMetadata,
    ...phase6ToolMetadata,
  ],
  flags = getRegistryFlags(),
} = {}) => {
  const enabledMetadata = metadata.filter((tool) => {
    const featureFlags = [
      ...(tool.featureFlag ? [tool.featureFlag] : []),
      ...(Array.isArray(tool.featureFlags) ? tool.featureFlags : []),
    ];
    return featureFlags.every((featureFlag) => flags[featureFlag] !== false);
  });

  const tools = new Map(enabledMetadata.map((tool) => {
    const handler = handlers[tool.name];
    return [tool.name, {
      ...tool,
      handler,
      definition: {
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.schema,
        strict: true,
      },
    }];
  }));

  return {
    getTool(name) {
      return tools.get(name) || null;
    },
    listTools() {
      return Array.from(tools.values());
    },
    getToolDefinitions(role) {
      return Array.from(tools.values())
        .filter((tool) => {
          if (tool.exposedToModel === false) return false;
          if (!role) return true;
          const allowedRoles = tool.allowedRoles || (
            tool.access === 'public'
              ? PUBLIC_TOOL_ROLES
              : tool.access === 'owner' ? ['restaurant_owner']
                : tool.access === 'admin' ? ['admin'] : ['customer']
          );
          return allowedRoles.includes(role);
        })
        .map((tool) => tool.definition);
    },
    getToolNames() {
      return Array.from(tools.keys());
    },
  };
};

module.exports = {
  createAiToolRegistry,
  phase4ToolMetadata,
  phase5ToolMetadata,
  phase6ToolMetadata,
  phase7KnowledgeToolMetadata,
  adminToolMetadata,
  ownerToolMetadata,
  publicCustomerToolMetadata,
};
