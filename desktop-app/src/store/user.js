/**
 * User profile store — localStorage-backed.
 */
const STORAGE_KEY = 'bridge_user_profile';

const UserStore = {
  _defaults: {
    name: '',
    avatar: '😊',
    interests: [],
    onboarded: false,
    createdAt: null,
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...this._defaults, ...JSON.parse(raw) } : { ...this._defaults };
    } catch {
      return { ...this._defaults };
    }
  },

  save(profile) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  },

  get(key) {
    return this.load()[key];
  },

  set(key, value) {
    const profile = this.load();
    profile[key] = value;
    this.save(profile);
    return profile;
  },

  completeOnboarding(data) {
    const profile = {
      ...this.load(),
      ...data,
      onboarded: true,
      createdAt: new Date().toISOString(),
    };
    this.save(profile);
    return profile;
  },

  isOnboarded() {
    return this.load().onboarded === true;
  },

  reset() {
    localStorage.removeItem(STORAGE_KEY);
  },
};

// Export for module usage or attach to window for script usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UserStore;
} else {
  window.UserStore = UserStore;
}
