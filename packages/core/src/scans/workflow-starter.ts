import {
  ExecutionAlreadyExists,
  SFNClient,
  StartExecutionCommand,
  StopExecutionCommand,
} from '@aws-sdk/client-sfn';
import type { ScanWorkflowInput } from '@cloudsentry/shared-types';

/** Port that launches the scan workflow. Manual and scheduled scans use the same implementation. */
export interface ScanWorkflowStarter {
  start(input: ScanWorkflowInput): Promise<{ executionArn: string }>;
  stop(executionArn: string, reason: string): Promise<void>;
}

export function executionArnFor(stateMachineArn: string, executionName: string): string {
  return `${stateMachineArn.replace(':stateMachine:', ':execution:')}:${executionName}`;
}

export class StepFunctionsScanStarter implements ScanWorkflowStarter {
  constructor(
    private readonly stateMachineArn: string,
    private readonly client = new SFNClient({ region: process.env.AWS_REGION, maxAttempts: 4 }),
  ) {}

  async start(input: ScanWorkflowInput): Promise<{ executionArn: string }> {
    try {
      // Execution name = scanId: Step Functions rejects duplicate names, making start idempotent.
      const out = await this.client.send(
        new StartExecutionCommand({
          stateMachineArn: this.stateMachineArn,
          name: input.scanId,
          input: JSON.stringify(input),
        }),
      );
      return { executionArn: out.executionArn ?? executionArnFor(this.stateMachineArn, input.scanId) };
    } catch (error) {
      if (error instanceof ExecutionAlreadyExists) {
        return { executionArn: executionArnFor(this.stateMachineArn, input.scanId) };
      }
      throw error;
    }
  }

  async stop(executionArn: string, reason: string): Promise<void> {
    await this.client.send(new StopExecutionCommand({ executionArn, cause: reason.slice(0, 256) }));
  }
}
