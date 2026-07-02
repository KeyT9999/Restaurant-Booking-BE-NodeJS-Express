const mongoose = require('mongoose');

const voucherSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Mã voucher là bắt buộc'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [255, 'Mô tả không được vượt quá 255 ký tự'],
    },
    name: {
      type: String,
      required: [true, 'Tên voucher là bắt buộc'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['platform', 'restaurant', 'loyalty', 'referral', 'system', 'compensation'],
      default: 'restaurant',
    },
    createdByRole: {
      type: String,
      enum: ['admin', 'owner', 'system'],
      default: 'owner',
    },
    customerSegments: {
      type: [String],
      enum: ['all', 'new_user', 'vip', 'inactive'],
      default: ['all'],
    },
    applicableRestaurants: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
    }],
    applicableCities: {
      type: [String],
      default: [],
    },
    applicableCategories: {
      type: [String],
      default: [],
    },
    stackable: {
      type: Boolean,
      default: false,
    },
    priority: {
      type: Number,
      default: 0,
    },
    currentUsage: {
      type: Number,
      default: 0,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VoucherCampaign',
      default: null,
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed_amount'],
      required: [true, 'Loại giảm giá là bắt buộc'],
    },
    discountValue: {
      type: Number,
      required: [true, 'Giá trị giảm giá là bắt buộc'],
      min: [0, 'Giá trị giảm giá không thể âm'],
    },
    maxDiscountAmount: {
      type: Number,
      default: null, // Chỉ dùng cho percentage
      min: [0, 'Số tiền giảm tối đa không thể âm'],
    },
    minOrderAmount: {
      type: Number,
      default: 0,
      min: [0, 'Số tiền đơn tối thiểu không thể âm'],
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      default: null, // null nghĩa là không hết hạn trừ khi bị pause/disable
    },
    globalUsageLimit: {
      type: Number,
      default: null, // null nghĩa là không giới hạn tổng lượt dùng
      min: [1, 'Giới hạn dùng hệ thống phải lớn hơn hoặc bằng 1'],
    },
    perCustomerLimit: {
      type: Number,
      default: 1, // Số lần mỗi customer được dùng tối đa
      min: [1, 'Giới hạn dùng của khách hàng phải lớn hơn hoặc bằng 1'],
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      default: null, // null = Global voucher áp dụng toàn bộ hệ thống
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'expired', 'paused', 'disabled', 'scheduled'],
      default: 'active',
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Người tạo voucher là bắt buộc'],
    },
    pointsCost: {
      type: Number,
      default: 0,
      min: [0, 'Số điểm đổi không thể âm'],
    },
  },
  {
    timestamps: true,
  }
);

// Index thời gian và trạng thái để tối ưu truy vấn tìm kiếm khuyến mại
voucherSchema.index({ startDate: 1, endDate: 1, status: 1 });
voucherSchema.index({ type: 1, status: 1, startDate: 1, endDate: 1 });
voucherSchema.index({ campaignId: 1 });

module.exports = mongoose.model('Voucher', voucherSchema);
