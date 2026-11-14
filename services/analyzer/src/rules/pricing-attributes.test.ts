import { describe, expect, it } from 'vitest';
import {
  ec2PriceListAttributes,
  ec2PriceListTenancy,
  nextSmallerRdsClass,
  rdsPriceListEngine,
} from './pricing-attributes';

describe('pricing attribute mapping', () => {
  it('maps EC2 platforms', () => {
    expect(ec2PriceListAttributes('Linux/UNIX')?.operatingSystem).toBe('Linux');
    expect(ec2PriceListAttributes(null)?.operatingSystem).toBe('Linux');
    expect(ec2PriceListAttributes('Red Hat Enterprise Linux')?.operatingSystem).toBe('RHEL');
    expect(ec2PriceListAttributes('SUSE Linux')?.operatingSystem).toBe('SUSE');
    expect(ec2PriceListAttributes('Windows with SQL Server Enterprise')).toMatchObject({
      operatingSystem: 'Windows',
      preInstalledSw: 'SQL Ent',
    });
    expect(ec2PriceListAttributes('Red Hat BYOL Linux')).toBeNull();
  });
  it('maps tenancy', () => {
    expect(ec2PriceListTenancy('default')).toBe('Shared');
    expect(ec2PriceListTenancy('dedicated')).toBe('Dedicated');
    expect(ec2PriceListTenancy('host')).toBe('Host');
    expect(ec2PriceListTenancy('weird')).toBeNull();
  });
  it('maps RDS engines', () => {
    expect(rdsPriceListEngine('postgres')).toBe('PostgreSQL');
    expect(rdsPriceListEngine('mysql')).toBe('MySQL');
    expect(rdsPriceListEngine('mariadb')).toBe('MariaDB');
    expect(rdsPriceListEngine('aurora-postgresql')).toBeNull();
    expect(rdsPriceListEngine('sqlserver-se')).toBeNull();
  });
  it('finds the next smaller RDS class', () => {
    expect(nextSmallerRdsClass('db.m5.2xlarge')).toBe('db.m5.xlarge');
    expect(nextSmallerRdsClass('db.m5.xlarge')).toBe('db.m5.large');
    expect(nextSmallerRdsClass('db.m5.large')).toBeNull();
    expect(nextSmallerRdsClass('db.t3.small')).toBe('db.t3.micro');
    expect(nextSmallerRdsClass('db.t3.micro')).toBeNull();
    expect(nextSmallerRdsClass('db.r6g.4xlarge')).toBe('db.r6g.2xlarge');
    expect(nextSmallerRdsClass('db.x2g.metal')).toBeNull();
    expect(nextSmallerRdsClass('not-a-class')).toBeNull();
  });
});
