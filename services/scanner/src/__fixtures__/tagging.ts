/** SYNTHETIC TEST FIXTURE: SDK-shaped Resource Groups Tagging API GetResources pages. Not real AWS data. */
import type { GetResourcesCommandOutput } from '@aws-sdk/client-resource-groups-tagging-api';

export const lambdaTagsPage1: Partial<GetResourcesCommandOutput> = {
  PaginationToken: 'tags-2',
  ResourceTagMappingList: [
    {
      ResourceARN: 'arn:aws:lambda:us-east-1:111122223333:function:fixture-api',
      Tags: [
        { Key: 'team', Value: 'payments' },
        { Key: 'cloudsentry:ignore', Value: 'false' },
      ],
    },
  ],
};

export const lambdaTagsPage2: Partial<GetResourcesCommandOutput> = {
  PaginationToken: '',
  ResourceTagMappingList: [
    {
      ResourceARN: 'arn:aws:lambda:us-east-1:111122223333:function:fixture-worker',
      Tags: [{ Key: 'team', Value: 'data' }],
    },
    { Tags: [{ Key: 'orphan', Value: 'no-arn' }] },
  ],
};
