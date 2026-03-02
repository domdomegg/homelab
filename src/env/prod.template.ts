import type { Env } from './types';

const env: Env = {
  STAGE: 'prod',

  BASE_DOMAIN: 'home.yourname.com',
  PORKBUN_API_KEY: 'pk1_abcdef',
  PORKBUN_SECRET_API_KEY: 'sk1_abcdef',

  GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
  GOOGLE_WALLET_ISSUER_ID: '',

  HASS_OIDC_SIGNING_KEY: '{"kty":"EC","crv":"P-256","x":"...","y":"...","d":"..."}',

  GOOGLE_MCP_CLIENT_ID: '',
  GOOGLE_MCP_CLIENT_SECRET: '',
  MCP_AUTH_WRAPPER_SECRET: '',
  MCP_AGGREGATOR_SECRET: '',
  MCP_LOCAL_TUNNEL_SECRET: '',
};

export default env;
