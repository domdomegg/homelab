import * as k8s from '@pulumi/kubernetes';
import {provider} from './provider';

// RBAC for GitHub-Actions-federated CI. The apiserver is configured (via
// /etc/rancher/k3s/github-oidc-auth.yaml) to trust GitHub OIDC tokens with
// audience 'homelab-k8s' whose sub is exactly this repo's master ref, mapping
// them to the username below (prefix 'github:' + the sub claim).
//
// This replaces the long-lived cluster-admin kubeconfig (the k3s.yaml that used
// to live in the KUBECONFIG GitHub secret): CI now presents a short-lived,
// repo+branch-scoped OIDC token instead of a stealable standing admin cert.
//
// Bound to cluster-admin because Pulumi manages helm releases, CRDs, namespaces
// and cluster-scoped resources — the same scope the admin cert had. The gain is
// the credential's nature (short-lived, revocable by deleting this binding),
// not a narrower grant.
const CI_USERNAME = 'github:repo:domdomegg/homelab:ref:refs/heads/master';

new k8s.rbac.v1.ClusterRoleBinding('github-ci-admin', {
	metadata: {name: 'github-ci-admin'},
	roleRef: {
		apiGroup: 'rbac.authorization.k8s.io',
		kind: 'ClusterRole',
		name: 'cluster-admin',
	},
	subjects: [{
		apiGroup: 'rbac.authorization.k8s.io',
		kind: 'User',
		name: CI_USERNAME,
	}],
}, {provider});
