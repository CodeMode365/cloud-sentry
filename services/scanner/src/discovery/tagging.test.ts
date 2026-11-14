import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { lambdaTagsPage1, lambdaTagsPage2 } from '../__fixtures__/tagging';
import { fetchTagsByArn } from './tagging';
import { awsError, captureLogger, warnings } from './test-helpers';

const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);
const client = () => new ResourceGroupsTaggingAPIClient({ region: 'us-east-1' });

beforeEach(() => taggingMock.reset());

describe('fetchTagsByArn', () => {
  it('follows PaginationToken, passes the type filters and maps ARN -> tags', async () => {
    taggingMock.on(GetResourcesCommand).resolvesOnce(lambdaTagsPage1).resolvesOnce(lambdaTagsPage2);
    const tags = await fetchTagsByArn(client(), ['lambda:function']);

    const calls = taggingMock.commandCalls(GetResourcesCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args[0].input).toMatchObject({
      ResourceTypeFilters: ['lambda:function'],
      ResourcesPerPage: 100,
    });
    expect(calls[1]?.args[0].input.PaginationToken).toBe('tags-2');
    expect([...tags.keys()]).toEqual([
      'arn:aws:lambda:us-east-1:111122223333:function:fixture-api',
      'arn:aws:lambda:us-east-1:111122223333:function:fixture-worker',
    ]);
    expect(tags.get('arn:aws:lambda:us-east-1:111122223333:function:fixture-api')).toEqual({
      team: 'payments',
      'cloudsentry:ignore': 'false',
    });
  });

  it('returns an empty map and logs a warning instead of throwing', async () => {
    taggingMock
      .on(GetResourcesCommand)
      .resolvesOnce(lambdaTagsPage1)
      .rejectsOnce(awsError('AccessDeniedException', 'not authorized to perform tag:GetResources'));
    const { logger, lines } = captureLogger();
    const tags = await fetchTagsByArn(client(), ['dynamodb:table'], logger);

    expect(tags.size).toBe(0);
    expect(warnings(lines)).toHaveLength(1);
    expect(warnings(lines)[0]).toMatchObject({
      awsError: 'AccessDeniedException',
      resourceTypeFilters: ['dynamodb:table'],
    });
  });
});
