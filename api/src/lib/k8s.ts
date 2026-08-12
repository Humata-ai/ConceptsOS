// Kubernetes client. Uses in-cluster config when running as a Pod, falls
// back to the default kubeconfig for local development.
//
// @kubernetes/client-node 0.22.x uses positional args + a { response, body }
// return shape; all helpers below live behind that.

import * as k8s from "@kubernetes/client-node";
import { env } from "./env";

let _kc: k8s.KubeConfig | null = null;

function kubeConfig(): k8s.KubeConfig {
  if (_kc) return _kc;
  const kc = new k8s.KubeConfig();
  try {
    kc.loadFromCluster();
  } catch {
    kc.loadFromDefault();
  }
  _kc = kc;
  return kc;
}

export function core(): k8s.CoreV1Api {
  return kubeConfig().makeApiClient(k8s.CoreV1Api);
}

export function apps(): k8s.AppsV1Api {
  return kubeConfig().makeApiClient(k8s.AppsV1Api);
}

function isNotFound(e: unknown): boolean {
  const any = e as any;
  return any?.code === 404 || any?.response?.statusCode === 404 || any?.statusCode === 404;
}

// A stable, dns-safe pod name derived from the user id.
export function podNameFor(userId: string): string {
  const name = `user-${userId.replace(/[^a-z0-9-]/gi, "").toLowerCase()}`;
  return name.slice(0, 63);
}

export interface EnsureUserPodArgs {
  userId: string;
  wgClientIp: string;
  /** Raw ConceptsOS API key, projected as $CONCEPTSOS_API_KEY into the pod. */
  apiKey: string;
}

export async function ensureUserPod(args: EnsureUserPodArgs): Promise<{
  podName: string;
  namespace: string;
  serviceClusterIp: string | null;
}> {
  const ns = env.k8sUsersNamespace();
  const name = podNameFor(args.userId);

  await ensureNamespace(ns);
  await ensureStatefulSet(ns, name, args.userId, args.wgClientIp, args.apiKey);
  const svcIp = await ensureService(ns, name, args.userId, args.wgClientIp);

  return { podName: name, namespace: ns, serviceClusterIp: svcIp };
}

async function ensureNamespace(ns: string): Promise<void> {
  try {
    await core().readNamespace(ns);
  } catch (e) {
    if (!isNotFound(e)) throw e;
    await core().createNamespace({
      metadata: { name: ns, labels: { "app.kubernetes.io/part-of": "conceptsos" } },
    });
  }
}

async function ensureStatefulSet(
  ns: string,
  name: string,
  userId: string,
  wgClientIp: string,
  apiKey: string,
): Promise<void> {
  const image = env.userPodImage();
  const storage = `${env.userPodStorageGb()}Gi`;

  const body: k8s.V1StatefulSet = {
    metadata: {
      name,
      labels: {
        "app.kubernetes.io/part-of": "conceptsos",
        "conceptsos.io/user-id": userId,
        "conceptsos.io/wg-client-ip": wgClientIp,
      },
    },
    spec: {
      serviceName: name,
      replicas: 1,
      selector: { matchLabels: { "conceptsos.io/user-pod": name } },
      template: {
        metadata: {
          labels: { "conceptsos.io/user-pod": name, "conceptsos.io/user-id": userId },
        },
        spec: {
          containers: [
            {
              name: "vm",
              image,
              imagePullPolicy: "Always",
              env: [
                { name: "CONCEPTSOS_WG", value: "external" },
                { name: "CONCEPTSOS_USER_ID", value: userId },
                { name: "PORT", value: "3000" },
                // The pod talks to Anthropic via our reverse proxy,
                // which injects the org key server-side. The pod
                // itself holds no Anthropic credential — the pi
                // conceptsos-provider extension (baked into the image)
                // rewires the built-in anthropic provider to point here
                // and authenticates with CONCEPTSOS_API_KEY.
                {
                  name: "CONCEPTSOS_BASE_URL",
                  value: "http://conceptsos-api.conceptsos-system.svc.cluster.local/api/llm",
                },
                // The pod's own identity to the LLM proxy. The pi
                // conceptsos-provider extension forwards this as
                // `Authorization: Bearer <key>`.
                { name: "CONCEPTSOS_API_KEY", value: apiKey },
              ],
              ports: [
                // DesktopUI (CRA in dev, or Next.js standalone serving
                // baked DesktopUI + AgentChat in prod). This is the port
                // the readiness probe hits and the primary port the wg
                // gateway forwards to.
                { containerPort: 3000, name: "http" },
                // AgentChat's `next dev` (dev image only). In prod the
                // container never binds this port, but declaring it is
                // harmless — the Service below lists it either way so the
                // wg-gateway can DNAT to <clusterIp>:3050 without
                // Kubernetes filtering the port at the Service layer.
                { containerPort: 3050, name: "agentchat" },
              ],
              readinessProbe: {
                httpGet: { path: "/", port: 3000 as any },
                initialDelaySeconds: 5,
                periodSeconds: 5,
              },
              volumeMounts: [{ name: "data", mountPath: "/data" }],
              resources: {
                requests: { cpu: "50m", memory: "256Mi" },
                limits: { cpu: "1", memory: "1Gi" },
              },
            },
          ],
        },
      },
      volumeClaimTemplates: [
        {
          metadata: { name: "data" },
          spec: {
            accessModes: ["ReadWriteOnce"],
            resources: { requests: { storage } },
          },
        },
      ],
    },
  };

  try {
    const existingRes = await apps().readNamespacedStatefulSet(name, ns);
    const existing = ((existingRes as any).body ?? existingRes) as k8s.V1StatefulSet;
    // Reconcile: make sure the pod's env vars match what we template. Older
    // StatefulSets predate CONCEPTSOS_API_KEY and would otherwise 401 at the
    // LLM proxy forever. We only patch the env list; other fields (image,
    // resources) are left alone until a proper rollout strategy lands.
    const desiredEnv = body.spec!.template.spec!.containers[0].env!;
    const currentEnv = existing.spec?.template?.spec?.containers?.[0]?.env ?? [];
    if (!envListEqual(currentEnv, desiredEnv)) {
      await apps().patchNamespacedStatefulSet(
        name,
        ns,
        { spec: { template: { spec: { containers: [{ name: "vm", env: desiredEnv }] } } } },
        undefined, undefined, undefined, undefined, undefined,
        { headers: { "content-type": "application/strategic-merge-patch+json" } },
      );
    }
  } catch (e) {
    if (!isNotFound(e)) throw e;
    await apps().createNamespacedStatefulSet(ns, body);
  }
}

function envListEqual(a: k8s.V1EnvVar[], b: k8s.V1EnvVar[]): boolean {
  if (a.length !== b.length) return false;
  const key = (e: k8s.V1EnvVar) => `${e.name}=${e.value ?? ""}`;
  const sa = a.map(key).sort();
  const sb = b.map(key).sort();
  return sa.every((v, i) => v === sb[i]);
}

async function ensureService(
  ns: string,
  name: string,
  userId: string,
  wgClientIp: string,
): Promise<string | null> {
  const body: k8s.V1Service = {
    metadata: {
      name,
      labels: {
        "app.kubernetes.io/part-of": "conceptsos",
        "conceptsos.io/user-id": userId,
        "conceptsos.io/wg-client-ip": wgClientIp,
      },
    },
    spec: {
      type: "ClusterIP",
      selector: { "conceptsos.io/user-pod": name },
      // The wg-gateway DNATs to this ClusterIP preserving the original
      // destination port (tailscale-style), so every port a client
      // should be able to reach must be listed here explicitly.
      // Services do not blanket-forward ports even under DNAT.
      ports: [
        { port: 3000, targetPort: 3000 as any, name: "http" },
        { port: 3050, targetPort: 3050 as any, name: "agentchat" },
      ],
    },
  };
  try {
    const existing = await core().readNamespacedService(name, ns);
    // 0.22.x return shape can be `{ response, body }` OR bare V1Service
    // depending on version — handle both defensively.
    const svc = (existing as any).body ?? existing;
    return (svc as k8s.V1Service).spec?.clusterIP ?? null;
  } catch (e) {
    if (!isNotFound(e)) throw e;
    const created = await core().createNamespacedService(ns, body);
    const svc = (created as any).body ?? created;
    return (svc as k8s.V1Service).spec?.clusterIP ?? null;
  }
}

export async function deleteUserPod(userId: string): Promise<void> {
  const ns = env.k8sUsersNamespace();
  const name = podNameFor(userId);
  const swallow404 = async (p: Promise<unknown>) => {
    try { await p; } catch (e) { if (!isNotFound(e)) throw e; }
  };
  await swallow404(apps().deleteNamespacedStatefulSet(name, ns));
  await swallow404(core().deleteNamespacedService(name, ns));
  await swallow404(core().deleteNamespacedPersistentVolumeClaim(`data-${name}-0`, ns));
}

export async function isPodReady(namespace: string, statefulSetName: string): Promise<boolean> {
  const podName = `${statefulSetName}-0`;
  try {
    const res = await core().readNamespacedPod(podName, namespace);
    const pod = ((res as any).body ?? res) as k8s.V1Pod;
    const conds = pod.status?.conditions ?? [];
    return conds.some((c: k8s.V1PodCondition) => c.type === "Ready" && c.status === "True");
  } catch {
    return false;
  }
}
