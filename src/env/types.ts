export interface Env {
  STAGE: 'local' | 'prod',

  /** @example home.adamjones.me */
  BASE_DOMAIN: string,

  /** @example pk1_abcdef */
  PORKBUN_API_KEY: string,
  /** @example sk1_abcdef */
  PORKBUN_SECRET_API_KEY: string,

  /** Google Wallet service account JSON */
  GOOGLE_SERVICE_ACCOUNT_JSON: string,
  /** Google Wallet issuer ID */
  GOOGLE_WALLET_ISSUER_ID: string,

  /** ECDSA P-256 JWK signing key for hass-oidc-provider */
  HASS_OIDC_SIGNING_KEY: string,

  /** Google OAuth client ID shared across all Google MCP servers */
  GOOGLE_MCP_CLIENT_ID: string,
  /** Google OAuth client secret shared across all Google MCP servers */
  GOOGLE_MCP_CLIENT_SECRET: string,
  /** Signing key for mcp-auth-wrapper token encryption */
  MCP_AUTH_WRAPPER_SECRET: string,
}
