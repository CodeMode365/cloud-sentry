'use client';

import { Download, ShieldCheck } from 'lucide-react';
import type { AccountOnboardingInstructions } from '@cloudsentry/shared-types';
import { CodeBlock, CopyButton } from '@/components/common/copy-button';
import { KeyValue } from '@/components/common/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { downloadTextFile } from '@/lib/utils';

export function OnboardingInstructions({ onboarding }: { onboarding: AccountOnboardingInstructions }) {
  return (
    <div className="space-y-5">
      <Alert variant="info">
        <ShieldCheck />
        <AlertTitle>Read-only access</AlertTitle>
        <AlertDescription>
          The role grants only Describe/List/Get permissions for EC2, EBS, RDS, ELB, Lambda, EKS, ElastiCache,
          CloudFront, EFS, DynamoDB, Redshift, AWS Backup, resource tags, CloudWatch metrics and Cost
          Explorer. CloudSentry never asks for access keys and cannot modify resources. Access requires the
          external ID below.
        </AlertDescription>
      </Alert>

      <dl className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
        <KeyValue label="External ID">
          <span className="flex items-center gap-2">
            <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">{onboarding.externalId}</code>
            <CopyButton value={onboarding.externalId} iconOnly label="Copy external ID" />
          </span>
        </KeyValue>
        <KeyValue label="Role to create">
          <span className="flex items-center gap-2">
            <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">{onboarding.roleName}</code>
          </span>
        </KeyValue>
        <KeyValue label="Expected role ARN" className="sm:col-span-2">
          <span className="flex items-center gap-2">
            <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">{onboarding.roleArn}</code>
            <CopyButton value={onboarding.roleArn} iconOnly label="Copy role ARN" />
          </span>
        </KeyValue>
        <KeyValue label="Trusted CloudSentry principal" className="sm:col-span-2">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{onboarding.trustedPrincipalArn}</code>
        </KeyValue>
      </dl>

      <Tabs defaultValue="cloudformation">
        <TabsList>
          <TabsTrigger value="cloudformation">CloudFormation</TabsTrigger>
          <TabsTrigger value="cli">AWS CLI</TabsTrigger>
          <TabsTrigger value="manual">Manual IAM</TabsTrigger>
        </TabsList>
        <TabsContent value="cloudformation" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Deploy this template in the AWS account you are connecting (any region; IAM is global). It creates
            the read-only role with the external ID condition.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadTextFile(
                'cloudsentry-readonly-role.yaml',
                onboarding.cloudFormationTemplate,
                'application/x-yaml',
              )
            }
          >
            <Download /> Download template (.yaml)
          </Button>
          <CodeBlock code={onboarding.cloudFormationTemplate} label="CloudFormation template" />
        </TabsContent>
        <TabsContent value="cli" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Save the template as <code className="text-xs">cloudsentry-readonly-role.yaml</code>, then run
            this with credentials for the target account.
          </p>
          <CodeBlock code={onboarding.cliCommand} label="AWS CLI command" maxHeight="max-h-40" />
        </TabsContent>
        <TabsContent value="manual" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Create a role named <code className="text-xs">{onboarding.roleName}</code> with this trust policy
            and an inline permissions policy.
          </p>
          <CodeBlock code={JSON.stringify(onboarding.trustPolicy, null, 2)} label="Trust policy" />
          <CodeBlock
            code={JSON.stringify(onboarding.permissionsPolicy, null, 2)}
            label="Permissions policy"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
