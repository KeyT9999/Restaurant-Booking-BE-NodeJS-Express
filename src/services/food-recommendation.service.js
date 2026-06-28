'use strict';

const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');
const { getAiConfig } = require('../config/ai.config');
const { createAiProviderManager } = require('./ai/ai-provider.service');
const { normalizeRestaurantImages } = require('../utils/restaurant-images');

const SYSTEM_INSTRUCTIONS = [
  'Bạn là một chuyên gia dinh dưỡng và ẩm thực hàng đầu của hệ thống đặt bàn nhà hàng BookEat.',
  'Nhiệm vụ của bạn là tiếp nhận câu hỏi của khách hàng về nhu cầu dinh dưỡng, phân tích và phản hồi dưới dạng JSON duy nhất.',
  'JSON phản hồi phải tuân theo cấu trúc sau:',
  '{',
  '  "nutritionAdvice": "Chuỗi văn bản tiếng Việt tư vấn ngắn gọn, dễ hiểu, có căn cứ khoa học dinh dưỡng cho câu hỏi của người dùng.",',
  '  "suggestedDishes": [',
  '    {',
  '      "name": "Tên món ăn gợi ý bằng tiếng Việt, ví dụ: Cá hồi áp chảo",',
  '      "reason": "Lý do vì sao món này phù hợp với nhu cầu của họ.",',
  '      "tags": ["danh sách các tag ngắn gọn, ví dụ: high-protein, low-carb, omega-3, healthy"],',
  '      "nutritionHighlights": "Điểm nhấn dinh dưỡng chính, ví dụ: ~30g protein, giàu omega-3, 350 kcal"',
  '    }',
  '  ],',
  '  "cuisineTypes": ["mảng chứa các loại hình ẩm thực liên quan để tìm nhà hàng, ví dụ: Hải sản, Món Nhật, Món Việt, Healthy"]',
  '}',
  'Chú ý quan trọng:',
  '1. Chỉ trả về chuỗi JSON hợp lệ, tuyệt đối không trả kèm lời mở đầu, giải thích hay kết luận bên ngoài khối JSON.',
  '2. Các món ăn gợi ý phải phù hợp thực tế và dễ tìm thấy trong thực đơn nhà hàng.'
].join('\n');

const isMockEnabled = () => {
  if (process.env.AI_MOCK_ENABLED !== undefined) {
    return process.env.AI_MOCK_ENABLED.toLowerCase() === 'true';
  }
  return process.env.NODE_ENV !== 'production';
};

const getMockRecommendation = (question, context = {}) => {
  const goal = context.goal || 'general';
  let advice = `Dành cho nhu cầu của bạn ("${question}"): Bạn nên tập trung vào chế độ dinh dưỡng cân bằng, bổ sung nhiều rau quả, uống đủ nước và hạn chế đồ ngọt hay nhiều dầu mỡ.`;
  let dishes = [
    {
      name: 'Salad',
      reason: 'Bổ sung nhiều chất xơ, vitamin và khoáng chất tự nhiên.',
      tags: ['healthy', 'low-carb', 'vegetarian'],
      nutritionHighlights: 'Giàu xơ, vitamin A, C'
    },
    {
      name: 'Cá hồi',
      reason: 'Cung cấp omega-3 và đạm lành mạnh hỗ trợ tim mạch.',
      tags: ['omega-3', 'high-protein'],
      nutritionHighlights: '25g đạm, tốt cho tim mạch'
    }
  ];

  if (goal === 'muscle_gain' || question.toLowerCase().includes('gym') || question.toLowerCase().includes('cơ')) {
    advice = 'Để tăng cơ hiệu quả, bạn cần tăng lượng protein nạp vào hàng ngày (~1.6-2.2g/kg trọng lượng), kết hợp carbs phức hợp để cung cấp năng lượng tập luyện.';
    dishes = [
      {
        name: 'Ức gà',
        reason: 'Nguồn đạm siêu tinh khiết, ít mỡ giúp xây dựng cơ bắp tối ưu.',
        tags: ['high-protein', 'low-fat'],
        nutritionHighlights: '31g protein / 100g'
      },
      {
        name: 'Bò',
        reason: 'Cung cấp sắt, kẽm, creatine tự nhiên và đạm chất lượng cao.',
        tags: ['high-protein', 'creatine'],
        nutritionHighlights: '26g protein, giàu sắt và kẽm'
      }
    ];
  } else if (goal === 'weight_loss' || question.toLowerCase().includes('béo') || question.toLowerCase().includes('cân')) {
    advice = 'Để giảm cân/giảm mỡ, hãy duy trì trạng thái thâm hụt calo nhẹ, ưu tiên thực phẩm giàu xơ để no lâu và đạm để bảo toàn khối cơ.';
    dishes = [
      {
        name: 'Salad ức gà',
        reason: 'Ít calo, nhiều chất xơ và đạm giúp tạo cảm giác no lâu.',
        tags: ['low-calorie', 'high-fiber', 'high-protein'],
        nutritionHighlights: 'Khoảng 250 kcal, giàu xơ'
      },
      {
        name: 'Cháo yến mạch',
        reason: 'Carbs hấp thụ chậm giúp duy trì năng lượng ổn định, tránh thèm ăn.',
        tags: ['complex-carbs', 'high-fiber'],
        nutritionHighlights: 'Năng lượng giải phóng chậm, nhiều beta-glucan'
      }
    ];
  }

  return {
    nutritionAdvice: `[MOCK] ${advice}`,
    suggestedDishes: dishes,
    cuisineTypes: ['Healthy', 'Món Việt', 'Món Âu']
  };
};

const cleanJsonResponseString = (text) => {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9]*\n/, '').replace(/\n```$/, '');
  }
  return cleaned.trim();
};

const getRecommendations = async ({ question, context = {}, signal } = {}) => {
  let aiResult;

  if (isMockEnabled()) {
    aiResult = getMockRecommendation(question, context);
  } else {
    const config = getAiConfig();
    const providerManager = createAiProviderManager();

    const promptInput = [
      {
        role: 'user',
        content: JSON.stringify({
          question,
          context: {
            goal: context.goal || null,
            dietaryRestrictions: context.dietaryRestrictions || [],
            maxBudget: context.maxBudget || null
          }
        })
      }
    ];

    let fullText = '';
    try {
      for await (const event of providerManager.streamText({
        instructions: SYSTEM_INSTRUCTIONS,
        input: promptInput,
        config,
        signal
      })) {
        if (event.type === 'delta' && event.text) {
          fullText += event.text;
        }
      }

      const cleanJson = cleanJsonResponseString(fullText);
      aiResult = JSON.parse(cleanJson);
    } catch (error) {
      console.error('[FoodRecommendationService] AI request or parsing failed:', error);
      aiResult = getMockRecommendation(question, context);
    }
  }

  const nutritionAdvice = aiResult.nutritionAdvice || 'Chưa có thông tin tư vấn.';
  const suggestedDishes = aiResult.suggestedDishes || [];
  const cuisineTypes = aiResult.cuisineTypes || [];

  const matchedItems = [];
  const dishNames = suggestedDishes.map(d => d.name).filter(Boolean);

  if (dishNames.length > 0) {
    const regexes = dishNames.map(name => new RegExp(name, 'i'));
    const items = await MenuItem.find({
      status: 'available',
      $or: [
        { name: { $in: regexes } },
        { description: { $in: regexes } }
      ]
    })
      .limit(20)
      .lean();
    matchedItems.push(...items);
  }

  const restaurantIds = [...new Set(matchedItems.map(item => item.restaurantId.toString()))];

  const matchedRestaurants = await Restaurant.find({
    _id: { $in: restaurantIds },
    approvalStatus: 'approved',
    active: true,
    deletedAt: null
  })
    .limit(5)
    .lean();

  let finalRestaurants = [...matchedRestaurants];

  if (finalRestaurants.length < 5 && cuisineTypes.length > 0) {
    const cuisineRegexes = cuisineTypes.map(c => new RegExp(c, 'i'));
    const remainingLimit = 5 - finalRestaurants.length;
    const additional = await Restaurant.find({
      _id: { $nin: finalRestaurants.map(r => r._id) },
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      cuisineTypes: { $in: cuisineRegexes }
    })
      .limit(remainingLimit)
      .lean();

    finalRestaurants.push(...additional);
  }

  const formattedRestaurants = finalRestaurants.map(restaurant => {
    const imageData = normalizeRestaurantImages(restaurant);
    const matchedDishes = matchedItems
      .filter(item => item.restaurantId.toString() === restaurant._id.toString())
      .map(item => ({
        id: item._id.toString(),
        name: item.name,
        price: item.price,
        image: item.image,
        description: item.description
      }));

    return {
      id: restaurant._id.toString(),
      name: restaurant.name,
      description: restaurant.description,
      phoneNumber: restaurant.phoneNumber,
      email: restaurant.email,
      address: restaurant.address,
      cuisineTypes: restaurant.cuisineTypes,
      priceRange: restaurant.priceRange,
      averageRating: restaurant.stats?.averageRating || 0,
      totalReviews: restaurant.stats?.totalReviews || 0,
      logo: imageData.logo,
      coverImage: imageData.coverImageUrl || imageData.coverImage,
      matchedDishes
    };
  });

  return {
    question,
    nutritionAdvice,
    suggestedDishes,
    restaurants: formattedRestaurants
  };
};

module.exports = {
  getRecommendations
};
