import * as k8s from '@pulumi/kubernetes';
import {provider} from './provider';
import {haDataPvc, zigbee2mqttDataPvc} from './storage';
import env from '../env/prod';

// Nightly encrypted backup of the HA and Zigbee2MQTT volumes to Google Drive.
// Restore steps are in the README.

const backupSecret = new k8s.core.v1.Secret('backup-secret', {
	metadata: {
		name: 'backup-secret',
	},
	stringData: {
		RCLONE_CONFIG_GDRIVE_TOKEN: env.BACKUP_RCLONE_DRIVE_TOKEN,
		AGE_RECIPIENT: env.BACKUP_AGE_RECIPIENT,
	},
}, {provider});

export const backupScript = `set -euo pipefail

case "\${AGE_RECIPIENT:-}" in age1*) ;; *) echo "AGE_RECIPIENT is not an age public key" >&2; exit 1 ;; esac
case "\${RCLONE_CONFIG_GDRIVE_TOKEN:-}" in *refresh_token*) ;; *) echo "RCLONE_CONFIG_GDRIVE_TOKEN is not set" >&2; exit 1 ;; esac

# age's version is fixed by the image's Alpine release
command -v age >/dev/null || apk add --no-cache age

REMOTE="\${REMOTE:-gdrive:homelab-backups}"
TODAY="\${TODAY:-$(date -u +%F)}"
FILE="homelab-backup-$TODAY.tar.gz.age"
OUT="\${WORK_DIR:-/work}/$FILE"

tar -c -C /volumes \\
	--exclude=ha/backups \\
	--exclude=ha/tts \\
	--exclude=ha/deps \\
	--exclude=ha/.cache \\
	--exclude='ha/home-assistant.log*' \\
	ha zigbee2mqtt \\
	| gzip \\
	| age -r "$AGE_RECIPIENT" > "$OUT"
echo "Archive: $(wc -c < "$OUT") bytes"

for d in daily weekly monthly; do rclone mkdir "$REMOTE/$d"; done
rclone copyto "$OUT" "$REMOTE/daily/$FILE"
# date +%u: 1 = Monday
if [ "$(date -u -d "$TODAY" +%u)" = 1 ]; then rclone copyto "$REMOTE/daily/$FILE" "$REMOTE/weekly/$FILE"; fi
if [ "$(date -u -d "$TODAY" +%d)" = 01 ]; then rclone copyto "$REMOTE/daily/$FILE" "$REMOTE/monthly/$FILE"; fi

# Keep the newest N of each by filename (date). Counting rather than --min-age
# keeps exactly 6 monthlies despite uneven month lengths, and never prunes the
# last good backups if new ones stop arriving.
prune() {
	rclone lsf --files-only --include 'homelab-backup-*' "$REMOTE/$1/" | sort -r | tail -n +$(($2 + 1)) | while read -r f; do
		rclone deletefile "$REMOTE/$1/$f"
	done
}
prune daily 7
prune weekly 4
prune monthly 6
`;

new k8s.batch.v1.CronJob('backup-cronjob', {
	metadata: {
		name: 'backup',
	},
	spec: {
		schedule: '30 3 * * *',
		timeZone: 'Europe/London',
		concurrencyPolicy: 'Forbid',
		startingDeadlineSeconds: 3600,
		successfulJobsHistoryLimit: 1,
		failedJobsHistoryLimit: 2,
		jobTemplate: {
			spec: {
				backoffLimit: 1,
				activeDeadlineSeconds: 1800,
				template: {
					spec: {
						restartPolicy: 'Never',
						automountServiceAccountToken: false,
						containers: [{
							name: 'backup',
							image: 'rclone/rclone:1.75.2@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5',
							command: ['/bin/sh', '-c', backupScript],
							env: [
								{name: 'RCLONE_CONFIG_GDRIVE_TYPE', value: 'drive'},
								{name: 'RCLONE_CONFIG_GDRIVE_SCOPE', value: 'drive.file'},
							],
							envFrom: [{secretRef: {name: backupSecret.metadata.name}}],
							volumeMounts: [
								{name: 'ha-data-volume', mountPath: '/volumes/ha', readOnly: true},
								{name: 'zigbee2mqtt-data-volume', mountPath: '/volumes/zigbee2mqtt', readOnly: true},
								{name: 'work', mountPath: '/work'},
							],
						}],
						volumes: [
							{name: 'ha-data-volume', persistentVolumeClaim: {claimName: haDataPvc.metadata.name, readOnly: true}},
							{name: 'zigbee2mqtt-data-volume', persistentVolumeClaim: {claimName: zigbee2mqttDataPvc.metadata.name, readOnly: true}},
							{name: 'work', emptyDir: {sizeLimit: '1Gi'}},
						],
					},
				},
			},
		},
	},
}, {provider});
