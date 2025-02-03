import * as k8s from '@pulumi/kubernetes';
import { provider } from './provider';
import {
  haConfigmap, haDataPvc, zigbee2mqttConfigmap, zigbee2mqttDataPvc,
} from './storage';

new k8s.batch.v1.Job('ha-init-job', {
  metadata: {
    name: 'ha-init-job',
  },
  spec: {
    template: {
      spec: {
        containers: [{
          name: 'ubuntu',
          image: 'ubuntu',
          command: ['/bin/sh', '-c'],
          args: [`
# Wait for HA initialisation
# This is so HA runs its _write_default_config method (otherwise other config files aren't set up properly)
while [ ! -e "/config/configuration.yaml" ]; do sleep 1; done

# Copy our custom configuration over
cp "/configmap/configuration.yaml" "/config/configuration.yaml"

# Install HACS
if [ ! -d "/config/custom_components/hacs" ]; then
  apt update && apt install -y wget unzip
  wget -O - https://get.hacs.xyz | bash -
fi

# TODO: trigger a restart of Home Assistant if we've updated the config or installed HACS
`],
          volumeMounts: [
            {
              name: 'ha-data-volume',
              mountPath: '/config',
            },
            {
              name: 'ha-configmap-volume',
              mountPath: '/configmap/configuration.yaml',
              subPath: 'configuration.yaml',
            },
          ],
        }],
        volumes: [{
          name: 'ha-data-volume',
          persistentVolumeClaim: {
            claimName: haDataPvc.metadata.name,
          },
        },
        {
          name: 'ha-configmap-volume',
          configMap: {
            name: haConfigmap.metadata.name,
          },
        }],
        restartPolicy: 'OnFailure',
      },
    },
    ttlSecondsAfterFinished: 0,
  },
}, { provider, deleteBeforeReplace: true });

new k8s.batch.v1.Job('zigbee2mqtt-init-job', {
  metadata: {
    name: 'zigbee2mqtt-init-job',
  },
  spec: {
    template: {
      spec: {
        containers: [{
          name: 'ubuntu',
          image: 'ubuntu',
          command: ['/bin/sh', '-c'],
          args: [`
# Copy our custom configuration over
cp "/configmap/configuration.yaml" "/config/configuration.yaml"
`],
          volumeMounts: [
            {
              name: 'zigbee2mqtt-data-volume',
              mountPath: '/config',
            },
            {
              name: 'zigbee2mqtt-configmap-volume',
              mountPath: '/configmap/configuration.yaml',
              subPath: 'configuration.yaml',
            },
          ],
        }],
        volumes: [{
          name: 'zigbee2mqtt-data-volume',
          persistentVolumeClaim: {
            claimName: zigbee2mqttDataPvc.metadata.name,
          },
        },
        {
          name: 'zigbee2mqtt-configmap-volume',
          configMap: {
            name: zigbee2mqttConfigmap.metadata.name,
          },
        }],
        restartPolicy: 'OnFailure',
      },
    },
    ttlSecondsAfterFinished: 0,
  },
}, { provider, deleteBeforeReplace: true });
