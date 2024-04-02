import * as k8s from '@pulumi/kubernetes';

// This results in using the default provider set by the KUBECONFIG
// environment variable or configured in ~/.kube/config
// We bother specifying this manually so it's easy to switch out if required
export const provider = new k8s.Provider('k8s-provider');
