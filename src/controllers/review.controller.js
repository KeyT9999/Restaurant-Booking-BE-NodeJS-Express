'use strict';

const Review = require('../models/Review');
const Booking = require('../models/Booking');
const Restaurant = require('../models/Restaurant');
const reviewService = require('../services/review.service');

// Hỗ trợ gửi thông báo Socket.io realtime
const emitNotification = (io, room, event, payload) => {
  if (io) {
    io.to(room).emit(event, payload);
  }
};

// ─────────────────────────────────────────────
// 1. Tạo Đánh Giá (POST /api/v1/reviews)
// ─────────────────────────────────────────────
const createReview = async (req, res) => {
  try {
    const userId = req.user._id;
    const { bookingId, rating, title, comment, images } = req.body;

    // 1. Validate required fields
    if (!bookingId || !rating || !comment) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp bookingId, rating và comment',
      });
    }

    const ratingNum = Number(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5 || !Number.isInteger(ratingNum)) {
      return res.status(400).json({
        success: false,
        message: 'Điểm đánh giá phải là số nguyên từ 1 đến 5',
      });
    }

    if (comment.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Nội dung đánh giá phải có ít nhất 10 ký tự',
      });
    }

    if (comment.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Nội dung đánh giá không được vượt quá 2000 ký tự',
      });
    }

    // 2. Check booking exists and belongs to customer
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy booking',
      });
    }

    if (booking.customerId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền đánh giá booking này',
      });
    }

    // 3. Check booking is completed
    if (booking.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể đánh giá các booking đã hoàn thành',
      });
    }

    // 4. Check duplicate review
    const existingReview = await Review.findOne({ bookingId });
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'Bạn đã đánh giá booking này rồi',
      });
    }

    // 5. Create review
    const review = new Review({
      userId,
      restaurantId: booking.restaurantId,
      bookingId,
      rating: ratingNum,
      title: title || null,
      comment: comment.trim(),
      images: images || [],
      status: 'approved',
    });

    await review.save();

    // 6. Update booking reviewed status
    booking.reviewId = review._id;
    booking.reviewed = true;
    await booking.save();

    // 7. Update restaurant rating stats
    await reviewService.updateRestaurantRating(booking.restaurantId);

    // 8. Gửi thông báo socket realtime cho Owner và Admin
    const io = req.app.get('io');
    const restaurant = await Restaurant.findById(booking.restaurantId);
    if (restaurant) {
      // Gửi cho Owner
      emitNotification(io, `restaurant:${restaurant._id.toString()}`, 'review:created', {
        reviewId: review._id,
        restaurantId: restaurant._id,
        rating: ratingNum,
        message: `Nhà hàng của bạn nhận được đánh giá ${ratingNum}★ mới từ khách hàng ${booking.customerName}`
      });
      emitNotification(io, `user:${restaurant.ownerId.toString()}`, 'review:created', {
        reviewId: review._id,
        restaurantId: restaurant._id,
        rating: ratingNum,
        message: `Nhà hàng của bạn nhận được đánh giá ${ratingNum}★ mới từ khách hàng ${booking.customerName}`
      });
    }
    
    // Gửi cho Admin
    emitNotification(io, 'admin', 'review:created', {
      reviewId: review._id,
      restaurantId: booking.restaurantId,
      rating: ratingNum,
      message: `Đánh giá mới ${ratingNum}★ tại nhà hàng ${restaurant ? restaurant.name : ''}`
    });

    return res.status(201).json({
      success: true,
      message: 'Đánh giá đã được tạo thành công',
      data: review.toPublicJSON(),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Bạn đã đánh giá booking này rồi',
      });
    }
    console.error('❌ [CreateReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tạo đánh giá' });
  }
};

// ─────────────────────────────────────────────
// 2. Cập Nhật Đánh Giá (PUT /api/v1/reviews/:id)
// ─────────────────────────────────────────────
const updateReview = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const { rating, title, comment, images } = req.body;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    if (review.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền chỉnh sửa đánh giá này',
      });
    }

    if (rating !== undefined) {
      const ratingNum = Number(rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5 || !Number.isInteger(ratingNum)) {
        return res.status(400).json({
          success: false,
          message: 'Điểm đánh giá phải là số nguyên từ 1 đến 5',
        });
      }
      review.rating = ratingNum;
    }

    if (comment !== undefined) {
      if (comment.trim().length < 10) {
        return res.status(400).json({
          success: false,
          message: 'Nội dung đánh giá phải có ít nhất 10 ký tự',
        });
      }
      review.comment = comment.trim();
    }

    if (title !== undefined) review.title = title || null;
    if (images !== undefined) review.images = images || [];

    review.isEdited = true;
    await review.save();

    if (rating !== undefined) {
      await reviewService.updateRestaurantRating(review.restaurantId);
    }

    return res.json({
      success: true,
      message: 'Cập nhật đánh giá thành công',
      data: review.toPublicJSON(),
    });
  } catch (error) {
    console.error('❌ [UpdateReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi cập nhật đánh giá' });
  }
};

// ─────────────────────────────────────────────
// 3. Xóa Đánh Giá (DELETE /api/v1/reviews/:id)
// ─────────────────────────────────────────────
const deleteReview = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    if (review.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xóa đánh giá này',
      });
    }

    const restaurantId = review.restaurantId;
    const bookingId = review.bookingId;

    await Review.findByIdAndDelete(id);

    await Booking.findByIdAndUpdate(bookingId, {
      reviewId: null,
      reviewed: false,
    });

    await reviewService.updateRestaurantRating(restaurantId);

    return res.json({
      success: true,
      message: 'Xóa đánh giá thành công',
    });
  } catch (error) {
    console.error('❌ [DeleteReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xóa đánh giá' });
  }
};

// ─────────────────────────────────────────────
// 4. Toggle Helpful (POST /api/v1/reviews/:id/helpful)
// ─────────────────────────────────────────────
const toggleHelpful = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    const alreadyHelpful = review.helpfulUsers.some(
      (uid) => uid.toString() === userId.toString()
    );

    if (alreadyHelpful) {
      review.helpfulUsers = review.helpfulUsers.filter(
        (uid) => uid.toString() !== userId.toString()
      );
      review.helpfulCount = Math.max(0, review.helpfulCount - 1);
    } else {
      review.helpfulUsers.push(userId);
      review.helpfulCount += 1;
    }

    await review.save();

    return res.json({
      success: true,
      message: alreadyHelpful ? 'Đã bỏ đánh dấu hữu ích' : 'Đã đánh dấu hữu ích',
      data: {
        helpful: !alreadyHelpful,
        helpfulCount: review.helpfulCount,
      },
    });
  } catch (error) {
    console.error('❌ [ToggleHelpful] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

// ─────────────────────────────────────────────
// 5. Report Review (POST /api/v1/reviews/:id/report)
// ─────────────────────────────────────────────
const reportReview = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    const alreadyReported = review.reportedBy.some(
      (uid) => uid.toString() === userId.toString()
    );

    if (alreadyReported) {
      return res.json({
        success: true,
        message: 'Bạn đã báo cáo đánh giá này trước đó',
        data: { alreadyReported: true, reportCount: review.reportCount },
      });
    }

    review.reportedBy.push(userId);
    review.reportCount += 1;
    review.status = 'reported'; // Update status to reported
    await review.save();

    return res.json({
      success: true,
      message: 'Báo cáo đánh giá thành công',
      data: { alreadyReported: false, reportCount: review.reportCount },
    });
  } catch (error) {
    console.error('❌ [ReportReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

// ─────────────────────────────────────────────
// 6. Lấy Danh Sách Review Của Customer (GET /api/v1/reviews/my-reviews)
// ─────────────────────────────────────────────
const getMyReviews = async (req, res) => {
  try {
    const userId = req.user._id;
    const reviews = await Review.find({ userId })
      .populate('restaurantId', 'name logo address')
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: reviews.map((r) => r.toPublicJSON()),
    });
  } catch (error) {
    console.error('❌ [GetMyReviews] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

// ─────────────────────────────────────────────
// 7. Lấy Reviews Nhà Hàng — Public (GET /api/v1/reviews/restaurant/:restaurantId)
// ─────────────────────────────────────────────
const getRestaurantReviews = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;
    const sortBy = req.query.sort || 'newest';

    let sort = { createdAt: -1 };
    if (sortBy === 'oldest') sort = { createdAt: 1 };
    else if (sortBy === 'highest') sort = { rating: -1, createdAt: -1 };
    else if (sortBy === 'lowest') sort = { rating: 1, createdAt: -1 };
    else if (sortBy === 'helpful') sort = { helpfulCount: -1, createdAt: -1 };

    const query = { restaurantId, status: 'approved' };

    if (req.query.rating) {
      const ratingFilter = parseInt(req.query.rating);
      if (ratingFilter >= 1 && ratingFilter <= 5) {
        query.rating = ratingFilter;
      }
    }

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('userId', 'fullName avatarUrl')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Review.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: reviews.map((r) => {
        const item = r.toPublicJSON();
        if (r.userId) {
          item.customer = {
            fullName: r.userId.fullName,
            avatarUrl: r.userId.avatarUrl,
          };
        }
        return item;
      }),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [GetRestaurantReviews] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tải đánh giá nhà hàng' });
  }
};

// ─────────────────────────────────────────────
// 8. Rating Summary (GET /api/v1/reviews/restaurant/:restaurantId/rating-summary)
// ─────────────────────────────────────────────
const getRatingSummary = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const summary = await reviewService.calculateRatingSummary(restaurantId);

    return res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('❌ [GetRatingSummary] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy tóm tắt đánh giá' });
  }
};

// ─────────────────────────────────────────────
// 9. Phản Hồi Review (PATCH /api/v1/reviews/:id/reply)
// ─────────────────────────────────────────────
const replyReview = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;
    const { comment } = req.body;

    if (!comment || comment.trim().length < 5 || comment.trim().length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Nội dung phản hồi phải từ 5 đến 500 ký tự',
      });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    const restaurant = await Restaurant.findById(review.restaurantId);
    if (!restaurant || restaurant.ownerId.toString() !== ownerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền phản hồi đánh giá này',
      });
    }

    review.ownerReply = {
      comment: comment.trim(),
      content: comment.trim(),
      repliedAt: new Date(),
      repliedBy: ownerId,
    };

    await review.save();

    // Gửi socket notify cho người viết review
    const io = req.app.get('io');
    emitNotification(io, `user:${review.userId.toString()}`, 'review:replied', {
      reviewId: review._id,
      restaurantId: review.restaurantId,
      message: `Nhà hàng ${restaurant.name} đã phản hồi đánh giá của bạn!`
    });

    return res.json({
      success: true,
      message: 'Gửi phản hồi đánh giá thành công',
      data: review.toPublicJSON(),
    });
  } catch (error) {
    console.error('❌ [ReplyReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi phản hồi đánh giá' });
  }
};

// ─────────────────────────────────────────────
// 10. Admin Cập Nhật Trạng Thái (PATCH /api/v1/reviews/:id/status)
// ─────────────────────────────────────────────
const updateReviewStatus = async (req, res) => {
  try {
    const adminId = req.user._id;
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!status || !['approved', 'reported', 'hidden'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Trạng thái không hợp lệ',
      });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    review.status = status;

    if (status === 'hidden') {
      review.hiddenBy = adminId;
      review.hiddenAt = new Date();
      review.hideReason = reason ? reason.trim() : 'Bị ẩn bởi quản trị viên';
    } else if (status === 'approved') {
      review.hiddenBy = null;
      review.hiddenAt = null;
      review.hideReason = null;
    }

    await review.save();
    await reviewService.updateRestaurantRating(review.restaurantId);

    return res.json({
      success: true,
      message: `Cập nhật trạng thái đánh giá thành công thành ${status}`,
      data: review.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [UpdateReviewStatus] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

// ─────────────────────────────────────────────
// 11. Admin Lấy Danh Sách Review (GET /api/v1/reviews/admin/all)
// ─────────────────────────────────────────────
const adminGetReviews = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;
    const { status } = req.query;

    const query = {};
    if (status) {
      if (status === 'reported') {
        // Hỗ trợ lọc các review bị report (reportCount > 0 hoặc status === 'reported')
        query.$or = [{ status: 'reported' }, { reportCount: { $gt: 0 } }];
      } else {
        query.status = status;
      }
    }

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('userId', 'fullName email avatarUrl')
        .populate('restaurantId', 'name')
        .sort({ reportCount: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Review.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: {
        reviews: reviews.map((r) => {
          const item = r.toAdminJSON();
          if (r.userId) {
            item.customer = {
              fullName: r.userId.fullName,
              email: r.userId.email,
              avatarUrl: r.userId.avatarUrl,
            };
          }
          if (r.restaurantId) {
            item.restaurant = { name: r.restaurantId.name };
          }
          return item;
        }),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [AdminGetReviews] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

module.exports = {
  createReview,
  updateReview,
  deleteReview,
  toggleHelpful,
  reportReview,
  getMyReviews,
  getRestaurantReviews,
  getRatingSummary,
  replyReview,
  updateReviewStatus,
  adminGetReviews,
};
