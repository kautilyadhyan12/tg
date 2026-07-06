const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    // Basic info
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Never return password in queries by default
    },

    // OAuth
    googleId: {
      type: String,
      sparse: true,
    },
    authProvider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
    },

    // Profile
    profilePicture: {
      type: String,
      default: '',
    },
    age: Number,
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_to_say'],
    },
    height: {
      value: Number,
      unit: { type: String, enum: ['cm', 'ft'], default: 'cm' },
    },
    weight: {
      value: Number,
      unit: { type: String, enum: ['kg', 'lbs'], default: 'kg' },
    },
    targetWeight: {
      value: Number,
      unit: { type: String, enum: ['kg', 'lbs'], default: 'kg' },
    },

    // Fitness profile (filled during onboarding)
    fitnessLevel: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'beginner',
    },
    fitnessGoals: [
      {
        type: String,
        enum: [
          'weight_loss',
          'muscle_gain',
          'general_fitness',
          'flexibility',
          'endurance',
          'posture',
          'stress_relief',
        ],
      },
    ],
    exerciseFrequency: Number, // days per week
    availableEquipment: [
      {
        type: String,
        enum: ['none', 'dumbbells', 'resistance_bands', 'kettlebells', 'pull_up_bar'],
      },
    ],
    sessionDuration: Number, // minutes
    preferredWorkoutTime: {
      type: String,
      enum: ['morning', 'afternoon', 'evening'],
    },
    medicalConditions: String,
    onboardingCompleted: {
      type: Boolean,
      default: false,
    },

    // Account status
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },

    // Email verification
    emailVerificationToken: String,
    emailVerificationExpires: Date,

    // Password reset
    passwordResetToken: String,
    passwordResetExpires: Date,

    // Session tracking
    lastLogin: Date,
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: Date,

    // Gamification (will be used in Phase 9)
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    streak: { type: Number, default: 0 },
    lastWorkoutDate: Date,
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// ─── Hooks ───────────────────────────────────────────────────────────────────

// Hash password before saving (only if password was modified)
userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12);
  this.password = await bcrypt.hash(this.password, salt);
});

// ─── Methods ─────────────────────────────────────────────────────────────────

// Compare entered password with stored hash
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Check if account is locked (too many failed login attempts)
userSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

// Increment failed login attempts, lock after 5.
// Uses atomic updates — the previous read-modify-save version raced when two
// failed logins arrived in parallel (lost increments / VersionError).
userSchema.methods.incrementLoginAttempts = async function () {
  const User = this.constructor;

  // Reset if a previous lock has expired
  if (this.lockUntil && this.lockUntil < Date.now()) {
    await User.updateOne(
      { _id: this._id },
      { $set: { loginAttempts: 1 }, $unset: { lockUntil: 1 } }
    );
    return;
  }

  const res = await User.findOneAndUpdate(
    { _id: this._id },
    { $inc: { loginAttempts: 1 } },
    { new: true, projection: { loginAttempts: 1 } }
  );

  // Lock for 30 minutes after 5 failed attempts
  if (res && res.loginAttempts >= 5) {
    await User.updateOne(
      { _id: this._id },
      { $set: { lockUntil: Date.now() + 30 * 60 * 1000 } }
    );
  }
};

module.exports = mongoose.model('User', userSchema);