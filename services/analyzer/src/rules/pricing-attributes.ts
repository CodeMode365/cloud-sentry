/**
 * Maps AWS API attribute values to AWS Price List attribute values. Detection rules use these to build
 * SavingsRequests. Unsupported combinations return null so savings are reported as unavailable rather
 * than priced with a guess.
 */

export interface Ec2PriceListAttributes {
  operatingSystem: string;
  preInstalledSw: string;
  licenseModel: string;
}

const NO_LICENSE = 'No License required';

/** Maps EC2 `PlatformDetails` to Price List attributes. */
export function ec2PriceListAttributes(platformDetails: string | null): Ec2PriceListAttributes | null {
  const p = (platformDetails ?? 'Linux/UNIX').trim();
  switch (p) {
    case 'Linux/UNIX':
      return { operatingSystem: 'Linux', preInstalledSw: 'NA', licenseModel: NO_LICENSE };
    case 'Windows':
      return { operatingSystem: 'Windows', preInstalledSw: 'NA', licenseModel: NO_LICENSE };
    case 'Red Hat Enterprise Linux':
      return { operatingSystem: 'RHEL', preInstalledSw: 'NA', licenseModel: NO_LICENSE };
    case 'SUSE Linux':
      return { operatingSystem: 'SUSE', preInstalledSw: 'NA', licenseModel: NO_LICENSE };
    case 'Windows with SQL Server Standard':
      return { operatingSystem: 'Windows', preInstalledSw: 'SQL Std', licenseModel: NO_LICENSE };
    case 'Windows with SQL Server Web':
      return { operatingSystem: 'Windows', preInstalledSw: 'SQL Web', licenseModel: NO_LICENSE };
    case 'Windows with SQL Server Enterprise':
      return { operatingSystem: 'Windows', preInstalledSw: 'SQL Ent', licenseModel: NO_LICENSE };
    default:
      return null;
  }
}

/** Maps EC2 `Placement.Tenancy` to the Price List `tenancy` attribute. */
export function ec2PriceListTenancy(tenancy: string | null | undefined): string | null {
  switch ((tenancy ?? 'default').toLowerCase()) {
    case 'default':
      return 'Shared';
    case 'dedicated':
      return 'Dedicated';
    case 'host':
      return 'Host';
    default:
      return null;
  }
}

/** Maps an RDS `Engine` value to the Price List `databaseEngine` attribute (open-source engines only). */
export function rdsPriceListEngine(engine: string): string | null {
  switch (engine.toLowerCase()) {
    case 'postgres':
      return 'PostgreSQL';
    case 'mysql':
      return 'MySQL';
    case 'mariadb':
      return 'MariaDB';
    default:
      return null;
  }
}

/** Size ladder shared by RDS instance classes and ElastiCache node types. */
export const INSTANCE_SIZE_ORDER = [
  'micro',
  'small',
  'medium',
  'large',
  'xlarge',
  '2xlarge',
  '4xlarge',
  '8xlarge',
  '12xlarge',
  '16xlarge',
  '24xlarge',
] as const;

/**
 * Next smaller size of `<prefix>.<family>.<size>` within the same family. Burstable families (`<prefix>.t*`)
 * go down to micro; other families stop at large (their smallest size). Returns null when there is no
 * smaller size or the size is not in the known ordering. The pricing engine confirms the target exists.
 */
function nextSmallerInFamily(prefix: string, type: string): string | null {
  const m = new RegExp(`^(${prefix}\\.[a-z0-9-]+)\\.([a-z0-9]+)$`).exec(type);
  if (!m) return null;
  const family = m[1] as string;
  const size = m[2] as string;
  const idx = (INSTANCE_SIZE_ORDER as readonly string[]).indexOf(size);
  if (idx <= 0) return null;
  const minIdx = new RegExp(`^${prefix}\\.t\\d`).test(family) ? 0 : INSTANCE_SIZE_ORDER.indexOf('large');
  if (idx - 1 < minIdx) return null;
  return `${family}.${INSTANCE_SIZE_ORDER[idx - 1]}`;
}

/** Next smaller instance class within the same family, e.g. db.m5.2xlarge -> db.m5.xlarge. */
export function nextSmallerRdsClass(instanceClass: string): string | null {
  return nextSmallerInFamily('db', instanceClass);
}

/** Next smaller ElastiCache node type within the same family, e.g. cache.r6g.xlarge -> cache.r6g.large. */
export function nextSmallerCacheNodeType(cacheNodeType: string): string | null {
  return nextSmallerInFamily('cache', cacheNodeType);
}

/** Maps an ElastiCache `Engine` value to the Price List `cacheEngine` attribute. */
export function elastiCachePriceListEngine(engine: string): string | null {
  switch (engine.toLowerCase()) {
    case 'redis':
      return 'Redis';
    case 'valkey':
      return 'Valkey';
    case 'memcached':
      return 'Memcached';
    default:
      return null;
  }
}

/** Price List operatingSystem for an EKS managed node group AMI type. */
export function eksNodeOperatingSystem(amiType: string | null): string {
  return (amiType ?? '').toUpperCase().startsWith('WINDOWS') ? 'Windows' : 'Linux';
}

/** Legacy runtimes that match the arm64 families below but were never offered on arm64. */
const X86_ONLY_RUNTIMES = new Set([
  'nodejs',
  'nodejs4.3',
  'nodejs4.3-edge',
  'nodejs6.10',
  'nodejs8.10',
  'nodejs10.x',
  'python3.6',
  'python3.7',
  'java8',
  'ruby2.5',
  'dotnetcore1.0',
  'dotnetcore2.0',
  'dotnetcore2.1',
]);

/** True when a Lambda managed runtime is available on arm64 (Graviton). */
export function lambdaRuntimeSupportsArm64(runtime: string | null): boolean {
  if (!runtime) return false;
  const r = runtime.toLowerCase();
  if (X86_ONLY_RUNTIMES.has(r)) return false;
  return /^(nodejs|python3\.|java|dotnet|ruby|provided\.al2)/.test(r);
}
