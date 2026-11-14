/**
 * Prints the customer read-only role CloudFormation template.
 * Usage: npx tsx scripts/print-customer-template.ts [--trusted-account 123456789012] [--external-id cs-...]
 * The CloudSentry API generates the same template per account (with the external ID filled in);
 * this script exists for documentation and review.
 */
import { customerRoleTemplate } from '../policies/customer-role';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const template = customerRoleTemplate({
  trustedAccountId: arg('--trusted-account'),
  externalId: arg('--external-id'),
});
process.stdout.write(`${JSON.stringify(template, null, 2)}\n`);
