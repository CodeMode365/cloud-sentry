import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  LambdaClient,
  ListFunctionsCommand,
  ListProvisionedConcurrencyConfigsCommand,
} from '@aws-sdk/client-lambda';
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';
import {
  fixtureApiProvisionedConcurrencyPage1,
  fixtureApiProvisionedConcurrencyPage2,
  lambdaFunctionsPage1,
  lambdaFunctionsPage2,
} from '../__fixtures__/lambda';
import { lambdaTagsPage1, lambdaTagsPage2 } from '../__fixtures__/tagging';
import { discoverLambdaFunctions, qualifierFromArn } from './lambda-functions';
import { awsError, captureLogger, warnings } from './test-helpers';

const lambdaMock = mockClient(LambdaClient);
const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);
const lambda = () => new LambdaClient({ region: 'us-east-1' });
const tagging = () => new ResourceGroupsTaggingAPIClient({ region: 'us-east-1' });

beforeEach(() => {
  lambdaMock.reset();
  taggingMock.reset();
});

describe('qualifierFromArn', () => {
  it('extracts alias or version qualifiers and ignores unqualified ARNs', () => {
    expect(qualifierFromArn('arn:aws:lambda:us-east-1:111122223333:function:f:live')).toBe('live');
    expect(qualifierFromArn('arn:aws:lambda:us-east-1:111122223333:function:f:7')).toBe('7');
    expect(qualifierFromArn('arn:aws:lambda:us-east-1:111122223333:function:f')).toBeNull();
    expect(qualifierFromArn(undefined)).toBeNull();
  });
});

describe('discoverLambdaFunctions', () => {
  it('paginates functions and PC configs, maps fields and tags, and degrades a failed PC listing', async () => {
    lambdaMock.on(ListFunctionsCommand).resolvesOnce(lambdaFunctionsPage1).resolvesOnce(lambdaFunctionsPage2);
    lambdaMock.on(ListProvisionedConcurrencyConfigsCommand).resolves({ ProvisionedConcurrencyConfigs: [] });
    lambdaMock
      .on(ListProvisionedConcurrencyConfigsCommand, { FunctionName: 'fixture-api' })
      .resolvesOnce(fixtureApiProvisionedConcurrencyPage1)
      .resolvesOnce(fixtureApiProvisionedConcurrencyPage2);
    lambdaMock
      .on(ListProvisionedConcurrencyConfigsCommand, { FunctionName: 'fixture-worker' })
      .rejects(awsError('ServiceException'));
    taggingMock.on(GetResourcesCommand).resolvesOnce(lambdaTagsPage1).resolvesOnce(lambdaTagsPage2);
    const { logger, lines } = captureLogger();

    const result = await discoverLambdaFunctions(lambda(), tagging(), {
      accountId: '111122223333',
      region: 'us-east-1',
      logger,
    });

    expect(lambdaMock.commandCalls(ListFunctionsCommand)[1]?.args[0].input.Marker).toBe('page-2');
    expect(lambdaMock.commandCalls(ListFunctionsCommand)[0]?.args[0].input.FunctionVersion).toBeUndefined();
    const apiPcCalls = lambdaMock
      .commandCalls(ListProvisionedConcurrencyConfigsCommand)
      .filter((c) => c.args[0].input.FunctionName === 'fixture-api');
    expect(apiPcCalls).toHaveLength(2);
    expect(apiPcCalls[1]?.args[0].input.Marker).toBe('pc-2');
    expect(taggingMock.commandCalls(GetResourcesCommand)[0]?.args[0].input.ResourceTypeFilters).toEqual([
      'lambda:function',
    ]);

    expect(result.map((r) => r.name)).toEqual(['fixture-api', 'fixture-image', 'fixture-worker']);
    const [api, image, worker] = result;
    expect(api).toEqual({
      resourceType: 'LAMBDA_FUNCTION',
      accountId: '111122223333',
      region: 'us-east-1',
      resourceId: 'arn:aws:lambda:us-east-1:111122223333:function:fixture-api',
      arn: 'arn:aws:lambda:us-east-1:111122223333:function:fixture-api',
      name: 'fixture-api',
      state: 'Active',
      tags: { team: 'payments', 'cloudsentry:ignore': 'false' },
      createdAt: null,
      attributes: {
        functionName: 'fixture-api',
        runtime: 'nodejs20.x',
        architecture: 'x86_64',
        memoryMb: 1024,
        timeoutSeconds: 30,
        packageType: 'Zip',
        ephemeralStorageMb: 512,
        lastModified: '2026-09-01T10:00:00.000Z',
        provisionedConcurrency: [
          { qualifier: '7', allocated: 0, requested: 5, status: 'IN_PROGRESS' },
          { qualifier: 'live', allocated: 10, requested: 10, status: 'READY' },
        ],
      },
    });
    expect(image).toMatchObject({
      state: 'Active',
      tags: {},
      attributes: {
        runtime: null,
        architecture: 'arm64',
        packageType: 'Image',
        ephemeralStorageMb: null,
        lastModified: null,
        provisionedConcurrency: [],
      },
    });
    expect(worker).toMatchObject({
      state: 'Inactive',
      tags: { team: 'data' },
      attributes: { memoryMb: 128, timeoutSeconds: 3, architecture: 'x86_64', provisionedConcurrency: [] },
    });
    expect(warnings(lines)).toHaveLength(1);
    expect(warnings(lines)[0]).toMatchObject({
      functionName: 'fixture-worker',
      awsError: 'ServiceException',
    });
  });

  it('still returns functions with empty tags when the Tagging API fails', async () => {
    lambdaMock.on(ListFunctionsCommand).resolves(lambdaFunctionsPage2);
    lambdaMock.on(ListProvisionedConcurrencyConfigsCommand).resolves({});
    taggingMock.on(GetResourcesCommand).rejects(awsError('AccessDeniedException'));
    const result = await discoverLambdaFunctions(lambda(), tagging(), {
      accountId: '111122223333',
      region: 'us-east-1',
      logger: captureLogger().logger,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.tags).toEqual({});
  });

  it('fails the region when ListFunctions itself fails', async () => {
    lambdaMock.on(ListFunctionsCommand).rejects(awsError('AccessDeniedException'));
    taggingMock.on(GetResourcesCommand).resolves({});
    await expect(
      discoverLambdaFunctions(lambda(), tagging(), { accountId: '111122223333', region: 'us-east-1' }),
    ).rejects.toMatchObject({ name: 'AccessDeniedException' });
  });
});
