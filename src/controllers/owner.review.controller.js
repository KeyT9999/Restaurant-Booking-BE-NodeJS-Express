'use strict';

const Review = require('../models/Review');
const Restaurant = require('../models/Restaurant');

// ─────────────────────────────────────────────
// A. Lấy Danh Sách Review Nhà Hàng — Owner (GET /api/v1/owner/reviews)
// ─────────────────────────────────────────────
const getRestaurantReviewsForOwner = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const restaurantId = req.query.restaurantId;

    // Tìm nhà hàng thuộc owner
    const query = { ownerId };
    if (restaurantId) query._id = restaurantId;

    const restaurant = await Restaurant.findOne(query);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy nhà hàng của bạn',
      });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const reviewQuery = { restaurantId: restaurant._id };

    // Filter by status
    if (req.query.status) {
      if (req.query.status === 'visible') {
        reviewQuery.status = { $ne: 'hidden' };
      } else if (['approved', 'reported', 'hidden'].includes(req.query.status)) {
        reviewQuery.status = req.query.status;
      }
    }

    // Filter by replied/not-replied
    if (req.query.replied === 'true') {
      reviewQuery.$or = [
        { 'ownerReply.comment': { $ne: null } },
        { 'ownerReply.content': { $ne: null } }
      ];
    } else if (req.query.replied === 'false') {
      reviewQuery.$and = [
        {
          $or: [
            { 'ownerReply.comment': null },
            { 'ownerReply.comment': { $exists: false } }
          ]
        },
        {
          $or: [
            { 'ownerReply.content': null },
            { 'ownerReply.content': { $exists: false } }
          ]
        }
      ];
    }

    const [reviews, total] = await Promise.all([
      Review.find(reviewQuery)
        .populate('userId', 'fullName avatarUrl email')
        .populate('bookingId', 'bookingDate bookingTime')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Review.countDocuments(reviewQuery),
    ]);

    return res.json({
      success: true,
      data: {
        reviews: reviews.map((r) => {
          const item = r.toPublicJSON();
          if (r.userId) {
            item.customer = {
              fullName: r.userId.fullName,
              avatarUrl: r.userId.avatarUrl,
              email: r.userId.email,
            };
          }
          if (r.bookingId) {
            item.booking = {
              bookingDate: r.bookingId.bookingDate,
              bookingTime: r.bookingId.bookingTime,
            };
          }
          // Owner gets full ownerReply data
          item.ownerReply = r.ownerReply;
          return item;
        }),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [GetOwnerReviews] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

// ─────────────────────────────────────────────
// B. Phản Hồi Review (POST /api/v1/owner/reviews/:id/reply)
// ─────────────────────────────────────────────
const replyToReview = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Nội dung phản hồi là bắt buộc',
      });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    // Verify owner owns the restaurant
    const restaurant = await Restaurant.findOne({
      _id: review.restaurantId,
      ownerId,
    });
    if (!restaurant) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền phản hồi đánh giá này',
      });
    }

    review.ownerReply = {
      comment: content.trim(),
      content: content.trim(),
      repliedAt: new Date(),
      repliedBy: ownerId,
    };

    await review.save();

    return res.json({
      success: true,
      message: 'Phản hồi đánh giá thành công',
      data: review.toPublicJSON(),
    });
  } catch (error) {
    console.error('❌ [ReplyToReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi phản hồi đánh giá' });
  }
};

module.exports = {
  getRestaurantReviewsForOwner,
  replyToReview,
};
