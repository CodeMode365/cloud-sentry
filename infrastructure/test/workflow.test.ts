import { describe, expect, it } from 'vitest';
import { handlersPresent, synth } from './helpers';

interface AslState {
  Type: string;
  Next?: string;
  End?: boolean;
  Branches?: { StartAt: string; States: Record<string, AslState> }[];
  Catch?: { ErrorEquals: string[]; Next: string; ResultPath?: string }[];
  Retry?: {
    ErrorEquals: string[];
    IntervalSeconds: number;
    BackoffRate: number;
    MaxAttempts: number;
    JitterStrategy?: string;
  }[];
  ResultPath?: string;
}

function definition(): { StartAt: string; States: Record<string, AslState>; TimeoutSeconds?: number } {
  const t = synth().templates.workflow;
  const machines = t.findResources('AWS::StepFunctions::StateMachine');
  const machine = Object.values(machines)[0] as {
    Properties: { DefinitionString: { 'Fn::Join': [string, unknown[]] } };
  };
  // DefinitionString is Fn::Join of literal fragments and function ARN tokens; replace tokens with a marker.
  const parts = machine.Properties.DefinitionString['Fn::Join'][1].map((p) =>
    typeof p === 'string' ? p : 'arn:TOKEN',
  );
  return JSON.parse(parts.join('')) as { StartAt: string; States: Record<string, AslState> };
}

const MAIN_CHAIN = [
  'ValidateAccount',
  'AssumeCustomerRole',
  'DiscoverResources',
  'ParallelResourceDiscovery',
  'CollectCloudWatchMetrics',
  'AnalyzeAWSCosts',
  'NormalizeResourceData',
  'ExecuteDetectionRules',
  'GenerateRecommendations',
  'EstimateSavings',
  'PersistResults',
  'GenerateScanSummary',
  'SendNotifications',
  'COMPLETE',
];

describe.skipIf(!handlersPresent)('Scan state machine', () => {
  it('is a Standard workflow named cloudsentry-dev-scan with logging and tracing', () => {
    const t = synth().templates.workflow;
    t.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineName: 'cloudsentry-dev-scan',
      StateMachineType: 'STANDARD',
      TracingConfiguration: { Enabled: true },
      LoggingConfiguration: { IncludeExecutionData: false, Level: 'ERROR' },
    });
  });

  it('runs the main chain in the documented order', () => {
    const def = definition();
    expect(def.StartAt).toBe('ValidateAccount');
    expect(def.TimeoutSeconds).toBe(3600);
    for (let i = 0; i < MAIN_CHAIN.length - 1; i++) {
      const state = def.States[MAIN_CHAIN[i] as string];
      expect(state, MAIN_CHAIN[i]).toBeDefined();
      expect(state?.Next, `${MAIN_CHAIN[i]}.Next`).toBe(MAIN_CHAIN[i + 1]);
    }
    expect(def.States.COMPLETE?.Type).toBe('Succeed');
  });

  it('discovers resources in a Parallel state with 16 independently caught branches', () => {
    const parallel = definition().States.ParallelResourceDiscovery as AslState;
    expect(parallel.Type).toBe('Parallel');
    expect(parallel.ResultPath).toBe('$.discovery');
    const starts = (parallel.Branches ?? []).map((b) => b.StartAt).sort();
    expect(starts).toEqual(
      [
        'EBSDiscovery',
        'EC2Discovery',
        'EIPDiscovery',
        'LoadBalancerDiscovery',
        'NATGatewayDiscovery',
        'RDSDiscovery',
        'SnapshotDiscovery',
        'LambdaDiscovery',
        'EKSDiscovery',
        'ElastiCacheDiscovery',
        'CloudFrontDiscovery',
        'EFSDiscovery',
        'DynamoDBDiscovery',
        'RedshiftDiscovery',
        'BackupPlanDiscovery',
        'BackupVaultDiscovery',
      ].sort(),
    );
    for (const branch of parallel.Branches ?? []) {
      const task = branch.States[branch.StartAt] as AslState;
      expect(task.Catch?.[0]?.ErrorEquals).toEqual(['States.ALL']);
      const failed = branch.States[task.Catch?.[0]?.Next as string] as AslState;
      expect(failed.Type).toBe('Pass');
      expect(task.Retry?.[0]).toMatchObject({
        IntervalSeconds: 2,
        BackoffRate: 2,
        MaxAttempts: 4,
        JitterStrategy: 'FULL',
      });
    }
  });

  it('continues past metric, cost and notification failures and routes other failures to MarkScanFailed', () => {
    const states = definition().States;
    expect(states.CollectCloudWatchMetrics?.Catch?.[0]?.Next).toBe('CollectCloudWatchMetricsFailed');
    expect(states.CollectCloudWatchMetricsFailed?.Next).toBe('AnalyzeAWSCosts');
    expect(states.AnalyzeAWSCostsFailed?.Next).toBe('NormalizeResourceData');
    expect(states.SendNotificationsFailed?.Next).toBe('COMPLETE');
    for (const name of ['ValidateAccount', 'AssumeCustomerRole', 'PersistResults', 'GenerateScanSummary']) {
      expect(states[name]?.Catch?.[0]).toMatchObject({ Next: 'MarkScanFailed', ResultPath: '$.error' });
    }
    expect(states.MarkScanFailed?.Next).toBe('ScanFailed');
    expect(states.ScanFailed?.Type).toBe('Fail');
  });
});
