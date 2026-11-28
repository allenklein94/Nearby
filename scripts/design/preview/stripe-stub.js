// Web-only stand-in for @stripe/stripe-react-native in the preview harness (payments never run in a screenshot).
import React from 'react';
export const StripeProvider = ({ children }) => children;
export const useStripe = () => ({ initPaymentSheet: async () => ({}), presentPaymentSheet: async () => ({ error: { code: 'Canceled' } }) });
export const CardField = () => null;
export const initStripe = async () => {};
export default { StripeProvider };
