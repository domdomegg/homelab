import * as aws from '@pulumi/aws';

// The k3s cluster's OIDC issuer, so AWS can federate against cluster
// service-account tokens (the adamcon app assumes an SES-send role via it).
// Lives here — next to the cluster and the app that use it — rather than in the
// account-level aws-shared-infra repo.
//
// IMPORTED (created out-of-band, then moved out of aws-shared-infra's state):
//   pulumi import aws:iam/openIdConnectProvider:OpenIdConnectProvider cluster-oidc \
//     arn:aws:iam::338337944728:oidc-provider/k8s-oidc.home.adamjones.me
//
// Fields must match AWS exactly. The AWS provider's validator wants a scheme on
// `url` but the stored value has none; 'https://…' both validates and matches
// the import (Pulumi normalizes), so it does NOT trigger a replacement.
export const clusterOidcProvider = new aws.iam.OpenIdConnectProvider('cluster-oidc', {
	url: 'https://k8s-oidc.home.adamjones.me',
	clientIdLists: ['sts.amazonaws.com'],
	thumbprintLists: ['ab9d0263244dd0326eb67015705a667e79cfe998'],
});
