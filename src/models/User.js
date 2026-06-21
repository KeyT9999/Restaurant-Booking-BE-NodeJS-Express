const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username là bắt buộc'],
      unique: true,
      trim: true,
      minlength: [3, 'Username phải có ít nhất 3 ký tự'],
    },
    email: {
      type: String,
      required: [true, 'Email là bắt buộc'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: function () {
        return !this.googleId; // Không bắt buộc nếu đăng nhập bằng Google
      },
      minlength: [8, 'Mật khẩu phải có ít nhất 8 ký tự'],
      select: false, // Không trả về password khi query
    },
    fullName: {
      type: String,
      required: [true, 'Họ và tên là bắt buộc'],
      trim: true,
    },
    phoneNumber: {
      type: String,
      default: null,
      trim: true,
    },
    address: {
      type: String,
      default: null,
      trim: true,
    },
    role: {
      type: String,
      enum: ['customer', 'restaurant_owner', 'admin'],
      default: 'customer',
    },
    googleId: {
      type: String,
      default: null,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      default: null,
      select: false,
    },
    emailVerificationExpires: {
      type: Date,
      default: null,
      select: false,
    },
    passwordResetToken: {
      type: String,
      default: null,
      select: false,
    },
    passwordResetExpires: {
      type: Date,
      default: null,
      select: false,
    },
    active: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    // ─── No-show Penalty ───
    noShowCounter: {
      type: Number,
      default: 0,
      min: 0,
    },
    bookingBlockedUntil: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // tự tạo createdAt, updatedAt
  }
);

// ─── Hash password trước khi lưu ───
userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// ─── Method: So sánh password ───
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ─── Method: Trả về object không có thông tin nhạy cảm ───
userSchema.methods.toPublicJSON = function () {
  return {
    id: this._id.toString(),
    username: this.username,
    email: this.email,
    fullName: this.fullName,
    phoneNumber: this.phoneNumber,
    address: this.address,
    role: this.role,
    avatarUrl: this.avatarUrl,
    emailVerified: this.emailVerified,
    active: this.active,
    lastLogin: this.lastLogin,
    noShowCounter: this.noShowCounter,
    bookingBlockedUntil: this.bookingBlockedUntil,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('User', userSchema);
