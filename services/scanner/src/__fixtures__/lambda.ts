/** SYNTHETIC TEST FIXTURE: SDK-shaped ListFunctions / ListProvisionedConcurrencyConfigs pages. Not real AWS data. */
import type {
  ListFunctionsCommandOutput,
  ListProvisionedConcurrencyConfigsCommandOutput,
} from '@aws-sdk/client-lambda';

const fnArn = (name: string) => `arn:aws:lambda:us-east-1:111122223333:function:${name}`;

export const lambdaFunctionsPage1: Partial<ListFunctionsCommandOutput> = {
  NextMarker: 'page-2',
  Functions: [
    {
      FunctionName: 'fixture-api',
      FunctionArn: fnArn('fixture-api'),
      Runtime: 'nodejs20.x',
      Architectures: ['x86_64'],
      MemorySize: 1024,
      Timeout: 30,
      PackageType: 'Zip',
      EphemeralStorage: { Size: 512 },
      LastModified: '2026-09-01T10:00:00.000+0000',
      State: 'Active',
    },
    {
      FunctionName: 'fixture-image',
      FunctionArn: fnArn('fixture-image'),
      Architectures: ['arm64'],
      MemorySize: 2048,
      Timeout: 900,
      PackageType: 'Image',
    },
  ],
};

export const lambdaFunctionsPage2: Partial<ListFunctionsCommandOutput> = {
  Functions: [
    {
      FunctionName: 'fixture-worker',
      FunctionArn: fnArn('fixture-worker'),
      Runtime: 'python3.12',
      State: 'Inactive',
    },
  ],
};

export const fixtureApiProvisionedConcurrencyPage1: Partial<ListProvisionedConcurrencyConfigsCommandOutput> = {
  NextMarker: 'pc-2',
  ProvisionedConcurrencyConfigs: [
    {
      FunctionArn: `${fnArn('fixture-api')}:live`,
      AllocatedProvisionedConcurrentExecutions: 10,
      AvailableProvisionedConcurrentExecutions: 10,
      RequestedProvisionedConcurrentExecutions: 10,
      Status: 'READY',
    },
  ],
};

export const fixtureApiProvisionedConcurrencyPage2: Partial<ListProvisionedConcurrencyConfigsCommandOutput> = {
  ProvisionedConcurrencyConfigs: [
    {
      FunctionArn: `${fnArn('fixture-api')}:7`,
      AllocatedProvisionedConcurrentExecutions: 0,
      RequestedProvisionedConcurrentExecutions: 5,
      Status: 'IN_PROGRESS',
    },
  ],
};
