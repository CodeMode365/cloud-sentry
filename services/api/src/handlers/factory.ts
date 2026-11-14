import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { apiServices } from '../composition';
import { fromApiGateway, toApiGateway } from '../http/apigw';
import { Router, toErrorResponse } from '../http/router';
import { ROUTE_GROUPS, type RouteGroup } from '../routes';
import { createLogger, newId } from '@cloudsentry/utilities';

/** One Lambda per API domain: each function only contains (and is granted IAM for) its own routes. */
export function createApiHandler(group: RouteGroup) {
  const router = new Router(ROUTE_GROUPS[group](apiServices));
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const services = apiServices();
      const res = await router.handle(fromApiGateway(event), {
        logger: services.logger.child({ function: `api-${group}` }),
        authenticate: (header) => services.auth.authenticate(header),
      });
      return toApiGateway(res);
    } catch (error) {
      // Composition/config failures (cold start) still return a well-formed error envelope.
      const requestId = event.requestContext?.requestId ?? newId.request();
      return toApiGateway(toErrorResponse(error, requestId, createLogger({ service: 'cloudsentry-api' })));
    }
  };
}
