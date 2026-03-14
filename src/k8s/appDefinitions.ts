import { core } from '@pulumi/kubernetes/types/input';
import {
  haDataPvc, mosquittoConfigmap, ddclientConfigmap, zigbee2mqttDataPvc, esphomeDataPvc, piperDataPvc, whisperDataPvc, puregymGoogleWalletDataPvc,
  mcpAggregatorDataPvc, starlingBankMcpDataPvc, openfoodfactsMcpDataPvc,
} from './storage';
import env from '../env/prod';

export const apps: AppDefinition[] = [
  {
    name: 'nginx',
    targetPort: 80,
    spec: {
      containers: [{
        name: 'nginx',
        image: 'nginx',
      }],
    },
    ingress: { host: `nginx.${env.BASE_DOMAIN}`, auth: true },
  },
  {
    name: 'ha',
    targetPort: 8123,
    spec: {
      containers: [{
        name: 'ha',
        image: 'ghcr.io/home-assistant/home-assistant:stable@sha256:0e091dfce3068339c3e1d14382e6c34141e05cd589a1972ebd4d9a8e6b5d8969',
        // Necessary to access the Bluetooth
        securityContext: {
          privileged: true,
        },
        volumeMounts: [
          {
            name: 'ha-data-volume',
            mountPath: '/config',
          },
          {
            name: 'ha-dbus',
            mountPath: '/run/dbus',
            readOnly: true,
          },
        ],
      }],
      volumes: [
        {
          name: 'ha-data-volume',
          persistentVolumeClaim: {
            claimName: haDataPvc.metadata.name,
          },
        },
        // For Bluetooth integration
        {
          name: 'ha-dbus',
          hostPath: {
            path: '/run/dbus',
          },
        },
      ],
    },
    ingress: { host: env.BASE_DOMAIN, auth: false },
  },
  {
    name: 'mosquitto',
    targetPort: 1883,
    spec: {
      containers: [{
        name: 'eclipse-mosquitto',
        image: 'eclipse-mosquitto:latest@sha256:9cfdd46ad59f3e3e5f592f6baf57ab23e1ad00605509d0f5c1e9b179c5314d87',
        volumeMounts: [
          {
            name: 'mosquitto-configmap-volume',
            mountPath: '/mosquitto/config/mosquitto.conf',
            subPath: 'mosquitto.conf',
          },
        ],
      }],
      volumes: [{
        name: 'mosquitto-configmap-volume',
        configMap: {
          name: mosquittoConfigmap.metadata.name,
        },
      }],
    },
  },
  {
    name: 'zigbee2mqtt',
    targetPort: 8080,
    spec: {
      containers: [{
        name: 'zigbee2mqtt',
        image: 'koenkk/zigbee2mqtt:latest@sha256:89cf02f379aa743a68494388e3a26fba7b8c9101f8b452038cc07aeff3fc983c',
        // Necessary to access the USB Zigbee stick
        securityContext: {
          privileged: true,
        },
        volumeMounts: [
          {
            name: 'zigbee2mqtt-data-volume',
            mountPath: '/app/data',
          },
          // Access to the USB Zigbee stick
          {
            name: 'zigbee2mqtt-usb-volume',
            mountPath: '/dev/ttyUSB0',
          },
        ],
      }],
      volumes: [
        {
          name: 'zigbee2mqtt-data-volume',
          persistentVolumeClaim: {
            claimName: zigbee2mqttDataPvc.metadata.name,
          },
        },
        {
          name: 'zigbee2mqtt-udev-volume',
          hostPath: {
            path: '/run/udev',
          },
        },
        {
          name: 'zigbee2mqtt-usb-volume',
          hostPath: {
            path: '/dev/ttyUSB0',
          },
        },
      ],
    },
    ingress: { host: `z2m.${env.BASE_DOMAIN}`, auth: true },
  },
  {
    name: 'ddclient',
    spec: {
      containers: [{
        name: 'ddclient',
        image: 'linuxserver/ddclient:latest@sha256:cf9c8c2ba0397dc689afd2f438b94d1ff7e5ff54ed4f00bcab43b04fb35fa462',
        volumeMounts: [
          {
            name: 'ddclient-configmap-volume',
            mountPath: '/defaults/ddclient.conf',
            subPath: 'ddclient.conf',
          },
        ],
      }],
      volumes: [
        {
          name: 'ddclient-configmap-volume',
          configMap: {
            name: ddclientConfigmap.metadata.name,
          },
        },
      ],
    },
  },
  {
    name: 'vouch-proxy',
    targetPort: 9090,
    spec: {
      containers: [{
        name: 'vouch-proxy',
        image: 'quay.io/vouch/vouch-proxy:latest@sha256:b1f82c00eb5b154aeb9f58a7c846a73ff9ae683fe4e51953f8fa188baa50006f',
        env: [{
          name: 'VOUCH_ALLOWALLUSERS',
          value: 'true',
        }, {
          name: 'VOUCH_COOKIE_DOMAIN',
          value: env.BASE_DOMAIN,
        }, {
          name: 'VOUCH_LISTEN',
          value: '0.0.0.0',
        }, {
          name: 'OAUTH_PROVIDER',
          value: 'homeassistant',
        }, {
          name: 'OAUTH_CLIENT_ID',
          value: `https://vouch.${env.BASE_DOMAIN}`,
        }, {
          name: 'OAUTH_CALLBACK_URL',
          value: `https://vouch.${env.BASE_DOMAIN}/auth`,
        }, {
          name: 'OAUTH_AUTH_URL',
          value: `https://${env.BASE_DOMAIN}/auth/authorize`,
        }, {
          name: 'OAUTH_TOKEN_URL',
          value: `https://${env.BASE_DOMAIN}/auth/token`,
        }],
      }],
    },
    ingress: { host: `vouch.${env.BASE_DOMAIN}`, auth: false },
  },
  {
    name: 'esphome',
    targetPort: 6052,
    spec: {
      containers: [{
        name: 'esphome',
        image: 'ghcr.io/esphome/esphome:latest@sha256:344427c7d9ed64670172def4868daf89537ac121a1a83f080cc74a6ececfb9c7',
        env: [{
          name: 'ESPHOME_DASHBOARD_USE_PING',
          value: 'true',
        }],
        volumeMounts: [
          {
            name: 'esphome-data-volume',
            mountPath: '/config',
          },
        ],
      }],
      volumes: [
        {
          name: 'esphome-data-volume',
          persistentVolumeClaim: {
            claimName: esphomeDataPvc.metadata.name,
          },
        },
      ],
    },
    ingress: { host: `esphome.${env.BASE_DOMAIN}`, auth: true },
  },
  {
    name: 'whisper',
    targetPort: 10300,
    spec: {
      containers: [{
        name: 'whisper',
        image: 'rhasspy/wyoming-whisper:latest@sha256:995b37523bc422f4f7649e50ccded97a5b9bf6d1d0420591183a778dd5d7d3f2',
        args: ['--stt-library', 'sherpa', '--model', 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8', '--language', 'en'],
        volumeMounts: [
          {
            name: 'whisper-data-volume',
            mountPath: '/data',
          },
        ],
      }],
      volumes: [
        {
          name: 'whisper-data-volume',
          persistentVolumeClaim: {
            claimName: whisperDataPvc.metadata.name,
          },
        },
      ],
    },
  },
  {
    name: 'piper',
    targetPort: 10200,
    spec: {
      containers: [{
        name: 'piper',
        image: 'rhasspy/wyoming-piper',
        args: ['--voice', 'en_GB-jenny_dioco-medium', '--length-scale', '0.6'],
        volumeMounts: [
          {
            name: 'piper-data-volume',
            mountPath: '/data',
          },
        ],
      }],
      volumes: [
        {
          name: 'piper-data-volume',
          persistentVolumeClaim: {
            claimName: piperDataPvc.metadata.name,
          },
        },
      ],
    },
  },
  {
    name: 'hass-oidc-provider',
    targetPort: 3001,
    spec: {
      containers: [{
        name: 'hass-oidc-provider',
        image: 'ghcr.io/domdomegg/hass-oidc-provider:latest@sha256:d6f00d0418be30621781794f56c1b2be54c4d663e2a4f583f4bebcb75f883390',
        env: [{
          name: 'HASS_OIDC_CONFIG',
          value: JSON.stringify({
            hassUrl: `https://${env.BASE_DOMAIN}`,
            externalUrl: `https://oidc.${env.BASE_DOMAIN}`,
            signingKey: env.HASS_OIDC_SIGNING_KEY,
          }),
        }],
      }],
    },
    ingress: { host: `oidc.${env.BASE_DOMAIN}`, auth: false },
  },
  {
    name: 'puregym-google-wallet',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'puregym-google-wallet',
        image: 'ghcr.io/domdomegg/puregym-google-wallet:latest',
        env: [{
          name: 'GOOGLE_SERVICE_ACCOUNT_JSON',
          value: env.GOOGLE_SERVICE_ACCOUNT_JSON,
        }, {
          name: 'GOOGLE_WALLET_ISSUER_ID',
          value: env.GOOGLE_WALLET_ISSUER_ID,
        }],
        volumeMounts: [
          {
            name: 'puregym-google-wallet-data-volume',
            mountPath: '/app/data',
          },
        ],
      }],
      volumes: [
        {
          name: 'puregym-google-wallet-data-volume',
          persistentVolumeClaim: {
            claimName: puregymGoogleWalletDataPvc.metadata.name,
          },
        },
      ],
    },
    ingress: { host: `puregym.${env.BASE_DOMAIN}`, auth: false },
  },

  // Google MCP servers (native OAuth to Google)
  ...([
    'gmail',
    'google-cal',
    'google-contacts',
    'google-documents',
    'google-drive',
    'google-maps-places',
    'google-sheets',
  ]).map((name) => ({
    name: `${name}-mcp`,
    targetPort: 3000,
    spec: {
      containers: [{
        name: `${name}-mcp`,
        image: 'node:lts-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03',
        command: ['npx', '-y', `${name}-mcp`],
        env: [
          { name: 'MCP_TRANSPORT', value: 'http' },
          { name: 'GOOGLE_CLIENT_ID', value: env.GOOGLE_MCP_CLIENT_ID },
          { name: 'GOOGLE_CLIENT_SECRET', value: env.GOOGLE_MCP_CLIENT_SECRET },
          { name: 'MCP_BASE_URL', value: `https://${name}.mcp.${env.BASE_DOMAIN}` },
        ],
      }],
    },
    ingress: { host: `${name}.mcp.${env.BASE_DOMAIN}`, auth: false },
  })),

  // Starling Bank MCP (via mcp-auth-wrapper + hass-oidc-provider)
  {
    name: 'starling-bank-mcp',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'starling-bank-mcp',
        image: 'ghcr.io/domdomegg/mcp-auth-wrapper:latest@sha256:fd2fb6d3c952349423b3dfac2c1bb4ecc18cadbe0b37d0c842d6570506695453',
        env: [{
          name: 'MCP_AUTH_WRAPPER_CONFIG',
          value: JSON.stringify({
            command: ['npx', '-y', 'starling-bank-mcp'],
            auth: { issuer: `https://oidc.${env.BASE_DOMAIN}` },
            envPerUser: [
              { name: 'STARLING_BANK_ACCESS_TOKEN', label: 'Starling Bank Access Token', secret: true },
            ],
            storage: '/app/data/mcp.sqlite',
            issuerUrl: `https://starling-bank.mcp.${env.BASE_DOMAIN}`,
            secret: env.MCP_AUTH_WRAPPER_SECRET,
          }),
        }],
        volumeMounts: [{
          name: 'mcp-data-volume',
          mountPath: '/app/data',
        }],
      }],
      volumes: [{
        name: 'mcp-data-volume',
        persistentVolumeClaim: {
          claimName: starlingBankMcpDataPvc.metadata.name,
        },
      }],
    },
    ingress: { host: `starling-bank.mcp.${env.BASE_DOMAIN}`, auth: false },
  },

  // OpenFoodFacts MCP (via mcp-auth-wrapper + hass-oidc-provider)
  {
    name: 'openfoodfacts-mcp',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'openfoodfacts-mcp',
        image: 'ghcr.io/domdomegg/mcp-auth-wrapper:latest@sha256:fd2fb6d3c952349423b3dfac2c1bb4ecc18cadbe0b37d0c842d6570506695453',
        env: [{
          name: 'MCP_AUTH_WRAPPER_CONFIG',
          value: JSON.stringify({
            command: ['npx', '-y', 'openfoodfacts-mcp'],
            auth: { issuer: `https://oidc.${env.BASE_DOMAIN}` },
            envPerUser: [
              { name: 'OFF_USER_AGENT', label: 'User Agent (e.g. MyApp/1.0 (email@example.com))' },
              { name: 'OFF_USER_ID', label: 'OpenFoodFacts Username (optional)' },
              { name: 'OFF_PASSWORD', label: 'OpenFoodFacts Password (optional)', secret: true },
            ],
            storage: '/app/data/mcp.sqlite',
            issuerUrl: `https://openfoodfacts.mcp.${env.BASE_DOMAIN}`,
            secret: env.MCP_AUTH_WRAPPER_SECRET,
          }),
        }],
        volumeMounts: [{
          name: 'mcp-data-volume',
          mountPath: '/app/data',
        }],
      }],
      volumes: [{
        name: 'mcp-data-volume',
        persistentVolumeClaim: {
          claimName: openfoodfactsMcpDataPvc.metadata.name,
        },
      }],
    },
    ingress: { host: `openfoodfacts.mcp.${env.BASE_DOMAIN}`, auth: false },
  },

  // Barcode Scanner MCP (no auth, direct HTTP)
  {
    name: 'barcode-scanner-mcp',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'barcode-scanner-mcp',
        image: 'node:lts-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03',
        command: ['npx', '-y', 'barcode-scanner-mcp'],
        env: [
          { name: 'MCP_TRANSPORT', value: 'http' },
        ],
      }],
    },
    ingress: { host: `barcode-scanner.mcp.${env.BASE_DOMAIN}`, auth: false },
  },

  // Tool Sandbox MCP (sandboxed code execution with access to gateway tools, proxies OAuth from gateway)
  {
    name: 'tool-sandbox-mcp',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'tool-sandbox-mcp',
        image: 'node:lts-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03',
        command: ['npx', '-y', 'tool-sandbox-mcp'],
        env: [{
          name: 'TOOL_SANDBOX_MCP_CONFIG',
          value: JSON.stringify({
            upstream: `https://mcp.${env.BASE_DOMAIN}`,
            issuerUrl: `https://tool-sandbox.mcp.${env.BASE_DOMAIN}`,
          }),
        }],
      }],
    },
    ingress: { host: `tool-sandbox.mcp.${env.BASE_DOMAIN}`, auth: false },
  },

  // MCP Local Tunnel relay (bridges agent WebSocket connections to MCP endpoint)
  {
    name: 'mcp-local-tunnel',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'mcp-local-tunnel',
        image: 'ghcr.io/domdomegg/mcp-local-tunnel:latest@sha256:62b5b2b74ca01428d2cbef1d63ae055f4a3276771fa3091c9e942755c9dbd544',
        env: [{
          name: 'MCP_LOCAL_TUNNEL_CONFIG',
          value: JSON.stringify({
            mode: 'relay',
            auth: { issuer: `https://oidc.${env.BASE_DOMAIN}` },
            issuerUrl: `https://tunnel.mcp.${env.BASE_DOMAIN}`,
            secret: env.MCP_LOCAL_TUNNEL_SECRET,
          }),
        }],
      }],
    },
    ingress: { host: `tunnel.mcp.${env.BASE_DOMAIN}`, auth: false },
  },

  // MCP Aggregator (aggregates all upstream MCP servers behind a single OAuth endpoint)
  {
    name: 'mcp-aggregator',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'mcp-aggregator',
        image: 'ghcr.io/domdomegg/mcp-aggregator:2.0.1@sha256:990a63a45a29a5a7258202c2803f8ac8e5717fa90cd4dce1afb8580d0decc3ea',
        env: [{
          name: 'MCP_AGGREGATOR_CONFIG',
          value: JSON.stringify({
            auth: {
              issuer: `https://oidc.${env.BASE_DOMAIN}`,
              clientId: 'mcp-aggregator',
            },
            upstreams: [
              { name: 'gmail', url: `https://gmail.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-cal', url: `https://google-cal.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-contacts', url: `https://google-contacts.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-documents', url: `https://google-documents.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-drive', url: `https://google-drive.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-maps-places', url: `https://google-maps-places.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-sheets', url: `https://google-sheets.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'starling-bank', url: `https://starling-bank.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'openfoodfacts', url: `https://openfoodfacts.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'barcode-scanner', url: `https://barcode-scanner.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'home-assistant', url: `https://${env.BASE_DOMAIN}/api/mcp` },
              { name: 'tool-sandbox-mcp', url: `https://tool-sandbox.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'tunnel', url: `https://tunnel.mcp.${env.BASE_DOMAIN}/mcp` },
            ],
            storage: '/app/data/mcp-aggregator.sqlite',
            issuerUrl: `https://mcp.${env.BASE_DOMAIN}`,
            secret: env.MCP_AGGREGATOR_SECRET,
          }),
        }],
        volumeMounts: [{
          name: 'mcp-data-volume',
          mountPath: '/app/data',
        }],
      }],
      volumes: [{
        name: 'mcp-data-volume',
        persistentVolumeClaim: {
          claimName: mcpAggregatorDataPvc.metadata.name,
        },
      }],
    },
    ingress: { host: `mcp.${env.BASE_DOMAIN}`, auth: false },
  },
];

interface AppDefinition {
  name: string,
  targetPort?: number,
  spec: core.v1.PodSpec,
  ingress?: { host: string, auth: boolean },
}
