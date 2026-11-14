import { z } from 'zod';

export const AWS_ACCOUNT_ID_PATTERN = /^\d{12}$/;
/** Commercial, GovCloud and China region names, e.g. us-east-1, eu-central-2, us-gov-west-1, ap-southeast-7. */
export const AWS_REGION_PATTERN = /^[a-z]{2}(-gov|-iso[a-z]?)?-[a-z]+-\d{1,2}$/;
/**
 * Customer role names must start with "CloudSentry" so the platform's own IAM policy can restrict
 * sts:AssumeRole to arn:aws:iam::*:role/CloudSentry* (least privilege on the CloudSentry side).
 */
export const CUSTOMER_ROLE_NAME_PATTERN = /^CloudSentry[\w+=,.@-]{0,52}$/;
export const ROLE_ARN_PATTERN = /^arn:aws:iam::(\d{12}):role\/((?:[\w+=,.@-]+\/)*)([\w+=,.@-]{1,64})$/;

export const awsAccountIdSchema = z
  .string()
  .trim()
  .regex(AWS_ACCOUNT_ID_PATTERN, 'AWS account ID must be exactly 12 digits');

export const awsRegionSchema = z.string().trim().regex(AWS_REGION_PATTERN, 'Invalid AWS region name');

export const roleNameSchema = z
  .string()
  .trim()
  .regex(
    CUSTOMER_ROLE_NAME_PATTERN,
    'Role name must start with "CloudSentry" and use only IAM role-name characters',
  );

export interface ParsedRoleArn {
  accountId: string;
  path: string;
  roleName: string;
}

export function parseRoleArn(arn: string): ParsedRoleArn | null {
  const m = ROLE_ARN_PATTERN.exec(arn.trim());
  if (!m) return null;
  return { accountId: m[1] as string, path: `/${m[2] ?? ''}`, roleName: m[3] as string };
}

export const roleArnSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (v) => parseRoleArn(v) !== null,
    'Invalid IAM role ARN (expected arn:aws:iam::<account-id>:role/<name>)',
  )
  .refine(
    (v) => CUSTOMER_ROLE_NAME_PATTERN.test(parseRoleArn(v)?.roleName ?? ''),
    'Role name must start with "CloudSentry"',
  );

/** Validates that a role ARN belongs to the expected AWS account (account ID verification). */
export function roleArnMatchesAccount(roleArn: string, accountId: string): boolean {
  return parseRoleArn(roleArn)?.accountId === accountId;
}

export const DEFAULT_REGIONS = ['us-east-1'];

/** Regions offered in the UI. Validation accepts any well-formed region; enabled regions are verified via AWS. */
export const COMMON_AWS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'sa-east-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-1',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-east-1',
  'me-south-1',
  'af-south-1',
] as const;
