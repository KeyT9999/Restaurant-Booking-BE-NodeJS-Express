const mongoose = require('mongoose');
const { normalizeRestaurantImages } = require('../utils/restaurant-images');

const restaurantSchema = new mongoose.Schema(
  {
    // ─── Owner Information ───
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner ID là bắt buộc'],
      index: true,
    },

    // ─── Basic Information ───
    name: {
      type: String,
      required: [true, 'Tên nhà hàng là bắt buộc'],
      trim: true,
      maxlength: [200, 'Tên nhà hàng không được vượt quá 200 ký tự'],
    },
    description: {
      type: String,
      required: [true, 'Mô tả là bắt buộc'],
      trim: true,
      maxlength: [2000, 'Mô tả không được vượt quá 2000 ký tự'],
    },
    
    // ─── Contact Information ───
    phoneNumber: {
      type: String,
      required: [true, 'Số điện thoại là bắt buộc'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email là bắt buộc'],
      lowercase: true,
      trim: true,
    },
    websiteUrl: {
      type: String,
      trim: true,
      maxlength: [255, 'URL website không được vượt quá 255 ký tự'],
      default: null,
    },
    contactHotline: {
      type: String,
      trim: true,
      maxlength: [50, 'Hotline không được vượt quá 50 ký tự'],
      default: null,
    },
    contactSecondaryPhone: {
      type: String,
      trim: true,
      maxlength: [50, 'SĐT phụ không được vượt quá 50 ký tự'],
      default: null,
    },

    // ─── Location ───
    address: {
      street: { type: String, required: true, trim: true },
      ward: { type: String, required: true, trim: true },
      district: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      fullAddress: { type: String, trim: true },
    },
    coordinates: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },

    // ─── Business Details ───
    cuisineTypes: [{
      type: String,
      trim: true,
    }],
    priceRange: {
      type: String,
      enum: ['budget', 'moderate', 'expensive', 'luxury'],
      default: 'moderate',
    },
    capacity: {
      type: Number,
      default: 0,
      min: [0, 'Sức chứa không thể âm'],
    },

    // ─── Operating Hours ───
    operatingHours: {
      monday: { open: String, close: String, closed: { type: Boolean, default: false } },
      tuesday: { open: String, close: String, closed: { type: Boolean, default: false } },
      wednesday: { open: String, close: String, closed: { type: Boolean, default: false } },
      thursday: { open: String, close: String, closed: { type: Boolean, default: false } },
      friday: { open: String, close: String, closed: { type: Boolean, default: false } },
      saturday: { open: String, close: String, closed: { type: Boolean, default: false } },
      sunday: { open: String, close: String, closed: { type: Boolean, default: false } },
    },

    // ─── Media ───
    images: [{
      url: { type: String, required: true },
      caption: { type: String, default: '' },
      isPrimary: { type: Boolean, default: false },
      uploadedAt: { type: Date, default: Date.now },
    }],
    logo: {
      type: String,
      default: null,
    },
    coverImage: {
      type: String,
      default: null,
    },
    galleryImages: [{
      type: String,
      trim: true,
    }],

    // ─── Pricing ───
    averagePrice: {
      type: Number,
      default: null,
      min: [0, 'Giá trung bình không thể âm'],
    },
    priceRangeMin: {
      type: Number,
      default: null,
      min: [0, 'Giá thấp nhất không thể âm'],
    },
    priceRangeMax: {
      type: Number,
      default: null,
      min: [0, 'Giá cao nhất không thể âm'],
    },

    // ─── Display Information ───
    statusMessage: { type: String, trim: true, maxlength: 255, default: null },
    heroCity: { type: String, trim: true, maxlength: 100, default: null },
    heroHeadline: { type: String, trim: true, maxlength: 255, default: null },
    heroSubheadline: { type: String, trim: true, maxlength: 255, default: null },
    heroSearchPlaceholder: { type: String, trim: true, maxlength: 255, default: null },
    bookingInformation: { type: String, trim: true, default: null },
    bookingNotes: { type: String, trim: true, default: null },
    generalPromotions: { type: String, trim: true, default: null },
    groupPromotions: { type: String, trim: true, default: null },
    promotionNotes: { type: String, trim: true, default: null },
    summaryHighlights: { type: String, trim: true, default: null },
    suitableFor: [{ type: String, trim: true }],
    signatureDishes: [{ type: String, trim: true }],
    spaceDescriptionDetail: { type: String, trim: true, default: null },
    uniqueFeatures: { type: String, trim: true, default: null },
    pricingDetails: { type: String, trim: true, default: null },
    menuHighlights: { type: String, trim: true, default: null },
    policyRules: [{ type: String, trim: true }],
    amenities: [{ type: String, trim: true }],
    parkingDetails: { type: String, trim: true, default: null },
    galleryNotes: { type: String, trim: true, default: null },
    directionInfo: { type: String, trim: true, default: null },
    operatingSchedule: { type: String, trim: true, default: null },


    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending',
      index: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
      trim: true,
    },
    suspensionReason: {
      type: String,
      default: null,
      trim: true,
    },
    unsuspendedAt: {
      type: Date,
      default: null,
    },
    unsuspendedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    deleteReason: {
      type: String,
      default: null,
      trim: true,
    },

    // ─── Financial ───
    balance: {
      type: Number,
      default: 0,
      min: [0, 'Số dư không thể âm'],
    },
    totalRevenue: {
      type: Number,
      default: 0,
      min: [0, 'Doanh thu không thể âm'],
    },
    totalCommission: {
      type: Number,
      default: 0,
      min: [0, 'Hoa hồng không thể âm'],
    },
    commissionRate: {
      type: Number,
      default: 10, // 10% default commission
      min: [0, 'Tỷ lệ hoa hồng không thể âm'],
      max: [100, 'Tỷ lệ hoa hồng không thể vượt quá 100%'],
    },

    // ─── Business Registration ───
    businessLicense: {
      number: { type: String, default: null },
      imageUrl: { type: String, default: null },
      verifiedAt: { type: Date, default: null },
    },
    taxCode: {
      type: String,
      default: null,
      trim: true,
    },

    // ─── Bank Information (for withdrawals) ───
    bankInfo: {
      bankName: { type: String, default: null },
      accountNumber: { type: String, default: null },
      accountHolder: { type: String, default: null },
      branch: { type: String, default: null },
    },

    // ─── Statistics ───
    stats: {
      totalBookings: { type: Number, default: 0 },
      completedBookings: { type: Number, default: 0 },
      cancelledBookings: { type: Number, default: 0 },
      averageRating: { type: Number, default: 0, min: 0, max: 5 },
      totalReviews: { type: Number, default: 0 },
    },

    // ─── Status ───
    active: {
      type: Boolean,
      default: true,
    },
    featured: {
      type: Boolean,
      default: false,
    },
    hasMenu: {
      type: Boolean,
      default: false,
    },
    hasTableLayout: {
      type: Boolean,
      default: false,
    },

    // ─── Cancellation Policy ───
    cancellationPolicy: {
      fullRefundBeforeHours: { type: Number, default: 24 },
      partialRefundBeforeHours: { type: Number, default: 2 },
      partialRefundPercent: { type: Number, default: 50, min: 0, max: 100 },
      cancellationFee: { type: Number, default: 0, min: 0 },
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ───
restaurantSchema.index({ name: 'text', description: 'text' });
restaurantSchema.index({ 'address.city': 1, 'address.district': 1 });
restaurantSchema.index({ cuisineTypes: 1 });
restaurantSchema.index({ priceRange: 1 });
restaurantSchema.index({ 'stats.averageRating': -1 });
restaurantSchema.index({ deletedAt: 1 });
restaurantSchema.index({ featured: 1 });
restaurantSchema.index({ createdAt: -1 });
restaurantSchema.index({ ownerId: 1, approvalStatus: 1 });

// ─── Virtual: Primary Image ───
restaurantSchema.virtual('primaryImage').get(function () {
  return normalizeRestaurantImages(this).primaryImage;
});

// ─── Method: Public JSON ───
restaurantSchema.methods.toPublicJSON = function () {
  const imageData = normalizeRestaurantImages(this);
  return {
    id: this._id.toString(),
    ownerId: this.ownerId,
    name: this.name,
    description: this.description,
    phoneNumber: this.phoneNumber,
    email: this.email,
    websiteUrl: this.websiteUrl,
    contactHotline: this.contactHotline,
    contactSecondaryPhone: this.contactSecondaryPhone,
    address: this.address,
    coordinates: this.coordinates,
    cuisineTypes: this.cuisineTypes,
    priceRange: this.priceRange,
    capacity: this.capacity,
    operatingHours: this.operatingHours,
    images: this.images,
    logo: imageData.logo,
    coverImage: imageData.coverImage,
    coverImageUrl: imageData.coverImageUrl,
    galleryImages: imageData.galleryImages,
    primaryImage: imageData.primaryImage,
    averagePrice: this.averagePrice,
    priceRangeMin: this.priceRangeMin,
    priceRangeMax: this.priceRangeMax,
    statusMessage: this.statusMessage,
    bookingNotes: this.bookingNotes,
    summaryHighlights: this.summaryHighlights,
    suitableFor: this.suitableFor,
    signatureDishes: this.signatureDishes,
    amenities: this.amenities,
    policyRules: this.policyRules,
    approvalStatus: this.approvalStatus,
    stats: this.stats,
    active: this.active,
    featured: this.featured,
    hasMenu: this.hasMenu,
    hasTableLayout: this.hasTableLayout,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// ─── Method: Admin JSON (includes sensitive data) ───
restaurantSchema.methods.toAdminJSON = function () {
  const imageData = normalizeRestaurantImages(this);
  return {
    id: this._id.toString(),
    ownerId: this.ownerId,
    name: this.name,
    description: this.description,
    phoneNumber: this.phoneNumber,
    email: this.email,
    address: this.address,
    coordinates: this.coordinates,
    cuisineTypes: this.cuisineTypes,
    priceRange: this.priceRange,
    capacity: this.capacity,
    operatingHours: this.operatingHours,
    images: this.images,
    logo: imageData.logo,
    coverImage: imageData.coverImage,
    coverImageUrl: imageData.coverImageUrl,
    galleryImages: imageData.galleryImages,
    primaryImage: imageData.primaryImage,
    approvalStatus: this.approvalStatus,
    approvedBy: this.approvedBy,
    approvedAt: this.approvedAt,
    rejectionReason: this.rejectionReason,
    suspensionReason: this.suspensionReason,
    unsuspendedAt: this.unsuspendedAt,
    unsuspendedBy: this.unsuspendedBy,
    deletedAt: this.deletedAt,
    deletedBy: this.deletedBy,
    deleteReason: this.deleteReason,
    balance: this.balance,
    totalRevenue: this.totalRevenue,
    totalCommission: this.totalCommission,
    commissionRate: this.commissionRate,
    businessLicense: this.businessLicense,
    taxCode: this.taxCode,
    bankInfo: this.bankInfo,
    stats: this.stats,
    active: this.active,
    featured: this.featured,
    hasMenu: this.hasMenu,
    hasTableLayout: this.hasTableLayout,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Restaurant', restaurantSchema);
