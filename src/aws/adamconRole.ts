import * as aws from '@pulumi/aws';
import {clusterOidcProvider} from './clusterOidcProvider';

const ACCOUNT_ID = '338337944728';

// Permissions boundary that every homelab app role must carry (defined in
// aws-shared-infra). homelab-ci is only allowed to create/manage app roles that
// have it attached, so it can't escalate them beyond the SES-send ceiling.
const APP_ROLE_BOUNDARY_ARN = `arn:aws:iam::${ACCOUNT_ID}:policy/homelab-app-role-boundary`;

// The AWS role the adamcon app assumes (via the cluster OIDC provider) to send
// email through SES. Named homelab-app-* so aws-shared-infra's homelab-ci grant
// (scoped to role/homelab-app-*) can manage it. The k8s app / service account
// stays named 'adamcon', so the trust sub is unchanged.
export const adamconRole = new aws.iam.Role('adamcon', {
	name: 'homelab-app-adamcon',
	description: 'SES-send role for the adamcon app; assumed via the k3s cluster OIDC provider.',
	permissionsBoundary: APP_ROLE_BOUNDARY_ARN,
	assumeRolePolicy: clusterOidcProvider.arn.apply((providerArn) => JSON.stringify({
		Version: '2012-10-17',
		Statement: [{
			Effect: 'Allow',
			Principal: {Federated: providerArn},
			Action: 'sts:AssumeRoleWithWebIdentity',
			Condition: {
				StringEquals: {
					'k8s-oidc.home.adamjones.me:aud': 'sts.amazonaws.com',
					'k8s-oidc.home.adamjones.me:sub': 'system:serviceaccount:default:adamcon',
				},
			},
		}],
	})),
});

new aws.iam.RolePolicy('adamcon-ses-send', {
	name: 'adamcon-ses-send',
	role: adamconRole.name,
	policy: JSON.stringify({
		Version: '2012-10-17',
		Statement: [{
			Sid: 'AdamconSesSend',
			Effect: 'Allow',
			Action: ['ses:SendEmail', 'ses:SendRawEmail'],
			Resource: `arn:aws:ses:eu-west-1:${ACCOUNT_ID}:identity/adamjones.me`,
		}],
	}),
});
