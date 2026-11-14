import {
  paginateGetResources,
  type ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { awsErrorName, errorMessage, type Logger } from '@cloudsentry/utilities';
import { defaultDiscoveryLogger, tagsToRecord } from './common';

/**
 * Batch tag lookup through the Resource Groups Tagging API for services whose list APIs omit tags
 * (Lambda, ElastiCache, DynamoDB). One paginated GetResources call per region and filter set.
 *
 * Tags are best effort: any failure returns an empty map and logs a warning, so discovery continues
 * with `tags: {}` instead of failing the region.
 */
export async function fetchTagsByArn(
  client: ResourceGroupsTaggingAPIClient,
  resourceTypeFilters: string[],
  logger: Logger = defaultDiscoveryLogger,
): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  try {
    for await (const page of paginateGetResources(
      { client, pageSize: 100 },
      { ResourceTypeFilters: resourceTypeFilters },
    )) {
      for (const mapping of page.ResourceTagMappingList ?? []) {
        if (mapping.ResourceARN) out.set(mapping.ResourceARN, tagsToRecord(mapping.Tags));
      }
    }
    return out;
  } catch (error) {
    logger.warn('Tag lookup failed; continuing without tags', {
      resourceTypeFilters,
      awsError: awsErrorName(error),
      message: errorMessage(error),
    });
    return new Map();
  }
}
