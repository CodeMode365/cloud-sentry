import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  FunctionCode,
  FunctionEventType,
  Function as CloudFrontFunction,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import { REPO_ROOT } from '../constructs/handlers';
import { resourcePrefix, type EnvironmentConfig } from '../environments';

export interface WebStackProps extends StackProps {
  config: EnvironmentConfig;
  /** HTTP API endpoint domain, e.g. abc123.execute-api.us-east-1.amazonaws.com. */
  apiDomainName: string;
}

export const WEB_BUILD_DIR = join(REPO_ROOT, 'apps', 'web', 'out');

/**
 * Next.js static export (apps/web/out) delivered from a private bucket through CloudFront (OAC).
 * /api/* is routed to the HTTP API on the same origin, so the httpOnly refresh cookie stays first-party
 * and no CORS configuration is needed.
 */
export class WebStack extends Stack {
  readonly distribution: Distribution;
  readonly siteBucket: Bucket;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    const { config } = props;
    const prefix = resourcePrefix(config);
    const destroy = config.removalPolicy === RemovalPolicy.DESTROY;

    this.siteBucket = new Bucket(this, 'SiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: config.removalPolicy,
      autoDeleteObjects: destroy,
    });

    // Next.js is exported with trailingSlash: /accounts/ -> /accounts/index.html.
    const rewrite = new CloudFrontFunction(this, 'DirectoryIndexRewrite', {
      functionName: `${prefix}-directory-index`,
      runtime: FunctionRuntime.JS_2_0,
      comment: 'Rewrite directory-style URIs to index.html for the static Next.js export',
      code: FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.split('/').pop().includes('.')) {
    request.uri = uri + '/index.html';
  }
  return request;
}`),
    });

    // Static export pages contain inline bootstrap scripts, so script-src needs 'unsafe-inline'
    // (nonces/hashes are not possible without a server). All other sources are locked to 'self'.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');

    const securityHeaders = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: `${prefix}-security-headers`,
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(730),
          includeSubdomains: true,
          override: true,
        },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        contentTypeOptions: { override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()', override: true },
        ],
      },
    });

    const customDomain =
      config.web.domainName && config.web.certificateArn
        ? {
            domainNames: [config.web.domainName],
            certificate: Certificate.fromCertificateArn(this, 'WebCertificate', config.web.certificateArn),
            minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
          }
        : {};

    this.distribution = new Distribution(this, 'Distribution', {
      comment: `${prefix} dashboard`,
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2_AND_3,
      priceClass: PriceClass.PRICE_CLASS_100,
      ...customDomain,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
        functionAssociations: [{ function: rewrite, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new HttpOrigin(props.apiDomainName, { protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY }),
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          // Caching disabled: with this policy CloudFront forwards the Authorization header and cookies.
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
          compress: true,
        },
      },
      // No custom error responses: they apply to every origin and would replace JSON API errors.
    });

    if (existsSync(WEB_BUILD_DIR)) {
      new BucketDeployment(this, 'DeployWebApp', {
        sources: [Source.asset(WEB_BUILD_DIR)],
        destinationBucket: this.siteBucket,
        distribution: this.distribution,
        distributionPaths: ['/*'],
        prune: true,
        memoryLimit: 512,
      });
    } else {
      Annotations.of(this).addWarningV2(
        'cloudsentry:web-not-built',
        `Dashboard build not found at ${WEB_BUILD_DIR}; the site bucket will be empty. ` +
          'Run `pnpm --filter @cloudsentry/web build` before deploying.',
      );
    }

    new CfnOutput(this, 'DashboardUrl', {
      value: config.web.domainName
        ? `https://${config.web.domainName}`
        : `https://${this.distribution.distributionDomainName}`,
    });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
  }
}
