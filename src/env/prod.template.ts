import type { Env } from './types';

const env: Env = {
  STAGE: 'prod',

  BASE_DOMAIN: 'home.yourname.com',
  PORKBUN_API_KEY: 'pk1_abcdef',
  PORKBUN_SECRET_API_KEY: 'sk1_abcdef',

  GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
  GOOGLE_WALLET_ISSUER_ID: '',
};

export default env;
