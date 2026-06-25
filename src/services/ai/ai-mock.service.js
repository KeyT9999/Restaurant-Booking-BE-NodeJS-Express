'use strict';

const { createAiToolRegistry } = require('./ai-tool-registry');
const { createAiToolRunner } = require('./ai-tool-runner');

const createMockReply = (message) => ({
  message: `BookEat \u0111\u00e3 nh\u1eadn: ${message}`,
  provider: 'mock',
});

const normalizeText = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\u0111/g, 'd')
  .replace(/\u0110/g, 'D')
  .toLowerCase();

const getRestaurantIdFromContext = (pageContext = {}) => {
  if (typeof pageContext?.restaurantId === 'string' && /^[a-fA-F0-9]{24}$/.test(pageContext.restaurantId)) {
    return pageContext.restaurantId;
  }

  const routeMatch = typeof pageContext?.route === 'string'
    ? pageContext.route.match(/^\/restaurants\/([a-fA-F0-9]{24})$/)
    : null;

  return routeMatch?.[1] || null;
};

const getPolicyTopic = (normalizedMessage) => {
  if (/\b(huy|cancel|hoan)\b/.test(normalizedMessage)) return 'cancellation';
  if (/\b(coc|deposit|thanh toan)\b/.test(normalizedMessage)) return 'deposit';
  if (/\b(dat ban|booking|giu cho|dat cho)\b/.test(normalizedMessage)) return 'booking';
  return 'general';
};

const getSearchKeyword = (message) => {
  const normalized = normalizeText(message);
  if (/\bpho\b/.test(normalized)) return 'ph\u1edf';
  if (normalized.includes('hai san')) return 'h\u1ea3i s\u1ea3n';
  if (normalized.includes('mon nhat') || normalized.includes('nha hang nhat')) return 'Nh\u1eadt';
  if (normalized.includes('han quoc') || normalized.includes('nha hang han')) return 'H\u00e0n Qu\u1ed1c';
  if (normalized.includes('lau')) return 'l\u1ea9u';
  if (normalized.includes('nuong')) return 'n\u01b0\u1edbng';

  return String(message || '')
    .replace(/^\s*(tim|t\u00ecm|goi y|g\u1ee3i \u00fd|cho toi|cho t\u00f4i)\s+/i, '')
    .replace(/\b(nha hang|nh\u00e0 h\u00e0ng|quan|qu\u00e1n|gan day|g\u1ea7n day|gan toi|g\u1ea7n t\u00f4i)\b/gi, '')
    .trim()
    .slice(0, 120) || null;
};

const getCity = (normalizedMessage) => {
  if (normalizedMessage.includes('ha noi')) return 'Ha Noi';
  if (
    normalizedMessage.includes('ho chi minh')
    || normalizedMessage.includes('hcm')
    || normalizedMessage.includes('sai gon')
  ) return 'Ho Chi Minh';
  if (normalizedMessage.includes('da nang')) return 'Da Nang';
  return null;
};

const getDistrict = (message) => {
  const raw = String(message || '');
  const match = raw.match(/\b(?:quan|q\.?)\s*(\d{1,2})\b/i);
  return match ? `Quan ${match[1]}` : null;
};

const getRecommendationBudget = (normalizedMessage) => {
  if (/\b(re|gia re|tiet kiem|binh dan|duoi)\b/.test(normalizedMessage)) return 'low';
  if (/\b(vua tui tien|trung binh|tam trung|medium)\b/.test(normalizedMessage)) return 'medium';
  if (/\b(cao cap|sang|expensive|premium)\b/.test(normalizedMessage)) return 'high';
  return null;
};

const getRecommendationCuisine = (message, normalizedMessage) => {
  if (normalizedMessage.includes('pho')) return 'pho';
  if (normalizedMessage.includes('hai san')) return 'hai san';
  if (normalizedMessage.includes('mon nhat') || normalizedMessage.includes('nha hang nhat')) return 'Nhat';
  if (normalizedMessage.includes('han quoc') || normalizedMessage.includes('nha hang han')) return 'Han Quoc';
  if (normalizedMessage.includes('lau')) return 'lau';
  if (normalizedMessage.includes('nuong')) return 'nuong';
  const keyword = getSearchKeyword(message);
  return keyword && keyword.length <= 40 ? keyword : null;
};

const getRecommendationPreferredTime = (normalizedMessage) => {
  if (normalizedMessage.includes('toi nay') || normalizedMessage.includes('buoi toi')) return '19:00';
  if (normalizedMessage.includes('trua') || normalizedMessage.includes('buoi trua')) return '12:00';
  if (normalizedMessage.includes('sang') || normalizedMessage.includes('an sang')) return '08:00';
  return null;
};

const getRecommendationType = (normalizedMessage) => {
  if (
    normalizedMessage.includes('ca nha hang va mon')
    || normalizedMessage.includes('ca mon va nha hang')
    || normalizedMessage.includes('nha hang va mon')
    || normalizedMessage.includes('mon va nha hang')
    || normalizedMessage.includes('tong hop')
    || normalizedMessage.includes('mixed')
  ) {
    return 'mixed';
  }
  if (
    normalizedMessage.includes('mon')
    || normalizedMessage.includes('menu')
    || normalizedMessage.includes('an gi')
  ) {
    return 'menu_item';
  }
  return 'restaurant';
};

const isPersonalizedRecommendationRequest = (normalizedMessage) => (
  normalizedMessage.includes('ca nhan hoa')
  || normalizedMessage.includes('hop voi toi')
  || normalizedMessage.includes('hop gu toi')
  || normalizedMessage.includes('goi y cho toi')
  || normalizedMessage.includes('de xuat cho toi')
  || normalizedMessage.includes('toi nen an gi')
  || normalizedMessage.includes('toi nen dat quan nao')
);

const getLocalDateString = (offsetDays = 0) => {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

const extractBookingDate = (message, normalizedMessage) => {
  if (normalizedMessage.includes('toi nay') || normalizedMessage.includes('hom nay')) {
    return getLocalDateString(0);
  }
  if (/\b(ngay mai|toi mai|mai)\b/.test(normalizedMessage)) {
    return getLocalDateString(1);
  }

  const dateMatch = String(message || '').match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (!dateMatch) return null;

  const currentYear = Number(getLocalDateString(0).slice(0, 4));
  const day = dateMatch[1].padStart(2, '0');
  const month = dateMatch[2].padStart(2, '0');
  const rawYear = dateMatch[3];
  const year = rawYear
    ? String(rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear))
    : String(currentYear);
  return `${year}-${month}-${day}`;
};

const extractBookingTime = (message) => {
  const text = String(message || '').toLowerCase();
  const match = text.match(/\b([01]?\d|2[0-3])\s*(?:h|gi\u1edd|:)\s*([0-5]\d)?\b/);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2] || '00'}`;
};

const extractGuestCount = (message) => {
  const match = String(message || '').match(/\b(\d{1,3})\s*(?:ng\u01b0\u1eddi|nguoi|kh\u00e1ch|khach)\b/i);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isInteger(count) && count >= 1 && count <= 100 ? count : null;
};

const extractVoucherCode = (message) => {
  const text = String(message || '');
  const explicit = text.match(/\b(?:voucher|m\u00e3|ma|code|coupon)\s+([A-Z0-9_-]{2,60})\b/i);
  if (explicit) return explicit[1].toUpperCase();
  const fallback = text.match(/\b([A-Z][A-Z0-9_-]{2,59})\b/);
  return fallback ? fallback[1].toUpperCase() : null;
};

const extractAmountEstimate = (message) => {
  const match = String(message || '').toLowerCase().match(/\b(\d+(?:[.,]\d+)*)\s*(k|nghin|ngan|ng\u00e0n|trieu|tri\u1ec7u|vnd|\u0111|d)?\b/);
  if (!match) return null;
  const numeric = Number(match[1].replace(/[.,]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  const unit = match[2] || '';
  if (unit === 'k' || unit === 'nghin' || unit === 'ngan' || unit === 'ng\u00e0n') return numeric * 1000;
  if (unit === 'trieu' || unit === 'tri\u1ec7u') return numeric * 1000000;
  return numeric >= 1000 ? numeric : null;
};

const inferToolCall = ({ message, pageContext }) => {
  const normalized = normalizeText(message);
  const restaurantId = getRestaurantIdFromContext(pageContext);

  if (isPersonalizedRecommendationRequest(normalized)) {
    return {
      name: 'get_personalized_recommendations',
      args: {
        type: getRecommendationType(normalized),
        limit: 5,
        context: {
          budget: getRecommendationBudget(normalized),
          cuisine: getRecommendationCuisine(message, normalized),
          location: getDistrict(message) || getCity(normalized),
          numberOfGuests: extractGuestCount(message),
          occasion: null,
          preferredTime: getRecommendationPreferredTime(normalized),
        },
      },
    };
  }

  if (
    normalized.includes('voucher')
    || normalized.includes('ma giam gia')
    || normalized.includes('coupon')
  ) {
    const code = extractVoucherCode(message);
    if (!code) {
      return {
        name: null,
        note: 'B\u1ea1n cho m\u00ecnh m\u00e3 voucher c\u1ea7n ki\u1ec3m tra nh\u00e9.',
      };
    }

    return {
      name: 'validate_voucher',
      args: {
        code,
        restaurantId,
        orderAmountEstimate: extractAmountEstimate(message),
      },
    };
  }

  if (
    normalized.includes('con ban')
    || normalized.includes('ban trong')
    || normalized.includes('kiem tra ban')
    || normalized.includes('co ban')
  ) {
    const bookingDate = extractBookingDate(message, normalized);
    const bookingTime = extractBookingTime(message);
    const numberOfGuests = extractGuestCount(message);
    const missing = [];
    if (!restaurantId) missing.push('nh\u00e0 h\u00e0ng');
    if (!bookingDate) missing.push('ng\u00e0y');
    if (!bookingTime) missing.push('gi\u1edd');
    if (!numberOfGuests) missing.push('s\u1ed1 kh\u00e1ch');
    if (missing.length > 0) {
      return {
        name: null,
        note: `M\u00ecnh c\u1ea7n th\u00eam ${missing.join(', ')} \u0111\u1ec3 ki\u1ec3m tra b\u00e0n tr\u1ed1ng.`,
      };
    }

    return {
      name: 'check_table_availability',
      args: {
        restaurantId,
        bookingDate,
        bookingTime,
        numberOfGuests,
      },
    };
  }

  if (
    normalized.includes('chinh sach')
    || normalized.includes('quy dinh')
    || normalized.includes('huy')
    || normalized.includes('dat coc')
    || normalized.includes('deposit')
  ) {
    return {
      name: 'get_booking_policy',
      args: {
        restaurantId,
        topic: getPolicyTopic(normalized),
      },
    };
  }

  if (
    normalized.includes('menu')
    || normalized.includes('thuc don')
    || normalized.includes('mon an')
    || normalized.includes('gia mon')
  ) {
    if (!restaurantId) {
      return {
        name: 'search_restaurants',
        args: {
          query: getSearchKeyword(message),
          cuisineType: null,
          city: getCity(normalized),
          priceRange: null,
          limit: 5,
        },
        note: 'H\u00e3y ch\u1ecdn m\u1ed9t nh\u00e0 h\u00e0ng c\u1ee5 th\u1ec3 \u0111\u1ec3 xem menu c\u00f4ng khai.',
      };
    }

    return {
      name: 'get_restaurant_menu',
      args: {
        restaurantId,
        query: null,
        categoryId: null,
        maxPrice: null,
        limit: 10,
      },
    };
  }

  if (
    restaurantId
    && (
      normalized.includes('chi tiet')
      || normalized.includes('thong tin')
      || normalized.includes('dia chi')
      || normalized.includes('gio mo cua')
    )
  ) {
    return {
      name: 'get_restaurant_detail',
      args: { restaurantId },
    };
  }

  return {
    name: 'search_restaurants',
    args: {
      query: getSearchKeyword(message),
      cuisineType: null,
      city: getCity(normalized),
      priceRange: null,
      limit: 5,
    },
  };
};

const getToolSummary = (toolName, toolResult, fallbackNote) => {
  const payload = toolResult.result?.payload || {};
  if (toolName === 'validate_voucher') {
    if (payload.authRequired) return payload.reason;
    if (payload.status === 'needs_input') return payload.reason;
    return payload.valid
      ? `Voucher ${payload.code} c\u00f3 th\u1ec3 h\u1ee3p l\u1ec7 theo \u01b0\u1edbc t\u00ednh hi\u1ec7n t\u1ea1i.`
      : `Voucher ${payload.code || ''} ch\u01b0a h\u1ee3p l\u1ec7${payload.reason ? `: ${payload.reason}` : '.'}`;
  }
  if (toolName === 'check_table_availability') {
    return payload.available
      ? 'Khung gi\u1edd n\u00e0y \u0111ang c\u00f3 b\u00e0n ph\u00f9 h\u1ee3p theo ki\u1ec3m tra hi\u1ec7n t\u1ea1i.'
      : (payload.reason || 'Khung gi\u1edd n\u00e0y ch\u01b0a c\u00f3 b\u00e0n ph\u00f9 h\u1ee3p.');
  }
  if (!toolResult.ok) return toolResult.message || 'Tool public t\u1ea1m th\u1eddi kh\u00f4ng kh\u1ea3 d\u1ee5ng.';
  if (fallbackNote) return fallbackNote;

  if (toolName === 'get_personalized_recommendations') {
    const count = Number(payload.items?.length || 0);
    return payload.message || (
      count > 0
        ? `Da tim thay ${count} goi y phu hop.`
        : 'Chua tim thay goi y phu hop luc nay.'
    );
  }
  if (toolName === 'search_restaurants') {
    const count = Number(payload.returned ?? payload.restaurants?.length ?? 0);
    return count > 0
      ? `T\u00ecm th\u1ea5y ${count} nh\u00e0 h\u00e0ng public ph\u00f9 h\u1ee3p.`
      : 'Ch\u01b0a t\u00ecm th\u1ea5y nh\u00e0 h\u00e0ng public ph\u00f9 h\u1ee3p v\u1edbi y\u00eau c\u1ea7u n\u00e0y.';
  }
  if (toolName === 'get_restaurant_menu') {
    const count = Number(payload.returned ?? payload.items?.length ?? 0);
    return count > 0
      ? `T\u00ecm th\u1ea5y ${count} m\u00f3n c\u00f4ng khai trong menu.`
      : 'Ch\u01b0a t\u00ecm th\u1ea5y m\u00f3n c\u00f4ng khai ph\u00f9 h\u1ee3p trong menu.';
  }
  if (toolName === 'get_booking_policy') {
    return payload.answer || '\u0110\u00e2y l\u00e0 th\u00f4ng tin ch\u00ednh s\u00e1ch public t\u1eeb BookEat.';
  }
  if (toolName === 'get_restaurant_detail') {
    return payload.restaurant?.name
      ? `\u0110\u00e2y l\u00e0 th\u00f4ng tin public c\u1ee7a ${payload.restaurant.name}.`
      : '\u0110\u00e2y l\u00e0 th\u00f4ng tin nh\u00e0 h\u00e0ng public.';
  }
  return '\u0110\u00e3 l\u1ea5y d\u1eef li\u1ec7u public t\u1eeb BookEat.';
};

async function* streamMockChat({
  message,
  pageContext,
  requestId,
  user,
  signal,
  registry = createAiToolRegistry(),
  toolRunner = createAiToolRunner({ registry }),
} = {}) {
  if (signal?.aborted) return;

  const inferredCall = inferToolCall({ message, pageContext });
  if (!inferredCall.name) {
    yield {
      type: 'delta',
      text: inferredCall.note || 'M\u00ecnh c\u1ea7n th\u00eam th\u00f4ng tin \u0111\u1ec3 ki\u1ec3m tra ch\u00ednh x\u00e1c.',
    };
    yield {
      type: 'completed',
      usage: { inputTokens: 0, outputTokens: 0, fallback: 'mock-public-tools' },
    };
    return;
  }

  const tool = registry.getTool(inferredCall.name);

  yield {
    type: 'tool_started',
    tool: inferredCall.name,
    label: tool?.label || '\u0110ang t\u1ea3i d\u1eef li\u1ec7u public...',
  };

  const toolResult = await toolRunner.runToolCall({
    toolName: inferredCall.name,
    rawArguments: JSON.stringify(inferredCall.args),
    requestId: requestId || 'mock-fallback',
    user,
    signal,
  });

  yield {
    type: 'tool_completed',
    tool: inferredCall.name,
    label: toolResult.label || tool?.label || '\u0110\u00e3 x\u1eed l\u00fd tool public',
    status: toolResult.status,
    latencyMs: toolResult.latencyMs,
    errorCode: toolResult.errorCode || null,
    message: toolResult.ok ? null : toolResult.message,
  };

  if (toolResult.result) {
    yield {
      type: 'result',
      tool: inferredCall.name,
      result: toolResult.result,
    };
  }

  yield {
    type: 'delta',
    text: getToolSummary(inferredCall.name, toolResult, inferredCall.note),
  };
  yield {
    type: 'completed',
    usage: { inputTokens: 0, outputTokens: 0, fallback: 'mock-public-tools' },
  };
}

module.exports = {
  createMockReply,
  inferToolCall,
  normalizeText,
  streamMockChat,
};
