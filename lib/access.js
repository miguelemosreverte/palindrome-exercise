const wallet = require('./wallet');

module.exports = {
  consumePaidAccess: wallet.consumeWalletBalance,
  ensureApprovedPaymentAccess: wallet.ensureWalletAccess,
  findApprovedPayments: wallet.findApprovedWallets,
  summarizePaidAccess: wallet.summarizeWallet,
};
