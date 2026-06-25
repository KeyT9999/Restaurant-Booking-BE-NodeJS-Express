'use strict';

const AiKnowledgeDocument = require('../../models/AiKnowledgeDocument');
const { DEFAULT_AI_KNOWLEDGE_DOCUMENTS } = require('../../data/ai-knowledge-seed');

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;
const MAX_CANDIDATES = 100;
const DEFAULT_DISCLAIMER = 'Thông tin này được lấy từ knowledge base đã published của BookEat và có thể cần nhà hàng hoặc nhân viên xác nhận cho trường hợp cụ thể.';
const NO_MATCH_ANSWER = 'Mình không tìm thấy tài liệu knowledge đã published phù hợp với quyền truy cập hiện tại. Bạn có thể chat với nhân viên hoặc liên hệ nhà hàng để được hỗ trợ.';
const DYNAMIC_FALLBACK_ANSWER = 'Câu hỏi này cần dữ liệu thời gian thực hoặc dữ liệu cá nhân, nên không thể trả lời bằng knowledge base tĩnh. Vui lòng dùng chức năng phù hợp hoặc chat với nhân viên.';

const CATEGORY_VALUES = new Set(['policy', 'faq', 'guide', 'support', 'terms']);

const ROLE_SCOPE_BY_ROLE = Object.freeze({
  guest: ['public'],
  customer: ['public', 'customer'],
  restaurant_owner: ['public', 'owner'],
  owner: ['public', 'owner'],
  admin: ['public', 'admin'],
});

const STOP_WORDS = new Set([
  'anh',
  'ban',
  'bi',
  'cai',
  'can',
  'cho',
  'co',
  'cua',
  'duoc',
  'gi',
  'hay',
  'hoi',
  'khong',
  'la',
  'lam',
  'minh',
  'mot',
  'nao',
  'neu',
  'nhu',
  'toi',
  'trong',
  'va',
  've',
  'voi',
]);

const STATIC_INTENT_PHRASES = Object.freeze([
  'chinh sach',
  'quy dinh',
  'dieu kien',
  'huong dan',
  'cach',
  'faq',
  'la gi',
  'co duoc',
  'ho tro',
  'can biet',
]);

const DYNAMIC_DATA_PHRASES = Object.freeze([
  'ban trong',
  'con ban',
  'kiem tra ban',
  'trang thai booking',
  'trang thai dat ban',
  'booking cua toi',
  'lich dat cua toi',
  'dat ban cua toi',
  'ma dat ban',
  'booking id',
  'voucher cua toi',
  'ma voucher',
  'kiem tra voucher',
  'voucher con',
  'voucher het han',
  'giam bao nhieu',
  'ap dung voucher',
  'redeem voucher',
  'save voucher',
  'luu voucher',
  'menu',
  'mon an',
  'gia mon',
  'thanh toan cua toi',
  'payment',
  'refund id',
  'hoan tien cua toi',
  'doanh thu',
  'so du',
  'thong tin ca nhan',
]);

const normalizeSearchText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const compactText = (value, maxLength = 1200) => {
  if (typeof value !== 'string') return '';
  const normalized = value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
};

const tokenize = (value) => normalizeSearchText(value)
  .split(/[^a-z0-9]+/)
  .map((token) => token.trim())
  .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  .slice(0, 24);

const clampLimit = (limit) => {
  if (!Number.isInteger(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, limit));
};

const getAllowedRoleScopes = (actorRole = 'guest') => (
  ROLE_SCOPE_BY_ROLE[actorRole] || ROLE_SCOPE_BY_ROLE.guest
);

const isStaticKnowledgeIntent = (normalizedQuery) => (
  STATIC_INTENT_PHRASES.some((phrase) => normalizedQuery.includes(phrase))
);

const isDynamicKnowledgeQuery = (query) => {
  const normalized = normalizeSearchText(query);
  const hasDynamicPhrase = DYNAMIC_DATA_PHRASES.some((phrase) => normalized.includes(phrase));
  const hasStaticIntent = isStaticKnowledgeIntent(normalized);

  if (hasDynamicPhrase && !hasStaticIntent) return true;

  const hasPersonalMarker = /\b(cua toi|cho toi|ma don|id|trang thai|lich su)\b/.test(normalized);
  const hasSensitiveTopic = /\b(booking|dat ban|voucher|payment|thanh toan|refund|hoan tien|doanh thu|ca nhan)\b/.test(normalized);
  return hasPersonalMarker && hasSensitiveTopic && !hasStaticIntent;
};

const isEffective = (doc, now) => {
  if (doc.effectiveFrom && new Date(doc.effectiveFrom) > now) return false;
  if (doc.effectiveTo && new Date(doc.effectiveTo) < now) return false;
  return true;
};

const isVisibleDocument = (doc, { allowedScopes, category, now }) => (
  doc
  && doc.status === 'published'
  && allowedScopes.includes(doc.roleScope)
  && (!category || doc.category === category)
  && isEffective(doc, now)
);

const createNoMatchResult = ({ dynamic = false } = {}) => ({
  type: 'knowledge_answer',
  version: 1,
  payload: {
    found: false,
    title: null,
    answer: dynamic ? DYNAMIC_FALLBACK_ANSWER : NO_MATCH_ANSWER,
    matchedSources: [],
    category: null,
    updatedAt: null,
    disclaimer: dynamic
      ? 'Knowledge search chỉ dùng cho FAQ, chính sách và hướng dẫn tĩnh, không dùng cho dữ liệu động hoặc cá nhân.'
      : DEFAULT_DISCLAIMER,
  },
});

const collectSearchableText = (doc) => normalizeSearchText([
  doc.title,
  doc.key,
  doc.slug,
  doc.category,
  ...(doc.tags || []),
  doc.summary,
  doc.content,
].filter(Boolean).join(' '));

const scoreDocument = (doc, query, tokens) => {
  const normalizedQuery = normalizeSearchText(query);
  const title = normalizeSearchText(doc.title);
  const summary = normalizeSearchText(doc.summary);
  const content = normalizeSearchText(doc.content);
  const key = normalizeSearchText(`${doc.key || ''} ${doc.slug || ''}`);
  const tags = (doc.tags || []).map(normalizeSearchText);
  const searchable = collectSearchableText(doc);

  let score = 0;
  if (title.includes(normalizedQuery)) score += 30;
  if (summary.includes(normalizedQuery)) score += 20;
  if (content.includes(normalizedQuery)) score += 12;
  if (key.includes(normalizedQuery)) score += 12;

  for (const token of tokens) {
    if (tags.some((tag) => tag === token || tag.includes(token))) score += 14;
    if (title.includes(token)) score += 8;
    if (key.includes(token)) score += 6;
    if (summary.includes(token)) score += 4;
    if (content.includes(token)) score += 2;
    if (!searchable.includes(token)) score -= 1;
  }

  return score;
};

const toMatchedSource = (doc) => ({
  title: doc.title,
  sourceLabel: doc.source?.label || 'BookEat Knowledge Base',
  category: doc.category,
  version: doc.version,
  updatedAt: toIsoString(doc.updatedAt || doc.createdAt),
});

const toIsoString = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const toKnowledgeResult = (docs, { limit }) => {
  const best = docs[0];
  const answer = compactText(best.content || best.summary || '');
  const matchedSources = docs.slice(0, limit).map(toMatchedSource);

  return {
    type: 'knowledge_answer',
    version: 1,
    payload: {
      found: true,
      title: best.title,
      answer,
      matchedSources,
      category: best.category,
      updatedAt: toIsoString(best.updatedAt || best.createdAt),
      disclaimer: DEFAULT_DISCLAIMER,
      sourceLabel: matchedSources[0]?.sourceLabel || 'BookEat Knowledge Base',
    },
  };
};

const runQuery = async (query) => {
  let chain = query;
  if (typeof chain.sort === 'function') chain = chain.sort({ updatedAt: -1 });
  if (typeof chain.limit === 'function') chain = chain.limit(MAX_CANDIDATES);
  if (typeof chain.lean === 'function') chain = chain.lean();
  if (typeof chain.exec === 'function') return chain.exec();
  return chain;
};

const createAiKnowledgeService = ({
  documentModel = AiKnowledgeDocument,
  nowProvider = () => new Date(),
} = {}) => {
  const findCandidateDocuments = async ({ allowedScopes, category, now }) => {
    const filter = {
      status: 'published',
      roleScope: { $in: allowedScopes },
      ...(category ? { category } : {}),
      $and: [
        {
          $or: [
            { effectiveFrom: null },
            { effectiveFrom: { $exists: false } },
            { effectiveFrom: { $lte: now } },
          ],
        },
        {
          $or: [
            { effectiveTo: null },
            { effectiveTo: { $exists: false } },
            { effectiveTo: { $gte: now } },
          ],
        },
      ],
    };

    const docs = await runQuery(documentModel.find(filter));
    return Array.isArray(docs) ? docs : [];
  };

  const searchKnowledge = async ({
    query,
    category = null,
    limit = DEFAULT_LIMIT,
    actorRole = 'guest',
  } = {}) => {
    const safeQuery = compactText(query, 240);
    const normalizedCategory = CATEGORY_VALUES.has(category) ? category : null;
    const safeLimit = clampLimit(limit);

    if (!safeQuery || isDynamicKnowledgeQuery(safeQuery)) {
      return createNoMatchResult({ dynamic: Boolean(safeQuery) });
    }

    const tokens = tokenize(safeQuery);
    if (tokens.length === 0) return createNoMatchResult();

    const now = nowProvider();
    const allowedScopes = getAllowedRoleScopes(actorRole);
    const candidates = await findCandidateDocuments({
      allowedScopes,
      category: normalizedCategory,
      now,
    });

    const visibleDocs = candidates
      .filter((doc) => isVisibleDocument(doc, {
        allowedScopes,
        category: normalizedCategory,
        now,
      }))
      .map((doc) => ({
        doc,
        score: scoreDocument(doc, safeQuery, tokens),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return new Date(right.doc.updatedAt || 0) - new Date(left.doc.updatedAt || 0);
      });

    if (visibleDocs.length === 0) return createNoMatchResult();

    return toKnowledgeResult(
      visibleDocs.slice(0, safeLimit).map((item) => item.doc),
      { limit: safeLimit },
    );
  };

  const seedDefaultKnowledge = async () => {
    const now = nowProvider();
    const operations = DEFAULT_AI_KNOWLEDGE_DOCUMENTS.map((document) => ({
      updateOne: {
        filter: { key: document.key },
        update: {
          $setOnInsert: {
            ...document,
            effectiveFrom: document.effectiveFrom || null,
            effectiveTo: document.effectiveTo || null,
            createdAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    }));

    if (operations.length === 0) {
      return { insertedCount: 0, upsertedCount: 0, matchedCount: 0 };
    }

    return documentModel.bulkWrite(operations, { ordered: false, timestamps: false });
  };

  return {
    searchKnowledge,
    seedDefaultKnowledge,
  };
};

const defaultService = createAiKnowledgeService();

module.exports = {
  DEFAULT_DISCLAIMER,
  DYNAMIC_FALLBACK_ANSWER,
  NO_MATCH_ANSWER,
  ROLE_SCOPE_BY_ROLE,
  compactText,
  createAiKnowledgeService,
  getAllowedRoleScopes,
  isDynamicKnowledgeQuery,
  normalizeSearchText,
  searchKnowledge: defaultService.searchKnowledge,
  seedDefaultKnowledge: defaultService.seedDefaultKnowledge,
  tokenize,
};
