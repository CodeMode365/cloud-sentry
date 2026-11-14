import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { handlersPresent, synth } from './helpers';

describe.skipIf(!handlersPresent)('AuthStack', () => {
  it('enforces the password policy and email sign-in', () => {
    synth().templates.auth.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: {
        PasswordPolicy: {
          MinimumLength: 12,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
      UsernameAttributes: ['email'],
      AutoVerifiedAttributes: ['email'],
    });
  });

  it('uses a confidential client with USER_PASSWORD_AUTH, token revocation, and no OAuth', () => {
    synth().templates.auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: true,
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']),
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
      AllowedOAuthFlowsUserPoolClient: false,
    });
  });
});

describe.skipIf(!handlersPresent)('ApiStack', () => {
  it('protects every non-auth route with the Cognito JWT authorizer', () => {
    const t = synth().templates.api;
    const routes = Object.values(t.findResources('AWS::ApiGatewayV2::Route')) as {
      Properties: { RouteKey: string; AuthorizationType?: string };
    }[];
    expect(routes.length).toBeGreaterThan(15);
    for (const r of routes) {
      if (r.Properties.RouteKey.includes('/api/v1/auth/')) {
        expect(r.Properties.AuthorizationType ?? 'NONE').toBe('NONE');
      } else {
        expect(r.Properties.AuthorizationType, r.Properties.RouteKey).toBe('JWT');
      }
    }
    t.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
    });
  });

  it('routes manual scan starts to the scans domain and throttles the stage', () => {
    const t = synth().templates.api;
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /api/v1/accounts/{accountId}/scans',
    });
    t.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
      AccessLogSettings: Match.objectLike({ Format: Match.stringLikeRegexp('requestId') }),
    });
  });
});

describe.skipIf(!handlersPresent)('WebStack', () => {
  it('serves the API on the same origin with caching disabled', () => {
    synth().templates.web.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: '/api/*',
            CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
            OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
            ViewerProtocolPolicy: 'https-only',
          }),
        ],
      }),
    });
  });

  it('sends security headers', () => {
    synth().templates.web.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          FrameOptions: { FrameOption: 'DENY', Override: true },
          StrictTransportSecurity: Match.objectLike({ IncludeSubdomains: true }),
        }),
      }),
    });
  });
});
