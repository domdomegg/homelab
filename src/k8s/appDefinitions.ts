import { apps as appsTypes, core } from '@pulumi/kubernetes/types/input';
import {
  haDataPvc, mosquittoConfigmap, ddclientConfigmap, zigbee2mqttDataPvc, esphomeDataPvc, whisperDataPvc,
  mcpAggregatorDataPvc, starlingBankMcpDataPvc, openfoodfactsMcpDataPvc, olioVolunteerMcpDataPvc, musicAssistantDataPvc, haMcpDataPvc,
  googleWorkspaceMcpDataPvc, whatsappMcpDataPvc, airtableMcpDataPvc, adamconDataPvc, adamconServiceAccount, oidcDiscoveryConfigmap,
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
      // Required for AF_BLUETOOTH sockets — they're scoped to the network namespace,
      // so even a privileged pod can't open HCI sockets without host networking.
      hostNetwork: true,
      dnsPolicy: 'ClusterFirstWithHostNet',
      containers: [{
        name: 'ha',
        image: 'ghcr.io/home-assistant/home-assistant:stable@sha256:adb3341e31e03e0048e60d8c1cf952e118a381ae258bb921d3da12a3b27bf0c2',
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
        image: 'eclipse-mosquitto:latest@sha256:6f8d8a947c506f8a2290ec65cd4bd2bc7cb4d43fb5f6271f861cb013e2ef9797',
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
    // The Zigbee USB stick can only be held by one process at a time. With the default
    // RollingUpdate, the new pod boots while the old still owns /dev/ttyUSB0 and crashes
    // with "Cannot lock port" until the old pod terminates.
    strategy: { type: 'Recreate' },
    spec: {
      containers: [{
        name: 'zigbee2mqtt',
        image: 'koenkk/zigbee2mqtt:latest@sha256:2a21bbf7a664a149024bbe1f776e3151f28ed9db15948270dcbffb89544a41f0',
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
        image: 'ghcr.io/esphome/esphome:latest@sha256:10794efbf28068f790f671764c9af135cf5f5799903d1ffb05313a037c97b032',
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
  // The int8 transducer 110m model files are pre-populated in the PVC manually.
  // Upstream sherpa-onnx publishes only the fp32 transducer and CTC int8 (which doesn't
  // load via wyoming-whisper's `from_transducer` call), so this int8 transducer was
  // produced by running onnxruntime's `quantize_dynamic` (MatMul-only) on the fp32 ONNX
  // files from HF `csukuangfj/sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000`,
  // then `kubectl cp`'d into the whisper PVC. If the PVC is ever recreated, wyoming-whisper
  // will hit its hardcoded URL and 404. Tracking upstream:
  // https://github.com/k2-fsa/sherpa-onnx/issues/3570
  {
    name: 'whisper',
    targetPort: 10300,
    spec: {
      containers: [{
        name: 'whisper',
        image: 'rhasspy/wyoming-whisper:3.1.0@sha256:9501d2659eee83b6eead98d53842193e5fed011eda6c5b1c3ad36f3146b28fed',
        args: ['--stt-library', 'sherpa', '--model', 'sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8', '--language', 'en'],
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
  // Microsoft Edge TTS via wyoming-edge-tts: a single Rust binary that speaks
  // Wyoming on one side and Microsoft's free read-aloud WebSocket on the other.
  // Replaces the prior wyoming_openai + travisvn/openai-edge-tts two-container
  // stack — saves ~250 MB RSS, cuts time-to-first-audio by 3-6×.
  {
    name: 'edge-tts',
    targetPort: 10210,
    spec: {
      containers: [{
        name: 'edge-tts',
        image: 'ghcr.io/domdomegg/wyoming-edge-tts:0.1.2@sha256:5c85b741df52cfd0dc5c0befafec4810d2be8285cb7395de164d87d6125d60b7',
      }],
    },
  },
  {
    name: 'music-assistant',
    targetPort: 8095,
    spec: {
      // Required for mDNS/Zeroconf device discovery (Chromecast, Sonos, AirPlay, DLNA, Squeezebox)
      // — multicast doesn't traverse the pod network namespace.
      hostNetwork: true,
      dnsPolicy: 'ClusterFirstWithHostNet',
      containers: [{
        name: 'music-assistant',
        image: 'ghcr.io/music-assistant/server:latest@sha256:7e7269b20bafd7fabd1567bc0991fd30e894b05d205dacdaba8a2a3893982722',
        volumeMounts: [{
          name: 'music-assistant-data-volume',
          mountPath: '/data',
        }],
      }],
      volumes: [{
        name: 'music-assistant-data-volume',
        persistentVolumeClaim: {
          claimName: musicAssistantDataPvc.metadata.name,
        },
      }],
    },
    ingress: { host: `music.${env.BASE_DOMAIN}`, auth: true },
  },

  // ── MCP gateway ──
  // Auth principle for every MCP server behind the aggregator: per-person self-serve auth.
  // Each user authorizes their own account through the OAuth flow (or supplies their own
  // per-user token via the auth wrapper) — we never hardcode shared/per-user credentials,
  // and never put user credentials in a Pulumi secret. App-level OAuth client id/secret is
  // fine; user-identifying tokens must be self-served, not provisioned by us.
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

  // Google Workspace MCP (taylorwilsdon/google_workspace_mcp) — Python, runs via uvx.
  // Single comprehensive server (Gmail, Drive, Calendar, Docs, Sheets, Slides, Forms, Tasks,
  // Contacts, Chat, Apps Script) using its own OAuth 2.1 multi-user mode: each user self-serves
  // a Google authorization via the /oauth2callback flow, tokens persisted per-user to the PVC.
  // Reuses the shared GOOGLE_MCP OAuth client — the redirect URI
  // https://google-workspace.mcp.${BASE_DOMAIN}/oauth2callback must be registered on that client.
  // NB: runs as root to install Python/uv at startup (same pattern as ha-mcp).
  {
    name: 'google-workspace-mcp',
    targetPort: 8000,
    spec: {
      containers: [{
        name: 'google-workspace-mcp',
        image: 'node:lts-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03',
        command: ['sh', '-c'],
        args: [
          'apk add --no-cache python3 py3-pip && python3 -m pip install --break-system-packages uv && exec uvx workspace-mcp --transport streamable-http --tool-tier complete',
        ],
        securityContext: { runAsUser: 0 },
        env: [
          { name: 'MCP_ENABLE_OAUTH21', value: 'true' },
          { name: 'GOOGLE_OAUTH_CLIENT_ID', value: env.GOOGLE_MCP_CLIENT_ID },
          { name: 'GOOGLE_OAUTH_CLIENT_SECRET', value: env.GOOGLE_MCP_CLIENT_SECRET },
          { name: 'WORKSPACE_MCP_PORT', value: '8000' },
          { name: 'WORKSPACE_EXTERNAL_URL', value: `https://google-workspace.mcp.${env.BASE_DOMAIN}` },
          { name: 'WORKSPACE_MCP_CREDENTIALS_DIR', value: '/app/data/credentials' },
        ],
        volumeMounts: [{
          name: 'mcp-data-volume',
          mountPath: '/app/data',
        }],
      }],
      volumes: [{
        name: 'mcp-data-volume',
        persistentVolumeClaim: {
          claimName: googleWorkspaceMcpDataPvc.metadata.name,
        },
      }],
    },
    ingress: { host: `google-workspace.mcp.${env.BASE_DOMAIN}`, auth: false },
  },

  // Starling Bank MCP (via mcp-auth-wrapper + hass-oidc-provider)
  // NB: mcp-auth-wrapper runs as non-root `node` user (uid 1000). If copying this configuration and using a PVC, you may need
  // securityContext: { fsGroup: 1000 } on the pod spec for write access.
  {
    name: 'starling-bank-mcp',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'starling-bank-mcp',
        image: 'ghcr.io/domdomegg/mcp-auth-wrapper:latest@sha256:6f44f74fefe7406379f5e62c5348920f4fb919e2a9fb484c65e5e2a54eeaeb8b',
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

  // Airtable MCP (domdomegg/airtable-mcp-server, via mcp-auth-wrapper + hass-oidc-provider).
  // Per-user Airtable personal access token. Read+write across the user's bases.
  // NB: mcp-auth-wrapper runs as non-root `node` user (uid 1000); fsGroup set for PVC write access.
  {
    name: 'airtable-mcp',
    targetPort: 3000,
    spec: {
      securityContext: { fsGroup: 1000 },
      containers: [{
        name: 'airtable-mcp',
        image: 'ghcr.io/domdomegg/mcp-auth-wrapper:latest@sha256:6f44f74fefe7406379f5e62c5348920f4fb919e2a9fb484c65e5e2a54eeaeb8b',
        env: [{
          name: 'MCP_AUTH_WRAPPER_CONFIG',
          value: JSON.stringify({
            command: ['npx', '-y', 'airtable-mcp-server'],
            auth: { issuer: `https://oidc.${env.BASE_DOMAIN}` },
            envPerUser: [
              { name: 'AIRTABLE_API_KEY', label: 'Airtable Personal Access Token', secret: true },
            ],
            storage: '/app/data/mcp.sqlite',
            issuerUrl: `https://airtable.mcp.${env.BASE_DOMAIN}`,
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
          claimName: airtableMcpDataPvc.metadata.name,
        },
      }],
    },
    ingress: { host: `airtable.mcp.${env.BASE_DOMAIN}`, auth: false },
  },

  // OpenFoodFacts MCP (via mcp-auth-wrapper + hass-oidc-provider)
  // NB: mcp-auth-wrapper runs as non-root `node` user (uid 1000). If copying this configuration and using a PVC, you may need
  // securityContext: { fsGroup: 1000 } on the pod spec for write access.
  {
    name: 'openfoodfacts-mcp',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'openfoodfacts-mcp',
        image: 'ghcr.io/domdomegg/mcp-auth-wrapper:latest@sha256:6f44f74fefe7406379f5e62c5348920f4fb919e2a9fb484c65e5e2a54eeaeb8b',
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

  // Olio Volunteer Hub MCP (via mcp-auth-wrapper, per-user _session_id cookie)
  {
    name: 'olio-volunteer-mcp',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'olio-volunteer-mcp',
        image: 'ghcr.io/domdomegg/mcp-auth-wrapper:latest@sha256:6f44f74fefe7406379f5e62c5348920f4fb919e2a9fb484c65e5e2a54eeaeb8b',
        env: [{
          name: 'MCP_AUTH_WRAPPER_CONFIG',
          value: JSON.stringify({
            command: ['npx', '-y', 'olio-volunteer-mcp'],
            auth: { issuer: `https://oidc.${env.BASE_DOMAIN}` },
            envPerUser: [
              { name: 'OLIO_SESSION_ID', label: 'Olio Volunteer Hub _session_id cookie', secret: true },
            ],
            storage: '/app/data/mcp.sqlite',
            issuerUrl: `https://olio.mcp.${env.BASE_DOMAIN}`,
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
          claimName: olioVolunteerMcpDataPvc.metadata.name,
        },
      }],
    },
    ingress: { host: `olio.mcp.${env.BASE_DOMAIN}`, auth: false },
  },

  // Home Assistant MCP (via mcp-auth-wrapper + hass-oidc-provider, per-user HA tokens)
  // NB: runs as root to install Python/uv at startup. Spawns ha-mcp (Python, stdio) via uvx.
  {
    name: 'ha-mcp',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'ha-mcp',
        image: 'node:lts-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03',
        command: ['sh', '-c'],
        args: [
          'apk add --no-cache python3 py3-pip && python3 -m pip install --break-system-packages uv && exec npx -y mcp-auth-wrapper',
        ],
        securityContext: { runAsUser: 0 },
        env: [
          { name: 'HOMEASSISTANT_URL', value: 'http://ha-svc:80' },
          {
            name: 'MCP_AUTH_WRAPPER_CONFIG',
            value: JSON.stringify({
              command: ['uvx', 'ha-mcp==7.3.0'],
              auth: { issuer: `https://oidc.${env.BASE_DOMAIN}` },
              envPerUser: [
                { name: 'HOMEASSISTANT_TOKEN', label: 'Home Assistant Long-Lived Access Token', secret: true },
              ],
              storage: '/app/data/mcp.sqlite',
              issuerUrl: `https://ha.mcp.${env.BASE_DOMAIN}`,
              secret: env.MCP_AUTH_WRAPPER_SECRET,
            }),
          },
        ],
        volumeMounts: [{
          name: 'mcp-data-volume',
          mountPath: '/app/data',
        }],
      }],
      volumes: [{
        name: 'mcp-data-volume',
        persistentVolumeClaim: {
          claimName: haMcpDataPvc.metadata.name,
        },
      }],
    },
    ingress: { host: `ha.mcp.${env.BASE_DOMAIN}`, auth: false },
  },

  // WhatsApp MCP (domdomegg/whatsapp-mcp-extended fork; personal account via whatsmeow bridge).
  // The combined image bundles mcp-auth-wrapper, which gates access via hass-oidc-provider and
  // spawns one combined per-user stdio server (run_server.py) per authenticated user.
  // Each user gets their own store/<MCP_USER_ID>/ (whatsmeow session + history) and a private
  // loopback bridge — full isolation behind the shared aggregator. Onboard via the get_setup_qr
  // tool (scan QR in WhatsApp > Linked Devices). Single-account-per-user; unofficial API (ban risk).
  // NB: runs as non-root (uid 1000), so fsGroup is set for PVC write access.
  {
    name: 'whatsapp-mcp',
    targetPort: 3000,
    spec: {
      securityContext: { fsGroup: 1000 },
      containers: [{
        name: 'whatsapp-mcp',
        image: 'ghcr.io/domdomegg/whatsapp-mcp-extended:latest',
        env: [{
          name: 'MCP_AUTH_WRAPPER_CONFIG',
          value: JSON.stringify({
            command: ['python', '/app/whatsapp-mcp-server/run_server.py'],
            auth: { issuer: `https://oidc.${env.BASE_DOMAIN}` },
            storage: '/app/data/mcp.sqlite',
            issuerUrl: `https://whatsapp.mcp.${env.BASE_DOMAIN}`,
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
          claimName: whatsappMcpDataPvc.metadata.name,
        },
      }],
    },
    ingress: { host: `whatsapp.mcp.${env.BASE_DOMAIN}`, auth: false },
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

  // Benepass MCP (no auth, direct HTTP — server is fully stateless, every tool call carries
  // its own refresh_token. Aggregator inclusion is fine because the aggregator is OIDC-gated;
  // the direct ingress is the only public surface either way.)
  {
    name: 'benepass-mcp',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'benepass-mcp',
        image: 'node:lts-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03',
        command: ['npx', '-y', 'benepass-mcp'],
        env: [
          { name: 'MCP_TRANSPORT', value: 'http' },
        ],
      }],
    },
    ingress: { host: `benepass.mcp.${env.BASE_DOMAIN}`, auth: false },
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
        image: 'ghcr.io/domdomegg/mcp-local-tunnel:latest@sha256:f99255ecadfbe2540948f05e63f1e16f98a219e715e884fbe650b98d5b2210f2',
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
  // NB: mcp-aggregator runs as non-root `node` user (uid 1000). If copying this configuration and using a PVC, you may need
  // securityContext: { fsGroup: 1000 } on the pod spec for write access.
  {
    name: 'mcp-aggregator',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'mcp-aggregator',
        image: 'ghcr.io/domdomegg/mcp-aggregator:latest@sha256:8e001bcb9cf4bad273f09064dc1f8af2001524f8f4d1a0286af6564f4a15ef54',
        env: [{
          name: 'MCP_AGGREGATOR_CONFIG',
          value: JSON.stringify({
            auth: {
              issuer: `https://oidc.${env.BASE_DOMAIN}`,
              clientId: 'mcp-aggregator',
            },
            upstreams: [
              { name: 'gmail', url: `https://gmail.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'gmail-2', url: `https://gmail.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-cal', url: `https://google-cal.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-contacts', url: `https://google-contacts.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-documents', url: `https://google-documents.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-drive', url: `https://google-drive.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-maps-places', url: `https://google-maps-places.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-sheets', url: `https://google-sheets.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'google-workspace', url: `https://google-workspace.mcp.${env.BASE_DOMAIN}/mcp` },
              // Second registration of the same server: a distinct aggregator session so one
              // person can authorize a second Google account in parallel (cf. gmail/gmail-2).
              { name: 'google-workspace-2', url: `https://google-workspace.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'starling-bank', url: `https://starling-bank.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'airtable', url: `https://airtable.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'openfoodfacts', url: `https://openfoodfacts.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'olio', url: `https://olio.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'benepass', url: `https://benepass.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'barcode-scanner', url: `https://barcode-scanner.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'home-assistant', url: `https://ha.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'whatsapp', url: `https://whatsapp.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'tool-sandbox', url: `https://tool-sandbox.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'tunnel', url: `https://tunnel.mcp.${env.BASE_DOMAIN}/mcp` },
              { name: 'slack', url: 'https://mcp.slack.com/mcp', clientId: '825862040501.10898174083287' },
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
  {
    name: 'pairdrop',
    targetPort: 3000,
    spec: {
      containers: [{
        name: 'pairdrop',
        image: 'ghcr.io/schlagmichdoch/pairdrop:latest@sha256:c4b30977264a76e335740089e693a52a0d0d616330dec7f93c7b96beef7b4a02',
      }],
    },
    ingress: { host: `pairdrop.${env.BASE_DOMAIN}`, auth: true },
  },
  {
    // Serves the cluster's OIDC discovery documents (static copies, see
    // oidcDiscoveryConfigmap in storage.ts) so AWS IAM can federate against
    // service account tokens.
    name: 'oidc-discovery',
    targetPort: 80,
    spec: {
      containers: [{
        name: 'nginx',
        image: 'nginx:stable-alpine@sha256:0d3b80406a13a767339fbe2f41406d6c7da727ab89cf8fae399e81f780f814d1',
        volumeMounts: [
          { name: 'content', mountPath: '/data' },
          { name: 'nginx-conf', mountPath: '/etc/nginx/conf.d' },
        ],
      }],
      volumes: [
        {
          name: 'content',
          configMap: {
            name: oidcDiscoveryConfigmap.metadata.name,
            items: [
              { key: 'openid-configuration', path: '.well-known/openid-configuration' },
              { key: 'jwks', path: 'openid/v1/jwks' },
            ],
          },
        },
        {
          name: 'nginx-conf',
          configMap: {
            name: oidcDiscoveryConfigmap.metadata.name,
            items: [{ key: 'nginx.conf', path: 'default.conf' }],
          },
        },
      ],
    },
    ingress: { host: `k8s-oidc.${env.BASE_DOMAIN}`, auth: false },
  },
  {
    name: 'adamcon',
    targetPort: 3000,
    // Single replica on a RWO volume: replace, don't roll
    strategy: { type: 'Recreate' },
    spec: {
      serviceAccountName: adamconServiceAccount.metadata.name,
      containers: [{
        name: 'adamcon',
        image: 'ghcr.io/domdomegg/adamcon:latest',
        imagePullPolicy: 'Always',
        env: [
          // Next standalone binds to HOSTNAME, which k8s sets to the pod
          // name (= the pod's IPv6 on this cluster) — leaving the IPv4
          // service endpoint refusing connections. Bind both families.
          { name: 'HOSTNAME', value: '::' },
          { name: 'APP_ORIGIN', value: `https://adamcon.${env.BASE_DOMAIN}` },
          { name: 'EMAIL_FROM', value: 'AdamCon <adamcon@adamjones.me>' },
          { name: 'AWS_REGION', value: 'eu-west-1' },
          { name: 'AWS_ROLE_ARN', value: 'arn:aws:iam::338337944728:role/adamcon' },
          { name: 'AWS_WEB_IDENTITY_TOKEN_FILE', value: '/var/run/secrets/aws/token' },
        ],
        volumeMounts: [
          { name: 'adamcon-data-volume', mountPath: '/data' },
          { name: 'aws-token', mountPath: '/var/run/secrets/aws', readOnly: true },
        ],
      }],
      volumes: [
        {
          name: 'adamcon-data-volume',
          persistentVolumeClaim: {
            claimName: adamconDataPvc.metadata.name,
          },
        },
        {
          name: 'aws-token',
          projected: {
            sources: [{
              serviceAccountToken: {
                audience: 'sts.amazonaws.com',
                expirationSeconds: 3600,
                path: 'token',
              },
            }],
          },
        },
      ],
    },
    ingress: { host: `adamcon.${env.BASE_DOMAIN}`, auth: false },
  },
];

interface AppDefinition {
  name: string,
  targetPort?: number,
  spec: core.v1.PodSpec,
  strategy?: appsTypes.v1.DeploymentStrategy,
  ingress?: { host: string, auth: boolean },
}
